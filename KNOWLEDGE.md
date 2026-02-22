# Knowledge Base — Индекс

> **Важно:** Не дублировать содержимое knowledge/ файлов. Этот файл — навигация + уникальные разделы.

## Что где найти

| Тема | Файл | Когда читать |
|------|------|-------------|
| Концепция контрактов, матрица уровней | `knowledge/contract-testing.md` | Перед первым анализом |
| n8n data flow, типы нод, consumer/provider паттерны | `knowledge/n8n-data-flow.md` | При парсинге нод |
| FlowLint R1-R10 (config audit) | `knowledge/flowlint-rules.md` | При FlowLint проверке |
| Regex-паттерны парсинга | `knowledge/regex-patterns.md` | При fallback без acorn |
| Формат JSON/Markdown отчёта | `knowledge/report-format.md` | При генерации отчёта |

---

## Ключевые архитектурные решения

- **Mermaid + ASCII** для графов контрактов — Mermaid рендерится в GitHub/Obsidian, ASCII для терминала
- **PactFlow интеграция** через REST API, не MCP — официального MCP-пакета не существует
- **Brace counting** вместо `[^}]+` regex для Provider-полей — работает с вложенными объектами
- **Sub-workflow рекурсия** с file-based visited tracking + depth limit 5

---

## База прецедентов (реальные паттерны багов)

| Паттерн | Описание | Частота |
|---------|----------|--------|
| **Shadow field** | Consumer читает `field_hint`, Provider возвращает `field` | Высокая |
| **Branch blindness** | Consumer не обрабатывает одну из веток IF | Высокая |
| **Rename drift** | Provider переименовал поле, Consumer не обновили | Высокая |
| **Type confusion** | Provider: `"true"` (string), Consumer: `=== true` (boolean) | Средняя |
| **Dead passthrough** | Поле передаётся через 3 ноды и нигде не используется | Средняя |
| **Undefined cascade** | `undefined` передаётся дальше и ломает 3-ю ноду | Низкая |
| **Merge item reference bug** | `$('Node').item` падает для items из 2+ input в Merge (n8n >=1.83, issue #15981) | Высокая |
| **executeOnce mismatch** | Code нода в режиме "All Items" использует `$json` — не работает в runtime | Средняя |

---

## Ресурсы

### Эталонные фреймворки
- **Pact.io** — https://docs.pact.io/
- **pact-js** (11.8K stars) — https://github.com/pact-foundation/pact-js
- **Data Contract Specification** — https://github.com/datacontract/datacontract-specification

### PactFlow: публикация контрактов через REST API

Если в `.env` заданы `PACTFLOW_URL` и `PACTFLOW_TOKEN`, агент может публиковать контракты в PactFlow:

```
PUT /pacts/provider/{provider_name}/consumer/{consumer_name}/version/{consumer_version}
```

> Документация: https://docs.pactflow.io/docs/api/
> Токен: PactFlow Settings > API Tokens

### n8n-специфичные
- **n8n-mcp** (13.8K stars) — https://github.com/czlonkowski/n8n-mcp
- **n8n-skills** (2.9K stars) — https://github.com/czlonkowski/n8n-skills
- **n8n встроенный MCP** — https://docs.n8n.io/advanced-ai/accessing-n8n-mcp-server/
- **n8n Security Audit API** — `POST {N8N_BASE_URL}/api/v1/audit` (нативный аудит)
- **n8n Nodelinter** (~70 правил) — линтер для разработчиков кастомных нод (НЕ для workflow JSON)
- **FlowLint** — https://flowlint.dev/ (правила R1-R10 в `knowledge/flowlint-rules.md`)
- **n8n GitHub issue #15981** (Merge баг) — https://github.com/n8n-io/n8n/issues/15981

### Тестовые данные
- **Zie619/n8n-workflows** (4343 workflow JSON) — https://github.com/Zie619/n8n-workflows
- **zengfr/n8n-workflow-all-templates** (7439+ workflow JSON) — https://github.com/zengfr/n8n-workflow-all-templates

### Аудит и безопасность
- **n8n-Audit-Workflow** (runtime аудитор) — https://github.com/christinec-dev/n8n-Audit-Workflow
- **audit8n.com** (browser-based) — https://audit8n.com/en
- **makafeli/n8n-workflow-builder** (MCP с `generate_audit`) — https://github.com/makafeli/n8n-workflow-builder

### Документация n8n
- Expressions API — https://docs.n8n.io/code/expressions/
- Code node — https://docs.n8n.io/code/code-node/
- n8n REST API — https://docs.n8n.io/api/