---
name: chronos-upstream-sync
description: "Обновить форк Chronos с T3, проверить новую nightly. Review upstream compatibility or run the verified daily sync."
---

# Синхронизация Chronos с апстримом T3

Репозиторий: `~/Documents/Chronos` (Windows: `%USERPROFILE%\Documents\Chronos`; `origin` = `Zulut30/Chronos`, `upstream` = `pingdotgg/t3code`).
Опорные документы: `chronos/README.md` (таблица точек встраивания), `chronos/version.json`, `chronos/parity/upstream-5209.md` (опыт и опись привязок Olympus), `chronos/plans/2026-11-services-upstream-switch.md`.

## Границы и постоянное разрешение

- Синхронизация с T3 входит в постоянно разрешённый полный цикл Chronos. После всех барьеров [chronos-router](../chronos-router/SKILL.md), зелёного паритета и разбора расхождений продвигай main, делай обычный push и выпускай `chronos-v*` по [chronos-release](../chronos-release/SKILL.md) без дополнительного вопроса. Просьба только запланировать обновление означает поставить задачу на указанное время. Просьба ограничиться отчётом или веткой задаёт предел работы.
- **Остановись в ветке `upstream-sync/<дата>` и спроси пользователя**, если:
  - после диагностики и повторной проверки остаётся блокирующая ошибка CI/smoke или необъяснённая регрессия паритета (`chronos-parity-check`);
  - апстрим меняет `appId`, профиль, схемы, Clerk/relay или формат фида обновлений;
  - новая функция T3 напрямую конфликтует с функцией Olympus и выбор приоритета неочевиден (`chronos-upstream-adopt`);

При запросе только на сводку или ветку заверши запрошенную работу и отчитайся.

- Для force-push и остальных исключений из [chronos-router](../chronos-router/SKILL.md) нужно явное согласие пользователя. Тестовые сборки запускай с отдельным профилем: миграции БД односторонние. Секреты запрашивай только через `request_secret`, личные данные и снимки храни вне публичного репозитория.

## 1. Разведка и сводка коммитов

```bash
git status --short                              # дерево должно быть чистым
git fetch origin
git ls-remote --tags --refs --sort=-version:refname upstream 'v*-nightly.*' | head -5
git show origin/main:chronos/version.json       # upstream, revision и upstreamCommit
```

Для плана нужен checkout проверяемой базы: `upstream-plan.mjs nightly` читает локальный `HEAD` и `chronos/version.json`. Проверь совпадение `git rev-parse HEAD` и `git rev-parse origin/main` в своём чистом checkout. При повторном запуске продолжай уже существующую ветку по её зафиксированной базе. Выбери целевой nightly-тег `vX-nightly.YYYYMMDD.N`, забери коммит и прогони план:

```bash
git fetch --no-tags upstream "refs/tags/<tag>"
target_sha=$(git rev-parse "FETCH_HEAD^{commit}")
node chronos/scripts/upstream-plan.mjs nightly "$target_sha"
git log --oneline --no-merges <upstreamCommit>.."$target_sha"
git diff --stat <upstreamCommit>.."$target_sha"
```

Если целевой SHA совпадает с `upstreamCommit` или уже входит в актуальный main, отчитайся о текущей базе и заверши ежедневный прогон без новой ревизии. Сформируй краткую сводку по группам: `desktop`, `server`, `web`, `mobile`, `l10n/GT`, `CI`, зависимости (`electron`, `@pierre/trees`, `@tanstack/router-core`), миграции (`apps/server/src/persistence/Migrations/`).
Проверь пересечение с точками форка (`git grep -l "chronos:"`). Если появились новые пользовательские функции T3 (страницы, настройки, триггеры, провайдеры) — сразу оцени их по `chronos-upstream-adopt`.

## 2. Ветка и слияние

```bash
git switch -c upstream-sync/<YYYY-MM-DD> origin/main
git merge --no-ff "$target_sha" -m "feat(sync): merge upstream T3 <tag> into Chronos"
```

## 3. Разрешение конфликтов (опыт 4774→5209)

| Класс файла                                                | Правило разрешения                                                                                                                                                                                                                                                                                                                                                                                                         |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.github/workflows/*` (кроме `chronos-*.yml`)              | Удалённые в форке workflow оставлять удалёнными (`git rm`). Все **новые** апстримные workflow тоже удалять (`git rm`).                                                                                                                                                                                                                                                                                                     |
| `pnpm-workspace.yaml`, `pnpm-lock.yaml`                    | Взять версию апстрима и заново добавить запись патча `patches/@pierre__trees@<ver>.patch`: `patch_hash` = SHA-256 файла патча **строго с LF**, ссылки импортёров и ключ snapshot. Если версия `@pierre/trees` сменилась — перебазировать патч, сверить tarball из lock и проверить `git apply --check` на JS и `.d.ts`.                                                                                                    |
| Точка встраивания с `// chronos:` / `// chronos(olympus):` | Взять новый файл апстрима и повторить правку Chronos поверх него. Если код переехал (пример: `resolveDesktopSshCliRunner` из `main.ts` → `DesktopSshEnvironment.ts`, схема Markdown → `markdownHast.ts`), перенести правку в новое место и обновить `chronos/README.md`.                                                                                                                                                   |
| Апстрим реализовал то же нативно                           | Принять апстрим целиком и удалить лишний патч/модуль форка, сохранив лишь узкие поля для Olympus (пример 5209: приняты `AntigravityChildWork.ts`, `AntigravityProtocol.ts`, CLI sign-in в `antigravityUsageLimits.ts`, удалён модуль поиска потомков, оставлено только поле `olyAccountEmail` для модуля 28). Отметить удаление в `chronos/parity/`.                                                                       |
| Контракты и общие пакеты                                   | В `packages/contracts/src/{server,usage}.ts` сохранить `THEME_CSS_MAX_LENGTH = 4_194_304` и `"openrouter"` в `UsageProviderKind` (проверить `apps/{web,mobile}/.../usageProviders.ts`). В `packages/shared/src/themeCss.ts` оставить и встроенные картинки Olympus, и `--theme-background-image`. В `markdownPipeline.ts` / `markdownHast.ts` сохранить `pre`/`post` Olympus вокруг `rehypeSanitize` и `sanitizeChatHast`. |
| Корневой `README.md`                                       | Оставить описание форка Chronos; версию и точки обновить в `chronos/README.md`.                                                                                                                                                                                                                                                                                                                                            |

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

| Зависимость                                | Файлы T3 и Chronos для сверки                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **React Fiber пропсы (24/25/28)**          | `24`: `ThreadDetailsUsage.tsx` (`window` в `LimitRow`/`PoolRow`, `tabIndex=0`, `#thread-details-usage-heading`), `ThreadRelationshipsControl.tsx` (`rows`, ключ `li` = `threadId`, `#thread-details-lineage-heading`). `25`: `ThreadDetailsPanel.tsx` / `ThreadDetailsCard.tsx` (`threadRef`, `data-workspace-focus-key="details:..."`). `28`: `ProviderModelPicker.tsx` (`environmentId`, `instanceEntries`, `activeInstanceId`, email в метаданных, `data-model-picker-{sidebar,content,provider}`). |
| **Хешированные чанки и шимы (93)**         | `apps/web/src/chronos/olympus/plugin.ts` (`entities-BYt4Kx9w.js`, `rightPanelStore-BKC7Sf3u.js`, `react-BP46yLMB.js`, `jsx-runtime-BQExFN_X.js`), `shims/{entities,rightPanelStore,react,jsx-runtime}.ts`, адаптер `panelSurfaces.ts` (`side-chat:<id>` ↔ `thread:<id>`), `PanelHost.tsx` в `ChatView.tsx`. Прогнать `apps/web/src/chronos/olympus/compatibility.test.ts`.                                                                                                                             |
| **Роутер (22/26/93)**                      | `apps/web/src/router.ts` и версия `@tanstack/router-core` в lock: всё ещё устанавливает `self.__TSR_ROUTER__ = this`, параметры маршрута треда (environmentId, threadId) не изменились.                                                                                                                                                                                                                                                                                                                |
| **Лексер и отправка (10/55/30/70)**        | `composer-editor-mentions.ts` (`splitPromptIntoComposerSegments` → `__olyReferences.lex`), `composerContextPresentation.tsx` и `CollapsedComposerPromptPreview.tsx` (чипы `oly-`), `__olyWrapModeText` и `__olySendPlan` в `useComposerSend.ts` (вкл. мультимодельный fan-out, искл. `/compact`), `useComposerResume.ts`, `useThreadLifecycle.tsx`, `ChatView.tsx`.                                                                                                                                    |
| **Цепочка Markdown (88)**                  | `packages/shared/src/markdownPipeline.ts` и `markdownHast.ts` (Words вызывает `sanitizeChatHast` напрямую!): `mark`, `u`, `dataOlyStyle` и `pre → rehypeSanitize → post` активны в обеих точках.                                                                                                                                                                                                                                                                                                       |
| **Иконки `@pierre/trees` (15)**            | Патч `patches/@pierre__trees@<ver>.patch`, `apps/web/src/pierre-icons.ts` (`__olyLangIcons.apply` до создания resolver), `DiffPanel.tsx` (`PierreEntryIcon`).                                                                                                                                                                                                                                                                                                                                          |
| **DOM-селекторы и тексты `features/*.js`** | Сверь изменённые экраны с описью в `chronos/parity/upstream-5209.md` (`data-slot`, `data-workspace-area`, `data-settings-section`, русские `aria-label` для «Расход», «Показать или скрыть правую панель», «Поиск в настройках», «Закрыть настройки», «Студия», «День / ночь»).                                                                                                                                                                                                                        |

## 6. Перевод и проверка кандидата

1. При появлении новых строк разбери GT-ключи и видимые литералы по [правилам перевода](../../parity/l10n.md). Сверь русские подписи, используемые селекторами Olympus.
2. В [version.json](../../version.json) обнови `upstream`, полный `upstreamCommit` и `revision`. Проверь `node chronos/scripts/chronos-version.mjs` и `node chronos/scripts/upstream-plan.mjs surface`. Обнови [карту интеграций](../../README.md) и отчёт по nightly.
3. Отправь свою `upstream-sync/<дата>`. На её SHA дождись `chronos-checks.yml`, `chronos-parity.yml`, ручного `chronos-desktop.yml` и `chronos-smoke.yml` с `desktop_run_id` этой сборки и обоими параметрами `require_services=true`, `require_provider=true` (14/14). Отсутствующий прогон запусти через `gh workflow run <workflow> --ref <ветка> -R Zulut30/Chronos`, передавая inputs через `-f`. Каждый run жди через `gh run watch <id> -R Zulut30/Chronos --exit-status`. До появления `chronos-perf.yml` в main используй ref `perf/guard` и `-f target=<ветка-кандидата>`. Проверь SHA main и кандидата в `pair.json`. Без подтверждённой пары слияние ждёт.
4. При доступном ПК сравни окно и wording по [методике smoke и compare](../../scripts/smoke/README.md). Исправь регрессии в ветке, повтори затронутые проверки и разбери каждое расхождение.

## 7. Слияние, синхронизация скиллов и релиз

После подтверждения всех условий проверь, что база main не ушла вперёд. При изменении базы сначала проверь объединённый кандидат. Продвинь main fast-forward на проверенный SHA. Если нужен отдельный merge-коммит, сначала проверь его в интеграционной ветке. **Ежедневная задача после слияния** в актуальном локальном checkout main выполняет `node chronos/scripts/sync-skills.mjs`. На удалённом CI-раннере команда обновила бы только его домашний каталог.

На точном SHA main собери доказательства для релиза по [chronos-release](../chronos-release/SKILL.md), включая ручной desktop и smoke его артефакта. В отчёте укажи старую и новую базы, важные изменения и конфликты, ссылки на проверки и perf, итог локального сравнения и синхронизации скиллов, тег и ссылку на релиз либо причину остановки.
