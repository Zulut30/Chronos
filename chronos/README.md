# Chronos

Chronos — форк [pingdotgg/t3code](https://github.com/pingdotgg/t3code) (MIT), который отличается от
T3 Code только оформлением: название, иконка, логотип в шапке и тема Olympus по умолчанию.
Под капотом всё как в T3: T3 Connect, туннель, мобильное приложение, протокол `t3code://`,
CLI `t3`, папки данных.

## Что остаётся как в T3 (не менять)

| Что | Значение |
| --- | --- |
| appId / AppUserModelId | `com.t3tools.t3code` |
| Профиль Electron (userData) | `%APPDATA%\t3code-v2` (Windows), `~/Library/Application Support/t3code-v2` (macOS) |
| Данные сервера | `~/.t3` (`~/.t3/userdata`) |
| Протокол | `t3code://` |
| T3 Connect | Clerk `pk_live_Y2xlcmsudDMuY29kZXMk`, relay `https://relay.t3.codes` (публичные значения из `.env.example`) |
| CLI | `t3`, версии и архивы — официальные релизы T3 |

Поэтому Chronos подхватывает треды, настройки, вход в T3 Connect и пейринг установленного
«T3 Code (Nightly)». Одновременно оба приложения работать не могут (общий appId и общие данные):
установщик Chronos заменяет T3 Nightly.

## Версии

`chronos/version.json`:

```json
{ "upstream": "0.1.10-nightly.20261116.4800", "revision": 1 }
```

- `upstream` — nightly-тег апстрима (`v<upstream>` в pingdotgg/t3code), на котором стоит наш `main`.
- `revision` — счётчик релизов Chronos поверх этого nightly; после синхронизации с апстримом
  сбрасывается в 1.
- Версия приложения: `<upstream>.chronos.<revision>`, например `0.1.10-nightly.20261116.4800.chronos.1`.
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
  `nightly-mac.yml`. Если вручную переключить канал на Stable, обновления Chronos не придут.
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
- Встроенная тема не проходит через лимит CSS опубликованных тем (`THEME_CSS_MAX_LENGTH` = 50 000),
  поэтому лимит не менялся. Старый опубликованный `~/.t3/userdata/themes/olympus.json` (327 КБ)
  сервер пропускает с предупреждением в логе — его заменяет встроенная тема.

## Русский интерфейс

- Языки: English и Русский (Настройки → Язык; там же «Как в системе»). Выбор хранится в
  клиентских настройках (`language`), как в апстриме.
- По умолчанию — язык системы: при первом запуске профиля Chronos один раз меняет нетронутое
  значение `en` (дефолт схемы) на `system`; `ru-*` → русский, остальное → английский
  (`apps/web/src/chronos/i18n/languages.ts`, ключ `chronos:default-language-seeded`).
- Механизм апстрима — gt-react (`apps/web/src/i18n`, `gt.config.json`). Строки, обёрнутые в
  `<T>`/`gt()` (пока ~70, экраны настроек), переводит его каталог `translations/ru.json`.
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
  + `chronos/l10n/ru.overrides.json` (новые строки по `glossary.md`; `keep` — имена, которые
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

| Файл апстрима | Правка |
| --- | --- |
| `packages/shared/src/cliRelease.ts` | блок `chronos: begin/end` в конце (версии, адреса); `cliReleaseChannelOf` читает версию апстрима |
| `apps/desktop/src/updates/updateChannels.ts` | nightly-признак по версии апстрима |
| `apps/desktop/src/main.ts` | SSH-рантайм качает CLI версии апстрима |
| `apps/desktop/src/app/DesktopEnvironment.ts` | имя продукта Chronos, заголовок окна |
| `apps/desktop/src/updates/DesktopUpdates.ts` | macOS: «Скачать» открывает страницу релиза |
| `scripts/build-desktop-artifact.ts` | productName, иконки, имя артефактов, фид обновлений, WSL-архив |
| `apps/web/src/hooks/useTheme.ts` | первый импорт — выбор Olympus по умолчанию |
| `apps/web/src/themePalette.ts` | Olympus среди встроенных тем |
| `apps/web/src/components/settings/ThemeSettings.tsx`, `CommandPaletteThemeItems.tsx` | Olympus в списках тем |
| `apps/web/src/components/sidebar/SidebarChrome.tsx` | логотип Chronos в шапке |
| `apps/web/src/components/desktopUpdate.logic.ts` | ссылка на релиз по тегу `chronos-v…` |
| `apps/web/vite.config.ts` | плагин `chronosL10nPlugin` (русский каталог и имя Chronos в JSX); имя в `<title>` |
| `apps/web/src/i18n/locales.ts` | языки: только `en` и `ru` |
| `apps/web/src/i18n/initializeI18n.ts` | вместе с `ru.json` грузится каталог Chronos |
| `apps/web/src/i18n/I18nProvider.tsx` | `key={locale}`: перемонтирование при смене языка |
| `apps/web/src/i18n/runtime.ts` | первый запуск — язык системы |
| `apps/web/src/branding.ts` | имя продукта в браузерной сборке |
| `apps/web/index.html` | Olympus и его первый запуск в загрузочном скрипте (без мелькания), иконка и имя на заставке |
| `apps/desktop/src/electron/ElectronDialog.ts` | диалоги называют продукт Chronos |
| `apps/desktop/src/app/DesktopStartupRecovery.ts` | «Предыдущие версии» — релизы Chronos, имя на странице восстановления |
| `README.md`, `.gitignore` | строка о форке, игнор `chronos/.work/` |
| `.github/workflows/*` | апстримные workflow удалены |

Новые модули: `apps/desktop/src/chronos/` (`ChronosUpdates.ts`, `ChronosBrand.ts`),
`apps/web/src/chronos/` (`theme.ts`, `seedDefaultTheme.ts`, `ChronosBrandMark.tsx`,
`olympus.theme.json`, иконки, `i18n/`), `chronos/l10n/`, `chronos/scripts/l10n-check.mjs`,
`.github/workflows/chronos-checks.yml`.

Юнит-тесты апстрима, которые проверяют название «T3 Code (Nightly)», с Chronos расходятся — это
ожидаемо; в CI Chronos тесты апстрима не запускаются.

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
