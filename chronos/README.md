# Chronos

Chronos развивает доску задач, Studio, управление скиллами и MCP, русский интерфейс и тему Olympus
на базе [pingdotgg/t3code](https://github.com/pingdotgg/t3code) (MIT).

## Разработка Chronos и перенос функций T3

Общая рабочая ветка — `feature/chronos-development`. Она включает доработки поверх nightly 4838.
От неё создаём ветку под задачу. Законченную функцию возвращаем в общую ветку после проверки.
Когда эта основа войдёт в `main`, новые задачи можно начинать от обновлённой `main`.

### Своя функция

```sh
git switch -c feature/my-feature feature/chronos-development
node chronos/scripts/upstream-plan.mjs feature feature/chronos-development
```

Размещай реализацию в `apps/web/src/chronos/`, `apps/desktop/src/chronos/` или
`apps/server/src/chronos/` по месту исполнения. Команда показывает изменения ветки и рабочей копии,
включая новые файлы. По списку путей вне каталогов Chronos проверь, какие вызовы связывают
функцию с T3. Обнови таблицу точек встраивания ниже и прогони тест изменённого поведения.
Для обзора всех исходных файлов T3, изменённых или удалённых в текущем коммите форка,
выполни `node chronos/scripts/upstream-plan.mjs surface`.

### Одна функция оригинального T3

В чистой ветке, созданной от общей рабочей ветки, получи коммиты официального репозитория.
Если в свежем клоне есть только `origin`, один раз добавь источник командой
`git remote add upstream https://github.com/pingdotgg/t3code.git`.

```sh
git fetch --no-tags upstream main
git log --oneline FETCH_HEAD
node chronos/scripts/upstream-plan.mjs pick <sha>
git show <sha>
git cherry-pick -x <sha>
```

Вместо `<sha>` подставь SHA обычного коммита T3. Проверь его зависимости, тесты и перечисленные
отчётом общие файлы. Если функция занимает несколько коммитов, переноси их по порядку,
каждый раз запуская `pick` перед переносом. Ключ `-x` записывает исходный SHA в историю.
При отмене незавершённого переноса используй `git cherry-pick --abort`. Версию полной базы
обновляем только при слиянии nightly.

### Целая nightly

```sh
git switch -c upstream-sync/nightly-5038 feature/chronos-development
git fetch --no-tags upstream refs/tags/v0.1.12-nightly.20261121.5038
node chronos/scripts/upstream-plan.mjs nightly FETCH_HEAD
```

Подставь выбранный тег и имя новой ветки. Отчёт сравнивает обе стороны с SHA в
`chronos/version.json` и пробует слияние через `git merge-tree`. Он показывает и общие пути
для проверки поведения, и файлы, в которых Git требует разрешить конфликт. Для `pick`
пробный перенос берёт разницу относительно единственного родителя коммита.
Оба режима работают с коммитами и оставляют ветку, индекс и рабочие файлы на месте.
Код выхода 0 означает, что отчёт построен, в том числе при найденных конфликтах.
Нужен Git с поддержкой `merge-tree --merge-base`. После выбора nightly следуй
[процедуре слияния и проверки](skills/chronos-upstream-sync/SKILL.md).

## Установка рядом с T3

Установщик Windows регистрирует приложение Chronos с идентификатором `io.github.zulut30.chronos`. Профиль Electron находится в `%APPDATA%\Chronos` (на Mac в `~/Library/Application Support/Chronos`), сервер и его база — в `~/.chronos/userdata`. Для изолированного стенда каталог сервера задаётся через `CHRONOS_HOME`. У каждого экземпляра свой локальный сервер и блокировка профиля.

Встроенный клиент использует внутренний origin `t3code://app` для совместимости с серверами T3. Внешний callback Chronos — `chronos://app/`. T3 Connect использует официальные публичные параметры Clerk и relay из `.env.example`. Новая установка проходит свой вход и привязку. Команда `~/.chronos/bin/t3` (на Windows `t3.cmd`) обращается к среде Chronos.

Ежедневная проверка **T3 nightly compatibility report** сверяет SHA базового тега с официальным репозиторием и публикует список пересечений и конфликтов во вкладке Actions. Перенос выполняется в рабочей ветке по результатам проверки. Для доработок внешнего вида и взаимодействия используй [chronos-ui](skills/chronos-ui/SKILL.md).

## Версии

`chronos/version.json`:

```json
{ "upstream": "0.1.11-nightly.20261117.4838", "upstreamCommit": "ea6d3fc30fb066635f31326f49b85cdee8fbf8d7", "revision": 1 }
```

- `upstream` — nightly-тег апстрима (`v<upstream>` в pingdotgg/t3code), на котором стоит эта ветка.
- `upstreamCommit` — полный SHA коммита этого тега. Сохраняется в истории форка и доступен в полном клоне без тегов T3.
- `revision` — счётчик релизов Chronos поверх этого nightly; после синхронизации с апстримом
  сбрасывается в 1.
- Версия приложения: `<upstream>.chronos.<revision>`, например `0.1.11-nightly.20261117.4838.chronos.1`.
  По semver она идёт сразу после своей nightly T3 и раньше следующей, поэтому сравнение с версиями
  T3 остаётся корректным.
- Тег релиза: `chronos-v<версия>` (`node chronos/scripts/chronos-version.mjs` печатает всё сразу).

Сервер, веб и CLI собираются с версией апстрима (`<upstream>`), только десктоп получает версию
Chronos. Так фоновая служба, удалённые SSH/WSL-рантаймы и проверки треков обновлений находят
настоящие релизы T3. Для этого `chronosUpstreamVersion()` превращает версию Chronos в версию апстрима.

## Сборка (GitHub Actions)

`.github/workflows/chronos-desktop.yml`:

- **workflow_dispatch** — сборка Windows x64 (NSIS), macOS arm64 и x64 (dmg + zip); установщики
  лежат в артефактах прогона (`chronos-win-x64`, `chronos-mac-arm64`, `chronos-mac-x64`).
- **тег `chronos-v*`** — то же самое, затем GitHub Release с установщиками и фидами обновлений.
  Тег должен совпадать с `chronos/version.json`, иначе сборка падает сразу.
- Подписи нет (нет Apple Developer ID и Azure Trusted Signing): Windows SmartScreen и macOS
  Gatekeeper предупреждают при первом запуске.
- Windows собирается кросс-сборкой на Ubuntu, как в апстриме. Для WSL в установщик кладётся
  официальный Linux-архив CLI `t3-<upstream>-linux-x64.tar.gz` из релиза апстрима.
- Не собираются (в отличие от апстрима): Linux, Windows arm64, архивы CLI, npm, мобильные приложения.
  Апстримные workflow из `.github/workflows` удалены: им нужны платные раннеры Blacksmith, а
  `release.yml` по расписанию публиковал бы nightly.

## Обновления

- Фид — generic-провайдер electron-updater: `https://github.com/Zulut30/Chronos/releases/latest/download`.
  GitHub перенаправляет его на последний опубликованный (не pre-release) релиз Chronos.
- Канал: версия Chronos считается nightly, поэтому приложение читает `nightly.yml` /
  `nightly-mac.yml`. Самостоятельная сборка принимает проверенные версии Chronos в этом канале.
- Windows: обычное «Скачать → Перезапустить» (тихая установка NSIS).
- macOS: сборки без подписи не могут установить обновление сами. Приложение показывает, что есть
  новая версия, а «Скачать» открывает страницу последнего релиза в браузере.

## Тема Olympus

- Исходники и сборщик: `chronos/theme/` (`build.py` собирает `olympus.json`: светлая «день» +
  `variants.dark` «ночь», картинки — data URI внутри CSS).
- `node chronos/scripts/sync-theme.mjs` копирует её в `apps/web/src/chronos/olympus.theme.json`.
- Тема встроена в веб-клиент с id `olympus` (как опубликованная раньше через `t3 theme set`).
  На первом запуске профиля Chronos один раз выбирает её с режимом «как в системе»;
  если пользователь уже выбирал тему, выбор не трогается (ключ `chronos:default-theme-seeded`).
- Встроенная тема не проходит через лимит CSS опубликованных тем (`THEME_CSS_MAX_LENGTH` = 100 000),
  поэтому лимит не менялся. Старый опубликованный `~/.t3/userdata/themes/olympus.json` (327 КБ)
  сервер пропускает с предупреждением в логе — его заменяет встроенная тема.

## Русский интерфейс

- Языки: English и Русский (Настройки → Язык; там же «Как в системе»). Выбор хранится в
  клиентских настройках (`language`), как в апстриме.
- По умолчанию — язык системы: при первом запуске профиля Chronos один раз меняет нетронутое
  значение `en` (дефолт схемы) на `system`; `ru-*` → русский, остальное → английский
  (`apps/web/src/chronos/i18n/languages.ts`, ключ `chronos:default-language-seeded`).
- Механизм апстрима — gt-react (`apps/web/src/i18n`, `gt.config.json`). Строки, обёрнутые в
  `<T>`/`gt()` (пока 77, экраны настроек), переводит его каталог `translations/ru.json`.
  Остальной интерфейс в апстриме — английские литералы. Оборачивать их в файлах апстрима =
  тысячи правок и конфликт на каждом слиянии, поэтому Chronos добавляет свой каталог
  `apps/web/src/chronos/i18n/ru.catalog.json` (англ. строка → рус., плюс шаблоны с `$1`).
- Каталог применяется при создании React-элементов: плагин Vite (`vitePlugin.ts`) подменяет
  `react/jsx-runtime` для модулей `apps/web/src` на `jsxRuntime.ts`, а `localizeElement.ts`
  переводит текстовые дети и атрибуты `title`/`placeholder`/`aria-label`/`alt`. DOM не
  наблюдается. Пользовательский текст не трогается: `pre`/`code`/`kbd`/`textarea`, элементы с
  `dir` (заголовки тредов, сообщения), `.chat-markdown`, `.font-mono`, пузыри сообщений.
  Строки-данные (`title === "New thread"` на сервере, ключи, протокол) не переводятся: меняется
  только отображаемый текст. Тот же слой показывает «T3 Code» как «Chronos» (кроме мобильного
  приложения T3 и T3 Connect). Каталог грузится отдельным чанком вместе с `ru.json` апстрима;
  смена языка перемонтирует дерево (`key` на `GTProvider`).
- Источник каталога: `chronos/legacy-package/client/l10n/` (`ru-final.json`, `runtime-*.json`)
  - `chronos/l10n/ru.overrides.json` (новые строки по `glossary.md`; `keep` — имена, которые
    остаются английскими). Пересборка: `node chronos/l10n/build-ru-catalog.mjs`.
- Проверка: `node chronos/scripts/l10n-check.mjs [--missing] [--min 95]` — доля переведённых
  литералов интерфейса из `apps/web/src`, полнота `ru.json` апстрима, битые плейсхолдеры
  (`{name}`, `${x}`, `%s`, `$n` в шаблонах). `--missing` пишет непереведённые строки в
  `chronos/.work/l10n-missing.tsv`. Запускается в `chronos-checks.yml`.
- Не переведено: нативные меню Electron и тексты main-процесса, строки, которые собираются в
  коде из кусков без литерала (их ловят только шаблоны), подсказки, которые Base UI создаёт сам.

## Где Chronos встраивается в код апстрима

Все правки в файлах апстрима помечены комментарием `chronos:` (`git grep -n "chronos:"`).
Новые файлы — только в `chronos/`, `apps/*/src/chronos/` и `.github/workflows/chronos-*.yml`.

| Файл апстрима                                                                        | Правка                                                                                           |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| `packages/shared/src/cliRelease.ts`                                                  | блок `chronos: begin/end` в конце (версии, адреса); `cliReleaseChannelOf` читает версию апстрима |
| `apps/desktop/src/updates/updateChannels.ts`                                         | nightly-признак по версии апстрима                                                               |
| `apps/desktop/src/ssh/DesktopSshEnvironment.ts`                                      | SSH-рантайм качает CLI версии апстрима, в том числе через заданное зеркало                       |
| `apps/desktop/src/app/DesktopEnvironment.ts`                                         | имя продукта Chronos, заголовок окна                                                             |
| `apps/desktop/src/updates/DesktopUpdates.ts`                                         | macOS: «Скачать» открывает страницу релиза                                                       |
| `scripts/build-desktop-artifact.ts`                                                  | productName, иконки, имя артефактов, фид обновлений, WSL-архив                                   |
| `apps/web/src/hooks/useTheme.ts`                                                     | первый импорт — выбор Olympus по умолчанию                                                       |
| `apps/web/src/themePalette.ts`                                                       | Olympus среди встроенных тем                                                                     |
| `apps/web/src/components/settings/ThemeSettings.tsx`, `CommandPaletteThemeItems.tsx` | Olympus в списках тем                                                                            |
| `apps/web/src/components/sidebar/SidebarChrome.tsx`                                  | логотип Chronos в шапке                                                                          |
| `apps/web/src/components/desktopUpdate.logic.ts`                                     | ссылка на релиз по тегу `chronos-v…`                                                             |
| `apps/web/vite.config.ts`                                                            | плагин `chronosL10nPlugin` (русский каталог и имя Chronos в JSX); имя в `<title>`                |
| `apps/web/src/i18n/locales.ts`                                                       | языки: только `en` и `ru`                                                                        |
| `apps/web/src/i18n/initializeI18n.ts`                                                | вместе с `ru.json` грузится каталог Chronos                                                      |
| `apps/web/src/i18n/I18nProvider.tsx`                                                 | `key={locale}`: перемонтирование при смене языка                                                 |
| `apps/web/src/i18n/runtime.ts`                                                       | первый запуск — язык системы                                                                     |
| `apps/web/src/branding.ts`                                                           | имя продукта в браузерной сборке                                                                 |
| `apps/web/index.html`                                                                | Olympus и его первый запуск в загрузочном скрипте (без мелькания), иконка и имя на заставке      |
| `apps/desktop/src/electron/ElectronDialog.ts`                                        | диалоги называют продукт Chronos                                                                 |
| `apps/desktop/src/app/DesktopStartupRecovery.ts`                                     | «Предыдущие версии» — релизы Chronos, имя на странице восстановления                             |
| `README.md`, `.gitignore`                                                            | строка о форке, игнор `chronos/.work/`                                                           |
| `.github/workflows/*`                                                                | апстримные workflow удалены                                                                      |

| `apps/web/src/AppRoot.tsx` | Chronos workspace, native Settings navigation и CSS цветов |
| `apps/web/src/components/{CommandPalette,sidebar/SidebarChrome}.tsx` | Точки входа в расширения |
| `apps/web/src/components/settings/{SettingsSidebarNav,SettingsBreadcrumb}.tsx`, `routes/_chat.settings.tsx` | Нативные локальные страницы и device scope |
| `apps/web/src/routes/_chat.settings.{mcp,skills,chronos-keys}.tsx` | Тонкие обязательные entry points файлового роутера; реализация под chronos/ |
| `apps/web/src/components/chat/{ChatComposer,ComposerControlsBar}.tsx` | Intake Studio и инструменты композера/Plan |
| `apps/web/src/components/chat/{useComposerSend,useMultipleModelSend,useComposerResume,useThreadLifecycle}.ts*` | Снимок выбранного interactionMode до подготовки и RPC |
| `apps/web/src/components/{ChatMarkdown,files/FileBrowserPanel}.tsx` | Ссылки задач и загрузка из дерева файлов |
| `apps/web/src/components/chat/MessageCopyButton.tsx`, `markdown-clipboard.ts` | Санитизированный rich HTML и частичные выделения |
| `packages/shared/src/markdownPipeline.ts` | Allowlist rich text из отдельного модуля; экспорт в существующей точке |
| `apps/web/src/state/environments.ts` | Aliases только отображения, без изменения identity/соединений |
| `apps/web/vite.config.ts` | Только dev proxy фиксированных localhost-сервисов, без localhost в remote production |

Новые модули: `apps/desktop/src/chronos/` (`ChronosUpdates.ts`, `ChronosBrand.ts`),
`apps/web/src/chronos/` (`theme.ts`, `seedDefaultTheme.ts`, `ChronosBrandMark.tsx`,
`olympus.theme.json`, иконки, `i18n/`), `chronos/l10n/`, `chronos/scripts/l10n-check.mjs`,
`.github/workflows/chronos-checks.yml`.

В CI обязательны полные юнит-наборы web/desktop, включая Chronos (SSH, Olympus, русский каталог,
бренд, профиль, обновления и перетаскивание файлов), выбранные проверки shared и серверные
регрессии авторизации, миграций, проекций и запрета сна WSL. Ожидания имени продукта в тестах
адаптированы к Chronos; Linux-раннер устанавливает libsecret для нативного теста хранилища.

## Синхронизация с апстримом и релизы

Скиллы (исходники в `chronos/skills/`, копии в `~/.claude/skills/` и `~/.codex/skills/`):

- `chronos-upstream-sync` — сводка новых коммитов апстрима, ветка `upstream-sync/<дата>`,
  слияние, CI, отчёт. В `main` — только по решению пользователя.
- `chronos-release` — версия, тег, CI, релиз — только по слову пользователя.
- `chronos-feature` — как добавлять функции под `chronos/`, не ломая слияния.

## Прочее

- `chronos/brand/` — логотип и иконки (`chronos.ico`, `chronos.icns`, `chronos-macos-1024.png`,
  `chronos-1024.png`, маска и фавикон).
- `chronos/legacy-package/` — старый пакет бинарного патчинга установленного T3 (`server.asar`):
  русский интерфейс, задачи, студия и т. д. Источник для переноса функций на следующих этапах;
  в сборку не входит.

## Граница переноса из бинарного пакета

| Функция локального пакета           | Состояние в Git-форке                                                                                                                                   |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Olympus (день/ночь), бренд и иконки | Встроены; сохранён пользовательский выбор темы, переключение через настройки и палитру команд                                                           |
| Русский интерфейс                   | Перенесён в JSX-слой и каталоги; без DOM-переводчика legacy                                                                                             |
| Отдельная кнопка день/ночь legacy   | Не перенесена; смена режима доступна штатными средствами                                                                                                |
| Задачи `#T-12`                      | React-доска: проекты/группы, доска/таблица, фильтры, порядок, checklist, заметки, корзина; сохранён внешний tasks-service                               |
| Скиллы                              | Страница штатных Settings с существующим skills-manager; сервис и его MCP не переустанавливаются                                                        |
| Plan                                | Нативный `interactionMode`, отдельный draft/thread; create/start/fanout/resume/standalone фиксируют режим до await                                      |
| Файлы и машины                      | Загрузка файла/папки из контекстного меню, очередь/отмена/показ папки, локальный/SSH/URL-путь; aliases и упоминания машин                               |
| Композер                            | Ссылки на задачи, машины, модели и `!`-поиск через существующие MCP; вложения идут через штатный intake и редактор T3                                   |
| Studio                              | Один React chooser, доски и WordPress — в native preview; создание/rename/корзина, board-to-chat/PNG через SSE и штатные вложения                       |
| OpenRouter и API-ключи              | React-каталог text/image/video/speech/transcription/audio/decision и отдельная страница ключей; OpenRouter MCP и integrations-service остаются внешними |
| Скорость                            | Нативные usage timestamps, live-оценка роста текста, legacy-замеры и калибровка `oly-speed-v2`; оценки помечены `≈`                                     |
| Rich text / clipboard               | Общий allowlist Markdown, безопасные стили и фиксированные цвета HTML clipboard, включая частичное выделение                                            |
| Менеджер MCP                        | Штатный маршрут Settings, embedded-форма существующего mcp-manager без второго overlay и заголовка                                                      |

Установщик и явный пакет совместимости собираются CI. Пакет не включает старый архив или JS-бандлы:
он проверяет существующие сервисы/MCP и сохраняет их файлы на месте. Обычный `.exe` сам по себе
не устанавливает отсутствующие сервисы. Процедура и ограничения — [compatibility/README.md](compatibility/README.md).
Встроенный web-клиент и Electron получают локальный слой (production web — HTTP localhost:3773); hosted web/мобильный клиент не обращаются
к localhost чужого устройства и сохраняют штатные функции T3. Генерация через OpenRouter оплачивается
провайдером согласно запросу агента; автоматических платных проверок нет.
