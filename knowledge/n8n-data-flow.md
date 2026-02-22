# n8n Data Flow: структура данных и типы нод

## 1. Структура данных между нодами

```javascript
[{ "json": { "field1": "value1", "field2": 42, "nested": { "sub": true } } }]
```

---

## 2. Чтение данных (Consumer patterns)

```javascript
$json.fieldName                               // прямой доступ
$json['fieldName']                            // bracket notation
$json?.fieldName                              // optional chaining — есть fallback!
$('Node Name').first().json.fieldName         // по имени ноды
$('Node Name').last().json.fieldName
$input.first().json.fieldName                 // generic input
const { field1, field2 } = $json;            // деструктуризация
const data = $('Node').first().json;          // через переменную
={{ $json.fieldName }}                        // expression в UI нодах
```

---

## 3. Создание данных (Provider patterns)

```javascript
return [{ json: { field1: value1, field2: value2 } }];
return items.map(item => ({ json: { ...item.json, newField: value } }));
const result = { field1, field2 }; return [{ json: result }];
return [{ json: { ...$json, newField: 'value' } }]; // spread — наследует ВСЕ поля

// ВНИМАНИЕ: условный return = разные поля в разных ветках!
if (condition) {
  return [{ json: { type: 'a', data: x } }];   // ветка A: поле 'data'
} else {
  return [{ json: { type: 'b', items: y } }];  // ветка B: поле 'items', не 'data'!
}
```

---

## 4. Connections в workflow JSON

```javascript
// workflow.connections:
{ "NodeA": { "main": [[{ "node": "NodeB" }]] } }  // NodeA → NodeB

// IF нода:
{ "IF": { "main": [
  [{ "node": "TrueBranch" }],   // main[0] = true branch
  [{ "node": "FalseBranch" }]   // main[1] = false branch
]}}
```

---

## 5. Типы UI нод и их парсинг

| Тип | node.type | Где читать входы | Где читать выходы |
|-----|-----------|-----------------|-------------------|
| **IF** | `n8n-nodes-base.if` | `parameters.conditions.conditions[].leftValue` | passthrough + 2 ветки |
| **Set** | `n8n-nodes-base.set` | `parameters.assignments.assignments[].value` | `assignments[].name` |
| **Switch** | `n8n-nodes-base.switch` | `parameters.rules.rules[].conditions[].leftValue` | passthrough + N веток |
| **Execute Workflow** | `n8n-nodes-base.executeWorkflow` | передаёт ВСЕ данные в sub-workflow | outputs sub-workflow |
| **LLM/Agent** | `@n8n/n8n-nodes-langchain.*` | промпт + `parameters.text` | UNCERTAIN если не явно |

> ⚠️ **Контракты LangChain нод (важное дополнение):**  
> В современных версиях n8n Provider-контракт AI-агентов **не задаётся в промпте** — он определяется через подключённые ноды Structured Output Parser и JSON Schema инструментов.
>
> **Где искать Provider-контракт для LangChain нод:**
>
> 1. **Structured Output Parser** (`n8n-nodes-langchain.outputParserStructured`) — определяет жёсткую JSON Schema выходных данных агента. Поля ищи в `parameters.schemaType`:
>    ```json
>    { "type": "object", "properties": { "sentiment": {}, "score": {}, "tags": {} } }
>    ```
>    Эти поля — гарантированный Provider-контракт агента.
>
> 2. **Auto-fixing Output Parser** (`n8n-nodes-langchain.outputParserAutofixing`) — оборачивает другой парсер, контракт берётся из вложенного парсера.
>
> 3. **Tool nodes** (`n8n-nodes-langchain.toolWorkflow`, `toolCode`) — параметры `inputSchema` описывают Consumer-контракт инструментов агента.
>
> **Правило анализа:** Если AI Agent нода подключена к Output Parser → извлечь JSON Schema из парсера как Provider-контракт (не UNCERTAIN). Если парсера нет → UNCERTAIN.


| **Merge** | `n8n-nodes-base.merge` | ВСЕ входящие ноды | объединение всех inputs |
| **Split In Batches** | `n8n-nodes-base.splitInBatches` | данные без изменений | **main[0]** = batch items, **main[1]** = done signal (2 выхода!) |
| **Code** | `n8n-nodes-base.code` | jsCode — regex парсинг | jsCode — regex парсинг |
| **HTTP Request** | `n8n-nodes-base.httpRequest` | параметры запроса | `{ json: <response_body> }` — структура зависит от API → UNCERTAIN |
| **Aggregate** | `n8n-nodes-base.aggregate` | `parameters.fieldsToAggregate` | поле-массив с именем из параметра |
| **Filter** | `n8n-nodes-base.filter` | `parameters.conditions` | passthrough (только фильтрует items) |
| **Limit** | `n8n-nodes-base.limit` | — | passthrough |
| **Wait** | `n8n-nodes-base.wait` | — | passthrough |
| **Respond to Webhook** | `n8n-nodes-base.respondToWebhook` | — | passthrough |
| **Error Trigger** | `n8n-nodes-base.errorTrigger` | — | `{ json: { execution, workflow, node, error } }` |
| **Webhook** | `n8n-nodes-base.webhook` | — (начало цепочки) | `{ json: { body, headers, query, params } }` — Provider тела запроса |
| **Schedule Trigger** | `n8n-nodes-base.scheduleTrigger` | — | `{ json: {} }` — пустой item (нет полей) |
| **Manual Trigger** | `n8n-nodes-base.manualTrigger` | — | `{ json: {} }` — пустой item или тестовые данные |
| **Function Item** (устар.) | `n8n-nodes-base.functionItem` | jsCode (старый синтаксис) | jsCode — как Code нода |

> ⚠️ **splitInBatches имеет ДВА выхода:** `main[0]` — текущий batch (items), `main[1]` — сигнал завершения (пустой). Consumer после него должен быть подключён к `main[0]`.

---

## 5а. Режимы выполнения Code ноды

```javascript
// Определить режим — от него зависит набор доступных переменных!
const executeOnce = node.parameters.executeOnce === true;
```

| executeOnce | Режим | Доступные переменные | Паттерны |
|-------------|-------|----------------------|---------|
| `false` (default) | Run Once for **Each** Item | `$json`, `$input.first()`, `$input.item` | JSON_DOT, NODE_REF, DESTRUCTURE |
| `true` | Run Once for **All** Items | `$input.all()`, **$json НЕДОСТУПЕН** | INPUT_ALL, ITEM_JSON_DOT |

---

## 5б. Язык Code ноды (JS vs Python)

```javascript
const lang = node.parameters.language || 'javaScript';
// 'javaScript' → JS паттерны из regex-patterns.md
// 'python'     → Python паттерны из regex-patterns.md
```

Python-специфика:
- `_input.all()` вместо `$input.all()`
- `_json["field"]` вместо `$json.field`
- `return [{"json": {...}}]` — та же структура, другой синтаксис

---

## 6. Sub-workflow анализ

```json
// Execute Workflow нода:
{
  "type": "n8n-nodes-base.executeWorkflow",
  "parameters": { "workflowId": { "value": "ABC123" } }
}
```

### Алгоритм поиска входов sub-workflow

1. Найти ноду типа `n8n-nodes-base.executeWorkflowTrigger` в sub-workflow
2. Её inputs = данные, которые родительский workflow передал через Execute Workflow
3. Анализировать как обычные `$json.*` Consumer-паттерны
4. Если нода не найдена → sub-workflow не принимает входных данных

### Алгоритм поиска выходов sub-workflow

1. Найти ноды, у которых нет исходящих connections (`terminal nodes`)
2. Если их несколько → объединить поля из всех (union)
3. Поля, которые есть только в некоторых terminal-нодах → отметить как conditional
4. Подставить в граф основного workflow как outputs ноды Execute Workflow

### Защита от бесконечной рекурсии

```javascript
const workflowId = node.parameters.workflowId?.value || node.parameters.workflowId;

// Передавать через всю цепочку:
visitedWorkflowIds = new Set()
depthCount = 0

function analyzeSubWorkflow(id, depth, visited) {
  if (depth >= 5) → WARN "Достигнут лимит глубины (5)" → return null
  if (visited.has(id)) → WARN "Цикл: {id} уже анализировался" → return null
  visited.add(id)
  // ... рекурсивный анализ ...
}
```

---

## 7. Построение графа connections

```javascript
// Из workflow.connections → { NodeA: [NodeB, NodeC], NodeB: [NodeD] }
// + branchInfo: { "NodeA->NodeB": { branch: 'true', index: 0 } }

workflow.connections[sourceName].main.forEach((branch, branchIndex) => {
  branch.forEach(conn => {
    graph[sourceName].push(conn.node);
    branchInfo[`${sourceName}->${conn.node}`] = {
      branch: branchIndex === 0 ? 'true' : 'false',
      index: branchIndex
    };
  });
});
```

---

## Дополнительные паттерны и особые случаи

### Встроенные переменные n8n (не Consumer-поля)

Следующие выражения **не являются** обращением к Provider-полям — их нужно **исключать** из Consumer-анализа:

```javascript
// Метаданные workflow — НЕ поля данных
$workflow.id          // ID текущего workflow
$workflow.name        // имя workflow
$workflow.active      // статус активности

// Метаданные выполнения
$execution.id         // ID текущего execution
$execution.mode       // 'manual' | 'trigger' | 'webhook'
$runIndex             // индекс текущего run (для Split In Batches)
$itemIndex            // индекс текущего item

// Переменные окружения (не Provider-поля!)
$env.VARIABLE_NAME    // переменная окружения n8n
$vars.variableName    // переменная из n8n Variables (n8n ≥1.19)

// Устаревший синтаксис (встречается в старых workflow)
$node["NodeName"].data.json.field   // эквивалент $('NodeName').first().json.field
$node["NodeName"].json.field        // альтернативная запись
```

> **Правило:** при встрече `$env.*`, `$vars.*`, `$workflow.*`, `$execution.*`, `$runIndex`, `$itemIndex` — помечать как SKIP (не Consumer, не UNCERTAIN).

---

### typeVersion-aware парсинг параметров

**КРИТИЧНО:** структура `parameters` меняется между версиями ноды. Всегда проверять `node.typeVersion` перед парсингом.

```javascript
// Set нода (Edit Fields)
// typeVersion <= 2: parameters.values.string[] / number[] / boolean[]
// typeVersion >= 3: parameters.assignments.assignments[] = [{name, value, type}]

// IF нода
// typeVersion <= 1: parameters.conditions.conditions[].leftValue
// typeVersion >= 2: parameters.conditions.options.conditions[].leftValue

// Switch нода
// typeVersion <= 2: parameters.rules.rules[].value1
// typeVersion >= 3: parameters.rules.rules[].conditions[].leftValue

// Code нода
// typeVersion = 1: parameters.functionCode (устаревшее поле!)
// typeVersion >= 2: parameters.jsCode (актуальное)

function getCodeField(node) {
  if (node.type !== 'n8n-nodes-base.code') return null;
  return node.parameters.jsCode || node.parameters.functionCode || null;
}
```

---

### Merge нода: семантика по режимам

Merge нода объединяет несколько входных потоков. Её Consumer-контракт зависит от режима (`parameters.mode`):

```javascript
// Режимы Merge ноды:
// 'append'       — просто объединить все items из всех inputs
//                  outputs = union(input[0], input[1], ...) — все поля доступны
// 'mergeByIndex' — объединить items по индексу (ZIP)
//                  outputs = merge(input[0][i], input[1][i]) — поля из обоих inputs
// 'mergeByKey'   — объединить по значению ключа
//                  parameters.joinMode, parameters.propertyName1/2
// 'combine'      — декартово произведение
// 'chooseBranch' — пропустить только один из inputs

// ⚠️ ИЗВЕСТНЫЙ БАГ (n8n issue #15981, версии ≥1.83):
// $('NodeName').item в ноде ПОСЛЕ Merge возвращает неверный item
// для items из второго и последующих inputs.
// Фикс: использовать $input.item вместо $('NodeName').item
```

---

### Split In Batches: правильная семантика

```javascript
// Split In Batches НЕ "пропускает данные без изменений"!
// Она разбивает items на батчи и возвращает их по одному:
//
// Первый проход: возвращает items[0..batchSize-1] → main[0] (loop branch)
// Промежуточные: возвращает следующий батч → main[0] (loop branch)  
// Последний:     когда батчи исчерпаны → main[1] (done branch)
//
// Consumer после Split In Batches получает ПОДМНОЖЕСТВО items, не все.
// Поля данных — те же, структура items — та же, но количество меньше.
//
// parameters.batchSize — размер батча (default: 1)
// У Split In Batches НЕТ параметра maxIterations — единственная защита: workflow.settings.executionTimeout
```

---

### Sticky Notes — исключать из парсинга

```javascript
// Sticky Notes появляются как ноды в workflow.nodes, но не являются нодами обработки данных
// Всегда пропускать при парсинге:
if (node.type === 'n8n-nodes-base.stickyNote') {
  continue; // не анализировать
}
```

---

### pairedItem — механизм связи items

```javascript
// n8n использует pairedItem для отслеживания связи входных и выходных items
// Появляется в данных: item.pairedItem = { item: 0 } (индекс входного item)
//
// Влияние на Contract анализ:
// - Merge нода с mode='mergeByIndex': pairedItem определяет, какой item с какого input
// - $('Node').item в цикле: полагается на pairedItem для корректного возврата item
// - Если pairedItem не задан явно → $('Node').item может вернуть первый item (silent bug!)
//
// Для агента: если видим $('Node').item (без .first()/.last()) —
// помечать как UNCERTAIN если нода источник — Merge или имеет несколько inputs
//
// ⚠️ ИЗВЕСТНЫЙ БАГ (n8n issue #15981, версии ≥1.83):
// Consumer после Merge использует $('Node').item → неверный item для второго+ input.
//
// Фиксы в зависимости от намерения:
//   Если нужно глобальное значение (одно для всех):
//     $('Node').first().json.field      ← использовать
//   Если нужен item текущей итерации:
//     $input.item.json.field            ← использовать
//   НЕ использовать: $('Node').item.json.field  ← сломано после Merge ≥1.83
```
