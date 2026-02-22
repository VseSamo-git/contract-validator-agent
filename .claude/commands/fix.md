# /fix — Применить исправления

Применяет предложенные fix к workflow в n8n. ТОЛЬКО после подтверждения.

## Использование
```
/fix           ← применяет первый pending fix
/fix all       ← применяет все fixes после единого подтверждения
/fix #N        ← применяет конкретный fix по номеру
```

## Протокол применения

```
1. Показать fix: [контекст + diff кода]
2. Если workflow активен (active: true) → предупредить:
   "⚠️ Workflow активен. Деактивировать перед применением? (да/нет)"
   При "да": POST /api/v1/workflows/{id}/deactivate   ← POST, не PATCH!
3. Спросить: "Применить Fix #{N}? (да/нет/пропустить)"
4. При "да":
   a. Получить текущий workflow JSON: GET /api/v1/workflows/{id}
   b. Найти нужную ноду по имени в nodes[]
   c. Обновить параметр (jsCode, assignments, etc.) в памяти
   d. Отправить полный JSON: PUT /api/v1/workflows/{id}
   e. Подтвердить: показать успех/ошибку
   f. Предложить реактивировать если деактивировали: POST /api/v1/workflows/{id}/activate
5. При "нет": пропустить этот fix
6. Следующий fix → повторить с шага 1
```

## КРИТИЧНО: Безопасность credentials при PUT

> ⚠️ **СТРОГОЕ ПРАВИЛО:** API n8n чувствительно к credentials. При выполнении PUT-запроса **категорически запрещено** изменять, удалять или перезаписывать следующие поля в объекте ноды:
> - `id` — UUID ноды (изменение ломает идентификацию в n8n)
> - `credentials` — привязка учётных данных (удаление отвязывает все логины сервисов)
> - `typeVersion` — версия типа ноды (изменение сбрасывает UI-версию)
>
> **Алгоритм безопасного обновления (обязательный):**
> ```javascript
> // ШАГ 1: Получить ВЕСЬ текущий объект workflow из API
> const workflow = await GET(`/api/v1/workflows/${id}`);
>
> // ШАГ 2: Найти нужную ноду по имени
> const node = workflow.nodes.find(n => n.name === targetNodeName);
>
> // ШАГ 3: Изменить ТОЛЬКО целевой параметр
> node.parameters.jsCode = newCode;
> // ЗАПРЕЩЕНО: node.id = ..., delete node.credentials, node.typeVersion = ...
>
> // ШАГ 4: Отправить ВЕСЬ workflow обратно (не реконструировать!)
> await PUT(`/api/v1/workflows/${id}`, workflow);
> ```
> **Никогда не строить объект ноды заново** — только мутировать объект, полученный из GET.

## КРИТИЧНО: Безопасность

- **НИКОГДА** не применять без явного "да" / "apply" / "yes"
- **Перед применением** — показать полный diff изменения
- **После применения** — предложить протестировать workflow
- **Только один патч за раз** (если не `/fix all`)
- Логировать все изменения в history/

## API для применения fix

```bash
# Получить текущий workflow
GET $N8N_BASE_URL/api/v1/workflows/$WORKFLOW_ID

# Деактивировать перед правкой (если активен) — POST, не PATCH!
POST $N8N_BASE_URL/api/v1/workflows/$WORKFLOW_ID/deactivate

# Обновить workflow (ПОЛНЫЙ JSON с изменением)
PUT $N8N_BASE_URL/api/v1/workflows/$WORKFLOW_ID
Content-Type: application/json
X-N8N-API-KEY: $N8N_API_KEY

{
  ...workflow_json,
  nodes: [...updated_nodes]
}

# Реактивировать после правки — POST, не PATCH!
POST $N8N_BASE_URL/api/v1/workflows/$WORKFLOW_ID/activate
```

> ⚠️ При PUT убедиться, что у каждой ноды сохранено поле `typeVersion`. Его потеря сбрасывает версию ноды в n8n UI.

## Ограничения
- Не применять fix к активным workflow без предупреждения
- Если workflow активен — сначала деактивировать (или предупредить)
- LLM ноды: изменения промпта требуют ручной проверки
