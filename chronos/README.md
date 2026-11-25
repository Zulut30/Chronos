# Chronos

Chronos — независимый форк [pingdotgg/t3code](https://github.com/pingdotgg/t3code) (MIT) на базе
**`v0.1.12-nightly.20261124.5209`** (`84e4264bb347e36e97f6c3bd95d666eecfa12e07`), переносящий
функциональность, внешний вид внутри окна, серверные правки и русский перевод Olympus один в один
поверх исходников T3, с установкой рядом с T3 и собственной лентой обновлений.

Проверка переноса с эталона 4774 на эту базу — в [отчёте по nightly 5209](parity/upstream-5209.md).

## Архитектура переноса Olympus (паритет 1:1)

Предыдущая попытка на базе 4838 с переписыванием функций Olympus на React и отдельным i18n-слоем
отклонена: внутри окна приложение должно вести себя и выглядеть точно так же, как Olympus поверх
T3 Code 4774.

Перенос разбит на четыре независимых потока; отчёты и списки изменений каждого потока хранятся в
`chronos/parity/`:

- **Упаковка Chronos** (`chronos/parity/packaging.md`) — отдельная идентичность на уровне ОС
  (имя продукта, иконки, заголовок окна, установка рядом с T3, профиль, `CHRONOS_HOME`,
  `chronos://`, `~/.chronos/bin/t3`, CI и лента обновлений). Не меняет содержимое внутри окна.
- **Клиентские модули Olympus** — перенос модулей и клиентских native-правок Olympus как есть.
- **Серверные правки и контракты** — перенос серверных и контрактных патчей Olympus как есть
  (OpenRouter в статистике, лимит CSS темы `THEME_CSS_MAX_LENGTH`, адаптер Antigravity CLI/children).
- **Перевод и паритет** — перенос русского перевода Olympus и проверки паритета
  (`.github/workflows/chronos-parity.yml`).

Тема Olympus остаётся внешней (как в Olympus LIVE — файлы в `userdata/themes/`), встроенной темы
и переписанного JSX-каталога в `apps/web/src/chronos/` нет. Установщик включает семь HTTP-сервисов Olympus и OpenRouter MCP (stdio).
Chronos проверяет локальные порты после готовности Electron и запускает свободные сервисы
из ресурсов приложения. Профиль задаёт `CHRONOS_HOME`, по умолчанию `~/.chronos`.
Подробности — в [отчёте по сервисам](parity/services.md).

## Разработка Chronos и перенос функций T3

Основная ветка — `main`: перенос Olympus один в один на базе `v0.1.10-nightly.20261116.4774`
(бывшая ветка `parity/olympus`; прежний `main` с React-переписью сохранён как `legacy/react-rewrite`).
Новые задачи ведутся от `main`.

### Своя функция или правка

```sh
git switch -c feature/my-feature main
node chronos/scripts/upstream-plan.mjs feature main
```

Держи код форка изолированно (`chronos/`, `apps/desktop/src/chronos/`, отдельные модули потока),
а в файлах апстрима оставляй минимальные точки встраивания с комментарием `// chronos: <зачем>`.
Команда `upstream-plan.mjs feature` показывает все изменения ветки и рабочей копии с разбиением на
каталоги Chronos и файлы апстрима. Для обзора всей поверхности изменений относительно базового
коммита T3 выполни `node chronos/scripts/upstream-plan.mjs surface`.

### Trello

| Точка встраивания в T3 | Назначение |
| --- | --- |
| `packages/contracts/src/issue.ts`, `packages/source-control-core/src/server/IssueTracker.ts` | Необязательные срок и вложения, разрешение срока и определение доски карточки |
| `apps/server/src/issue/{IssueTrackerRegistry,IssueService}.ts` | Регистрация драйвера, выбор доски и аккаунта для короткой ссылки, обработка срока |
| `apps/server/src/mcp/toolkits/issues/{tools,handlers}.ts` | Чтение вложений и срока, создание и обновление карточек |
| `packages/client-runtime/src/issueLinks.ts`, `apps/web/src/lib/openIssueLink.ts`, `apps/mobile/src/native/useOpenPullRequest.ts` | Распознавание ссылки в чате и переход на реальную доску |
| `apps/web/src/components/settings/{IssueTrackerSettings.tsx,settingsSearch.ts}`, `components/issue/{issuePresentation,IssueDetailPanel}.tsx` | Поиск и настройка подключения, обозначение Trello и поля карточки |
| `apps/mobile/src/features/issues/IssueRouteScreen.tsx` | Срок и ссылки вложений в мобильной карточке |
| `packages/client-runtime/src/issueLinks.test.ts`, `apps/server/src/mcp/toolkits/issues/handlers.test.ts`, `.github/workflows/chronos-checks.yml` | Моки REST, короткие ссылки, реальные обработчики инструментов, регрессии подключений |

[Возможности и проверка Trello](parity/trello-tracker.md)

### Точечный перенос коммита T3

Если в свежем клоне есть только `origin`, добавь апстрим:
`git remote add upstream https://github.com/pingdotgg/t3code.git`.

```sh
git fetch --no-tags upstream main
git log --oneline FETCH_HEAD
node chronos/scripts/upstream-plan.mjs pick <sha>
git show <sha>
git cherry-pick -x <sha>
```

Ключ `-x` сохраняет исходный SHA в истории. Версию базы в `chronos/version.json` обновляем только
при полном обновлении nightly.

### Обновление до новой nightly T3

```sh
git switch -c upstream-sync/nightly-<build> main
git fetch --no-tags upstream refs/tags/v<version>
node chronos/scripts/upstream-plan.mjs nightly FETCH_HEAD
```

Отчёт сравнивает обе стороны с `upstreamCommit` в `chronos/version.json` и пробует слияние через
`git merge-tree --merge-base`, не меняя ветку, индекс и рабочие файлы. Полная процедура — в
[chronos-upstream-sync](skills/chronos-upstream-sync/SKILL.md).

## Установка рядом с T3

- Установщик Windows регистрирует приложение **Chronos** с идентификатором
  `io.github.zulut30.chronos` (без T3-скрипта `installer.nsh`).
- Профиль Electron: `%APPDATA%\Chronos` (Windows), `~/Library/Application Support/Chronos` (macOS).
  Миграция legacy-профиля T3 отключена.
- Сервер и его база: `~/.chronos/userdata` (переопределяется через `CHRONOS_HOME`; переменная
  `T3CODE_HOME` от установленного T3 игнорируется). WSL-бэкенд получает `--base-dir ~/.chronos`.
- Встроенный клиент сохраняет внутренний origin `t3code://app` для совместимости с серверами T3 и
  CORS-политиками локальных сервисов Olympus. Внешний OAuth/deep-link callback Chronos — `chronos://`.
- T3 Connect использует официальные публичные параметры Clerk и relay из `.env.example`.
- Глобальная команда `t3` в PATH остаётся за установленным T3; для Chronos используется
  `~/.chronos/bin/t3` (на Windows `~/.chronos/bin/t3.cmd`), жёстко привязанный к `~/.chronos`.

## Версии

`chronos/version.json`:

```json
{
  "upstream": "0.1.12-nightly.20261124.5209",
  "upstreamCommit": "84e4264bb347e36e97f6c3bd95d666eecfa12e07",
  "revision": 5
}
```

- `upstream` — nightly-тег апстрима (`v<upstream>` в `pingdotgg/t3code`), на котором стоит ветка.
- `upstreamCommit` — полный SHA коммита этого тега.
- `revision` — счётчик релизов Chronos (следующий после `main`).
- Версия приложения: `<upstream>.chronos.<revision>`, например
  `0.1.12-nightly.20261124.5209.chronos.5`.
- Тег релиза: `chronos-v<версия>` (`node chronos/scripts/chronos-version.mjs` печатает все поля).

Сервер, веб и CLI собираются с версией апстрима (`<upstream>`), только десктоп-оболочка получает
версию Chronos (`--build-version`). Через `chronosUpstreamVersion()` SSH/WSL-рантаймы и проверка
канала находят соответствующие релизы T3.

## Сборка и CI (GitHub Actions)

Апстримные workflow из `.github/workflows/` удалены (им нужны платные раннеры и расписание релизов
T3). Оставлены только workflow Chronos:

- `.github/workflows/chronos-desktop.yml`:
  - **push в `main`** и **`workflow_dispatch`** — собирают Windows x64 (NSIS) и macOS
    arm64/x64 (`dmg` + `zip`) без цифровой подписи и загружают установщики в артефакты прогона
    (`chronos-win-x64`, `chronos-mac-arm64`, `chronos-mac-x64`), без публикации GitHub Release.
  - **тег `chronos-v*`** — проверяет совпадение тега с `chronos/version.json`, находит успешные
    прогоны `chronos-checks.yml` и ручного `chronos-desktop.yml` на `HEAD` ветки `main`, сверяет
    манифесты (`chronos/scripts/verify-release.mjs`) и публикует GitHub Release (`--latest`) с
    постоянными именами установщиков и фидами `nightly.yml` / `nightly-mac.yml`.
  - Windows собирается кросс-сборкой на Ubuntu; для WSL вкладывается официальный Linux-архив CLI
    `t3-<upstream>-linux-x64.tar.gz` из релиза апстрима.
- `.github/workflows/chronos-checks.yml` — проверка `chronos/version.json`, тесты `upstream-plan`,
  lint модулей `apps/desktop/src/chronos`, typecheck, тесты `packages/shared`, юнит-тесты web и
  desktop, typecheck и регрессии `apps/server`.
- `.github/workflows/chronos-upstream.yml` — ежедневный отчёт совместимости с новым nightly T3
  (`upstream-plan.mjs nightly`).
- `.github/workflows/chronos-parity.yml` — проверки паритета Olympus (поддерживается потоком перевода).

## Обновления

- Фид — generic-провайдер electron-updater:
  `https://github.com/Zulut30/Chronos/releases/latest/download`.
- Канал: сборка Chronos фиксирована на канале `nightly` (`nightly.yml` / `nightly-mac.yml`) и
  принимает только версии Chronos (`isChronosVersion`).
- Windows: стандартное обновление через NSIS.
- macOS: неподписанные сборки не могут обновляться через Squirrel.Mac — «Скачать» открывает
  страницу последнего релиза Chronos в браузере.

## Настройки чата Olympus

В **Настройки → Внешний вид → Интерфейс** можно включить цветной текст, скачивание и дополнительные функции чата. [Опись модулей, зависимостей и параметров](parity/chat-settings.md) содержит ключи, исходные значения и время применения.

| Точка встраивания | Назначение |
| --- | --- |
| `apps/web/src/components/settings/AppearanceSettingsPanel.tsx` | Основные строки и группа внутри «Дополнительно». |
| `apps/web/src/components/settings/settingsSearch.ts` | Поиск строк и раскрытие «Дополнительно» при переходе. |
| `apps/web/src/i18n/translations/*.json` | Строки штатного GT-каталога и русский перевод. |
| `apps/web/src/chronos/olympus/plugin.ts` | Общий снимок флагов для пролога, Pierre и Markdown в сборке и dev. |
| `packages/shared/src/markdownPipeline.ts`, `packages/shared/src/markdownHast.ts` | Существующие точки подключения получают пустой экспорт плагина при отключении цвета. |
| `apps/web/src/components/ChatView.tsx`, `components/chat/{useComposerSend,useComposerResume,useThreadLifecycle}` | Существующие точки отправки получают исходный interactionMode через резервную функцию при отключении дополнительных режимов. |

## Точки встраивания слоя упаковки в код апстрима

Все правки упаковки в файлах апстрима помечены комментарием `chronos:` (`git grep -n "chronos:"`).
Точки встраивания клиентских модулей, серверных патчей и перевода описаны в соответствующих
отчётах в `chronos/parity/`.

| Файл апстрима | Правка упаковки |
| --- | --- |
| `packages/contracts/src/settings.ts`, `apps/server/src/serverSettings.ts` | Минуты простоя Claude в настройках окружения и значение для старых профилей |
| `packages/provider-core/src/server/ProviderAdapter.ts`, `apps/server/src/orchestration-v2/Adapters/ClaudeAdapterV2.ts` | Локальная проверка готовности к выгрузке, дерево процессов и нативное возобновление Claude |
| `apps/server/src/orchestration-v2/ProviderSessionManager.ts`, `apps/server/src/terminal/Manager.ts` | Таймер, блокировка открытия и проверка открытых терминалов. [Устройство и ручная проверка](parity/perf-idle-unload.md) |
| `apps/web/src/components/settings/ProviderSettingsPanel.tsx` | Поле времени простоя в дополнительных настройках провайдеров |
| `packages/shared/src/cliRelease.ts` | Блок `chronos: begin/end` (версии, appId, scheme, URLs); `cliReleaseChannelOf` читает версию апстрима |
| `apps/desktop/src/app/DesktopConfig.ts` | Переменная окружения `CHRONOS_HOME` |
| `apps/desktop/src/app/DesktopEnvironment.ts` | Имя продукта `Chronos`, заголовок окна, `~/.chronos` / `CHRONOS_HOME`, AUMID `io.github.zulut30.chronos` |
| `apps/desktop/src/app/DesktopUserData.ts` | Профиль `%APPDATA%\Chronos` / `~/Library/Application Support/Chronos` |
| `apps/desktop/src/app/DesktopLegacyLocalStorage.ts` | Отключение миграции legacy localStorage T3 |
| `apps/desktop/src/app/DesktopClerk.ts` | Внешний callback-протокол `chronos://` (внутренний origin остаётся `t3code://app`) |
| `apps/desktop/src/app/DesktopCliCommand.ts` | Не перехватывать глобальный `t3` в PATH |
| `apps/desktop/src/app/DesktopCliShim.ts` | Жёсткая привязка `~/.chronos/bin/t3` к `~/.chronos` (`privateHome`) |
| `apps/desktop/src/backend/DesktopBackendConfiguration.ts` | `T3CODE_HOME` для локального бэкенда и `--base-dir ~/.chronos` для WSL |
| `apps/desktop/src/ssh/DesktopSshEnvironment.ts` | `resolveDesktopSshCliRunner` запрашивает CLI-архив версии апстрима и учитывает зеркало релизов |
| `apps/desktop/src/updates/updateChannels.ts` | Признак nightly по версии апстрима |
| `apps/desktop/src/updates/DesktopUpdates.ts` | Фильтр версий Chronos, фиксация канала `nightly`, открытие релиза в браузере на неподписанной macOS |
| `apps/desktop/src/electron/ElectronDialog.ts` | Имя продукта `Chronos` в системных диалогах (без русской локализации) |
| `apps/desktop/src/app/DesktopStartupRecovery.ts` | Ссылки восстановления на релизы `Zulut30/Chronos` (`chronos-v*`) и имя продукта `Chronos` |
| `apps/desktop/src/app/DesktopAppIdentity.test.ts`, `DesktopClerk.test.ts`, `DesktopEnvironment.test.ts`, `DesktopPreReadyPlatform.test.ts`, `updates/updatesTestHarness.ts` | Ожидания имени/профиля/схемы Chronos и переносимость путей фикстур на Windows |
| `apps/desktop/src/app/DesktopClerk.ts`, `apps/desktop/src/electron/ElectronProtocol.ts` | После моста Clerk (схема `chronos://`) заново регистрируются привилегии `t3code://` вместе с `chronos://` (`apps/desktop/src/chronos/ChronosSchemes.ts`), иначе в окне не работает `fetch` (терминал, wasm) |
| `apps/desktop/src/window/RemoteRequestHeaders.ts` | С T3 5209 окно вырезает `Origin: t3code://app` из запросов к `http(s)`; для портов сервисов Olympus на loopback (`apps/desktop/src/chronos/services/ServiceOrigins.ts`) заголовок сохраняется, иначе их CORS отклоняет запросы |
| `apps/web/src/components/sidebar/SidebarChrome.tsx` | Знак и имя Chronos в шапке сайдбара вместо `T3 Code` (`apps/web/src/chronos/brand/`) — единственное намеренное отличие окна от Olympus |
| `apps/web/src/components/desktopUpdate.logic.ts` | Ссылка «Посмотреть релиз» ведёт на теги `chronos-v*` |
| `apps/desktop/src/app/DesktopApp.ts` | Запуск и остановка sidecar-процессов в области жизни DesktopApp после готовности Electron |
| `scripts/build-desktop-artifact.ts` | Ресурсы сервисов Olympus, `appId`, `productName`, иконки из `chronos/brand`, имя артефактов, фид обновлений, протокол `chronos://`, без `installer.nsh`, WSL-архив апстрима, метаданные издателя Chronos |
| `.github/workflows/*` | Удалены 27 workflow апстрима; добавлены `chronos-desktop.yml`, `chronos-checks.yml`, `chronos-upstream.yml` |
| `.gitignore`, `AGENTS.md`, `README.md` | Игнор `chronos/.work/` и `__pycache__/`, актуальные инструкции форка |

Новые модули упаковки: `apps/desktop/src/chronos/` (`ChronosUpdates.ts`, `ChronosBrand.ts`,
`ChronosBrand.test.ts`), `chronos/brand/`, `chronos/version.json`, `chronos/scripts/`
(`chronos-version.mjs`, `verify-release.mjs`, `upstream-plan.mjs`, `upstream-plan.test.mjs`).

## Точки встраивания оптимизаций при параллельных запусках

| Файл апстрима | Назначение |
|---|---|
| `apps/server/src/orchestration-v2/ProviderSessionManager.ts`, `RunExecutionService.ts` | Привязка очереди к запуску и выбор получателей событий Codex |
| `apps/server/src/orchestration-v2/ProviderCommitBatch.ts` | Размер неизменного snapshot перед постановкой в очередь |
| `apps/server/src/orchestration-v2/EventSink.ts` | Каналы подписок на committed events одного треда |
| `apps/server/src/usage/UsageService.ts` | Общий скан OpenCode и OpenRouter и раздельные итоги |
| `apps/server/src/observability/Observability.ts`, `packages/shared/src/observability.ts` | Решение о записи локального span после завершения |
| `apps/web/src/components/chat/useThreadFind.ts` | Подписка поиска на открытую проекцию |
| `packages/client-runtime/src/state/shellReducer.ts`, `threadShell.ts` | Индекс позиций и повторное использование списка ссылок тредов |

[Методика стенда](scripts/bench/README.md) и [замеры](parity/perf-quick-wins.md).

## Скиллы

Исходники скиллов в `chronos/skills/`:

- `chronos-feature` — добавление правок без лишнего расхождения с апстримом и с сохранением паритета Olympus.
- `chronos-upstream-sync` — оценка, слияние, проверка и выпуск новых nightly T3.
- `chronos-upstream-adopt` — оценка, разведение и перевод новых функций T3 рядом с модулями Olympus.
- `chronos-parity-check` — запуск и разбор smoke, сравнения скриншотов/формулировок и обновление эталона.
- `chronos-release` — версия, проверенный билд, тег `chronos-v*` и публикация релиза.
- `chronos-ui` — правки UI и проверка рядом с T3.
- `chronos-ui-review` — приёмка собранного окна Chronos и сравнение с Olympus LIVE.
