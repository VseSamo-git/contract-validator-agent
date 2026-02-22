#!/usr/bin/env bash
# Утилита для сравнения двух отчётов Contract Validator
# Использование: ./scripts/diff_reports.sh <workflow_id>
# Или: ./scripts/diff_reports.sh <file1.json> <file2.json>

HISTORY_DIR="./history"

if [ $# -eq 1 ]; then
    WORKFLOW_ID=$1
    # Найти два последних отчёта для workflow
    FILES=($(ls -t "$HISTORY_DIR/${WORKFLOW_ID}_"*.json 2>/dev/null | head -2))
    if [ ${#FILES[@]} -lt 2 ]; then
        echo "❌ Нужно минимум 2 отчёта для workflow $WORKFLOW_ID"
        echo "Доступные отчёты:"
        ls "$HISTORY_DIR/${WORKFLOW_ID}_"*.json 2>/dev/null || echo "  (нет отчётов)"
        exit 1
    fi
    FILE_NEW="${FILES[0]}"
    FILE_OLD="${FILES[1]}"
elif [ $# -eq 2 ]; then
    FILE_OLD=$1
    FILE_NEW=$2
else
    echo "Использование: $0 <workflow_id> | $0 <old.json> <new.json>"
    exit 1
fi

echo "=== Contract Validator DIFF ==="
echo "Старый: $FILE_OLD"
echo "Новый:  $FILE_NEW"
echo ""

# Требует jq
if ! command -v jq &> /dev/null; then
    echo "⚠️  Установи jq: brew install jq | apt install jq"
    echo "Показываю простой diff:"
    diff <(jq -S '.' "$FILE_OLD") <(jq -S '.' "$FILE_NEW")
    exit 0
fi

# Используем .id — универсальный 4-поля формат для всех типов issues:
# Contract: "CRITICAL|field|Consumer|Provider", CONFIG: "CONFIG|R1|node_name|workflow"
OLD_ISSUES=$(jq -r '.issues[] | .id' "$FILE_OLD" 2>/dev/null)
NEW_ISSUES=$(jq -r '.issues[] | .id' "$FILE_NEW" 2>/dev/null)

OLD_CRIT=$(jq '.summary.critical' "$FILE_OLD" 2>/dev/null || echo "?")
NEW_CRIT=$(jq '.summary.critical' "$FILE_NEW" 2>/dev/null || echo "?")
OLD_WARN=$(jq '.summary.warning' "$FILE_OLD" 2>/dev/null || echo "?")
NEW_WARN=$(jq '.summary.warning' "$FILE_NEW" 2>/dev/null || echo "?")
OLD_CONF=$(jq '.summary.config' "$FILE_OLD" 2>/dev/null || echo "?")
NEW_CONF=$(jq '.summary.config' "$FILE_NEW" 2>/dev/null || echo "?")
OLD_INFO=$(jq '.summary.info' "$FILE_OLD" 2>/dev/null || echo "?")
NEW_INFO=$(jq '.summary.info' "$FILE_NEW" 2>/dev/null || echo "?")

echo "📊 Тренд:"
echo "  🔴 CRITICAL: $OLD_CRIT → $NEW_CRIT"
echo "  🟡 WARNING:  $OLD_WARN → $NEW_WARN"
echo "  🔧 CONFIG:   $OLD_CONF → $NEW_CONF"
echo "  ℹ️  INFO:     $OLD_INFO → $NEW_INFO"

echo ""
echo "🆕 НОВЫЕ проблемы:"
if [ -n "$OLD_ISSUES" ] && [ -n "$NEW_ISSUES" ]; then
  comm -13 <(echo "$OLD_ISSUES" | sort) <(echo "$NEW_ISSUES" | sort) | while IFS='|' read -r level f2 f3 f4; do
    [ -z "$level" ] && continue
    if [ "$level" = "CONFIG" ]; then
      echo "  + [CONFIG] $f2: $f3"
    else
      echo "  + [$level] '$f2': $f4 → $f3"
    fi
  done
elif [ -n "$NEW_ISSUES" ] && [ -z "$OLD_ISSUES" ]; then
  echo "$NEW_ISSUES" | while IFS='|' read -r level f2 f3 f4; do
    [ -z "$level" ] && continue
    if [ "$level" = "CONFIG" ]; then
      echo "  + [CONFIG] $f2: $f3  (первый запуск)"
    else
      echo "  + [$level] '$f2': $f4 → $f3  (первый запуск — всё новое)"
    fi
  done
else
  echo "  (нет данных)"
fi

echo ""
echo "✅ ИСПРАВЛЕННЫЕ проблемы:"
if [ -n "$OLD_ISSUES" ] && [ -n "$NEW_ISSUES" ]; then
  comm -23 <(echo "$OLD_ISSUES" | sort) <(echo "$NEW_ISSUES" | sort) | while IFS='|' read -r level f2 f3 f4; do
    [ -z "$level" ] && continue
    if [ "$level" = "CONFIG" ]; then
      echo "  - [CONFIG] $f2: $f3 — FIXED"
    else
      echo "  - [$level] '$f2': $f4 → $f3 — FIXED"
    fi
  done
elif [ -z "$NEW_ISSUES" ] && [ -n "$OLD_ISSUES" ]; then
  echo "  Все проблемы исправлены! ✅"
else
  echo "  (нет исправленных проблем)"
fi
