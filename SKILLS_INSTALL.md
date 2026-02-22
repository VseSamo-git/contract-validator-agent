# Skills — Установка навыков для агента

Claude Code Skills — это файлы с инструкциями, которые автоматически активируются при работе с определёнными задачами. Они "обучают" агента конкретным паттернам без необходимости объяснять каждый раз.

---

## Обязательные скиллы (от n8n-mcp)

Набор из 7 скиллов специально для работы с n8n. Устанавливается из репозитория czlonkowski/n8n-skills.

**Установка вручную:**
```bash
git clone https://github.com/czlonkowski/n8n-skills.git
mkdir -p ~/.claude/skills/
cp -r n8n-skills/skills/* ~/.claude/skills/
# Перезапустить Claude Code
```

**Что входит:**

| Скилл | Когда активируется | Зачем нужен |
|-------|-------------------|-------------|
| n8n Expression Syntax | При написании `{{}}` выражений | Правильный синтаксис $json/$node |
| n8n MCP Tools Expert | При использовании n8n-mcp инструментов | Как правильно искать ноды и валидировать |
| n8n Workflow Patterns | При создании/анализе workflow | 5 проверенных архитектурных паттернов |
| n8n Validation Expert | При интерпретации ошибок валидации | Понимание и исправление ошибок |
| n8n Data Flow | При анализе передачи данных | Понимание $json, $input, connections |
| n8n Error Handling | При работе с ошибками | Паттерны обработки ошибок |
| n8n AI Nodes | При работе с LLM нодами | Специфика Agent/Chain нод |

**GitHub:** https://github.com/czlonkowski/n8n-skills

---

## Кастомный скилл: Contract Validator

Специальный скилл для этого агента. Создаётся вручную.

**Создай файл** `~/.claude/skills/contract-validator.md`:

```markdown
# Contract Validator Skill

Активируется при: анализе контрактов между нодами, поиске несовпадений данных, validate команде.

## Порядок работы

1. ВСЕГДА начинай с получения workflow через n8n API
2. ВСЕГДА строй граф connections перед анализом контрактов
3. НИКОГДА не применяй исправления без явного подтверждения пользователя
4. ВСЕГДА сохраняй отчёт в history/ после анализа
5. ВСЕГДА показывай конкретный код (строку) где найдена проблема

## Уровни проблем (строго)

CRITICAL = поле отсутствует у Provider И нет fallback у Consumer  
CRITICAL = type mismatch — явное несоответствие типов (string vs boolean vs array)  
WARNING = поле условное + есть fallback  
WARNING = поле отсутствует + есть fallback  
INFO = поле есть у Provider но нет Consumer (dead code)  
UNCERTAIN = динамические поля или LLM output

## Формат предложения исправления

Всегда показывай diff:
  До:  const x = $json.missing_field;
  После: const x = $json.correct_field;

## При анализе sub-workflows

Рекурсивно загружать через API, ограничение: 5 уровней глубины.
При цикличности — сообщать пользователю, не уходить в бесконечный цикл.
```

**Установка:**
```bash
mkdir -p ~/.claude/skills
# Скопировать содержимое выше в файл:
nano ~/.claude/skills/contract-validator.md
```

---

## Скилл для работы с историей отчётов

**Создай файл** `~/.claude/skills/report-history.md`:

```markdown
# Report History Skill

Активируется при: сравнении отчётов, --diff флаге, просмотре истории проверок.

## Хранение

Все отчёты: history/{workflow_id}_{YYYY-MM-DD_HH-mm}.json
Формат: JSON с полями runId, timestamp, workflowId, issues[]
Ротация: скрипт save-history.sh хранит последние 10 отчётов на workflow (настраивается через MAX_HISTORY).
Не удалять вручную — только добавлять через save-history.sh.

1. Загрузить последний отчёт для workflow_id из history/
2. Сравнить issues[] по полю id (= level + field + consumer + provider)
3. Показать: новые, исправленные, без изменений
4. Сохранить текущий отчёт как новый файл

## Не удалять старые отчёты — только добавлять новые.
```

---

## Проверка установки скиллов

```bash
ls ~/.claude/skills/
# Должны быть: contract-validator.md, report-history.md, n8n-*.md
```

---

## Структура файлов после установки

```
~/.claude/
├── skills/
│   ├── contract-validator.md     # кастомный скилл (создан вручную)
│   ├── report-history.md         # кастомный скилл (создан вручную)
│   ├── n8n-expression-syntax.md  # из n8n-skills
│   ├── n8n-mcp-tools-expert.md   # из n8n-skills
│   ├── n8n-workflow-patterns.md  # из n8n-skills
│   ├── n8n-validation-expert.md  # из n8n-skills
│   ├── n8n-data-flow.md          # из n8n-skills
│   ├── n8n-error-handling.md     # из n8n-skills
│   └── n8n-ai-nodes.md           # из n8n-skills
```

---

## Порядок установки (полный чеклист)

```
[ ] 1. Установить n8n-mcp MCP сервер (см. MCP_INSTALL.md)
[ ] 2. Клонировать n8n-skills и скопировать в ~/.claude/skills/
[ ] 3. Создать кастомный скилл contract-validator.md
[ ] 4. Создать кастомный скилл report-history.md
[ ] 5. Настроить .env с N8N_BASE_URL и N8N_API_KEY
[ ] 6. Запустить Claude Code и проверить /mcp и /skills
[ ] 7. Тест: validate <workflow_id>
```