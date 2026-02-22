# Contract Validator Agent — Handoff для исправлений

> ⚠️ **[STALE]** Этот handoff относится к версии до v5.0. Блокеры K1-K7, Z2, Z7 уже исправлены. Используйте как историческую справку.

**Создан:** 2026-02-22
**Цель:** Исправить найденные проблемы по аудиту _AUDIT_REPORT.md

---

## Контекст

Contract Validator Agent — Claude Code агент для статического анализа n8n workflow.
Находит несовпадения данных (контрактов) между нодами: когда Consumer ожидает поле, которое Provider не создаёт.

**Расположение проекта:** `d:\Agents\contract-validator-agent\agent-patched\`

---

## Структура файлов

```
agent-patched/
├── CLAUDE.md                          # Главные инструкции агента (284 строки)
├── QUICKSTART.md                      # Быстрый старт (121 строка)
├── KNOWLEDGE.md                       # Knowledge base — ДУБЛИРУЕТ knowledge/ (366 строк)
├── MCP_INSTALL.md                     # MCP серверы (218 строк)
├── SKILLS_INSTALL.md                  # Скиллы (148 строк)
├── .claude/
│   ├── agents/
│   │   ├── parser.md                  # Sub-agent парсинга нод
│   │   └── reporter.md               # Sub-agent генерации отчётов
│   └── commands/
│       ├── validate.md                # /validate команда
│       ├── diff.md                    # /diff команда
│       └── fix.md                     # /fix команда
├── knowledge/
│   ├── contract-testing.md            # Концепция + матрица уровней
│   ├── flowlint-rules.md             # FlowLint R1-R10
│   ├── n8n-data-flow.md              # n8n data flow + типы нод
│   ├── regex-patterns.md             # Regex-паттерны парсинга
│   └── report-format.md              # Формат отчётов
├── scripts/
│   ├── ast-parser.js                  # AST/regex парсер Code нод
│   ├── diff_reports.sh                # Diff двух отчётов
│   ├── fetch-workflow.sh              # Получение workflow из API
│   └── save-history.sh               # Сохранение в историю
├── test/
│   └── sample-workflow.json           # Тестовый workflow с намеренными багами
├── history/
│   ├── .gitkeep
│   └── README.md
├── .env.example
├── .mcp.json.example
├── .gitignore
├── _AUDIT_REPORT.md                   # ← АУДИТ (читать первым)
└── _HANDOFF.md                        # ← ЭТОТ ФАЙЛ
```

---

## Что исправлять — сводка из _AUDIT_REPORT.md

### Блокеры (5 фиксов)

| ID | Файл | Что | Сложность |
|----|-------|-----|-----------|
| K1 | `.claude/commands/fix.md:26` | `PATCH` → `POST` для activate | 1 строка |
| K2 | `.env.example`, `.mcp.json.example`, `MCP_INSTALL.md`, `QUICKSTART.md`, `KNOWLEDGE.md` | Стандартизировать `N8N_BASE_URL` vs `N8N_API_URL` — добавить обе переменные с комментарием | 5 файлов |
| K3 | `scripts/ast-parser.js` | Добавить consumer-паттерны: `$('Node').first().json.field`, `$input.first().json.field` — и в AST, и в regex-fallback | ~40 строк кода |
| K5 | `.claude/commands/validate.md:66` | Перенумеровать: Шаг 3 → Шаг 5 (пропущен Шаг 4) | Нумерация |
| K7 | `QUICKSTART.md` | Добавить секцию Windows: jq install, chmod не нужен, /dev/stdin caveat | 10 строк |

### Важные (выборочно, по приоритету)

| ID | Файл | Что |
|----|-------|-----|
| K4 | `KNOWLEDGE.md` | Сократить с 366 строк до ~40 (индекс-файл, убрать дупликаты knowledge/) |
| K6 | `CLAUDE.md`, `.claude/agents/parser.md` | Добавить обработку disabled нод (`node.disabled === true`) |
| V1 | `scripts/ast-parser.js` | Добавить conditional detection: проверять, внутри IfStatement ли ReturnStatement |
| V2 | `scripts/ast-parser.js` | Увеличить окно fallback detection с 4 до 20 символов |
| V3 | `knowledge/flowlint-rules.md` | R8: убрать несуществующий `maxIterations`, оставить `workflow.settings.executionTimeout` |
| V6 | `.claude/agents/reporter.md`, `scripts/diff_reports.sh` | Стандартизировать CONFIG issue id формат для 4-поля pipe |
| V12 | `knowledge/n8n-data-flow.md`, `.claude/agents/parser.md` | Описать Trigger-ноды как Provider (Webhook → $json.body/headers/query) |

### Мелкие

| ID | Файл | Что |
|----|-------|-----|
| V11 | `QUICKSTART.md` | "5 шагов" → "6 шагов" в заголовке |
| Z2 | корень | Создать `package.json` с `acorn` в devDependencies |
| Z7 | `CLAUDE.md` | Добавить версию агента |

---

## Порядок работы

1. Прочитать `_AUDIT_REPORT.md` — полные описания проблем с примерами фиксов
2. Блокеры K1, K2, K5, K7 — простые текстовые правки
3. K3 — самый крупный фикс (ast-parser.js), прочитать текущий код + описание проблемы
4. K4 — рефакторинг KNOWLEDGE.md
5. Остальные V* по приоритету
6. Z* — если останется время

---

## Язык

- Комментарии в коде: русский
- Коммуникация: русский
- Технические идентификаторы: английский
