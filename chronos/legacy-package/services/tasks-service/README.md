# Задачи для T3 Code (tasks-service)

Доска задач по проектам T3 (как Trello): кнопка «Задачи» в сайдбаре под строкой поиска → диалог с доской;
упоминание задачи в композере через `#`; доступ ИИ-агентов через MCP.

| Файл | Назначение |
|---|---|
| `server.mjs` | HTTP-сервис на `127.0.0.1:4518` (без зависимостей, Node ≥ 24) |
| `mcp.mjs` | MCP-сервер (stdio) для Claude Code и Codex |
| `store.mjs` | общее хранилище; межпроцессная блокировка `.lock`, атомарная запись |
| `start-hidden.vbs` | запуск сервиса без окна (для автозагрузки) |
| `..\ru-l10n\features\30-tasks.js` | UI в T3 (сайдбар, доска, `#`-попап) |
| `..\olympus-v2\feature-css\tasks.{day,night}.css` | оформление Olympus |

Данные: `%USERPROFILE%\.t3\tasks\` — `meta.json` (счётчик id), `groups.json`, `projects\<projectId>.json`,
`trash.json` (последние 500 удалённых задач). Проекты читаются только для чтения из `~\.t3\userdata\statev2.sqlite`.
Переменные окружения: `OLY_TASKS_DIR` (папка данных), `OLY_TASKS_PORT`, `OLY_TASKS_AGENT` (подпись заметок агента),
`OLY_TASKS_PROJECT` (проект MCP по умолчанию вместо текущей папки).

## Установка (выполняет лид)

1. Автозапуск сервиса — ярлык/скрипт в папке автозагрузки:
   ```powershell
   Copy-Item "$env:USERPROFILE\.t3\caches\t3-customizations\tasks-service\start-hidden.vbs" "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup\t3-tasks-service.vbs"
   wscript "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup\t3-tasks-service.vbs"
   ```
   Проверка: `curl http://127.0.0.1:4518/api/health`.
2. MCP для Claude Code (глобально для пользователя):
   ```powershell
   claude mcp add --scope user oly-tasks -- "C:\Program Files\nodejs\node.exe" "C:\Users\zulut\.t3\caches\t3-customizations\tasks-service\mcp.mjs"
   ```
3. MCP для Codex — добавить в `%USERPROFILE%\.codex\config.toml`:
   ```toml
   [mcp_servers.oly-tasks]
   command = 'C:\Program Files\nodejs\node.exe'
   args = ['C:\Users\zulut\.t3\caches\t3-customizations\tasks-service\mcp.mjs']
   ```
MCP-серверу не нужен запущенный HTTP-сервис: он работает с теми же файлами напрямую.

## MCP-инструменты
- `list_projects` — проекты T3 со счётчиками задач.
- `list_tasks(project?, status?, query?, include_done?)` — по умолчанию открытые задачи проекта текущей папки
  (папка проекта или worktree T3); `project:"all"` — все.
- `get_task(id)` — описание/план, чек-лист, заметки.
- `add_task(title, description?, project?, priority?, status?, checklist?)`.
- `update_task(id, status?, note?, title?, description?, priority?, check_items?, uncheck_items?, add_checklist?)`.

Статусы: `backlog` «Бэклог», `doing` «В работе», `review` «На проверке», `done` «Готово».
Приоритеты: `urgent`, `high`, `normal`, `low`.

## HTTP API (для UI)
`GET /api/health|projects|groups|tasks[?projects=a,b]|tasks/:id|thread/:threadId`;
изменения требуют заголовка `x-oly: 1`: `POST /api/tasks`, `PATCH /api/tasks/:id`, `POST /api/tasks/:id/move`,
`DELETE /api/tasks/:id`, `PUT /api/groups`, `DELETE /api/groups/:id`. CORS — только `t3code://app` и `http://localhost:3773`.
