# Совместимый Windows-пакет

Пакет рассчитан на существующий компьютер с локальным слоем Olympus и его сервисами. Новые
клиентские функции собраны из исходников Chronos; прежние JS-бандлы и `server.asar` не переносятся.
Каталог `~/.t3/caches/t3-customizations`, задачи, скиллы, MCP-конфиги и API-ключи остаются на месте.

Распакуйте пакет и выполните `powershell -File .\Install-Compatibility.ps1`. По умолчанию это
только проверка шести сервисов и MCP-регистраций Codex. Она ничего не устанавливает и не запускает.
Отсутствующий сервис или регистрация блокирует совместимую установку.

Когда установка разрешена, закройте T3 вручную и выполните
`powershell -File .\Install-Compatibility.ps1 -Install`. Скрипт сверяет SHA256 установщика,
сохраняет контрольные суммы защищённых файлов вне пакета, запускает обычный установщик и
повторно проверяет файлы. Скрипт не останавливает процессы, не меняет сервисы и конфиги и не
запускает приложение. Контрольные суммы обнаруживают изменение; автоматического отката нет.

Это не установщик сервисов для чистого компьютера. Пользовательские данные и секреты в архив
не входят. Локальные расширения доступны в Electron и HTTP loopback web на порту 3773; удалённый веб-клиент и
мобильное приложение сохраняют штатные возможности T3 без обращения к localhost другого устройства.

## Источники и риски совместимости

Фактические SHA256 19 reference-файлов находятся в `sources.json`; они не включаются в исполняемый
payload. Финальный reference — `ux-polish-20261117`, archive SHA256 указан в `services.json`.
`chronos/legacy-package` — прежний бинарный reference, не источник актуального MCP/clipboard/Plan UX.

| Приоритет / функция          | Фактический источник                                                 | Что переносится / что сохраняется                                                                            | Проверка и риск                                                                                                  |
| ---------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| P0 Plan                      | `src/10-plan-mode.js`, `ux-polish-20261117/package.py`               | React + native interactionMode; никаких глобальных Plan-флагов                                               | Store promotion/clear/switch и browser toggle; реальные provider turns отдельно, без платного запуска            |
| P0 Rich text / copy          | `src/88-rich-text.js`, `ru-l10n/extras.js`                           | Общий Markdown allowlist, HTML clipboard с фиксированной палитрой                                            | XSS/forged CSS/code literals + browser partial selection; внешние редакторы могут по-своему импортировать HTML   |
| P0 MCP                       | `src/90-mcp-manager.js`, `mcp-manager/{index.html,app.js,style.css}` | Нативная Settings-страница; актуальный внешний UI/backend                                                    | Preflight health/config; этот пакет не меняет и не повторно тестирует реальные MCP конфиги мутациями             |
| P1 Задачи                    | `src/30-tasks.js`, tasks-service                                     | React CRUD/группы/filters/order/checklist/notes/links; существующие данные и MCP                             | Browser сохраняет payload редактора; реальные задачи не изменяются тестами                                       |
| P1 Скиллы                    | skills-manager + legacy reference                                    | Existing service UI в Settings; MCP/реестр/файлы сохраняются                                                 | Health + preflight; функциональность сервиса не переписывается                                                   |
| P1 Studio                    | `src/60-studio.js`, `src/92-studio-shell.js`, studio-service/public  | React chooser, native preview, SSE board/PNG delivery; существующие editor/Playground/backend                | Browser create → preview, штатный attachment intake; запуск WordPress и сохранение реальных досок не выполняются |
| P1 Файлы / машины / композер | `40-files.js`, `50-machines.js`, `55-composer.js`                    | Context menu download, очередь/отмена, display aliases, ссылки; штатные composer contexts остаются нативными | Проверка API routing и identity; SSH требует уже настроенного соединения и доступного files-service              |
| P2 OpenRouter / ключи        | `70-openrouter.js`, `80-integrations.js`, openrouter-service         | React picker всех семи типов и Settings API keys; MCP/env остаются внешними                                  | Сериализация model/tool, отсутствие автоплатных вызовов; секреты в пакет не входят                               |
| P2 Скорость                  | `20-speed.js`                                                        | Native usage timestamp samples, text-growth estimates, прежние tuples/calibration                            | Unit samples/gap/reset/history; точность зависит от usage provider, `≈` для оценок                               |

Все native provider-адаптеры получают штатный `interactionMode`: их собственные ограничения и
протоколы не меняются. Локальные MCP вызываются агентом только там, где соответствующий MCP
зарегистрирован; preflight проверяет текущий Codex. Поддержка иных provider-конфигов зависит от
существующих регистраций и менеджера MCP, автоматически дописывать их установка не будет.

Пакет не является доказательством установленного runtime: установка и перезапуск выполняются
только отдельно по разрешению. Перед установкой нужны зелёные проверки и desktop build одного
и того же head. После разрешённой установки остаётся один ручной проход по реальным задачам,
скиллам, MCP, Studio PNG и SSH на этом компьютере.
