# MCP Servers — Установка и настройка

Этот файл содержит инструкции по подключению MCP-серверов для Contract Validator Agent в Claude Code.

---

## Обязательные MCP серверы

### 1. n8n-mcp — главный инструмент работы с n8n

Даёт Claude Code полное знание о 1084 нодах n8n, валидацию конфигураций, доступ к API.

**Установка (с подключением к твоему n8n instance):**

```bash
claude mcp add n8n-mcp \
  -e MCP_MODE=stdio \
  -e LOG_LEVEL=error \
  -e DISABLE_CONSOLE_OUTPUT=true \
  -e N8N_API_URL=https://your-n8n-instance.com \
  -e N8N_API_KEY=your-api-key-here \
  -- npx n8n-mcp
```

> 📌 **Где взять API Key:** n8n → Settings → API → Create API Key

**Проверка подключения:**
```bash
/mcp   # внутри Claude Code — показывает статус всех MCP
```

**Что даёт:**
- `search_nodes` — поиск нод n8n
- `get_node_info` — детальное описание ноды и её параметров  
- `validate_workflow` — валидация AI Agent нод
- `get_workflow_templates` — 2709 шаблонов
- Доступ к workflow через API (если указан N8N_API_KEY)

**GitHub:** https://github.com/czlonkowski/n8n-mcp

> **Альтернатива без Node.js — Docker образ (~280MB):**
> ```json
> {
>   "mcpServers": {
>     "n8n-mcp": {
>       "command": "docker",
>       "args": ["run", "-i", "--rm", "--init",
>                "-e", "MCP_MODE=stdio", "-e", "LOG_LEVEL=error",
>                "-e", "DISABLE_CONSOLE_OUTPUT=true",
>                "-e", "N8N_API_URL=https://your-n8n.com",
>                "-e", "N8N_API_KEY=your-key",
>                "ghcr.io/czlonkowski/n8n-mcp:latest"]
>     }
>   }
> }
> ```


---

### 2. n8n встроенный MCP (instance-level)

Прямой доступ к твоему n8n instance для чтения и запуска workflow.

**Настройка в n8n:**
1. n8n → Settings → Instance-level MCP
2. Включить MCP access
3. Скопировать Server URL и Access Token

**Подключение в Claude Code:**
```bash
# Вариант через Access Token:
claude mcp add n8n-instance \
  -e MCP_TOKEN=your-access-token \
  -- npx @n8n/mcp-client {your-n8n-server-url}
```

**Или вручную в `.mcp.json`:**
```json
{
  "mcpServers": {
    "n8n-instance": {
      "command": "npx",
      "args": ["@n8n/mcp-client", "https://your-n8n-instance.com"],
      "env": {
        "MCP_TOKEN": "your-access-token"
      }
    }
  }
}
```

**Документация:** https://docs.n8n.io/advanced-ai/accessing-n8n-mcp-server/

---

## Опциональные MCP серверы

### 3. Filesystem MCP — для работы с историей отчётов

Позволяет агенту читать/писать файлы истории в папке `history/`.

```bash
claude mcp add filesystem \
  -- npx @modelcontextprotocol/server-filesystem \
  /path/to/contract-validator-agent/history
```

**Конфигурация в `.mcp.json`:**
```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": [
        "@modelcontextprotocol/server-filesystem",
        "/path/to/your/contract-validator-agent/history"
      ]
    }
  }
}
```

---

### 4. PactFlow — интеграция с Consumer-Driven Contract Testing

Если нужна полноценная интеграция с PactFlow, взаимодействуйте через REST API напрямую — официального MCP-пакета не существует (несмотря на упоминания в интернете).
- Документация: https://docs.pactflow.io/docs/api/
- API key: PactFlow → Settings → API Tokens


---

## Итоговая конфигурация `.mcp.json`

Создай файл `.mcp.json` в корне проекта:

```json
{
  "mcpServers": {
    "n8n-mcp": {
      "command": "npx",
      "args": ["n8n-mcp"],
      "env": {
        "MCP_MODE": "stdio",
        "LOG_LEVEL": "error",
        "DISABLE_CONSOLE_OUTPUT": "true",
        "N8N_API_URL": "https://your-n8n-instance.com",
        "N8N_API_KEY": "YOUR_N8N_API_KEY"
      }
    },
    "filesystem": {
      "command": "npx",
      "args": [
        "@modelcontextprotocol/server-filesystem",
        "./history"
      ]
    }
  }
}
```

> ⚠️ **Безопасность:** Не коммить `.mcp.json` с реальными ключами. Добавь в `.gitignore`:
> ```
> .mcp.json
> .env
> ```

---

## Переменные окружения (.env)

Создай файл `.env` в корне проекта:

```env
# n8n Instance
N8N_BASE_URL=https://your-n8n-instance.com   # Используется скриптами агента
N8N_API_URL=https://your-n8n-instance.com    # Используется n8n-mcp (должно совпадать с N8N_BASE_URL!)
N8N_API_KEY=your-api-key-here

# Optional: n8n MCP instance-level
N8N_MCP_TOKEN=your-mcp-access-token

# Optional: PactFlow (если используется)
PACTFLOW_URL=https://your-org.pactflow.io
PACTFLOW_TOKEN=your-pactflow-token
```

---

## Быстрый старт

```bash
# 1. Создай .mcp.json из шаблона и заполни реальными данными
cp .mcp.json.example .mcp.json
nano .mcp.json   # вставь N8N_API_URL и N8N_API_KEY

# 2. Настрой переменные окружения
cp .env.example .env
nano .env        # заполни N8N_BASE_URL и N8N_API_KEY

# 3. Добавь MCP в Claude Code (npx установит n8n-mcp автоматически)
claude mcp add n8n-mcp \
  -e MCP_MODE=stdio \
  -e LOG_LEVEL=error \
  -e DISABLE_CONSOLE_OUTPUT=true \
  -e N8N_API_URL=$(grep N8N_BASE_URL .env | cut -d= -f2) \
  -e N8N_API_KEY=$(grep N8N_API_KEY .env | cut -d= -f2) \
  -- npx n8n-mcp

# 4. Загрузи переменные окружения в текущей сессии
set -a && source .env && set +a

# 5. Проверь статус
claude  # запустить Claude Code
/mcp    # проверить подключение
```