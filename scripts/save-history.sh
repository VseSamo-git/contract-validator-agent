#!/usr/bin/env bash
# save-history.sh — Сохранить отчёт в историю с diff-метаданными
# Использование: ./scripts/save-history.sh {workflow_id} {report_content_file}

set -euo pipefail

WORKFLOW_ID="${1:-}"
REPORT_FILE="${2:-}"
HISTORY_DIR="$(dirname "$0")/../history"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")

if [ -z "$WORKFLOW_ID" ] || [ -z "$REPORT_FILE" ]; then
  echo "Использование: $0 {workflow_id} {report_file}"
  exit 1
fi

mkdir -p "$HISTORY_DIR"

OUTPUT_FILE="${HISTORY_DIR}/${WORKFLOW_ID}_${TIMESTAMP}.json"
cp "$REPORT_FILE" "$OUTPUT_FILE"

echo "✅ Отчёт сохранён: ${OUTPUT_FILE}"

# Найти предыдущий отчёт для этого workflow
PREV_REPORT=$(ls -t "${HISTORY_DIR}/${WORKFLOW_ID}_"*.json 2>/dev/null | sed -n '2p')

if [ -n "$PREV_REPORT" ]; then
  echo "📋 Предыдущий отчёт: ${PREV_REPORT}"
  echo "   Запусти /diff ${WORKFLOW_ID} для сравнения"
else
  echo "ℹ️  Первый запуск для workflow ${WORKFLOW_ID} — история создана"
fi

# Ротация: оставить последние 10 отчётов на workflow (настраивается через MAX_HISTORY)
MAX_HISTORY="${MAX_HISTORY:-10}"
REPORT_COUNT=$(ls "${HISTORY_DIR}/${WORKFLOW_ID}_"*.json 2>/dev/null | wc -l)
if [ "$REPORT_COUNT" -gt "$MAX_HISTORY" ]; then
  DELETED=$(ls -t "${HISTORY_DIR}/${WORKFLOW_ID}_"*.json | tail -n +$((MAX_HISTORY + 1)))
  echo "$DELETED" | xargs rm -f
  echo "🧹 Удалены старые отчёты (хранится последние ${MAX_HISTORY}):"
  echo "$DELETED" | sed 's/^/   /'
fi
