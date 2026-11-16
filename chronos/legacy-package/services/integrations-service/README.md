# integrations-service — веб-данные для ИИ-агентов + страница «API-ключи»

- `server.mjs` — локальный сервис ключей, `http://127.0.0.1:4522` (только 127.0.0.1; POST требует `x-oly: 1`;
  CORS для `t3code://app` и `http://localhost:3773`). Автозапуск: `start-hidden.vbs`.
  - `GET /api/health`, `GET /api/keys` (статус, `••••last4`, последний тест)
  - `POST /api/keys {id,value}` — пишет пользовательскую переменную (HKCU\Environment, с WM_SETTINGCHANGE; значение идёт через stdin, не через argv)
  - `POST /api/keys/delete {id}`, `POST /api/test {id, value?}` — дешёвая реальная проверка (сохранённого или введённого ключа)
  - `state.json` — только результаты последних проверок, без секретов.
- `mcp.mjs` — MCP-сервер `oly-web` (stdio, без зависимостей). Ключ: сначала env процесса, затем реестр
  (ключи, добавленные позже, работают без перезапуска; при 401/403 перечитывает реестр и повторяет запрос).
- `keys.mjs` — общий каталог интеграций, чтение/запись ключей, проверки.
- UI: `ru-l10n/features/80-integrations.js`, стили Olympus: `olympus-v2/feature-css/integrations.{day,night}.css`.

| id | Переменная | Инструменты | Проверка ключа (стоимость) |
|---|---|---|---|
| scrapedo | `SCRAPEDO_API_KEY` | `web_search` (10 кр.), `scrape_page` (1 / JS 5 / super 10 / оба 25) | `GET api.scrape.do/info` — бесплатно |
| getxapi | `GETXAPI_API_KEY` | `x_search`, `x_user`, `x_user_tweets`, `x_tweet` ($0.001/вызов) | `GET /account/me` — бесплатно |
| redditapis | `REDDITAPIS_API_KEY` | `reddit_search`, `reddit_posts`, `reddit_comments` ($0.0015) | `GET /account/me` — бесплатно |
| transcriptapi | `TRANSCRIPTAPI_API_KEY` | `youtube_transcript`, `youtube_search` (1 кредит; кэш бесплатно) | `GET /transcript?video_id=dQw4w9WgXcQ` — ≤1 кредит (обычно кэш = 0) |
| openrouter | `OPENROUTER_API_KEY` | (MCP openrouter) | `GET /api/v1/key` — бесплатно |

Плюс `web_keys_status` — какие ключи заданы (без значений).

## Регистрация MCP (подготовлено, не применено)

Claude Code:
```
claude mcp add --scope user oly-web -- "C:\Program Files\nodejs\node.exe" "C:\Users\zulut\.t3\caches\t3-customizations\integrations-service\mcp.mjs"
```

Codex (`~/.codex/config.toml`):
```toml
[mcp_servers.oly-web]
command = 'C:\Program Files\nodejs\node.exe'
args = ['C:\Users\zulut\.t3\caches\t3-customizations\integrations-service\mcp.mjs']
tool_timeout_sec = 120
```

Автозапуск сервиса: ярлык/запись Run на `wscript.exe "C:\Users\zulut\.t3\caches\t3-customizations\integrations-service\start-hidden.vbs"`.
