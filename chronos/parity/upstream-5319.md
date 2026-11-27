# Chronos на T3 nightly 5319

База T3 обновлена с `v0.1.12-nightly.20261124.5209` (`84e4264bb347e36e97f6c3bd95d666eecfa12e07`) до `v0.1.14-nightly.20261127.5319` (`ee5b8469be04c8ec11c3016e7fdbdd1047082155`). На старте задачи это был последний nightly апстрима. Родители merge-коммита `f01a3874da` — Chronos `22eee0f541` (main, revision 13) и T3 `ee5b8469be`. Между двумя nightly 626 коммитов и 1 715 изменённых файлов. Пока шла проверка, main продвинулся до Chronos 14 (`b7db82c0f9`, `integration/chronos-14`), поэтому он влит в ветку коммитом `e9ff1db2c0`, а `chronos-version.mjs` выдаёт `0.1.14-nightly.20261127.5319.chronos.15`.

Главное в апстриме: воркфлоу (пулы, вопросы с видами и причинами, теги и предмет запуска), команды раскладки worktree только после подтверждения, копирование таблицы чата в PNG и путей из боковой панели файлов, скрытие сайдбара перетаскиванием, действия над текущим тредом из cmd+k, переключение терминалов клавишами (`ctrl+alt+[`/`]` при фокусе терминала), пользовательские HTTP-источники квот. Зависимости: `@pierre/trees` 1.0.0-beta.6 → 1.0.0, `@legendapp/list` 3.7.3 → 3.9.0, vite-plus 1.4 → 1.8, Clerk-пакеты. Electron 44.10.1 и `@tanstack/router-core` 1.171.8 не менялись. Новые миграции 112–119 (согласование команд раскладки, воркфлоу, история форков) — односторонние, у форка своих миграций нет.

## Разрешение 55 конфликтов

| Файлы | Решение |
|---|---|
| `mobile-eas-preview-fork.yml`, `release-desktop.yml`, `release.yml` | Оставлены удалёнными. Новых workflow апстрим не добавил. |
| `antigravityUsageLimits.ts` и тест (modify/delete), `AntigravityProvider.ts` | Апстрим удалил чтение лимитов Antigravity из внутренних API Google (#43026). Удаление принято, вместе с ним убрана склейка `olyAccountEmail`. **Модуль 28 больше не показывает почту аккаунта Antigravity** — у апстрима не осталось локального источника этой почты; для остальных провайдеров ничего не меняется. |
| 20 каталогов GT (`apps/{web,mobile}/src/i18n/translations/*.json`) | Трёхстороннее слияние по ключам: 0 спорных ключей. Web en/ru — 10 368 записей, mobile — 5 112. |
| `pnpm-lock.yaml`, `pnpm-workspace.yaml` | Версии апстрима и запись патча `@pierre/trees@1.0.0`. Патч перенесён с beta.6 (сдвиг строки в `.d.ts`), `git apply --check` прошёл на обоих файлах tarball, SHA-512 tarball совпал с lock, `patch_hash` (LF) — `85168ab7205bdd83d43151dbe0d63d0253021df66906625996eb72ac37a4ca25`. `package.json` форка от базы не отличаются. |
| `@legendapp__list@3.9.0.patch`, `PullRequestDetailPanel.tsx`, `PullRequestSummaryTab.tsx`, `pullRequestPresentation.tsx`, `shared-tooltip.tsx`, `tooltip.browser.test.tsx`, `preserveReadingPosition.ts` | Бэкпорт `eaf65dccab` (upstream #42582) теперь в базе: взяты версии апстрима. Патчи `gt-i18n`/`@generaltranslation/format` совпадают с апстримом. |
| `DesktopClerk.ts`, `DesktopClerk.test.ts` | Апстрим убрал свой `ClerkTokenStore` (#42413): хранилище Clerk в том же `stateDir/clerk`, права файла ставит Clerk. Схема `chronos://` и `restoreDesktopSchemePrivileges()` перенесены поверх нового моста; тест проверяет каталог, схему, восстановление привилегий и прямую передачу хранилища. |
| `IssueService.ts`, `issueLinks.ts` | Сохранены разрешение карточек Trello и подсказка ссылок `trello.com/c/` поверх нового кэша деталей и регулярного выражения Linear. |
| `OrchestratorMcpService.ts`, `RemoteDelegation.ts` | Оба поля (`delegated` и `skipAgentModeRefusal`). В связанном окружении другой модели по-прежнему передаётся уровень рассуждения делегата, а унаследованные параметры проходят новую фильтрацию режимов агента. |
| `ScheduledTaskService.ts` | Логика пропущенных запусков Chronos внутри нового `routineSpan`-обёртки апстрима. |
| `terminal/Manager.ts` | Новый поиск оболочки апстрима с таймаутом; на Windows сохранена проверка кандидатов через `resolveExecutable` до запуска ConPTY. |
| `observability.ts` (shared и server) | Апстрим добавил выборку «рутинных» спанов. Сохранены оба механизма: сначала выборка апстрима, затем удержание тихих спанов Chronos (1 из 16). |
| `provider-acp/adapter.ts` | Уровень уведомлений задаётся в месте вызова, учёт контекста апстрима перед буферизацией кадров отсоединённого терминала. Проверка фоновой работы перенесена в общую `sessionHasPendingBackgroundWork`. |
| `CodexAdapterV2.ts`, `usagePricing.ts`, `UsageLimitsPooled.tsx`, `_chat.settings.tsx`, `markdownHast.ts`, `markdownPipeline.ts` | Ленивый импорт `generatedImageMarkdown` + `parseSemver`; `modelCalls` + `provider`; `Var` + `usageNotice`; `data-chronos-settings-*` + `navPathname`; `pre`/`post` Olympus вокруг `rehypeSanitize` с новым `rehypeNormalizeLocalFileLinks`. |
| `Sidebar.tsx`, `SidebarThreadRow.tsx` | Взяты файлы апстрима (`ThreadHoverCardTrigger` вместо `Tooltip`) и повторены правки Chronos: общий `openPrLink`, `windowCard` + `SidebarCardContents`, перевод статуса задачи через `gt`. |
| `native/resource-monitor/Cargo.toml` | Апстрим добавил ту же зависимость `windows` с теми же возможностями — взят апстрим. |

После слияния из `chronos/ci/server/providers.sh` убран удалённый тест. Метки `chronos` сохранились во всех файлах, кроме удалённых вместе с лимитами Antigravity. Модули `apps/web/src/chronos/olympus/features` байт в байт совпадают с main. Исторический `chronos/parity/server.md` (перенос 4774) по-прежнему ссылается на удалённый `antigravityUsageLimits.ts`.

## Скрытые поломки и привязки Olympus

- CORS сервисов, привилегии схем, идентичность пакета и `RemoteRequestHeaders.ts` апстрим не менял; в упаковщике появились `electronFuses` с включённым `runAsNode`, поэтому сервисы Chronos запускаются как прежде.
- Привязки 15/24/25/28/10/55 на месте: `__olyLangIcons.apply` до создания resolver, `tabIndex=0` и заголовки карточек, `data-workspace-focus-key`, пропсы `ProviderModelPicker`, `__olyWrapModeText`, `__olyReferences.lex`, резерв `#` за доской задач.
- `host-seams` (84 маркера) и `check-catalog` (10 368 сообщений) прошли локально.
- Перевод бандла: `@pierre/trees` 1.0.0 держит метки в одном объекте, поэтому «Contains git status items» стала свойством `containsGitStatusTitle` — добавлено правило контекста, подсказка снова «Содержит элементы статуса git». У поля `Optional` в форме провайдера появился `visibleWhen` — сохранено решение Olympus оставить английский. Резервное сообщение EIP-1193 в новом чанке входа Clerk отмечено как проверенный текст библиотеки.
- CI: новый смок CLI-архива апстрима требует `client/.vite/manifest.json`, который `upload-artifact` отбрасывает как скрытый путь. В `chronos-desktop.yml` перенесены шаги апстрима #42806 (сохранить и восстановить манифест).

## Проверки

### Слияние с Chronos 14

Восемь конфликтов: каталоги GT `en`/`ru` слиты по ключам (10 423 записи, 0 спорных); `version.json` — база 5319, revision 15; `check-bundle-translation.mjs` — новый формат списка чанков main плюс проверенные вхождения EIP-1193; `preload.ts` — `getDatabaseMigrationProgress` апстрима и `offlineRehearsal` Chronos 14; `settingsSearch.ts` — быстрый поиск языка Chronos 14 поверх `titleMatchRank` апстрима; `ThreadTerminalDrawer.tsx` — помощники ввода остаются поднятыми, как в Chronos 14, с параметрами записи 5319; `ThemeSettings.tsx` — разметка 5319 с выбором половин `system` и сведением дублей тем Chronos 14.

### Проверки

| Кандидат | Chronos checks | Паритет 4774 | Desktop |
|---|---|---|---|
| `f01a3874da` | [успех](https://github.com/Zulut30/Chronos/actions/runs/45939323890) | [успех](https://github.com/Zulut30/Chronos/actions/runs/45939302423) | [сбой](https://github.com/Zulut30/Chronos/actions/runs/45939282985): четыре новых английских вхождения в бандле |
| `70961a33b0` | [успех](https://github.com/Zulut30/Chronos/actions/runs/45939894813) | [успех](https://github.com/Zulut30/Chronos/actions/runs/45939894817) | [сбой](https://github.com/Zulut30/Chronos/actions/runs/45939895233): CLI-архив без `client/.vite/manifest.json` |
| `e364df6161` | [успех](https://github.com/Zulut30/Chronos/actions/runs/45941784071) | [успех](https://github.com/Zulut30/Chronos/actions/runs/45941784081) | [успех](https://github.com/Zulut30/Chronos/actions/runs/45941784116) |
| `e9ff1db2c0` (с Chronos 14) | [успех](https://github.com/Zulut30/Chronos/actions/runs/45943660094) | [успех](https://github.com/Zulut30/Chronos/actions/runs/45943660064) | [успех](https://github.com/Zulut30/Chronos/actions/runs/45943658315) |

[CI smoke по `e9ff1db2c0`](https://github.com/Zulut30/Chronos/actions/runs/45945190823): функциональные прогоны Windows x64 и macOS arm64 прошли, упал `composer-browser` — тест Chronos «Shift model selection launches the same task on two models». Перед запуском треда в worktree 5319 читает команды раскладки проекта (#42386), а фейковое окружение отвечает на неизвестный RPC `Effect.never`, поэтому отправка ждала бесконечно. На живом сервере запрос отвечает. Тест теперь отвечает пустым списком команд.

Итоговые прогоны вершины ветки: [checks](https://github.com/Zulut30/Chronos/actions/workflows/chronos-checks.yml?query=branch%3Aupstream-sync%2F2026-11-27), [паритет](https://github.com/Zulut30/Chronos/actions/workflows/chronos-parity.yml?query=branch%3Aupstream-sync%2F2026-11-27), [desktop](https://github.com/Zulut30/Chronos/actions/workflows/chronos-desktop.yml?query=branch%3Aupstream-sync%2F2026-11-27), [smoke](https://github.com/Zulut30/Chronos/actions/workflows/chronos-smoke.yml?query=branch%3Aupstream-sync%2F2026-11-27), [производительность](https://github.com/Zulut30/Chronos/actions/workflows/chronos-perf.yml?query=branch%3Aupstream-sync%2F2026-11-27).

### Локальное сравнение (Windows, профиль Chronos, сервисы Olympus работают)

Опорный прогон — установленная chronos.13 до обновления: 15/15. Установщики `e364df6161` и `e9ff1db2c0` совпали по SHA-512 с `nightly.yml` и поставлены молча.

- `e364df6161` (5319 без Chronos 14): 15/15, ошибок 0, лишнего английского 0. Против chronos.13 изменились две строки экрана провайдеров (HTTP-источники квот #41291, «Хабы не настроены.» → «Источники расхода не настроены.» — формулировка Olympus «источники расхода» добавлена в `gt-additions.json` вместо «Источники данных об использовании…» каталога T3) и исчезла строка Antigravity на экране расхода (#43026). Порог 1% пикселей превысили главный экран, меню режимов, день/ночь (блок композера ниже на 2 px, после выравнивания остаётся фон темы) и расход (удалённая строка и таймеры).
- `e9ff1db2c0` с сохранённым в профиле `language: "en"`: интерфейс английский (154 фразы), экраны «Студия» и «День / ночь» не найдены по русским `aria-label`. Это поведение Chronos 14, уже выпущенного как `chronos-v0.1.12-nightly.20261124.5209.chronos.14`: `en` больше не заменяется на `ru`. Код выбора языка у кандидата и main совпадает. Сохранённое `en` здесь — прежнее значение по умолчанию T3, а не выбор пользователя.
- `e9ff1db2c0` с `language: "ru"` (временно, файл профиля восстановлен): 15/15, ошибок 0, лишнего английского 0. Новые формулировки — из Chronos 14 (управление ПК, выбор языка «русский», заголовок «Серверы» в панели MCP, выгрузка при нехватке памяти) и 5319 (см. выше). Сдвиги на экранах настроек (до 9 px, контраст полей API-ключей) и 67% на панели MCP приходят из Chronos 14.
- Против эталона 4774 обе сборки и chronos.13 дают одинаковые ~99,9% пикселей (эталон снят в другом состоянии профиля) и 0 новых ошибок и английских фраз.
