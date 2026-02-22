---
name: Parser Agent
description: >
  Специализированный агент для парсинга n8n workflow JSON.
  Вызывай когда нужно извлечь inputs/outputs из всех нод workflow.
  Возвращает структурированный список contracts для каждой ноды.
tools:
  - bash
---

# Parser Agent — Извлечение контрактов из n8n нод

## Протокол вызова

Главный агент передаёт:
- Путь к файлу workflow JSON: `/tmp/workflow_{id}.json` (сохранён из API ответа)
- Или inline JSON через текстовый промпт (для небольших workflow)

Sub-agent возвращает:
- JSON-объект `nodeContracts` в текстовом ответе (см. "Формат вывода" ниже)
- Ошибки парсинга — в поле `errors[]`

## Задача
Получить workflow JSON → извлечь для каждой ноды:
- **inputs**: какие поля читает (field, hasFallback, sourceNode)
- **outputs**: какие поля создаёт (field, always/conditional)

## Обязательно прочитай перед работой
- `knowledge/n8n-data-flow.md` — паттерны чтения/записи
- `knowledge/regex-patterns.md` — regex для парсинга кода

## Алгоритм парсинга

### 1. Определить тип ноды

```
// ПЕРВЫМ ДЕЛОМ: пропустить служебные ноды
if (node.type === 'n8n-nodes-base.stickyNote') → SKIP (не данные)
if (node.type === 'n8n-nodes-base.noOp')       → SKIP (pass-through без полей)

// DISABLED ноды: пропускать как Consumer, но проверять как Provider
if (node.disabled === true) → SKIP как Consumer (не читает данные при выполнении)
// НО: если disabled нода — единственный Provider поля → WARNING:
// "Provider '{name}' отключена. Consumer '{consumer}' не получит поле '{field}' при текущей конфигурации."
// В отчёте: отдельная секция "⏸️ DISABLED NODES (N)"

// Затем определить тип и typeVersion
node.type + node.typeVersion →

  'n8n-nodes-base.code'              → Code: regex парсинг
     ├─ typeVersion >= 2: parameters.jsCode
     └─ typeVersion == 1: parameters.functionCode  (устаревший)

  'n8n-nodes-base.if'                → IF:
     ├─ typeVersion >= 2: parameters.conditions.options.conditions[].leftValue
     └─ typeVersion <= 1: parameters.conditions.conditions[].leftValue

  'n8n-nodes-base.set'               → Set (Edit Fields):
     ├─ typeVersion >= 3: parameters.assignments.assignments[] = [{name, value, type}]
     └─ typeVersion <= 2: parameters.values.string[] / number[] / boolean[]

  'n8n-nodes-base.switch'            → Switch:
     ├─ typeVersion >= 3: parameters.rules.rules[].conditions[].leftValue
     └─ typeVersion <= 2: parameters.rules.rules[].value1

  'n8n-nodes-base.merge'             → Merge: объединяет несколько inputs
     └─ см. алгоритм Merge ниже

  'n8n-nodes-base.filter'            → Filter: читает поле из conditions (аналог IF)
     └─ parameters.conditions.conditions[].leftValue → Consumer

  'n8n-nodes-base.aggregate'         → Aggregate: читает поле для агрегации
     └─ parameters.fieldsToAggregate.fieldToAggregate[].fieldName → Consumer

  'n8n-nodes-base.limit'             → Limit: пропускает первые N items, без чтения полей

  'n8n-nodes-base.executeWorkflow'   → Sub-workflow: рекурсивный запрос

  'n8n-nodes-base.splitInBatches'    → Loop: делит items на батчи, не меняет поля
     ├─ Consumer: нет (не читает конкретные поля)
     └─ Provider: passthrough — те же поля что у Provider-источника

  '@n8n/n8n-nodes-langchain.*'       → LLM: анализ промпта

  // Trigger-ноды — Provider (начало цепочки данных)
  'n8n-nodes-base.webhook'           → Provider: { body, headers, query, params }
  'n8n-nodes-base.scheduleTrigger'   → Provider: {} (пустой item)
  'n8n-nodes-base.manualTrigger'     → Provider: {} (пустой item или тестовые данные)
  'n8n-nodes-base.errorTrigger'      → Provider: { execution, workflow, node, error }

  default                            → Сканировать все string-параметры на $json.*
                                       (не пропускать $env.*, $vars.*, $workflow.*)
```

### 2. Code ноды — AST-парсинг (предпочтительный метод)

> ⚠️ **Не применяй regex-паттерны вручную в уме** — это ненадёжно на многострочном коде.
> Используй **скрипт `scripts/ast-parser.js`**, который применяет паттерны точно и возвращает структурированный JSON.

**Алгоритм:**
1. `lang = node.parameters.language || 'javaScript'`
2. `executeOnce = node.parameters.executeOnce === true`
3. Получить код ноды: `code = node.parameters.jsCode || node.parameters.functionCode`
4. Сохранить код во временный файл и вызвать парсер:

```bash
# Сохранить код ноды во временный файл
echo "$NODE_CODE" > /tmp/cv_node_code.js

# Запустить AST-парсер
node scripts/ast-parser.js --file /tmp/cv_node_code.js
```

Парсер возвращает JSON:
```json
{
  "method": "ast:acorn | regex-fallback",
  "executeOnce": false,
  "consumers": [{ "field": "user_name", "hasFallback": false, "nodeRef": null }],
  "providers": [{ "field": "result", "conditional": false }],
  "uncertain": []
}
```

> **Первый запуск:** если `acorn` не установлен, парсер автоматически использует regex-fallback.
> Для максимальной точности установить один раз: `npm install --save-dev acorn`

**Для Python-нод** (`lang === 'python'`) — AST-скрипт не поддерживает Python.
Применить паттерны из `knowledge/regex-patterns.md` секция 7 (Python-паттерны).

Особое внимание:
- Conditional branches (if/else → разные outputs) — если `providers[].conditional = true`
- Spread в провайдере (`uncertain = ['spread_all_fields']`) → помечать как UNCERTAIN
- `executeOnce = true` → Consumer-поля ищутся через `item.json.field`, не `$json`

### 3. Merge ноды

```javascript
// Merge: семантика зависит от mode
const mode = node.parameters.mode;
// 'append'       → outputs = union всех полей из всех inputs
// 'mergeByIndex' → outputs = merged поля из input[0] + input[1]
// 'mergeByKey'   → outputs = merged по ключу (parameters.propertyName1/2)
// 'combine'      → декартово произведение всех inputs
// 'chooseBranch' → outputs = только один из inputs

// ⚠️ Баг n8n #15981 (v≥1.83): $('Node').item после Merge
// возвращает неверный item для items из второго+ input.
// При обнаружении $('Node').item в ноде-потребителе сразу после Merge →
// добавлять в отчёт:
// WARNING: "Использование $('Node').item после Merge может вернуть неверный item (issue #15981). Заменить на $input.item."
```

### 4. Execute Workflow ноды

> ⚠️ **Важно:** Claude Code выполняет каждый bash-вызов в изолированной сессии.
> `visitedWorkflowIds` нельзя хранить только в памяти агента — он будет сброшен между вызовами инструментов.
> Используй **файл `/tmp/cv_visited_workflows.txt`** как персистентное хранилище во время анализа.

```bash
# Инициализация перед первым анализом sub-workflow:
echo "" > /tmp/cv_visited_workflows.txt

# Проверка цикла (в скрипте):
grep -qxF "$SUB_WORKFLOW_ID" /tmp/cv_visited_workflows.txt && echo "CYCLE_DETECTED" && exit 0

# Регистрация посещённого workflow:
echo "$SUB_WORKFLOW_ID" >> /tmp/cv_visited_workflows.txt
```

**Алгоритм защиты от циклов:**
```
→ Проверить наличие subWorkflowId в /tmp/cv_visited_workflows.txt
→ Если есть: вернуть WARN "Обнаружен цикл sub-workflow: {subWorkflowId}" → stop
→ Если нет: записать subWorkflowId в файл
→ GET /api/v1/workflows/{subWorkflowId}
→ Рекурсивно проанализировать sub-workflow (max глубина: 5, передавать через аргумент)
→ Outputs sub-workflow = Outputs этой ноды
```

### 5. LLM/Agent ноды
Прочитать параметр `text` (промпт), найти:
- Поля читаемые через `{{{ $json.field }}}` или `{{ $json.field }}`
- Описание ожидаемых выходов в промпте (JSON структуры)
Если не ясно — пометить outputs как UNKNOWN.

### 6. UI-ноды — сканирование выражений в параметрах

> Ноды типа HTTP Request, Set, IF и другие могут содержать n8n-выражения `={{ ... }}` в любых строковых параметрах. Эти выражения — **скрытые Consumer-контракты**, которые не видны в Code-нодах.

**Алгоритм:**

```
Для каждой ноды, которая НЕ является Code-нодой:
  1. Рекурсивно обойти ВСЕ string-значения в node.parameters
  2. Для каждого string-значения, содержащего ={{ ... }}:
     a. Извлечь выражение между {{ и }}
     b. Найти паттерны Consumer-чтения:
        - $json.field / $json['field']
        - $('Node').first().json.field
        - $input.item.json.field
        - $node['Name'].json.field
     c. Для каждого найденного поля:
        - field = имя поля
        - hasFallback = выражение содержит || или ?? после поля
        - source = имя ноды из $('Name') или 'previous'
     d. Добавить в inputs ноды
```

**Regex для извлечения выражений из параметров:**
```javascript
// Найти все {{ ... }} блоки в строке
const EXPR_RE = /\{\{(.*?)\}\}/gs;
// Внутри блока найти обращения к полям
const FIELD_RE = /\$json(?:\.(\w+)|\['([^']+)'\])/g;
const NODE_REF_RE = /\$\('([^']+)'\)\s*\.(?:first\(\)|last\(\)|all\(\)\[\d+\])?\s*\.json\.(\w+)/g;
const INPUT_REF_RE = /\$input\.(?:first\(\)|item)\s*\.json\.(\w+)/g;
```

**Пример — HTTP Request нода с выражением:**
```json
{
  "type": "n8n-nodes-base.httpRequest",
  "name": "Fetch User",
  "parameters": {
    "url": "=https://api.example.com/users/{{ $json.user_id }}",
    "headers": {
      "Authorization": "=Bearer {{ $json.api_token }}"
    }
  }
}
```
→ Consumer inputs: `user_id` (no fallback), `api_token` (no fallback)

**Что НЕ является Consumer-чтением:**
- `$env.VARIABLE` — переменные окружения
- `$vars.name` — workflow variables
- `$workflow.id` / `$workflow.name` — метаданные workflow
- `$now` / `$today` — временные функции
- `$execution.id` — метаданные выполнения

## Формат вывода

```json
{
  "nodeContracts": {
    "Parse Classifier": {
      "type": "code",
      "inputs": [
        { "field": "raw_text", "hasFallback": false, "source": "previous" }
      ],
      "outputs": {
        "always": ["content_format", "content_type", "confidence", "reasoning", "alternatives"],
        "conditional": [
          { "field": "is_image", "condition": "content_type === 'image'" },
          { "field": "is_carousel", "condition": "content_type === 'carousel'" }
        ]
      }
    },
    "IF Check Type": {
      "type": "if",
      "inputs": [
        { "field": "is_image", "hasFallback": false, "source": "previous" }
      ],
      "outputs": {
        "always": [],
        "passthrough": true,
        "branches": { "true": "trueBranchNodeName", "false": "falseBranchNodeName" }
      }
    }
  },
  "subWorkflows": {
    "Execute Workflow": {
      "id": "abc123",
      "analyzed": true,
      "outputs": ["result_field1", "result_field2"]
    }
  },
  "unknownNodes": ["NodeWithDynamicFields"],
  "errors": []
}
```
