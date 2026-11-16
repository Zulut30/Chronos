# OpenRouter в T3 — установка (для ведущей сессии)

Ключ: пользовательская переменная окружения `OPENROUTER_API_KEY` (уже задана). Ни в одном файле ключа нет.
MCP-сервер берёт его из окружения процесса, а если его там нет — из `HKCU\Environment` (через `reg query`, без вывода).
OpenCode берёт ключ только из окружения: T3 должен быть перезапущен из Проводника/меню «Пуск» после того, как переменная задана.

## 1. Клиентская часть (собирается вашим build)
- `ru-l10n\features\70-openrouter.js` — логотип OpenRouter для инстанса с accentColor `#6467F2` + раздел «OpenRouter» в меню `@`.
- `olympus-v2\feature-css\openrouter.day.css`, `openrouter.night.css`.
- Отдельный сервис/порт не нужен: каталог моделей грузится с `https://openrouter.ai/api/v1/models?output_modalities=all`
  (публичный, CORS `*`; CSP T3 разрешает https), кэш в `localStorage` `oly-openrouter-catalog` на 6 ч.

## 2. Провайдер «OpenRouter» (инстанс драйвера OpenCode)
Вариант А (UI): Настройки → Провайдеры → добавить инстанс → OpenCode:
- Название: `OpenRouter`; цвет акцента: `#6467F2` (обязательно — по нему подменяется иконка на логотип OpenRouter);
- Переменная окружения (не секретная): `OPENCODE_CONFIG_CONTENT` = содержимое `opencode-config-content.json` (одна строка).

Вариант Б (файл, при закрытом T3): влить `provider-instance.json` в `%USERPROFILE%\.t3\userdata\settings.json` (ключ `providerInstances`).

Что делает конфиг: `enabled_providers:["openrouter"]` (в списке только модели OpenRouter), +6 чат-моделей, которых нет в models.dev,
MCP `openrouter` (этот сервер) — инстанс OpenRouter сразу умеет фото/видео/decisions.
Проверено локально: `opencode models` → 374 модели, все `openrouter/*`; `opencode mcp list` → `openrouter connected`.
Обновить список моделей позже: `node build-opencode-config.mjs` и заново вставить переменную.

## 3. MCP для остальных агентов (чтобы `@openrouter:<модель>` работал в Claude и Codex)
Claude Code:
```
claude mcp add --scope user openrouter -- "C:\Program Files\nodejs\node.exe" "C:\Users\zulut\.t3\caches\t3-customizations\openrouter-service\server.mjs"
```
Codex (`%USERPROFILE%\.codex\config.toml`):
```toml
[mcp_servers.openrouter]
command = "C:\\Program Files\\nodejs\\node.exe"
args = ["C:\\Users\\zulut\\.t3\\caches\\t3-customizations\\openrouter-service\\server.mjs"]
tool_timeout_sec = 600
```
(у Codex таймаут инструмента по умолчанию 60 с — генерация картинок бывает дольше).

## 4. Проверка
- `node server.mjs --check` → «OK: ключ OpenRouter работает…» (бесплатный `GET /api/v1/key`).
- После перезапуска T3: в выборе модели появляется группа OpenRouter с логотипом. Если моделей 0 — у T3 нет `OPENROUTER_API_KEY`
  в окружении (Проводник не получил новую переменную): перелогиниться в Windows либо добавить в инстанс секретную переменную
  `OPENROUTER_API_KEY` через UI T3 (хранится в секретах T3).

## Инструменты MCP
`list_models(kind, query)`, `model_info(model)`, `generate_image(model, prompt, aspect_ratio, resolution, size, quality, n,
output_format, background, input_images, out_dir, file_name)`, `generate_video(model, prompt, duration, resolution, aspect_ratio,
size, first_frame, last_frame, reference_images, generate_audio, seed, wait_seconds)`, `get_video(job_id)`,
`decide(model, state, questions, assets)`, `chat_once(model, prompt, system, images, max_tokens, reasoning_effort)`.
Файлы сохраняются в `<рабочая папка>\openrouter-media\` (или `out_dir`).
