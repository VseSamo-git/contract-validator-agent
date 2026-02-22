# Regex-паттерны для парсинга n8n нод

> 🔧 **Предпочтительный способ анализа Code нод — скрипт `scripts/ast-parser.js`**.
> Он запускается через `node scripts/ast-parser.js --file /tmp/cv_node_code.js` и возвращает
> готовые consumer/provider поля без необходимости применять паттерны вручную.
>
> Этот файл служит документацией паттернов и используется как **fallback**:
> - для Python-нод (AST-парсер не поддерживает Python)
> - для понимания логики, если нужна ручная проверка
> - для UI-нод (IF, Set, Switch) — они не обрабатываются AST-парсером

## 0. Обязательный предшаг: убрать комментарии из кода

> ⚠️ **Критично:** Применять все паттерны **только к очищенному коду**. Без этого fallback-детектор ложно срабатывает на комментарии вида `// $json.field || default`.

```javascript
function stripComments(code) {
  // Шаг 1: Извлечь Consumer-паттерны из template literals ДО их удаления
  // Иначе `Hello ${$json.user_name}` потеряет ссылку на поле
  const templateConsumers = [];
  const codeWithoutTemplates = code.replace(/`([^`]*)`/g, (_, content) => {
    const matches = [...content.matchAll(/\$json\.(\w+)/g)];
    for (const m of matches) templateConsumers.push(m[0]);
    return '""'; // заменить template literal на пустую строку
  });

  // Шаг 2: Убрать комментарии из кода без template literals
  const cleanCode = codeWithoutTemplates
    .replace(/\/\/[^\n]*/g, '')      // однострочные: // ...
    .replace(/\/\*[\s\S]*?\*\//g, ''); // многострочные: /* ... */

  // Шаг 3: Вернуть Consumer-паттерны из template literals как отдельные строки
  // чтобы regex-паттерны их нашли
  return cleanCode + '\n' + templateConsumers.join('\n');
}
// Всегда: const cleanCode = stripComments(node.parameters.jsCode);
```

> ⚠️ **Почему важен Шаг 1:** Простая замена `` `...` → "" `` удаляет Consumer-паттерны вида `\`Hello ${$json.user_name}\`` — реальные CRITICAL-проблемы остаются невидимыми.

---

## 1. Определение режима Code ноды

```javascript
// СНАЧАЛА определить режим — от него зависит какие паттерны применять
const executeOnce = node.parameters.executeOnce === true;
// executeOnce = true  → "Run Once for All Items": $json НЕДОСТУПЕН, только $input.all()
// executeOnce = false → "Run Once for Each Item" (default): $json, $input.first()
```

---

## 2. Извлечение ВХОДОВ (Consumer patterns)

### JavaScript — режим "For Each Item" (executeOnce = false)

```javascript
// $json.field
const PATTERN_JSON_DOT      = /\$json\.(\w+)/g;
const PATTERN_JSON_BRACKET  = /\$json\[['"](\w+)['"]\]/g;
const PATTERN_JSON_OPT      = /\$json\?\.(\w+)/g;             // ← есть fallback

// $('NodeName').first().json.field → [nodeName, fieldName]
const PATTERN_NODE_REF      = /\$\(['"]([^'"]+)['"]\)\.(?:first|last|item)\(\)?\.json\.(\w+)/g;
const PATTERN_NODE_REF_OPT  = /\$\(['"]([^'"]+)['"]\)\.(?:first|last|item)\(\)?\.json\?\.(\w+)/g;

// $input.first().json.field  |  $input.item.json.field
const PATTERN_INPUT_FIRST   = /\$input\.(?:first|item)\(\)?\.json\.(\w+)/g;
const PATTERN_INPUT_ITEM    = /\$input\.item\.json\.(\w+)/g;

// const { field1, field2 } = $json
const PATTERN_DESTRUCTURE   = /const\s*\{([^}]+)\}\s*=\s*\$json/g;

// const data = $('Node').first().json → затем data.field (трекать через переменную)
const PATTERN_VAR_ASSIGN    = /const\s+(\w+)\s*=\s*\$\(['"]([^'"]+)['"]\)\.(?:first|last)\(\)\.json/g;
// После нахождения: искать varName\.(\w+) в остатке кода

// Expressions в UI нодах: ={{ $json.field }}
const PATTERN_EXPRESSION_JSON = /\{\{\s*\$json\.(\w+)/g;
const PATTERN_EXPRESSION_NODE = /\{\{\s*\$\(['"]([^'"]+)['"]\)\.(?:first|last)\(\)\.json\.(\w+)/g;
```

### JavaScript — режим "Run Once for All Items" (executeOnce = true)

```javascript
// $input.all() → затем item.json.field (или i.json.field, el.json.field)
const PATTERN_INPUT_ALL     = /\$input\.all\(\)/g;

// После детекции $input.all(): искать паттерны чтения через итератор
// Например: items.map(item => item.json.FIELD) или for (const i of items) i.json.FIELD
const PATTERN_ITEM_JSON_DOT = /(?:item|i|el|row|entry|record)\.json\.(\w+)/g;
const PATTERN_ITEM_JSON_BR  = /(?:item|i|el|row|entry|record)\.json\[['"](\w+)['"]\]/g;
```

### Python (node.parameters.language === 'python')

```python
# _input.all() — аналог $input.all()
PATTERN_PY_INPUT_ALL  = r'_input\.all\(\)'

# item["json"]["field"]  или  item['json']['field']
PATTERN_PY_ITEM_JSON  = r'(?:item|i|el|row)\[["\'"]json["\']\]\[["\'"](\ w+)["\']\]'

# _json["field"]  или  _json['field']
PATTERN_PY_JSON_BR    = r'_json\[["\'"](\ w+)["\']\]'

# return [{"json": {"key": value}}]
PATTERN_PY_RETURN     = r'return\s*\[\s*\{\s*["\']json["\']\s*:\s*\{'
```

---

## 3. Извлечение ВЫХОДОВ (Provider patterns)

> ⚠️ **Критично:** `[^}]+` в regex **НЕ работает** для многострочных/вложенных объектов.  
> Используй **счётчик скобок** — он единственный надёжный метод.

```javascript
/**
 * Извлечь поля первого уровня из всех return [{ json: {...} }] в коде.
 * Работает с многострочными объектами и вложенными структурами.
 */
function extractProviderFields(code) {
  const results = [];
  // Найти позицию json: { в каждом return [{
  const startPattern = /return\s*\[\s*\{[\s\S]*?json\s*:\s*\{/g;
  let match;

  while ((match = startPattern.exec(code)) !== null) {
    let depth = 1;
    let pos = match.index + match[0].length;

    // Пройти по символам со счётчиком скобок
    while (pos < code.length && depth > 0) {
      if (code[pos] === '{') depth++;
      if (code[pos] === '}') depth--;
      pos++;
    }

    // Содержимое объекта первого уровня
    const objContent = code.slice(match.index + match[0].length, pos - 1);

    // Извлечь ключи ТОЛЬКО первого уровня (не вложенных объектов)
    let innerDepth = 0;
    const keyPattern = /(\w+)\s*:/g;
    let keyMatch;
    while ((keyMatch = keyPattern.exec(objContent)) !== null) {
      // Считаем скобки до этой позиции — ключ первого уровня если depth = 0
      const before = objContent.slice(0, keyMatch.index);
      innerDepth = (before.match(/\{/g) || []).length - (before.match(/\}/g) || []).length;
      if (innerDepth === 0) {
        results.push(keyMatch[1]);
      }
    }
  }
  return [...new Set(results)]; // дедупликация
}

// Spread-оператор: return [{ json: { ...varName } }] → наследует ВСЕ поля переменной
const PATTERN_RETURN_SPREAD = /return\s*\[\s*\{\s*json:\s*\{\s*\.\.\.(\ w+)/g;

// return [{ json: varName }] → ищем const varName = { ... }
const PATTERN_RETURN_VAR    = /return\s*\[\s*\{\s*json:\s*(\w+)/g;
```

---

## 4. Fallback-детектор (снижает CRITICAL → WARNING)

```javascript
// Применять ТОЛЬКО к stripComments(code), иначе ложные срабатывания на комментарии

const HAS_FALLBACK_OR  = /\$json\.(\w+)\s*\|\|/;
const HAS_FALLBACK_NC  = /\$json\.(\w+)\s*\?\?/;
const HAS_OPTIONAL_CHN = /\$json\?\.(\w+)/;

// Для режима input.all(): fallback через итератор
const HAS_ITEM_FALLBACK = /(?:item|i)\.json\?\.(\w+)|(?:item|i)\.json\.(\w+)\s*\|\|/;
```

---

## 5. Что НЕ покрывают паттерны → UNCERTAIN

| Ситуация | Действие |
|----------|----------|
| `$json[variableName]` — динамический ключ | Пометить UNCERTAIN |
| `{ [computedKey]: value }` — вычисляемый ключ в Provider | Пометить UNCERTAIN |
| LLM output поля | Анализ промпта на явные JSON-схемы |
| Промежуточные переменные через 3+ строки | Best-effort через PATTERN_VAR_ASSIGN |
| Python: `_json[variable]` | Пометить UNCERTAIN |

---

## 6. Полный алгоритм применения паттернов

```
Для каждой Code ноды:

  1. cleanCode = stripComments(node.parameters.jsCode)
  2. lang = node.parameters.language || 'javaScript'
  3. executeOnce = node.parameters.executeOnce === true

  4. Если lang === 'python':
     → применить Python-паттерны
     → перейти к шагу 8

  5. Найти Consumer-поля (входы):
     Если executeOnce = false:
       → PATTERN_JSON_DOT, BRACKET, OPT
       → PATTERN_NODE_REF, NODE_REF_OPT
       → PATTERN_INPUT_FIRST, INPUT_ITEM
       → PATTERN_DESTRUCTURE
       → PATTERN_VAR_ASSIGN → затем varName\.(\w+) в остатке кода
       → PATTERN_EXPRESSION_JSON, EXPRESSION_NODE
     Если executeOnce = true:
       → PATTERN_INPUT_ALL (детекция режима)
       → PATTERN_ITEM_JSON_DOT, ITEM_JSON_BR

  6. Для каждого найденного поля:
     hasFallback = HAS_FALLBACK_OR || HAS_FALLBACK_NC || HAS_OPTIONAL_CHN
                   || HAS_ITEM_FALLBACK (если executeOnce)

  7. Найти Provider-поля (выходы):
     → extractProviderFields(cleanCode) — счётчик скобок
     → PATTERN_RETURN_SPREAD → пометить как "inherits all from {varName}"
     → PATTERN_RETURN_VAR → найти объявление → extractProviderFields

  8. Определить условность:
     → Если return внутри if/else → outputs помечаются как conditional
     → Для каждого conditional output: в какой ветке (true/false) появляется
```

---

## 7. Python-паттерны для Code нод (language: 'python')

> Применять когда `node.parameters.language === 'python'` (поддержка с n8n v1.0+).

### Consumer patterns (Python)

```python
import re

# _json["field"] или _json['field'] — основной способ доступа в Python-нодах
PATTERN_PY_JSON_BRACKET = r'_json\[[\'"](\w+)[\'"]\]'

# _json.get("field") — безопасный доступ (аналог optional chaining — есть fallback!)
PATTERN_PY_JSON_GET     = r'_json\.get\([\'"](\w+)[\'"]'

# item["json"]["field"] — доступ через items loop
PATTERN_PY_ITEM_JSON    = r'item\[[\'"']json[\'"]\]\[[\'"](\w+)[\'"]\]'

# _input.first()["json"]["field"]
PATTERN_PY_INPUT_FIRST  = r'_input\.first\(\)\[[\'"']json[\'"]\]\[[\'"](\w+)[\'"]\]'

# Деструктуризация: field = _json["field"] или field = _json.get("field")
PATTERN_PY_ASSIGN       = r'(\w+)\s*=\s*_json(?:\.get\(|)\[[\'"](\w+)[\'"]\]'
```

### Provider patterns (Python)

```python
# return [{"json": {"key": value, ...}}]
PATTERN_PY_RETURN       = r'return\s+\[\s*\{\s*["\']json["\']\s*:\s*\{([^}]+)\}'

# Ключи в возвращаемом dict
PATTERN_PY_DICT_KEY     = r'["\'](\ w+)["\']:\s*'
```

### Fallback-детектор (Python)

```python
# field = _json.get("key", default)  →  есть fallback
HAS_PY_FALLBACK_GET = r'_json\.get\([\'"](\w+)[\'"],\s*[^\)]+\)'

# field = _json["key"] if "key" in _json else default  →  есть fallback
HAS_PY_FALLBACK_IF  = r'_json\[[\'"](\w+)[\'"]\]\s+if\s+[\'"](\w+)[\'"]\s+in\s+_json'
```

### Переменные n8n в Python-режиме

В Python Code нодах переменные называются через underscore, не `$`:
- `$json` → `_json`
- `$input.first()` → `_input.first()`
- `$('Node').first().json` → `_('Node').first()["json"]`

> ⚠️ Если нода содержит `language: 'python'`, применять **только** Python-паттерны. Смешивать JS и Python паттерны нельзя.
