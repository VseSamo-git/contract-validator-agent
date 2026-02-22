#!/usr/bin/env node
/**
 * ast-parser.js — AST-парсер для точного извлечения полей из Code нод n8n
 *
 * Использование:
 *   node scripts/ast-parser.js '<jsCode>'
 *   node scripts/ast-parser.js --file /tmp/node_code.js
 *   echo '<jsCode>' | node scripts/ast-parser.js --stdin
 *
 * Возвращает JSON:
 * {
 *   "consumers": [{ "field": "name", "hasFallback": bool, "nodeRef": "NodeName"|null }],
 *   "providers": [{ "field": "name", "conditional": bool }],
 *   "uncertain": ["dynamic_key_access"],
 *   "executeOnce": bool
 * }
 *
 * Архитектура: ГИБРИДНЫЙ подход (v5.1)
 *   С acorn: AST парсит (conditional detection, provider structure) + regex дополняет (паттерны) → merge
 *   Без acorn: только regex-fallback
 *
 * Зависимости: только Node.js стандартная библиотека.
 * Для полноценного AST установить: npm install --save-dev acorn
 */

'use strict';

const fs = require('fs');

// ─── Получить код из аргументов ───────────────────────────────────────────
let code = '';

if (process.argv[2] === '--stdin') {
  // Портативно: fd 0 работает на Windows, Linux, macOS (в отличие от /dev/stdin)
  code = fs.readFileSync(0, 'utf8');
} else if (process.argv[2] === '--file' && process.argv[3]) {
  code = fs.readFileSync(process.argv[3], 'utf8');
} else if (process.argv[2]) {
  code = process.argv[2];
} else {
  process.stderr.write('Usage: node ast-parser.js "<code>" | --file <path> | --stdin\n');
  process.exit(1);
}

// ─── Попытка использовать acorn (если установлен) ─────────────────────────
let useAcorn = false;
let acorn;
try {
  acorn = require('acorn');
  useAcorn = true;
} catch (e) {
  // acorn не установлен — используем regex-fallback
}

// ─── Утилиты ──────────────────────────────────────────────────────────────

function stripComments(src) {
  // Сохранить consumer-паттерны из template literals перед удалением
  const templateConsumers = [];
  const withoutTemplates = src.replace(/`([^`]*)`/g, (_, content) => {
    const matches = [...content.matchAll(/\$json\.(\w+)/g)];
    for (const m of matches) templateConsumers.push(m[0]);
    return '""';
  });
  const clean = withoutTemplates
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  return clean + '\n' + templateConsumers.join('\n');
}

// ─── AST-парсер (acorn) ───────────────────────────────────────────────────

function parseWithAcorn(src) {
  const consumers = [];
  const providers = [];
  const uncertain = [];

  let ast;
  try {
    ast = acorn.parse(src, {
      ecmaVersion: 2022,
      sourceType: 'script',
      allowReturnOutsideFunction: true,
    });
  } catch (e) {
    return null; // синтаксическая ошибка — передаём в fallback
  }

  const executeOnce = src.includes('$input.all()');

  // Обход AST с отслеживанием conditional-контекста
  function walk(node, insideConditional, depth) {
    if (!node || typeof node !== 'object') return;
    if (depth > 200) return; // защита от рекурсии

    // Provider: ReturnStatement → ArrayExpression → ObjectExpression → { json: ObjectExpression }
    if (node.type === 'ReturnStatement' && node.argument) {
      extractProviderFromReturn(node.argument, insideConditional);
    }

    // Consumer: MemberExpression — $json.field или $('Node').first().json.field
    if (node.type === 'MemberExpression') {
      const consumer = extractConsumer(node, src);
      if (consumer) {
        if (consumer.uncertain) {
          uncertain.push(consumer.uncertain);
        } else if (consumer.field) {
          consumers.push(consumer);
        }
      }
    }

    // Consumer: destructuring — const { field1, field2 } = $json
    if (node.type === 'VariableDeclarator' &&
        node.id && node.id.type === 'ObjectPattern' &&
        node.init && node.init.type === 'Identifier' && node.init.name === '$json') {
      for (const prop of node.id.properties || []) {
        const field = prop.key && (prop.key.name || prop.key.value);
        if (field) {
          consumers.push({ field, hasFallback: false, nodeRef: null });
        }
      }
    }

    // IfStatement / SwitchStatement — тело помечается как conditional
    if (node.type === 'IfStatement') {
      walk(node.test, insideConditional, depth + 1);
      walk(node.consequent, true, depth + 1);
      if (node.alternate) walk(node.alternate, true, depth + 1);
      return;
    }
    if (node.type === 'SwitchStatement') {
      walk(node.discriminant, insideConditional, depth + 1);
      for (const c of node.cases || []) walk(c, true, depth + 1);
      return;
    }

    for (const key of Object.keys(node)) {
      const child = node[key];
      if (Array.isArray(child)) {
        for (const c of child) walk(c, insideConditional, depth + 1);
      } else if (child && typeof child === 'object' && child.type) {
        walk(child, insideConditional, depth + 1);
      }
    }
  }

  function extractProviderFromReturn(node, conditional) {
    // return [{ json: { ... } }]
    if (node.type === 'ArrayExpression') {
      for (const el of node.elements || []) {
        extractProviderFromReturn(el, conditional);
      }
    } else if (node.type === 'ObjectExpression') {
      for (const prop of node.properties || []) {
        const keyName = prop.key && (prop.key.name || prop.key.value);
        if (keyName === 'json') {
          extractFields(prop.value, conditional);
        }
      }
    }
  }

  function extractFields(node, conditional) {
    if (!node) return;
    if (node.type === 'ObjectExpression') {
      for (const prop of node.properties || []) {
        if (prop.type === 'SpreadElement') {
          uncertain.push('spread_all_fields');
          continue;
        }
        const key = prop.key && (prop.key.name || prop.key.value);
        if (prop.computed) {
          uncertain.push('computed_key');
          continue;
        }
        if (key) {
          providers.push({ field: key, conditional: !!conditional });
        }
      }
    } else if (node.type === 'Identifier') {
      uncertain.push(`variable_return:${node.name}`);
    }
  }

  function checkFallback(node, fullSrc) {
    const pos = node.end;
    // Расширенное окно (30 символов) с нормализацией whitespace — ловит multiline fallback
    const after = fullSrc.slice(pos, pos + 30).replace(/\s+/g, '');
    return after.startsWith('||') || after.startsWith('??') || node.optional;
  }

  function extractConsumer(node, fullSrc) {
    // $json.field или $json['literal'] → MemberExpression: object=Identifier($json)
    if (
      node.object &&
      node.object.type === 'Identifier' &&
      node.object.name === '$json'
    ) {
      if (node.computed) {
        // Различаем $json['literal'] от $json[variable]
        if (node.property && node.property.type === 'Literal' && typeof node.property.value === 'string') {
          const field = node.property.value;
          const hasFallback = checkFallback(node, fullSrc);
          return { field, hasFallback: !!hasFallback, nodeRef: null };
        }
        return { uncertain: `$json[dynamic]` };
      }
      const field = node.property && (node.property.name || node.property.value);
      if (!field) return null;
      const hasFallback = checkFallback(node, fullSrc);
      return { field, hasFallback: !!hasFallback, nodeRef: null };
    }

    // $('NodeName').first().json.field / $input.first().json.field / $node["Node"].json.field
    if (
      node.property && !node.computed &&
      node.object && node.object.type === 'MemberExpression' &&
      node.object.property && node.object.property.name === 'json'
    ) {
      const field = node.property.name || node.property.value;
      if (!field) return null;
      const jsonParent = node.object.object;

      // $('NodeName').first().json.field или $input.first().json.field
      if (jsonParent && jsonParent.type === 'CallExpression') {
        const callee = jsonParent.callee;
        if (callee && callee.type === 'MemberExpression') {
          const methodName = callee.property && callee.property.name;
          if (['first', 'last', 'item'].includes(methodName)) {
            const hasFallback = checkFallback(node, fullSrc);
            let nodeRef = null;
            const baseObj = callee.object;

            // $('NodeName').first() — baseObj = CallExpression($, ['NodeName'])
            if (baseObj && baseObj.type === 'CallExpression' &&
                baseObj.callee && baseObj.callee.type === 'Identifier' && baseObj.callee.name === '$' &&
                baseObj.arguments && baseObj.arguments.length > 0 && baseObj.arguments[0].type === 'Literal') {
              nodeRef = baseObj.arguments[0].value;
            }
            // $input.first() — baseObj = Identifier($input), nodeRef остаётся null
            return { field, hasFallback: !!hasFallback, nodeRef };
          }
        }
      }

      // $input.item.json.field (без скобок — property access, не CallExpression)
      if (jsonParent && jsonParent.type === 'MemberExpression' &&
          jsonParent.property && jsonParent.property.name === 'item' &&
          jsonParent.object && jsonParent.object.type === 'Identifier' && jsonParent.object.name === '$input') {
        const hasFallback = checkFallback(node, fullSrc);
        return { field, hasFallback: !!hasFallback, nodeRef: null };
      }

      // $node["NodeName"].json.field (устаревший синтаксис)
      if (jsonParent && jsonParent.type === 'MemberExpression' &&
          jsonParent.object && jsonParent.object.type === 'Identifier' && jsonParent.object.name === '$node') {
        const hasFallback = checkFallback(node, fullSrc);
        const nodeRef = jsonParent.property && (jsonParent.property.value || jsonParent.property.name);
        return { field, hasFallback: !!hasFallback, nodeRef: nodeRef || null };
      }
    }

    return null;
  }

  walk(ast, false, 0);

  // Дедупликация consumers по полю
  const seenConsumers = new Set();
  const dedupedConsumers = [];
  for (const c of consumers) {
    if (!seenConsumers.has(c.field)) {
      seenConsumers.add(c.field);
      dedupedConsumers.push(c);
    }
  }

  // Дедупликация providers
  const seenProviders = new Set();
  const dedupedProviders = [];
  for (const p of providers) {
    if (!seenProviders.has(p.field)) {
      seenProviders.add(p.field);
      dedupedProviders.push(p);
    }
  }

  return {
    method: 'ast:acorn',
    executeOnce,
    consumers: dedupedConsumers,
    providers: dedupedProviders,
    uncertain: [...new Set(uncertain)],
  };
}

// ─── Regex-fallback (если acorn недоступен) ───────────────────────────────

function parseWithRegex(src) {
  const clean = stripComments(src);
  const executeOnce = /\$input\.all\(\)/.test(clean);
  const consumers = [];
  const providers = [];
  const uncertain = [];

  // Consumers: $json.field (расширенное окно fallback detection — 30 символов, whitespace-normalized)
  for (const m of clean.matchAll(/\$json(?:\?\.|\.)(\w+)/g)) {
    const pos = m.index + m[0].length;
    const after = clean.slice(pos, pos + 30).replace(/\s+/g, '');
    const hasFallback = m[0].includes('?.') || after.startsWith('||') || after.startsWith('??');
    consumers.push({ field: m[1], hasFallback, nodeRef: null });
  }
  // Consumers: $json['field']
  for (const m of clean.matchAll(/\$json\[['"](\w+)['"]\]/g)) {
    consumers.push({ field: m[1], hasFallback: false, nodeRef: null });
  }
  // Consumers: $json[variable] → uncertain
  for (const m of clean.matchAll(/\$json\[([^'"\)\]]+)\]/g)) {
    uncertain.push(`$json[dynamic:${m[1].trim()}]`);
  }
  // Consumers: destructuring
  for (const m of clean.matchAll(/const\s*\{([^}]+)\}\s*=\s*\$json/g)) {
    for (const field of m[1].split(',').map(s => s.trim().split(':')[0].trim())) {
      if (field) consumers.push({ field, hasFallback: false, nodeRef: null });
    }
  }
  // Consumers: $('NodeName').first().json.field
  for (const m of clean.matchAll(/\$\(['"]([^'"]+)['"]\)\.(?:first|last|item)\(\)?\.json(?:\?\.|\.)(\w+)/g)) {
    consumers.push({ field: m[2], hasFallback: m[0].includes('?.'), nodeRef: m[1] });
  }
  // Consumers: $input.first().json.field и $input.item.json.field
  for (const m of clean.matchAll(/\$input\.(?:first|last|item)\(\)?\.json(?:\?\.|\.)(\w+)/g)) {
    consumers.push({ field: m[1], hasFallback: m[0].includes('?.'), nodeRef: null });
  }
  // Consumers: $node["NodeName"].json.field (устаревший)
  for (const m of clean.matchAll(/\$node\[['"]([ ^'"]+)['"]\]\.json(?:\?\.|\.)(\w+)/g)) {
    consumers.push({ field: m[2], hasFallback: m[0].includes('?.'), nodeRef: m[1] });
  }
  // Consumers: $input.all() mode — item.json.field
  for (const m of clean.matchAll(/(?:item|i|el|row|entry|record)\.json\.(\w+)/g)) {
    consumers.push({ field: m[1], hasFallback: false, nodeRef: null });
  }

  // Providers: brace-counting
  const startPattern = /return\s*\[\s*\{[\s\S]*?json\s*:\s*\{/g;
  let match;
  while ((match = startPattern.exec(clean)) !== null) {
    let depth = 1;
    let pos = match.index + match[0].length;
    while (pos < clean.length && depth > 0) {
      if (clean[pos] === '{') depth++;
      if (clean[pos] === '}') depth--;
      pos++;
    }
    const objContent = clean.slice(match.index + match[0].length, pos - 1);
    let innerDepth = 0;
    for (const km of objContent.matchAll(/(\w+)\s*:/g)) {
      const before = objContent.slice(0, km.index);
      innerDepth = (before.match(/\{/g) || []).length - (before.match(/\}/g) || []).length;
      if (innerDepth === 0) providers.push({ field: km[1], conditional: false });
    }
  }
  // Spread
  if (/return\s*\[\s*\{\s*json:\s*\{\s*\.\.\./.test(clean)) {
    uncertain.push('spread_all_fields');
  }

  // Дедупликация
  const seenC = new Set();
  const seenP = new Set();
  return {
    method: 'regex-fallback (install acorn for AST accuracy)',
    executeOnce,
    consumers: consumers.filter(c => !seenC.has(c.field) && seenC.add(c.field)),
    providers: providers.filter(p => !seenP.has(p.field) && seenP.add(p.field)),
    uncertain: [...new Set(uncertain)],
  };
}

// ─── Merge результатов AST + Regex ───────────────────────────────────────

function mergeResults(acornResult, regexResult) {
  // AST даёт: conditional detection для providers, точные uncertain
  // Regex даёт: полное покрытие consumer-паттернов (destructuring, item.json, etc.)
  // Merge: union consumers/providers, prefer acorn для conditional и uncertain

  const consumers = new Map();
  const providers = new Map();

  // Сначала regex (базовый слой)
  for (const c of regexResult.consumers) {
    consumers.set(c.field, c);
  }
  // Потом acorn (перезаписывает с более точным hasFallback)
  for (const c of acornResult.consumers) {
    consumers.set(c.field, c);
  }

  // Для providers: acorn имеет приоритет (conditional detection)
  for (const p of regexResult.providers) {
    providers.set(p.field, p);
  }
  for (const p of acornResult.providers) {
    providers.set(p.field, p); // acorn перезаписывает — у него есть conditional info
  }

  // Uncertain: объединение
  const uncertain = [...new Set([...acornResult.uncertain, ...regexResult.uncertain])];

  return {
    method: 'hybrid:acorn+regex',
    executeOnce: acornResult.executeOnce || regexResult.executeOnce,
    consumers: [...consumers.values()],
    providers: [...providers.values()],
    uncertain,
  };
}

// ─── Основной запуск ──────────────────────────────────────────────────────

let result;

if (useAcorn) {
  const acornResult = parseWithAcorn(code);
  const regexResult = parseWithRegex(code);

  if (acornResult) {
    // Гибридный подход: merge AST + regex для максимального покрытия
    result = mergeResults(acornResult, regexResult);
  } else {
    // Синтаксическая ошибка в AST → только regex
    result = regexResult;
    result.method = 'regex-fallback (AST parse error)';
  }
} else {
  result = parseWithRegex(code);
}

process.stdout.write(JSON.stringify(result, null, 2) + '\n');
