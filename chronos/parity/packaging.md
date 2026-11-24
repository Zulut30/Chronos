# Паритет Olympus → Chronos: слой упаковки поверх 4774

- **Базовый тег / коммит:** `v0.1.10-nightly.20261116.4774` (`16695c812fffe75e85f8cc3084d2c561aa3ca93f`), ветка `parity/olympus`.
- **Источник слоя упаковки:** история ветки `main` (`HEAD e33df5ea46`, база 4838 `ea6d3fc30f`).
- **Версия Chronos в `chronos/version.json`:** `0.1.10-nightly.20261116.4774.chronos.4` (тег `chronos-v0.1.10-nightly.20261116.4774.chronos.4`, `revision: 4` — следующий после `revision: 3` на `main`).
- **Ограничение локальных проверок:** `pnpm install`, сборки, полный typecheck (`effect-tsgo`), `vp lint` и тесты монорепо локально **не запускались** (выполнит CI). Локально проверены только `chronos-version.mjs`, `node --test chronos/scripts/upstream-plan.test.mjs`, `node --check`, разбор YAML через Python `yaml.safe_load`, побайтовые SHA-256 иконок и `git diff`.

---

## 1. Что перенесено и из каких коммитов

| Коммит(ы) на `main` | Что перенесено | Адаптации под базу 4774 |
|---|---|---|
| `e5f35f9720`, `db662678e7` | `packages/shared/src/cliRelease.ts` — блок `chronos: begin/end` (`CHRONOS_APP_ID`, `CHRONOS_SCHEME`, `CHRONOS_PRODUCT_NAME`, `CHRONOS_REPOSITORY`, `CHRONOS_RELEASES_URL`, `CHRONOS_UPDATE_FEED_URL`, `isChronosVersion`, `chronosUpstreamVersion`) и распаковка версии в `cliReleaseChannelOf`. | Пример в комментарии обновлён на `0.1.10-nightly.20261116.4774.chronos.4`. |
| `e5f35f9720`, `db662678e7`, `83cb4c9c7b` | `scripts/build-desktop-artifact.ts` — `appId` (`io.github.zulut30.chronos`), `productName` (`Chronos`), имя артефактов (`Chronos-${version}-${arch}.${ext}`), иконки из `chronos/brand/` (Windows `.ico` для exe/установщика/панели задач/окна, macOS `chronos-macos-1024.png`, Linux `chronos-1024.png`), generic-фид обновлений `Zulut30/Chronos/releases/latest/download`, схема `chronos://`, исключение T3 `installer.nsh` для NSIS, WSL-архив по `chronosUpstreamVersion`, passkey `appId`, метаданные издателя (`name: "chronos"`, `homepage: "https://github.com/Zulut30/Chronos"`, `author: "Chronos contributors"`). | На базе 4774 файл совпадает с 4838 — применено без конфликтов. |
| `db662678e7` | Установка рядом с T3 в `apps/desktop/src/**`: `DesktopConfig.ts` (`CHRONOS_HOME`), `DesktopEnvironment.ts` (`~/.chronos`, `CHRONOS_HOME`, `CHRONOS_APP_ID`, `APP_BASE_NAME = CHRONOS_PRODUCT_NAME`, `displayName`), `DesktopUserData.ts` (`%APPDATA%\Chronos` / `~/Library/Application Support/Chronos`), `DesktopLegacyLocalStorage.ts` (без импорта legacy-хранилища T3), `DesktopClerk.ts` (внешний callback `chronos://` при сохранении внутреннего origin `t3code://app`), `DesktopCliCommand.ts` (не перехватывать глобальный `t3` в PATH), `DesktopCliShim.ts` (`privateHome` привязывает `~/.chronos/bin/t3` к `~/.chronos`), `DesktopBackendConfiguration.ts` (`T3CODE_HOME` для локального сервера и `--base-dir ~/.chronos` для WSL). | В фикстурах тестов (`DesktopAppIdentity.test.ts`, `DesktopClerk.test.ts`, `DesktopEnvironment.test.ts`) использован пример версии 4774 (`0.1.10-nightly.20261116.4774.chronos.4`). |
| `e5f35f9720` (адаптировано вместо `DesktopSshEnvironment.ts` из 4838) | `apps/desktop/src/main.ts` — `resolveDesktopSshCliRunner` запрашивает `chronosUpstreamVersion(environment.appVersion)` для удалённых SSH-хостов. | **Разрешённое отличие 4774 от 4838:** в 4774 функция `resolveDesktopSshCliRunner` находится в `apps/desktop/src/main.ts:112`, а не в `apps/desktop/src/ssh/DesktopSshEnvironment.ts` (куда её перенёс апстрим между 4774 и 4838 вместе с `CLI_RELEASE_BASE_URL_ENV`). Поэтому пропатчен `apps/desktop/src/main.ts` (как в исходном `e5f35f9720`), а `DesktopSshEnvironment.ts` оставлен нетронутым. |
| `e5f35f9720`, `db662678e7` | `apps/desktop/src/chronos/ChronosUpdates.ts`, `apps/desktop/src/updates/updateChannels.ts`, `apps/desktop/src/updates/DesktopUpdates.ts` — nightly-канал по версии апстрима, фильтр обновлений только на версии Chronos, фиксация канала `nightly`, открытие страницы последнего релиза в браузере на неподписанной macOS. | Применено без конфликтов. |
| `15b984ae62` (только OS-брендинг и ссылки релизов, **без русской локализации**) | `apps/desktop/src/chronos/ChronosBrand.ts`, `ChronosBrand.test.ts`, `apps/desktop/src/electron/ElectronDialog.ts`, `apps/desktop/src/app/DesktopStartupRecovery.ts` — замена имени продукта `T3 Code` → `Chronos` в нативных системных диалогах ОС и на аварийной странице запуска, ссылки восстановления на `Zulut30/Chronos/releases` и тег `chronos-v<version>`. | Русской локализации системных диалогов нет (тексты остаются на английском, как в апстриме и на `main`). |
| `a295a35dbe`, `db662678e7` | Обновление ожиданий юнит-тестов десктопа: `DesktopAppIdentity.test.ts`, `DesktopClerk.test.ts`, `DesktopEnvironment.test.ts`, `DesktopPreReadyPlatform.test.ts`, `updatesTestHarness.ts` (нормализация `\` в `/` для запуска тестов на Windows). | Применено без конфликтов. |
| `92ed42fcaa` / `e5f35f9720` / `edf7b84535` | `chronos/brand/*` — все 9 бинарных ассетов (`.ico`, `.icns`, PNG-иконки, маска, social preview), скопированы побайтово из `main`. | Побайтовые SHA-256 сверены с `main`. |
| `e5f35f9720`, `db662678e7`, `61351116ee` | `.github/workflows/chronos-desktop.yml`, `chronos/scripts/chronos-version.mjs`, `chronos/scripts/verify-release.mjs`, удаление 27 апстримных workflow из `.github/workflows/`. | Добавлен триггер `push.branches: [parity/olympus]` для сборки артефактов без публикации релиза (релиз — строго по тегу `chronos-v*`). Удалён шаг `Package compatibility with existing Windows services` (зависимость от `1bb81edec0`). В `typecheck` добавлен `@t3tools/contracts`. |
| `15b984ae62`, `a295a35dbe`, `8eb7a28d9d`, `c78ea7b43a` | `.github/workflows/chronos-checks.yml` | Очищен от всех ссылок на React-переписку и `15b984ae62` i18n (`l10n-check.mjs`, `apps/web/src/chronos/*`, `chronosRichText.test.ts`, `package-compatibility*`, Playwright browser-тесты React-переписки). Добавлена ветка `parity/olympus`, проверка `chronos-version.mjs`, `vp lint apps/desktop/src/chronos`, typecheck `@t3tools/contracts` и `t3`. |
| `db662678e7`, `3e2b5ee4a8`, `e33df5ea46`, `c78ea7b43a` | `.github/workflows/chronos-upstream.yml`, `chronos/scripts/upstream-plan.mjs`, `chronos/scripts/upstream-plan.test.mjs`. | Без изменений логики; `chronos-upstream.yml` уже использует sparse-checkout без подмодулей из `e33df5ea46`. |
| `e5f35f9720`, `c78ea7b43a`, `db662678e7`, `61351116ee` | `.gitignore`, `AGENTS.md`, `README.md`, `chronos/README.md`, `chronos/skills/*` (`chronos-feature`, `chronos-release`, `chronos-ui`, `chronos-ui-review`, `chronos-upstream-sync`). | Полностью актуализированы под новую схему паритета Olympus на базе 4774, отчёты в `chronos/parity/`, отсутствие React-переписки и внешней темы Olympus. |

---

## 2. Что сознательно НЕ перенесено и почему

1. **React-переписка функций Olympus (`1bb81edec0`, `e49f8c6cbe`, `6d1fc78487`, `8eb7a28d9d`)**: `apps/web/src/chronos/workspace/**`, `apps/web/src/chronos/richText/**`, `packages/shared/src/chronosRichText*`, правки `apps/web/src/**`, `chronos/compatibility/*`, `chronos/scripts/package-compatibility*`. Причина: прямой запрет задачи — функции Olympus переносятся как есть клиентским и серверным потоками.
2. **Русский интерфейс через JSX-подмену (`15b984ae62`)**: `apps/web/src/chronos/i18n/**`, `apps/web/src/i18n/**`, `apps/web/vite.config.ts`, `chronos/l10n/*`, `chronos/scripts/l10n-check.mjs`. Причина: перенос перевода Olympus выполняет отдельный поток перевода.
3. **Внутренний брендинг веб-клиента и встроенная тема Olympus (`e5f35f9720`, `15b984ae62`)**: `apps/web/src/branding.ts`, `apps/web/src/chronos/ChronosBrandMark.tsx`, логотип в сайдбаре (`SidebarChrome.tsx`), встроенная `olympus.theme.json` (`chronos/theme/*`, `chronos/scripts/sync-theme.mjs`, правки `themePalette.ts`, `useTheme.ts`, `ThemeSettings.tsx`, `CommandPaletteThemeItems.tsx`), правки заставки и загрузочного скрипта в `apps/web/index.html`. Причина: внутри окна всё должно быть 1:1 как в Olympus 4774; тема Olympus остаётся внешней (`userdata/themes/`).
4. **Правка `<title>` в `apps/web/index.html`:** сознательно **не вносилась** (файл `apps/web/index.html` оставлен полностью нетронутым). Причина:
   - В Electron заголовок окна задаётся напрямую через `DesktopEnvironment.ts` → `DesktopWindow.ts` (`title: environment.displayName` → `"Chronos"`), а затем через `window.desktopBridge.getAppBranding()` в уже имеющемся штатном inline-скрипте `apps/web/index.html:680-681` и `apps/web/src/appInit.tsx:160-178`.
   - При сборке Vite плагин `bootstrapTitlePlugin` в `apps/web/vite.config.ts:273-290` (вне зоны этого потока) всё равно безусловно перезаписывает `<title>...</title>` в выходном `index.html`, поэтому однострочная правка `<title>` в исходном `apps/web/index.html` не повлияла бы на собранный веб-артефакт.
5. **Правка `apps/web/src/components/desktopUpdate.logic.ts` (из `e5f35f9720`):** не перенесена, так как `apps/web/src/**` запрещено изменять в этом потоке. Последствие: кнопка/ссылка «просмотреть релиз» внутри веб-интерфейса настроек/уведомления об обновлении будет формировать URL с `/tag/v<version>` вместо `/tag/chronos-v<version>` (подробнее см. раздел 5).
6. **Локализация системных диалогов десктопа:** на `main` русской локализации диалогов не было (проверено `git grep` по кириллице в `main:apps/desktop/` — 0 совпадений); в `ElectronDialog.ts` и `DesktopStartupRecovery.ts` перенесена только замена имени продукта `T3 Code` → `Chronos` и ссылки на релизы `Zulut30/Chronos`.
7. **`chronos/legacy-package/**`:** не перенесён по прямому запрету задачи.
8. **`.github/README.md` (из `edf7b84535`):** не перенесён, так как на `main` он содержал устаревшие сведения (утверждал, что Chronos заменяет T3 Code Nightly и делит его папки данных, и перечислял функции Olympus как «Coming next»), а GitHub показывает `.github/README.md` вместо корневого `README.md`. Вместо него актуализирован корневой `README.md`.
9. **`.github/workflows/chronos-parity.yml`:** не создавался и не изменялся (принадлежит потоку перевода; при удалении 27 апстримных workflow сохранён нетронутым).

### Побочный эффект `DesktopEnvironment.ts` внутри окна (зафиксировано прозрачно)

Замена `APP_BASE_NAME = CHRONOS_PRODUCT_NAME` и `displayName` в `apps/desktop/src/app/DesktopEnvironment.ts` нужна для имени продукта на уровне ОС (`Electron.app.setName`, «О программе», меню macOS, заголовок `BrowserWindow` в `DesktopWindow.ts`). Через штатный IPC `window.desktopBridge.getAppBranding()` это значение читается в `apps/web/src/branding.ts`:
- обновляет `document.title` (заголовок окна ОС — требуемое поведение);
- **не меняет** логотип/wordmark в сайдбаре (`SidebarChrome.tsx` рендерит `T3Wordmark` напрямую);
- в редких служебных местах (`apps/web/src/routes/__root.tsx` — экран 404 и текст копирования фатальной ошибки; `apps/web/src/components/pullRequest/PullRequestCodeTab.tsx:1431` — подпись `viewed in Chronos`) имя приложения будет `Chronos` вместо `T3 Code`.

---

## 3. Полный список путей потока упаковки (для коммита координатора)

> Ниже перечислены **строго только** файлы, изменённые, добавленные или удалённые этим потоком (всего: 23 изменено, 27 добавлено, 27 удалено). Файлы соседних потоков (`apps/web/**`, `apps/server/**`, `packages/contracts/**`, `packages/provider-opencode/**`, остальные файлы `packages/shared/**`, `chronos/l10n/**`, `chronos/scripts/parity/**`, `chronos/parity/{l10n*,server.md}`, `.github/workflows/chronos-parity.yml`) здесь отсутствуют и не изменялись.

### Изменённые (23)
- `.gitignore`
- `AGENTS.md`
- `README.md`
- `apps/desktop/src/app/DesktopAppIdentity.test.ts`
- `apps/desktop/src/app/DesktopClerk.test.ts`
- `apps/desktop/src/app/DesktopClerk.ts`
- `apps/desktop/src/app/DesktopCliCommand.ts`
- `apps/desktop/src/app/DesktopCliShim.ts`
- `apps/desktop/src/app/DesktopConfig.ts`
- `apps/desktop/src/app/DesktopEnvironment.test.ts`
- `apps/desktop/src/app/DesktopEnvironment.ts`
- `apps/desktop/src/app/DesktopLegacyLocalStorage.ts`
- `apps/desktop/src/app/DesktopPreReadyPlatform.test.ts`
- `apps/desktop/src/app/DesktopStartupRecovery.ts`
- `apps/desktop/src/app/DesktopUserData.ts`
- `apps/desktop/src/backend/DesktopBackendConfiguration.ts`
- `apps/desktop/src/electron/ElectronDialog.ts`
- `apps/desktop/src/main.ts`
- `apps/desktop/src/updates/DesktopUpdates.ts`
- `apps/desktop/src/updates/updateChannels.ts`
- `apps/desktop/src/updates/updatesTestHarness.ts`
- `packages/shared/src/cliRelease.ts`
- `scripts/build-desktop-artifact.ts`

### Добавленные (27)
- `.github/workflows/chronos-checks.yml`
- `.github/workflows/chronos-desktop.yml`
- `.github/workflows/chronos-upstream.yml`
- `apps/desktop/src/chronos/ChronosBrand.test.ts`
- `apps/desktop/src/chronos/ChronosBrand.ts`
- `apps/desktop/src/chronos/ChronosUpdates.ts`
- `chronos/README.md`
- `chronos/brand/chronos-1024.png`
- `chronos/brand/chronos-favicon-64.png`
- `chronos/brand/chronos-icon-256.png`
- `chronos/brand/chronos-logo.png`
- `chronos/brand/chronos-macos-1024.png`
- `chronos/brand/chronos-mask-128.png`
- `chronos/brand/chronos.icns`
- `chronos/brand/chronos.ico`
- `chronos/brand/social-preview.png`
- `chronos/parity/packaging.md`
- `chronos/scripts/chronos-version.mjs`
- `chronos/scripts/upstream-plan.mjs`
- `chronos/scripts/upstream-plan.test.mjs`
- `chronos/scripts/verify-release.mjs`
- `chronos/skills/chronos-feature/SKILL.md`
- `chronos/skills/chronos-release/SKILL.md`
- `chronos/skills/chronos-ui-review/SKILL.md`
- `chronos/skills/chronos-ui/SKILL.md`
- `chronos/skills/chronos-upstream-sync/SKILL.md`
- `chronos/version.json`

### Удалённые (27)
- `.github/workflows/agent-context-budget.yml`
- `.github/workflows/ci.yml`
- `.github/workflows/deploy-relay.yml`
- `.github/workflows/desktop-macos-preview-publish.yml`
- `.github/workflows/desktop-macos-preview.yml`
- `.github/workflows/issue-labels.yml`
- `.github/workflows/issue-vouch.yml`
- `.github/workflows/mobile-android-apk.yml`
- `.github/workflows/mobile-dev-client.yml`
- `.github/workflows/mobile-eas-preview-fork.yml`
- `.github/workflows/mobile-eas-preview.yml`
- `.github/workflows/mobile-eas-production.yml`
- `.github/workflows/mobile-fingerprint-check.yml`
- `.github/workflows/mobile-fingerprint-label.yml`
- `.github/workflows/mobile-showcase-screenshots.yml`
- `.github/workflows/pr-limits.yml`
- `.github/workflows/pr-size.yml`
- `.github/workflows/pr-vouch.yml`
- `.github/workflows/publish-aur.yml`
- `.github/workflows/relay-preview-cleanup.yml`
- `.github/workflows/relay-preview.yml`
- `.github/workflows/release-desktop.yml`
- `.github/workflows/release.yml`
- `.github/workflows/stale-needs-more-info.yml`
- `.github/workflows/thread-transfer-report.yml`
- `.github/workflows/web-preview.yml`
- `.github/workflows/windows-tests.yml`

---

## 4. Локальные проверки (выполнено)

- `node chronos/scripts/chronos-version.mjs` и `--check-tag chronos-v0.1.10-nightly.20261116.4774.chronos.4` → OK (`{"upstream":"0.1.10-nightly.20261116.4774","revision":4,"version":"0.1.10-nightly.20261116.4774.chronos.4","tag":"chronos-v0.1.10-nightly.20261116.4774.chronos.4"}`).
- `node --test chronos/scripts/upstream-plan.test.mjs` → 1/1 passed.
- `node --check` (Node v24.19.0) по всем 4 `.mjs`-скриптам в `chronos/scripts/` и всем 23 `.ts`-файлам потока (`apps/desktop/src/**`, `packages/shared/src/cliRelease.ts`, `scripts/build-desktop-artifact.ts`) → exit 0.
- `yaml.safe_load` по `.github/workflows/{chronos-desktop,chronos-checks,chronos-upstream}.yml` → валидный YAML, табуляций и ссылок на React-переписку нет.
- Побайтовая сверка SHA-256 всех 9 файлов `chronos/brand/*` с `main` → 9/9 совпали.

---

## 5. Места, требующие проверки в CI, и открытые вопросы (недоказано локально)

1. **Полный `typecheck`, `vp lint`, юнит-тесты и сборка десктопа (не запускались локально):**
   - `chronos-checks.yml`: `vp lint apps/desktop/src/chronos`, `typecheck` (`@t3tools/contracts`, `@t3tools/shared`, `@t3tools/web`, `@t3tools/desktop`, `@t3tools/scripts`, `t3`), тесты `packages/shared` (`cliRelease.test.ts`, `themeCss.test.ts`, `markdownPipeline.test.ts`), юнит-тесты `apps/web` и `apps/desktop` (включая `ChronosBrand.test.ts`, `DesktopAppIdentity.test.ts`, `DesktopClerk.test.ts`, `DesktopEnvironment.test.ts`, `DesktopPreReadyPlatform.test.ts`), серверные регрессии.
   - `chronos-desktop.yml`: сборка JS-бандла (`vp run build:desktop:bundle`) и упаковка `Windows x64 (nsis)`, `macOS arm64 (dmg/zip)`, `macOS x64 (dmg/zip)` на `push` в `parity/olympus` и по `workflow_dispatch` без публикации релиза.
2. **Доступность WSL-архива 4774 в релизах апстрима (недоказано):** шаг `Download upstream Linux CLI archive for WSL` в `chronos-desktop.yml` скачивает `t3-0.1.10-nightly.20261116.4774-linux-x64.tar.gz` и `SHA256SUMS` из `pingdotgg/t3code/releases/download/v0.1.10-nightly.20261116.4774`. Наличие и формат этого файла в релизе 4774 нужно подтвердить первым прогоном CI.
3. **Semver-порядок относительно предыдущего тега на `main`:** на `main` уже существует тег `chronos-v0.1.11-nightly.20261117.4838.chronos.3`, а новая версия — `0.1.10-nightly.20261116.4774.chronos.4`. По semver `0.1.10-... < 0.1.11-...`, поэтому уже установленная сборка `0.1.11-...chronos.3` не обновится автоматически «вниз» на `0.1.10-...chronos.4` через `electron-updater` (потребуется ручная установка поверх, либо решение о версии при будущем релизе).
4. **Ссылка на тег релиза внутри веб-клиента (`apps/web/src/components/desktopUpdate.logic.ts`):** в этом потоке файл не менялся из-за запрета на `apps/web/src/**`. Без 2-строчной правки `isChronosVersion(...) ? "chronos-v" : "v"` ссылка на конкретный релиз в UI обновлений будет указывать на `/tag/v0.1.10-...` вместо `/tag/chronos-v0.1.10-...` (сам `electron-updater` и `DesktopStartupRecovery.ts` при этом работают корректно). Нужно решить на уровне координатора, переносить ли эту правку.
5. **Публикация релиза по тегу `chronos-v*`:** job `release` в `chronos-desktop.yml` требует совпадения `HEAD` с веткой `main` и наличия успешных `chronos-checks.yml` и ручного `chronos-desktop.yml` (`event=workflow_dispatch`) на этом SHA — это сохранено из `61351116ee`. После слияния `parity/olympus` в `main` перед тегированием нужно прогнать ручной `workflow_dispatch` на `main`.
6. **Проверка установленного приложения на Windows рядом с T3/Olympus (недоказано):** требуется проверить после CI-сборки, что установщик не задевает T3 (`%APPDATA%\t3code-v2`, `~/.t3`), запускается с иконкой Chronos и заголовком окна `Chronos`, держит внутренний origin `t3code://app` для CORS 6 локальных сервисов Olympus (`:4517..4523`) и принимает OAuth-коллбэк по `chronos://`.
