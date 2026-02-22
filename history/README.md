# История отчётов

Эта папка уже создана. При первом запуске `/validate` в ней появится первый файл отчёта.

Формат файлов: `{workflow_id}_{YYYYMMDD_HHMMSS}.json`

Каждый файл — JSON с полями:
```json
{
  "runId": "...",
  "timestamp": "...",
  "workflowId": "...",
  "workflowName": "...",
  "summary": { "critical": N, "warning": N, "config": N, "info": N, "uncertain": N },
  "issues": [
    {
      "id": "CRITICAL|field|Consumer|Provider",
      "level": "CRITICAL",
      "field": "...",
      "consumer": "...",
      "provider": "...",
      "lineNumber": N,
      "codeSnippet": "...",
      "suggestedFix": "..."
    }
  ]
}
```

Используй `/diff {workflow_id}` для сравнения двух последних отчётов.  
Или напрямую: `./scripts/diff_reports.sh {workflow_id}`
