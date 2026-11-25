---
name: chronos-upstream-sync
description: Пошагово синхронизирует форк Chronos (Zulut30/Chronos) с новым nightly T3 Code (pingdotgg/t3code) — сводка коммитов, ветка, слияние, разрешение конфликтов, проверка скрытых поломок и зависимостей Olympus, перевод новых строк, CI/smoke и выпуск релиза. Используй в ежедневной задаче 05:00, когда просят «обнови Chronos до T3», «синхронизируй с апстримом», «влей свежий nightly», «что нового в T3» или по /chronos-upstream-sync.
---

# Синхронизация Chronos с апстримом T3

Репозиторий: `~/Documents/Chronos` (Windows: `%USERPROFILE%\Documents\Chronos`; `origin` = `Zulut30/Chronos`, `upstream` = `pingdotgg/t3code`).
Опорные документы: `chronos/README.md` (таблица точек встраивания), `chronos/version.json`, `chronos/parity/upstream-5209.md` (опыт и опись привязок Olympus), `chronos/plans/2026-11-services-upstream-switch.md`.

## Границы и постоянное разрешение

- **Постоянное разрешение пользователя (2026-11-25, в т. ч. ежедневная задача `05:00`):** если зелёные `chronos-checks.yml`, `chronos-parity.yml`, `chronos-desktop.yml` (Windows x64, macOS arm64, macOS x64) и `chronos-smoke.yml` (`require_services=true`, плюс локальный smoke/wording при наличии ПК), а необъяснённых регрессий нет — **сливай в `main` и выпускай релиз** (`chronos-release`).
- **Остановись в ветке `upstream-sync/<дата>` и спроси пользователя**, если:
  - падает CI/smoke или есть необъяснённая регрессия паритета (`chronos-parity-check`);
  - апстрим меняет `appId`, профиль, схемы, Clerk/relay или формат фида обновлений;
  - новая функция T3 напрямую конфликтует с функцией Olympus и выбор приоритета неочевиден (`chronos-upstream-adopt`);
  - пользователь явно просил только сводку или ветку без слияния.
- **Всегда запрещено:** force-push в `main`; запуск тестовых сборок на живом `~/.t3` (**миграции БД односторонние** — откатить базу на старую версию без бэкапа нельзя); секреты, токены, скриншоты и личные данные в публичном репо.

## 1. Разведка и сводка коммитов

```bash
git status --short                              # дерево должно быть чистым
git fetch origin && git fetch upstream main
git ls-remote --tags --refs --sort=-version:refname upstream 'v*-nightly.*' | head -5
node chronos/scripts/chronos-version.mjs        # текущие upstream и upstreamCommit
```

Выбери целевой nightly-тег `vX-nightly.YYYYMMDD.N`, забери коммит и прогони план:

```bash
git fetch --no-tags upstream "refs/tags/<tag>"
target_sha=$(git rev-parse "FETCH_HEAD^{commit}")
node chronos/scripts/upstream-plan.mjs nightly "$target_sha"
git log --oneline --no-merges <upstreamCommit>.."$target_sha"
git diff --stat <upstreamCommit>.."$target_sha"
```

Сформируй краткую сводку по группам: `desktop`, `server`, `web`, `mobile`, `l10n/GT`, `CI`, зависимости (`electron`, `@pierre/trees`, `@tanstack/router-core`), миграции (`apps/server/src/persistence/Migrations/`).
Проверь пересечение с точками форка (`git grep -l "chronos:"`). Если появились новые пользовательские функции T3 (страницы, настройки, триггеры, провайдеры) — сразу оцени их по `chronos-upstream-adopt`.

## 2. Ветка и слияние

```bash
git switch -c upstream-sync/<YYYY-MM-DD> main
git merge --no-ff "$target_sha" -m "feat(sync): merge upstream T3 <tag> into Chronos"
```

## 3. Разрешение конфликтов (опыт 4774→5209)

| Класс файла | Правило разрешения |
| --- | --- |
| `.github/workflows/*` (кроме `chronos-*.yml`) | Удалённые в форке workflow оставлять удалёнными (`git rm`). Все **новые** апстримные workflow тоже удалять (`git rm`). |
| `pnpm-workspace.yaml`, `pnpm-lock.yaml` | Взять версию апстрима и заново добавить запись патча `patches/@pierre__trees@<ver>.patch`: `patch_hash` = SHA-256 файла патча **строго с LF**, ссылки импортёров и ключ snapshot. Если версия `@pierre/trees` сменилась — перебазировать патч, сверить tarball из lock и проверить `git apply --check` на JS и `.d.ts`. |
| Точка встраивания с `// chronos:` / `// chronos(olympus):` | Взять новый файл апстрима и повторить правку Chronos поверх него. Если код переехал (пример: `resolveDesktopSshCliRunner` из `main.ts` → `DesktopSshEnvironment.ts`, схема Markdown → `markdownHast.ts`), перенести правку в новое место и обновить `chronos/README.md`. |
| Апстрим реализовал то же нативно | Принять апстрим целиком и удалить лишний патч/модуль форка, сохранив лишь узкие поля для Olympus (пример 5209: приняты `AntigravityChildWork.ts`, `AntigravityProtocol.ts`, CLI sign-in в `antigravityUsageLimits.ts`, удалён модуль поиска потомков, оставлено только поле `olyAccountEmail` для модуля 28). Отметить удаление в `chronos/parity/`. |
| Контракты и общие пакеты | В `packages/contracts/src/{server,usage}.ts` сохранить `THEME_CSS_MAX_LENGTH = 4_194_304` и `"openrouter"` в `UsageProviderKind` (проверить `apps/{web,mobile}/.../usageProviders.ts`). В `packages/shared/src/themeCss.ts` оставить и встроенные картинки Olympus, и `--theme-background-image`. В `markdownPipeline.ts` / `markdownHast.ts` сохранить `pre`/`post` Olympus вокруг `rehypeSanitize` и `sanitizeChatHast`. |
| Корневой `README.md` | Оставить описание форка Chronos; версию и точки обновить в `chronos/README.md`. |

## 4. Чек-лист скрытых поломок (случаются без git-конфликтов)

Проходи **каждый пункт** после завершения merge:

- [ ] **CORS сервисов Olympus:** проверь `apps/desktop/src/window/RemoteRequestHeaders.ts` и `apps/desktop/src/chronos/services/ServiceOrigins.ts` — новая политика заголовков не должна вырезать `Origin: t3code://app` для loopback-портов сервисов `4517–4524`.
- [ ] **Привилегии схем:** в `apps/desktop/src/app/DesktopClerk.ts` и `ElectronProtocol.ts` после регистрации `chronos://` мостом Clerk должна синхронно вызываться `restoreDesktopSchemePrivileges()` (`apps/desktop/src/chronos/ChronosSchemes.ts`) до `ready`, иначе `t3code://` теряет `fetch` (падают терминал и `.wasm`).
- [ ] **Идентичность и упаковка:** на месте `io.github.zulut30.chronos`, профиль `%APPDATA%\Chronos` / `CHRONOS_HOME`, `chronos://`, внутренний origin `t3code://app`, публичные параметры Clerk/relay (`.env.example`), отсутствие `installer.nsh`, упаковка `chronos/services` (`scripts/build-desktop-artifact.ts`), WSL-архив через `chronosUpstreamVersion()`.
- [ ] **GT-каталоги и перевод:** апстрим мог перенести строки из JS-литералов в `apps/web/src/i18n/translations/{en,ru}.json`, тихо подменив формулировки Olympus. Проверь работу хука `olympusCatalog()` (`apps/web/src/chronos/olympus/l10n/catalog.ts`) поверх `DICT` Olympus и `chronos/l10n/gt-additions.json`; просмотри лог сборки `[olympus-l10n]`.
- [ ] **CSS внешней темы Olympus:** не сменились ли теги/атрибуты под селекторы темы (пример 5209: строки лимитов стали `<a>` вместо `<div>` → пришлось вернуть `tabIndex={0}` в `ThreadDetailsUsage.tsx` и адаптировать `div[tabindex]` → `:is(div, a)[tabindex]` в `apps/web/src/themeCss.ts`).
- [ ] **Конфликты клавиш и триггеров композера:** проверь `apps/web/src/composer-logic.ts` — `#` должен быть зарезервирован за доской задач Olympus (`"__olyTasks" in globalThis`), а не перехвачен поиском PR/задач T3; проверь `@`, `!`, `$`, `/`.
- [ ] **Тесты апстрима:** если тест падает из-за намеренного поведения Olympus (пример: `UsageProviderChart.test.ts`, `UsageService.test.ts`, `packages/provider-opencode/src/server/usage.test.ts`, `Desktop*.test.ts`), поправь ожидание минимально с комментарием `// chronos(olympus): <причина>` (без голых ссылок `#12345` — запрещает `t3code/no-low-value-comments`).
- [ ] **Ловушки CI:** в `.github/workflows/chronos-checks.yml` серверный `typecheck` требует `--filter=@t3tools/scripts...` (`apps/server` тянет `../../scripts/lib`); в `chronos-desktop.yml` сборка macOS x64 должна идти на нативном `macos-26-intel` (кросс-генерация байткод-кэша на Apple Silicon падает); проверь новые нативные SDK-требования macOS (Swift/диктовка).
- [ ] **Миграции БД:** проверь `apps/server/src/persistence/Migrations/`. Миграции односторонние — локальные прогоны запускай только с отдельным `CHRONOS_HOME`, никогда не открывай `~/.t3`.

## 5. Аудит зависимостей модулей Olympus от внутренностей T3

Сверь перед сборкой по `chronos/parity/client.md` и `chronos/parity/upstream-5209.md`:

| Зависимость | Файлы T3 и Chronos для сверки |
| --- | --- |
| **React Fiber пропсы (24/25/28)** | `24`: `ThreadDetailsUsage.tsx` (`window` в `LimitRow`/`PoolRow`, `tabIndex=0`, `#thread-details-usage-heading`), `ThreadRelationshipsControl.tsx` (`rows`, ключ `li` = `threadId`, `#thread-details-lineage-heading`). `25`: `ThreadDetailsPanel.tsx` / `ThreadDetailsCard.tsx` (`threadRef`, `data-workspace-focus-key="details:..."`). `28`: `ProviderModelPicker.tsx` (`environmentId`, `instanceEntries`, `activeInstanceId`, email в метаданных, `data-model-picker-{sidebar,content,provider}`). |
| **Хешированные чанки и шимы (93)** | `apps/web/src/chronos/olympus/plugin.ts` (`entities-BYt4Kx9w.js`, `rightPanelStore-BKC7Sf3u.js`, `react-BP46yLMB.js`, `jsx-runtime-BQExFN_X.js`), `shims/{entities,rightPanelStore,react,jsx-runtime}.ts`, адаптер `panelSurfaces.ts` (`side-chat:<id>` ↔ `thread:<id>`), `PanelHost.tsx` в `ChatView.tsx`. Прогнать `apps/web/src/chronos/olympus/compatibility.test.ts`. |
| **Роутер (22/26/93)** | `apps/web/src/router.ts` и версия `@tanstack/router-core` в lock: всё ещё устанавливает `self.__TSR_ROUTER__ = this`, параметры маршрута треда (environmentId, threadId) не изменились. |
| **Лексер и отправка (10/55/30/70)** | `composer-editor-mentions.ts` (`splitPromptIntoComposerSegments` → `__olyReferences.lex`), `composerContextPresentation.tsx` и `CollapsedComposerPromptPreview.tsx` (чипы `oly-`), `__olyWrapModeText` и `__olySendPlan` в `useComposerSend.ts` (вкл. мультимодельный fan-out, искл. `/compact`), `useComposerResume.ts`, `useThreadLifecycle.tsx`, `ChatView.tsx`. |
| **Цепочка Markdown (88)** | `packages/shared/src/markdownPipeline.ts` и `markdownHast.ts` (Words вызывает `sanitizeChatHast` напрямую!): `mark`, `u`, `dataOlyStyle` и `pre → rehypeSanitize → post` активны в обеих точках. |
| **Иконки `@pierre/trees` (15)** | Патч `patches/@pierre__trees@<ver>.patch`, `apps/web/src/pierre-icons.ts` (`__olyLangIcons.apply` до создания resolver), `DiffPanel.tsx` (`PierreEntryIcon`). |
| **DOM-селекторы и тексты `features/*.js`** | Сверь изменённые экраны с описью в `chronos/parity/upstream-5209.md` (`data-slot`, `data-workspace-area`, `data-settings-section`, русские `aria-label` для «Расход», «Показать или скрыть правую панель», «Поиск в настройках», «Закрыть настройки», «Студия», «День / ночь»). |

## 6. Перевод новых строк

1. Проверь новые ключи в `apps/web/src/i18n/translations/en.json` и лог сборки `[olympus-l10n]` (остатки английского, не должны ломать ключи протокола вроде `not_a_file_request` и защищённые ключи GT).
2. Переведи новые видимые строки и расхождения формулировок по правилам `chronos-upstream-adopt` и глоссарию `C:\Users\zulut\.t3\caches\t3-customizations\ru-l10n\glossary.md` в `chronos/l10n/gt-additions.json` (при необходимости обнови `apps/web/src/chronos/olympus/l10n/catalog.ts`).
3. Проверь, что формулировки Olympus не затёрты машинным `ru.json` T3.

## 7. Версия, CI и проверка паритета

1. Обнови `chronos/version.json`: `upstream` = новая версия, `upstreamCommit` = полный SHA тега, `revision` = следующий счётчик после `main`. Проверь `node chronos/scripts/chronos-version.mjs`, `node chronos/scripts/upstream-plan.mjs surface`, `git grep -n "chronos:"`.
2. Обнови базу в `chronos/README.md` и (при нетривиальных изменениях) запиши отчёт в `chronos/parity/upstream-<build>.md`.
3. Закоммить и запушь ветку `upstream-sync/<дата>` (`git push -u origin upstream-sync/<дата>`).
4. Запусти и дождись зелёного статуса CI:
   ```bash
   gh workflow run chronos-checks.yml  --repo Zulut30/Chronos --ref upstream-sync/<дата>
   gh workflow run chronos-parity.yml  --repo Zulut30/Chronos --ref upstream-sync/<дата>
   gh workflow run chronos-desktop.yml --repo Zulut30/Chronos --ref upstream-sync/<дата>
   ```
   > `chronos-parity.yml` проверяет движок перевода на **зафиксированном ASAR 4774** — его зелёный статус сам по себе **не подтверждает** окно новой nightly.
5. После зелёного `chronos-desktop.yml` (Windows x64 + macOS arm64 + macOS x64 + сверка упакованных `chronos-services`) запусти CI-smoke с сервисами:
   ```bash
   gh workflow run chronos-smoke.yml --repo Zulut30/Chronos --ref upstream-sync/<дата> \
     -f desktop_run_id=<id_прогона_chronos-desktop> -f require_services=true
   ```
6. Проведи локальный полный smoke и сравнение с эталоном по `chronos-parity-check` (`smoke.mjs --strict-en` + `compare.py` по пикселям с масками и русским формулировкам). При падениях — чини в этой же ветке и повторяй прогон.

## 8. Слияние в `main`, релиз и отчёт

Если все проверки шага 7 зелёные, необъяснённых регрессий `0` и не сработали стоп-условия:

1. Влей `upstream-sync/<дата>` в `main` и запушь `main`.
2. Запусти на точном `HEAD` ветки `main` `chronos-checks.yml` и ручной `workflow_dispatch` `chronos-desktop.yml` (требуется job `release` в `.github/workflows/chronos-desktop.yml`), плюс `chronos-smoke.yml` (`require_services=true`) по свежему `desktop_run_id`.
3. Выпусти тег `chronos-v*` и GitHub Release по `chronos-release`.

В отчёте пользователю укажи:
- база была → стала (теги, SHA, число коммитов) и ключевые новинки T3;
- разрешённые конфликты, скрытые правки, удалённые патчи, новые переводы;
- ссылки на прогоны `chronos-checks`, `chronos-parity`, `chronos-desktop`, `chronos-smoke` и итог локального `compare.py`;
- итоговый статус: выпущен релиз `chronos-v*` (ссылка) или причина остановки в ветке `upstream-sync/<дата>`.
