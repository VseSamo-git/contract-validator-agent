# /diff — Сравнение с предыдущим запуском

Сравнивает текущий анализ workflow с последним сохранённым отчётом.

## Использование
```
/diff {workflow_id}
/diff                        ← читает ID из .last_workflow_id
```

Если `.last_workflow_id` не существует и ID не передан — спросить у пользователя.

## Что делает
1. Находит последний отчёт в `history/{workflow_id}_*.json`
2. Запускает `/validate {workflow_id}` для получения актуального состояния
3. Сравнивает issues по полю `id` из JSON (не YAML frontmatter)
4. Генерирует diff-отчёт по формату из knowledge/report-format.md

## Идентификатор issue
Уникальный ключ: `{level}|{field}|{consumer}|{provider}`  (разделитель — pipe, как в JSON-отчётах)
Пример: `CRITICAL|model_hint|Map to Pipeline Input|Model Selector`

## Алгоритм сравнения

```
Предыдущий отчёт (из history/{workflow_id}_*.json) → извлечь список issues[].id
Текущий анализ → список issues[].id
Сравнить:
  - В текущем, нет в предыдущем → НОВОЕ (регрессия)
  - В предыдущем, нет в текущем → ИСПРАВЛЕНО
  - В обоих → без изменений
```

## Вывод
```markdown
# Contract Testing DIFF: {Workflow Name}
...
## Тренд: CRITICAL 2→1 ✅, WARNING 5→5, INFO 8→7 ✅
```
