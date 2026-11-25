# Эталон smoke-проверки Chronos 4774

Обезличенная сводка эталонного прогона `chronos/scripts/smoke/` на установленной сборке Chronos 4774.

- **Версия приложения:** `0.1.10-nightly.20261116.4774.chronos.4` (канал `nightly`, `x64`, Electron `44.10.1` / Chrome `152.0.7977.169`).
- **Базовый тег T3:** `v0.1.10-nightly.20261116.4774` (`16695c812fffe75e85f8cc3084d2c561aa3ca93f`).
- **Скриншоты и полный `report.json` (вне репозитория из-за приватных данных пользователя):** `%USERPROFILE%\.t3\caches\chronos-parity\baseline\4774\`.
- **Параметры снятия эталона:** окно `1400×900` (`deviceScaleFactor: 1`), `prefers-reduced-motion: reduce` + заморозка бесконечных CSS-анимаций на `t=0` перед снимком, локальные сервисы Olympus (`4517–4524`) активны.

---

## 1. Сводка проверок (14/14 зелёные)

Красные проверки в эталоне отсутствуют (`0` ошибок консоли, `0` необработанных исключений, `0` неожиданных английских фраз).

| Проверка | Статус | Детали | Ошибки | Видимые EN-фразы (все в допусках) |
| --- | --- | --- | ---: | ---: |
| `globals` (28 объектов `__oly*`) | **PASS** | `28/28`, `missing=0`, `extra=0` | 0 | — |
| `scheme` (`t3code://`) | **PASS** | `/index.html` → `200`; `/assets/ghostty-vt-*.wasm` → `200` (`\0asm`), `/assets/ghostty-write-pty-*.wasm` → `200` (`\0asm`) | 0 | — |
| `screen/home` | **PASS** | `6/6` проверок элементов (главный экран без проекта, композер, кнопки сайдбара) | 0 | 1 |
| `screen/settings-general` | **PASS** | `6/6` (навигация, секции, пункты Olympus: «API-ключи», «Серверы MCP», «Шаблоны промптов») | 0 | 0 |
| `screen/settings-appearance` | **PASS** | `3/3` («Цветовая схема», «Темы», «Типографика») | 0 | 1 |
| `screen/settings-api-keys` | **PASS** | `4/4` (`.oly-ik-panel`, «API-ключи», «OpenRouter», «MCP-сервер oly-web») | 0 | 0 |
| `screen/settings-mcp` | **PASS** | `3/3` (`.oly-mcp-pane`, «Серверы MCP», видимый iframe `:4523`) | 0 | 0 |
| `screen/settings-prompts` | **PASS** | `3/3` (`.oly-ps-pane`, «Шаблоны промптов», «Ваши шаблоны») | 0 | 0 |
| `screen/settings-providers` | **PASS** | `3/3` (навигация, «Провайдеры», «Codex») | 0 | 7 |
| `screen/usage` | **PASS** | `3/3` («Расход», «Все окружения», «Все провайдеры») | 0 | 5 |
| `screen/tasks` | **PASS** | `3/3` (`.oly-tk-dialog`, «Все проекты», «Новая задача») | 0 | 1 |
| `screen/studio` | **PASS** | `3/3` (`dialog.oly-studio-dialog[open]`, «Студия», видимый iframe `:4520`) | 0 | 1 |
| `screen/composer-mode-menu` | **PASS** | `4/4` (`.oly-plan-menu`, «Выполнение», «Планирование», «Мозговой штурм») | 0 | 1 |
| `screen/day-night` | **PASS** | `4/4` (переключение `light → dark` меняет класс и фон, повторный клик возвращает `light`) | 0 | 1 |

### Подтверждённые глобальные объекты Olympus (28/28)

`__olyBgTasks`, `__olyBudget`, `__olyBudgetEvents`, `__olyCore`, `__olyFiles`, `__olyIntegrations`, `__olyLangIcons`, `__olyMachines`, `__olyMcpManager`, `__olyMentions`, `__olyModelAccount`, `__olyNotifications`, `__olyOpenRouter`, `__olyPanelHost`, `__olyPanels`, `__olyPlanMode`, `__olyPlanUi`, `__olyPromptsSettings`, `__olyReferences`, `__olyRichText`, `__olyRuFixes`, `__olySmooth`, `__olySpeed`, `__olyStudio`, `__olyStudioShell`, `__olyTasks`, `__olyThreadDetails`, `__olyWrapModeText`.

---

## 2. Допустимые английские фразы (не переведены в эталонном Olympus 4774)

Сканер собирает видимые текстовые узлы из латиницы (`≥ 2` слов) вне кода, моноширинных полей (`.font-mono`), сообщений чата, полей ввода и пользовательских списков (карточки/проекты в доске задач, пользовательские шаблоны промптов).

| Область | Допустимая фраза / шаблон | Причина допуска (поведение Olympus 4774) |
| --- | --- | --- |
| Глобально (сайдбар) | `No threads yet` | Заглушка пустого списка тредов в сайдбаре не переведена в Olympus 4774. |
| Глобально (сайдбар) | `Add project` | Допускается на пустом рабочем пространстве без проектов (в текущем профиле скрыта). |
| `settings-appearance` | `Inter Variable` | Собственное название встроенного шрифта интерфейса. |
| `settings-appearance` | `T3 Code`, `T3 Chat` | Собственные названия встроенных тем (зарезервированы в допусках). |
| `settings-providers` | `Antigravity (Google)`, `Antigravity (API key)`, `Muse Code` | Собственные названия провайдеров. |
| `settings-providers` | `Not authenticated`, `Installed · Sign-in not checked` | Сообщения статуса провайдеров, не переведённые в Olympus 4774. |
| `settings-providers` | `· Sign in with Cursor or add CURSOR_API_KEY in provider settings.` | Подсказка авторизации Cursor, не переведённая в Olympus 4774. |
| `settings-providers` | `· Enter a Gemini API key in the Antigravity provider settings.` | Подсказка ключа Gemini для Antigravity, не переведённая в Olympus 4774. |
| `settings-providers` | `^GPT-[\d.]+(?:[- ][A-Za-z0-9]+)+$`, `^Claude ...$`, `^Gemini ...$` | Собственные названия моделей провайдеров. |
| `usage` | `Gemini · 5-hour`, `Gemini · Weekly`, `Claude & GPT (shared) · 5-hour`, `Claude & GPT (shared) · Weekly` | Названия окон квот провайдеров, не переведённые в Olympus 4774. |
| `usage` | `<имя экземпляра>: Could not read limits.` (`^[A-Za-z0-9 ._-]+: Could not read limits\.$`) | Сообщение о недоступности лимитов провайдера (префикс зависит от локального имени экземпляра). |

---

## 3. Выявленные особенности Olympus 4774 и принятые решения

1. **Заморозка `requestAnimationFrame` при свёрнутом окне:** когда окно Chronos свёрнуто или перекрыто (`document.visibilityState === "hidden"`), Chromium останавливает `requestAnimationFrame`. На нём работают инъекция пунктов настроек Olympus (`80-integrations`, `90-mcp-manager`, `91-prompts-settings`) и runtime-переводчик (`runtime-translator.js`). Решение: `smoke.mjs` прокачивает кадры мини-захватом `Page.captureScreenshot` (`16×16`), поэтому проверки стабильно проходят даже в фоне.
2. **Скрытый заголовок «Цвета и темы» на `/settings/appearance`:** в `AppearanceSettingsPanel.tsx` секция `appearance` использует `hideTitle` (`sr-only`, `1×1 px`). Вместо скрытого заголовка проверка опирается на видимые элементы экрана: «Цветовая схема», «Темы», «Типографика».
3. **Бесконечные декоративные анимации темы Olympus:** в светлой теме `prefers-reduced-motion: reduce` останавливает `oly-glint`, `oly-spin`, `oly-breathe`, `oly-rise`, но в тёмной теме правила `html.dark` имеют более высокий приоритет, и `oly-spin` / `oly-rise` / `oly-twinkle` продолжают вращаться (~0.7–1.0% отличий пикселей между прогонами). Решение: перед снимком `smoke.mjs` ставит на паузу и сбрасывает в `t=0` все бесконечные анимации (`iterations === Infinity`), а в `finally` возобновляет их (`play()`).
4. **Динамические счётчики и шкалы лимитов:** на главном экране (индикатор бюджета `.oly-budget-pill`, счётчик задач, блок лимитов в карточке треда) и на `/usage` (проценты, прогресс-бары квот, таймеры сброса) значения меняются в реальном времени. Их прямоугольники измеряются через `getBoundingClientRect()` во время прогона и автоматически маскируются в `compare.py`.

---

## 4. Стабильность и проверка на заведомую поломку

### Два последовательных контрольных прогона против эталона (`compare.py`)

После снятия эталона выполнены два полных прогона подряд (`final-verify-1`, `final-verify-2`) и сравнение каждого с эталоном `4774` при порогах по умолчанию (`channel_threshold=4`, `pixel_threshold=1.0%`):

| Экран | Статус (прогон 1 / 2) | Новые ошибки | Новые EN | Diff% (прогон 1) | Diff% (прогон 2) | Масок |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| `home` | OK → OK / OK → OK | 0 / 0 | 0 / 0 | `0.0000%` | `0.0000%` | 6 |
| `settings-general` | OK → OK / OK → OK | 0 / 0 | 0 / 0 | `0.0000%` | `0.0000%` | 0 |
| `settings-appearance` | OK → OK / OK → OK | 0 / 0 | 0 / 0 | `0.0564%` | `0.0564%` | 0 |
| `settings-api-keys` | OK → OK / OK → OK | 0 / 0 | 0 / 0 | `0.0000%` | `0.0000%` | 0 |
| `settings-mcp` | OK → OK / OK → OK | 0 / 0 | 0 / 0 | `0.0000%` | `0.0000%` | 0 |
| `settings-prompts` | OK → OK / OK → OK | 0 / 0 | 0 / 0 | `0.0000%` | `0.0000%` | 0 |
| `settings-providers` | OK → OK / OK → OK | 0 / 0 | 0 / 0 | `0.0022%` | `0.0028%` | 0 |
| `usage` | OK → OK / OK → OK | 0 / 0 | 0 / 0 | `0.0340%` | `0.0340%` | 46 |
| `tasks` | OK → OK / OK → OK | 0 / 0 | 0 / 0 | `0.0000%` | `0.0040%` | 6 |
| `studio` | OK → OK / OK → OK | 0 / 0 | 0 / 0 | `0.0000%` | `0.0000%` | 6 |
| `composer-mode-menu` | OK → OK / OK → OK | 0 / 0 | 0 / 0 | `0.0000%` | `0.0000%` | 6 |
| `day-night` | OK → OK / OK → OK | 0 / 0 | 0 / 0 | `0.0758%` | `0.0758%` | 6 |

Итог обоих сравнений: **PASS** (`regressions=0`, `new_errors=0`, `new_en=0`, `visual_failures=0`, максимальное отличие пикселей `0.0758%` при пороге `1.0%`).

### Проверка на заведомую поломку (синтетические негативные тесты)

- `smoke.mjs` с временным `checks.json` (добавлен несуществующий глобальный объект `__olyBrokenFakeGlobal` и несуществующий текст на `home`) завершился с кодом `1`, зафиксировав `globals: 28/29 (missing=1)` и падение ассерта `home`.
- `compare.py` на копии прогона с искусственно добавленными падением проверки, ошибкой консоли, новой английской фразой и закрашенным прямоугольником `250×250` на `home.png` завершился с кодом `1`, зафиксировав `regressions=1, new_errors=1, new_en=1, visual_failures=1 (5.0761%)`.

## 5. Границы проверки

- Workflow `.github/workflows/chronos-smoke.yml` проверен статически (`yaml.safe_load`, соответствие имени артефакта `chronos-win-x64` и шагам `chronos-desktop.yml`), но **не запускался** на живом раннере GitHub `windows-latest` до отправки ветки и ручного `workflow_dispatch`.
- Флаг `--launch` в `smoke.mjs` реализован и проверен синтаксически (`node --check`), но локально тестировался режим подключения к уже запущенному окну (`--port 9333`), чтобы не перезапускать пользовательский экземпляр Chronos.

