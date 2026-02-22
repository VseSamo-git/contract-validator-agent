#!/usr/bin/env bash
# fetch-workflow.sh — Получить workflow JSON из n8n API
# Использование: ./scripts/fetch-workflow.sh {workflow_id} [output_file]

set -euo pipefail

WORKFLOW_ID="${1:-}"
OUTPUT_FILE="${2:-/tmp/workflow_${WORKFLOW_ID}.json}"

if [ -z "$WORKFLOW_ID" ]; then
  echo "❌ Укажи ID workflow: ./scripts/fetch-workflow.sh {id}"
  exit 1
fi

# Автозагрузка .env — необходима т.к. Claude Code изолирует каждую bash-сессию
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/../.env"
if [ -f "$ENV_FILE" ]; then
  export $(grep -v '^#' "$ENV_FILE" | xargs) 2>/dev/null
fi

if [ -z "${N8N_BASE_URL:-}" ]; then
  echo "❌ Переменная N8N_BASE_URL не задана"
  echo "   export N8N_BASE_URL=https://your-n8n.com"
  exit 1
fi

if [ -z "${N8N_API_KEY:-}" ]; then
  echo "❌ Переменная N8N_API_KEY не задана"
  echo "   export N8N_API_KEY=your-api-key"
  exit 1
fi

echo "📥 Получаю workflow ${WORKFLOW_ID} из ${N8N_BASE_URL}..."

HTTP_RESPONSE=$(curl -s -w "\n%{http_code}" \
  -H "X-N8N-API-KEY: ${N8N_API_KEY}" \
  -H "Content-Type: application/json" \
  "${N8N_BASE_URL}/api/v1/workflows/${WORKFLOW_ID}")

HTTP_BODY=$(echo "$HTTP_RESPONSE" | head -n -1)
HTTP_CODE=$(echo "$HTTP_RESPONSE" | tail -n 1)

if [ "$HTTP_CODE" != "200" ]; then
  echo "❌ Ошибка API: HTTP ${HTTP_CODE}"
  echo "   Ответ: ${HTTP_BODY}"
  exit 1
fi

echo "$HTTP_BODY" > "$OUTPUT_FILE"

# Проверить наличие jq
if ! command -v jq &> /dev/null; then
  echo "⚠️  jq не установлен. Установи: brew install jq | apt install jq"
  WORKFLOW_NAME="?"
  NODE_COUNT="?"
else
  WORKFLOW_NAME=$(echo "$HTTP_BODY" | jq -r '.name // "?"')
  NODE_COUNT=$(echo "$HTTP_BODY" | jq -r '.nodes | length')
fi

echo "✅ Workflow получен:"
echo "   Название: ${WORKFLOW_NAME}"
echo "   Нод: ${NODE_COUNT}"
echo "   Сохранён в: ${OUTPUT_FILE}"
