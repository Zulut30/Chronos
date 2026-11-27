# Паритет Olympus → Chronos: серверные и общие native-правки

- Базовый тег: `v0.1.10-nightly.20261116.4774` (коммит `16695c812f`, ветка `parity/olympus`).
- Эталон: LIVE `server.asar` по описи `C:\Users\zulut\.t3\caches\chronos-parity\inventory\asar\details\*.md` (30 native-hunks в 6 чанках).
- Ограничение проверок на этом ПК: `pnpm install`, сборки, полный typecheck (`effect-tsgo`), `vp lint`, `knip` и тесты монорепо **не запускались** (по условию задачи — их выполнит CI). Все пункты ниже проверены чтением исходников/типов/схем/конфигов (`tsconfig.base.json`, `tsconfig.effect.json`, `vite.config.ts`, `.d.ts` зависимостей), сверкой с LIVE-чанками, `git diff`, `node --check` (Node v24.19.0) и локальным smoke-тестом `antigravityCliSignIn.ts`.

## Таблица переноса (чанк N → файл:строка в Chronos → как проверено)

| Чанк, hunk | Файл:строка в Chronos | Как проверено |
|---|---|---|
| `ManagedEndpointRuntime--5XAAKR8.mjs` N01 | `packages/contracts/src/usage.ts:16-17` (`UsageProviderKind`) | Сверено с `details/ManagedEndpointRuntime--5XAAKR8.mjs.md` N01 (`"openrouter"` между `"opencode"` и `"antigravity"`); `node --check`; аудит всех потребителей `UsageProviderKind` (см. раздел ниже). |
| `ManagedEndpointRuntime--5XAAKR8.mjs` N02 | `packages/contracts/src/server.ts:630-631` (`THEME_CSS_MAX_LENGTH = 4_194_304`) | Сверено с `details/ManagedEndpointRuntime--5XAAKR8.mjs.md` N02 (`4194304`); `node --check`; аудит потребителей `THEME_CSS_MAX_LENGTH`. |
| `utils-BTU7ae6Y.js` N01 | `packages/contracts/src/usage.ts:16-17` (`UsageProviderKind`) | Общий контракт с `ManagedEndpointRuntime` N01; сверено с `details/utils-BTU7ae6Y.js.md` N01; `node --check`. |
| `utils-BTU7ae6Y.js` N02 | `packages/contracts/src/server.ts:630-631` (`THEME_CSS_MAX_LENGTH = 4_194_304`) | Общий контракт с `ManagedEndpointRuntime` N02; сверено с `details/utils-BTU7ae6Y.js.md` N02; `node --check`. |
| `themePalette-BrFetdG-.js` N01 | `packages/shared/src/themeCss.ts:82-83` (`THEME_GUIDE`) | Посимвольная сверка строки скриптом с LIVE `extract/live/.../themePalette-BrFetdG-.js` и `details/themePalette-BrFetdG-.js.md` N01; `node --check`. |
| `themePalette-BrFetdG-.js` N02 | `apps/web/src/themePalette.ts:2,127,1535` (правка **не требуется**) | Проверено чтением `apps/web/src/themePalette.ts`: строка 2 импортирует `THEME_CSS_MAX_LENGTH` из `@t3tools/contracts`, строка 127 (`isThemeCss`) сравнивает `value.length <= THEME_CSS_MAX_LENGTH`, строка 1535 использует `${THEME_CSS_MAX_LENGTH}`; литералов `50_000`/`50000`/`5e4` в файле нет (в бандле `5e4` был инлайном сборщика). |
| `relayTracing-CeJ93I6Y.mjs` N01 | `packages/shared/src/themeCss.ts:82-83` (`THEME_GUIDE`) | Общий исходник с `themePalette` N01; посимвольная сверка с LIVE `extract/live/.../relayTracing-CeJ93I6Y.mjs` и `details/relayTracing-CeJ93I6Y.mjs.md` N01; `node --check`. |
| `runtimeLayer-ojyN-pY_.mjs` N01 | `apps/server/src/chronos/olympus/antigravityCliSignIn.ts:1-125` + импорт `apps/server/src/provider/antigravityUsageLimits.ts:18-22` | Построчно сверено с `details/runtimeLayer-ojyN-pY_.mjs.md` N01; проверены `.d.ts` для `ffi-rs`, `@napi-rs/keyring`, `@types/node` (`Buffer.from`); `node --check`; выполнен smoke-тест импорта и чтения токен-файлов в Node v24 (5 кейсов passed). Чтение реального Windows Credential Manager (`ffi-rs`) и macOS Keychain (`@napi-rs/keyring`) в CI/runtime не запускалось (недоказано в runtime). |
| `runtimeLayer-ojyN-pY_.mjs` N02 | `apps/server/src/provider/antigravityUsageLimits.ts:245-246` (`let olyCli`) | Сверено с `details/runtimeLayer-ojyN-pY_.mjs.md` N02; `node --check`. |
| `runtimeLayer-ojyN-pY_.mjs` N03 | `apps/server/src/provider/antigravityUsageLimits.ts:247-260` | Сверено с `details/runtimeLayer-ojyN-pY_.mjs.md` N03 (путь `path.join(input.profileDirectory, "antigravity-acp", "antigravity-oauth-token")`, fallback при `olyCli === undefined`); `node --check`. |
| `runtimeLayer-ojyN-pY_.mjs` N04 | `apps/server/src/provider/antigravityUsageLimits.ts:261-273,286-288,349` | Сверено с `details/runtimeLayer-ojyN-pY_.mjs.md` N04 (проверка `Date.parse(olyCli.token.expiry ?? "") > (yield* Clock.currentTimeMillis) + 60_000`, текст ошибки `probeFailed`, `projectId` остаётся `undefined` для CLI-сессии); см. раздел адаптаций про `Clock.currentTimeMillis`; `node --check`. |
| `runtimeLayer-ojyN-pY_.mjs` N05 | `apps/server/src/provider/antigravityUsageLimits.ts:274-276,289-291` | Сверено с `details/runtimeLayer-ojyN-pY_.mjs.md` N05 (отпечаток `antigravity-cli\0${olyCli.token.refresh_token || olyCli.token.access_token}` vs ACP-отпечаток); `node --check`. |
| `runtimeLayer-ojyN-pY_.mjs` N06 | `apps/server/src/provider/antigravityUsageLimits.ts:273-286` | Сверено с `details/runtimeLayer-ojyN-pY_.mjs.md` N06 (`accessToken = olyCli.token.access_token`, запрос `userinfo` с fallback на `fingerprint`, без refresh и без записи в `cached`); `node --check`. |
| `runtimeLayer-ojyN-pY_.mjs` N07 | `apps/server/src/provider/antigravityUsageLimits.ts:377-382` | Сверено с `details/runtimeLayer-ojyN-pY_.mjs.md` N07 (`...(olyCli?.email ? { olyAccountEmail: olyCli.email } : {})`); проверена совместимость с `exactOptionalPropertyTypes` и `AntigravityDriver.ts:440`; `node --check`. |
| `server-syNn-CpO.mjs` N01 | `apps/server/src/provider/acp/AntigravityProtocol.ts:488-489` (`ANTIGRAVITY_SUBAGENT_TITLES`) | Сверено с `details/server-syNn-CpO.mjs.md` N01 (`"Run invoke_subagent"`); `node --check`. |
| `server-syNn-CpO.mjs` N02 | `apps/server/src/provider/acp/AntigravityChildWork.ts:50-70` (`antigravitySubagentLaunches`) | Построчно сверено с `details/server-syNn-CpO.mjs.md` N02 (плоский `{Role, Prompt}` и пачка `{Subagents: [...]}` через `Predicate.isObject`); удалён ставший неиспользуемым `decodeLaunchInput` (правило `eslint/no-unused-vars`); `node --check`. |
| `server-syNn-CpO.mjs` N03 | `apps/server/src/provider/acp/AntigravityChildWork.ts:131-135,396-404` (`InvokeRecord`, `readChildTranscript`) | Сверено с `details/server-syNn-CpO.mjs.md` N03 (`if (child.logUri !== undefined)`); `logUri?: string` в `InvokeRecord` согласовано с `exactOptionalPropertyTypes`; `node --check`. |
| `server-syNn-CpO.mjs` N04 | `apps/server/src/provider/acp/AntigravityChildWork.ts:404-405` (`readChildTranscript`) | Сверено с `details/server-syNn-CpO.mjs.md` N04 (закрытие блока `if (child.logUri !== undefined)` после проверки `realpath`); `node --check`. |
| `server-syNn-CpO.mjs` N05 | `apps/server/src/chronos/olympus/antigravityDetachedChildren.ts:1-202` + импорт `apps/server/src/provider/acp/AntigravityChildWork.ts:18-19` | Построчно сверено с `details/server-syNn-CpO.mjs.md` N05 (константы `256`/`64`/`MAX_STEP_BYTES`/`NATIVE_ID`, пути `brain/<id>/.system_generated/{messages,subagents}`, `read.json`, поля `state`/`role`/`conversationId`, строгое уникальное совпадение `matches.length === 1`); `node --check`. |
| `server-syNn-CpO.mjs` N06 | `apps/server/src/provider/acp/AntigravityChildWork.ts:448-465` (`readAntigravityChildWork`) | Сверено с `details/server-syNn-CpO.mjs.md` N06 (ранний возврат при `profileRoot === undefined`, сначала `olyFindDetachedInvokeRecord`, затем поиск `${input.rootSessionId}.db`); `node --check`. |
| `server-syNn-CpO.mjs` N07 | `apps/server/src/provider/acp/AntigravityChildWork.ts:465-471` (`readAntigravityChildWork`) | Сверено с `details/server-syNn-CpO.mjs.md` N07 (заполнение общей `record` из SQLite с закрытием `database.close()` в `finally`); `node --check`. |
| `server-syNn-CpO.mjs` N08 | `apps/server/src/provider/AntigravityProvider.ts:166-169,250-260` (`AntigravityProviderOptions`, `refreshUsage`) | Сверено с `details/server-syNn-CpO.mjs.md` N08 (перенос `probed.olyAccountEmail.trim()` в `draft.auth.email` при `state.draft.auth.status !== "unauthenticated"`); проверена совместимость типов с `AntigravityDriver.ts:440` и `AntigravityProvider.test.ts:137`; `node --check`. |
| `server-syNn-CpO.mjs` N09 | `packages/provider-opencode/src/server/usage.ts:68-69` (`parseOpenCodeMessage`) | Сверено с `details/server-syNn-CpO.mjs.md` N09 (`totalTokens(totals) === 0 && !message.olyOpenrouterReceipt`); `node --check`. |
| `server-syNn-CpO.mjs` N10 | `packages/provider-opencode/src/server/usage.ts:75-76` (`parseOpenCodeMessage`) | Сверено с `details/server-syNn-CpO.mjs.md` N10 (`providerId === "openrouter" ? "openrouter" : "opencode"`); `node --check`. |
| `server-syNn-CpO.mjs` N11 | `packages/provider-opencode/src/server/usage.ts:84-94` (`parseOpenCodeMessage`) | Сверено с `details/server-syNn-CpO.mjs.md` N11 (LIVE-версия, а не устаревший `patch-native.py`: `free || message.olyOpenrouterReceipt === true || (providerId === "openrouter" && model.endsWith(":free"))`); `node --check`. |
| `server-syNn-CpO.mjs` N12 | `packages/provider-opencode/src/server/usage.ts:96-97` (`parseOpenCodeMessage`) | Сверено с `details/server-syNn-CpO.mjs.md` N12 (`${providerId === "openrouter" ? "openrouter" : "opencode"}:${id}`); `node --check`. |
| `server-syNn-CpO.mjs` N13 | `packages/provider-opencode/src/server/usage.ts:493-497` (`resolveOpenCodeDataDirs`) | Сверено с `details/server-syNn-CpO.mjs.md` N13 (`[...(roots?.length ? roots : defaults), path.join(homeDirectory, ".t3", "userdata", "openrouter-usage")]`); `node --check`. |
| `server-syNn-CpO.mjs` N14 | `apps/server/src/usage/usagePricing.ts:328-333,382-385` (`PricedRecord`, `priceUsage`) | Сверено с `details/server-syNn-CpO.mjs.md` N14 (`if (record.provider === "openrouter" && override === undefined) return ...`); `provider` добавлено в `PricedRecord` опционально (`Partial<Pick<UsageRecord, "provider">>`), чтобы не ломать фикстуры `usagePricing.test.ts`; `node --check`. |
| `server-syNn-CpO.mjs` N15 | `apps/server/src/usage/UsageService.ts:92-107` (`olyUsagePartition`) | Сверено с `details/server-syNn-CpO.mjs.md` N15 (фильтрация `file.records` по `provider`, отбрасывание пустых файлов, сохранение `[]` при не-null `source.files` и `null` при `source.files === null`); `node --check`. |
| `server-syNn-CpO.mjs` N16 | `apps/server/src/usage/UsageService.ts:35-36,40,109-123` (`scanReaders`) | Сверено с `details/server-syNn-CpO.mjs.md` N16 (разделение `OpenCodeDriver` на `"opencode"` и `"openrouter"` с обёрткой `olyUsagePartition`, сохранение остальных драйверов); `node --check`. |

## Полный список изменённых и добавленных путей

### Изменённые файлы (10)
- `packages/contracts/src/usage.ts`
- `packages/contracts/src/server.ts`
- `packages/shared/src/themeCss.ts`
- `apps/server/src/provider/antigravityUsageLimits.ts`
- `apps/server/src/provider/acp/AntigravityProtocol.ts`
- `apps/server/src/provider/acp/AntigravityChildWork.ts`
- `apps/server/src/provider/AntigravityProvider.ts`
- `packages/provider-opencode/src/server/usage.ts`
- `apps/server/src/usage/usagePricing.ts`
- `apps/server/src/usage/UsageService.ts`

### Добавленные файлы (3)
- `apps/server/src/chronos/olympus/antigravityCliSignIn.ts`
- `apps/server/src/chronos/olympus/antigravityDetachedChildren.ts`
- `chronos/parity/server.md`

### Не изменён (проверено)
- `apps/web/src/themePalette.ts` — не требует правки (`THEME_CSS_MAX_LENGTH` уже импортируется из `@t3tools/contracts` на строке 2 и используется в `isThemeCss` на строке 127 и в сообщении об ошибке на строке 1535).

## Использование изменённых контрактов (`packages/contracts`)

Обе правки контрактов точно соответствуют LIVE (`ManagedEndpointRuntime--5XAAKR8.mjs` N01–N02 и `utils-BTU7ae6Y.js` N01–N02):

### 1. `UsageProviderKind` (`packages/contracts/src/usage.ts:10-21`) — добавлено `"openrouter"`
- **Контракты и общие пакеты:**
  - `packages/contracts/src/usage.ts:56,77` (`UsageBucket.provider`, `UsageSourceFingerprint.provider`)
  - `packages/provider-core/src/server/usage.ts:15,119,140` (`UsageRecord.provider`, `ProviderUsageReader.provider`)
  - `packages/shared/src/usageMerge.ts:19,30,50,58,256-260,379-524` (`Map`/`Set` — исчерпывающих `Record` нет)
  - `packages/client-runtime/src/state/usageProgress.ts:31-32,46,77` (`Set`/массивы — исчерпывающих `Record` нет)
- **Сервер:**
  - `apps/server/src/usage/UsageService.ts:104,128,564,680` (и наши N15–N16)
  - `apps/server/src/usage/usageScanCache.ts:43,74,177,203,356-357` (`Map` — исчерпывающих `Record` нет)
  - `apps/server/src/usage/usageTestFormats.ts:10-22` (типизирован как `Record<"claude" | "codex" | "grok" | "pi" | "muse", ...>`, не зависит от полноты `UsageProviderKind`)
  - `packages/provider-opencode/src/server/usage.ts:76` (выдаёт `"openrouter"` / `"opencode"`)
- **Веб-клиент (`apps/web`):**
  - `apps/web/src/components/usage/usageProviders.ts:50` — **`satisfies Record<UsageProviderKind, UsageProviderPresentation>`** (требует добавления ключа `openrouter`, выполняется клиентским потоком по `UsageLimits-MnFl4D3C.js` N01).
  - `apps/web/src/components/usage/usagePagePreferences.ts:10` (`Schema.Array(UsageProviderKind)`)
  - `apps/web/src/components/usage/UsagePage.tsx:118,124-127,607,1031,1252-1253`
  - `apps/web/src/components/usage/UsageProviderChart.tsx:21-297`
  - `apps/web/src/components/usage/UsageLimits.tsx:9,360`
  - `apps/web/src/state/usage.ts:8,111-157`
- **Мобильный клиент (`apps/mobile`) — ВАЖНЫЙ РИСК TYPECHECK В CI:**
  - `apps/mobile/src/features/usage/usageProviders.ts:20` (`PROVIDER_LABEL: Record<UsageProviderKind, string>`) и `:31` (`useProviderColors(): Record<UsageProviderKind, string>`) **не содержат ключ `openrouter`**. Если CI запускает `pnpm typecheck` (`vp run -r typecheck`) включая `apps/mobile`, эти два объекта не пройдут проверку типов без добавления `openrouter`. Файл `apps/mobile/**` не входит в разрешённый список нашего потока и не изменялся — требует решения координатора.
  - Прочие ссылки в `apps/mobile`: `apps/mobile/src/features/usage/UsageRouteScreen.tsx:4,71`, `apps/mobile/src/features/usage/usageChartData.ts:1,10`.

### 2. `THEME_CSS_MAX_LENGTH` (`packages/contracts/src/server.ts:631`) — `50_000` → `4_194_304`
- **Контракты:** `packages/contracts/src/server.ts:647` (`environmentThemeFields.css` → `EnvironmentThemeFile`, `EnvironmentTheme`).
- **Сервер:** `apps/server/src/environmentTheme.ts:52` (`MAX_THEME_FILE_BYTES = 6 * THEME_CSS_MAX_LENGTH + 16 * 1024`, автоматически вырастает до `25_182_208` байт, как и в LIVE `relayTracing-CeJ93I6Y.mjs:11147`), `apps/server/src/environmentTheme.test.ts:311`.
- **Веб-клиент:** `apps/web/src/themePalette.ts:127` (`isThemeCss`) и `apps/web/src/themePalette.ts:1535` (текст ошибки `parseThemeFile`).

## Отличия от буквального LIVE, адаптации и недоказанные моменты

Все 30 hunks перенесены по поведению **1:1**. Единственные технические адаптации ради строгого TypeScript, `@effect/language-service` (`tsconfig.effect.json`) и `oxlint-plugin-t3code` (`vite.config.ts`):

1. **`antigravityCliSignIn.ts` (N01): `import * as NodeFS from "node:fs"` вместо `process.getBuiltinModule("node:fs")`** — `process.getBuiltinModule` не даёт типизированный модуль в `@types/node`, тогда как `node:fs` с директивой `// @effect-diagnostics nodeBuiltinImport:off -- ...` строго типизирован и полностью эквивалентен в runtime.
2. **`antigravityUsageLimits.ts` (N04): `yield* Clock.currentTimeMillis` вместо `Date.now()`** — правило `globalDateInEffect: "error"` в `tsconfig.effect.json` запрещает `Date.now()` внутри `Effect.gen`; в живом рантайме `Clock.currentTimeMillis` возвращает то же время `Date.now()` (и корректно работает с `TestClock`).
3. **`antigravityUsageLimits.ts` (N04–N06): единая развилка `if (olyCli !== undefined) { ... } else { ... }`** — вместо `{ project_id: undefined }` для `token`, чтобы TypeScript без `as any` сузил тип `token` в ветке ACP; порядок вызовов, отпечатки, отсутствие кэширования CLI-сессии и пустое тело `{}` без `project` сохранены 1:1.
4. **`AntigravityChildWork.ts` (N02): удалена неиспользуемая `decodeLaunchInput`** — правило `eslint/no-unused-vars: "error"` отклонило бы неиспользуемую переменную.
5. **Комментарии без ссылок `#38966`/`#39004`/`#39519`** — правило `t3code/no-low-value-comments: "error"` запрещает голые ссылки на PR/issue вида `#12345` в комментариях исходников; проставлены маркеры `// chronos(olympus): <чанк> <N>`.
6. **Совместимость с существующими upstream-тестами (недоказано, не запускались):**
   - `packages/provider-opencode/src/server/usage.test.ts:768-771` ожидает ровно `[defaultRoot, instanceRoot, xdgRoot]` от `openCodeUsageReader.scan`, но N13 добавляет `path.join(homeDirectory, ".t3", "userdata", "openrouter-usage")`.
   - `apps/server/src/usage/UsageService.test.ts:2364` ожидает `sourcesFor("opencode").length === 1`, что также затронет N13.
   - `apps/server/src/provider/antigravityUsageLimits.test.ts:657-665` (`missingToken: true`) на машине с реальной записью `gemini:antigravity` в системном keyring попадёт в CLI-ветку вместо `unsupported` (на чистом CI runner записи нет).
   - Полная компиляция `effect-tsgo`, `vp lint`, `knip:check`, сборка и прогон vitest **не выполнялись** (недоказано до прогона CI).

## Оркестрация агентов

- `ScheduledTaskService` хранит состояние `missed`. Настройка `fixed_time.catchUp` разрешает один запуск за время отсутствия сервера. Старые задачи сохраняют прежнее поведение.
- `OrchestratorMcpService` и `RemoteDelegation` выбирают глубину через `delegatedReasoning`. Для локального `target.projectId` сервис подготовки треда использует репозиторий целевого проекта. `ThreadManagementService` проверяет доступность провайдера в обоих проектах.
- `AntigravityTurnOutcome` помечает исчерпание индивидуальной квоты. `UsageLimitRecoveryWorker` читает этот признак из проекции и отправляет продолжение после явного согласия в треде.
- `QueuedRunsControl` показывает ожидающую отправку и действие отмены. Ответ `t3_thread_send` возвращает статус доставки. Windows-терминал в `terminal/Manager.ts` проверяет путь оболочки до запуска PTY.

## Восстановление лимитов подписки

При открытии экрана лимитов или нажатии «Обновить» провайдер Antigravity запускает `agy -p /usage --output-format json` для выбранного подключения Google. Команда доступна с версии 1.1.11. Штатный CLI использует тот же профиль, что и вход через ACP. Модуль `apps/server/src/chronos/antigravity/quota.ts` принимает отчёт с нулём ходов и выводит отдельные пятичасовые и недельные квоты для групп моделей, которые сообщил Google. [Команда /usage](https://antigravity.google/docs/cli/commands/usage/) · [История изменений CLI](https://antigravity.google/docs/changelog?tab=cli)

Если Claude Code подтвердил поддержку лимитов, но вернул пустой результат `get_usage`, `ClaudeDriver` повторяет запрос при следующем обновлении. Проценты приходят из полного ответа или из событий лимитов того же аккаунта. В `packages/provider-core/src/server/usageLimits.ts` пустой ответ при повторной проверке сохраняет частичные данные до указанного провайдером времени сброса.

Общий код `packages/shared/src/usageLimits.ts` выбирает данные для экрана лимитов и команды `/usage` в веб-клиенте и на мобильном устройстве. При частичном ответе пользователю видны подтверждённые периоды с будущей датой сброса и сообщение о результате последней полной проверки.
