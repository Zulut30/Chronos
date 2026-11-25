---
name: chronos-feature
description: "Реализация функций и исправление ошибок Chronos. Implement a feature, fix a regression or locate a fork integration point."
---

# Разработка функций и правок в Chronos

Текущая база апстрима — в `chronos/version.json`; карта всех точек встраивания и отчёты потоков — в `chronos/README.md` и `chronos/parity/`. Функции Olympus переносятся как есть, без переписывания на React. Работай в назначенной ветке. Новую независимую ветку начинай от актуального `origin/main` (архив старой переписи `legacy/react-rewrite` не трогай).

## Где размещать код

1. **Изолированные каталоги форка:**
   - **Веб-клиент:** `apps/web/src/chronos/<фича>/` (например, `issue-trello/`, `idleUnload/`, `perf/`). Модули Olympus лежат байт в байт в `apps/web/src/chronos/olympus/features/`, подключаются через `prologue.ts` и плагин `olympus/plugin.ts` (мимо React Compiler и переводчика) — адаптацию делай в стыке вне этих файлов. [Тест упаковки](../../scripts/olympus-settings.test.mjs) сравнивает бандл с файлами текущего checkout. Для проверки самих исходников сравни `git diff <проверенная-база> -- apps/web/src/chronos/olympus/features`.
   - **Сервисы Olympus и sidecar-менеджер (`chronos/parity/services.md`):**
     - исходники 7 HTTP-сервисов (порты 4517–4520, 4522–4524: `skills-manager`, `tasks-service`, `files-service`, `studio-service`, `integrations-service`, `mcp-manager`, `olympus-hub`) и `openrouter-service` (stdio) — в `chronos/services/<имя>/`. Пути данных параметризуются через `CHRONOS_T3_HOME` и `CHRONOS_SERVICES_DATA` (фолбэк `~/.t3` при ручном запуске);
     - [Sidecars.ts](../../../apps/desktop/src/chronos/services/Sidecars.ts) проверяет порты. Один [host.mjs](../../services/host.mjs) держит HTTP-сервисы в отдельных Worker, OpenRouter использует stdio. Тестируй управление жизненным циклом в CI или изолированном стенде; существующие службы пользователя продолжают работу;
     - сохранение `Origin: t3code://app` для CORS портов сервисов — `apps/desktop/src/chronos/services/ServiceOrigins.ts` (подключён в `RemoteRequestHeaders.ts`).
   - **Перевод.** Для каталогов GT, JS-литералов и динамических строк следуй [chronos-l10n](../chronos-l10n/SKILL.md).
   - **Бренд:** внутри окна единственное намеренное отличие от Olympus — знак в шапке сайдбара (`apps/web/src/chronos/brand/ChronosSidebarMark.tsx` → `SidebarChrome.tsx`). Иконки ОС/установщика — `chronos/brand/`; имя в системных диалогах и ссылках релизов — `apps/desktop/src/chronos/ChronosBrand.ts`, `ChronosUpdates.ts`, `apps/web/src/components/desktopUpdate.logic.ts`. Внешняя тема Olympus остаётся в `userdata/themes/`.
   - **Десктоп / сервер / пакеты:** `apps/desktop/src/chronos/`, `apps/server/src/chronos/`, `packages/{contracts,client-runtime}/src/chronos/`; в общих файлах апстрима — блок `// --- chronos: begin … // --- chronos: end ---` без лишних экспортов в `package.json`.
   - **Инструменты, отчёты, скиллы:** `chronos/{scripts,parity,skills}/`.
2. **Правки в файлах апстрима — минимальные:** импорт + короткий вызов с комментарием `// chronos: <зачем>` (для правок тестов под поведение Olympus — `// chronos(olympus): <зачем>`; не оставляй голых ссылок `#12345` — сработает `t3code/no-low-value-comments`). Окружающий код апстрима не переформатируй.
3. Каждую новую точку встраивания отрази в `chronos/README.md` и соответствующем отчёте `chronos/parity/`.

## Инварианты (чего не ломать)

- Идентичность: `appId` `io.github.zulut30.chronos`, профиль `%APPDATA%\Chronos`, `CHRONOS_HOME` (`~/.chronos`), внешний callback `chronos://`, глобальный `t3` в PATH не перехватывается.
- Внутренний origin `t3code://app`: сохраняй привилегии схемы вместе с `chronos://` (`apps/desktop/src/chronos/ChronosSchemes.ts`) и заголовок `Origin` для loopback-портов сервисов (`ServiceOrigins.ts`).
- Публичные параметры Clerk/relay (`.env.example`), мобильный пейринг; при расширении общих контрактов (`UsageProviderKind` и т. п.) проверяй потребителей и в `apps/web`, и в `apps/mobile`.
- Никогда не запускай тестовые сборки на живом `~/.t3` (миграции БД односторонние).

## Проверка изменения

Для вопроса об устройстве достаточно карты и исходников. При изменении кода проверь поверхность патча командой `node chronos/scripts/upstream-plan.mjs feature <база-ветки>`. Для новой возможности проверь, что без включения или первого обращения она не запускает дополнительный процесс, наблюдатель или загрузку. Тяжёлые проверки и сборку выполняет [chronos-ci](../chronos-ci/SKILL.md). Для поведения готового пакета используй [chronos-live-verify](../chronos-live-verify/SKILL.md). Условия входа в main задаёт [chronos-router](../chronos-router/SKILL.md).
