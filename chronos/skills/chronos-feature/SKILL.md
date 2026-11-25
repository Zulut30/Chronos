---
name: chronos-feature
description: Как добавлять и переносить функции в форк Chronos (Zulut30/Chronos) с сохранением паритета Olympus, встроенных сервисов, перевода, бренда и чистых слияний с апстримом T3. Используй перед любой правкой кода Chronos и по /chronos-feature.
---

# Разработка функций и правок в Chronos

Текущая база апстрима — в `chronos/version.json`; карта всех точек встраивания и отчёты потоков — в `chronos/README.md` и `chronos/parity/`. Функции Olympus переносятся как есть, без переписывания на React. Начинай ветку от `main` (архив старой переписи `legacy/react-rewrite` не трогай).

## Где размещать код

1. **Изолированные каталоги форка:**
   - **Веб-клиент:** `apps/web/src/chronos/<фича>/` (например, `issue-trello/`, `idleUnload/`, `perf/`). Модули Olympus лежат байт в байт в `apps/web/src/chronos/olympus/features/`, подключаются через `prologue.ts` и плагин `olympus/plugin.ts` (мимо React Compiler и переводчика) — правь их только точечно ради исправления бага.
   - **Сервисы Olympus и sidecar-менеджер (`chronos/parity/services.md`):**
     - исходники 7 HTTP-сервисов (`4517–4524`: `skills-manager`, `tasks-service`, `files-service`, `studio-service`, `integrations-service`, `mcp-manager`, `olympus-hub`) и `openrouter-service` (stdio) — в `chronos/services/<имя>/`. Пути данных параметризуются через `CHRONOS_T3_HOME` и `CHRONOS_SERVICES_DATA` (фолбэк `~/.t3` при ручном запуске);
     - запуск/остановка из Electron main — `apps/desktop/src/chronos/services/` (`ChronosServices.ts`, `Sidecars.ts` через `ELECTRON_RUN_AS_NODE=1` с проверкой порта до старта и логами в `<baseDir>/logs/services/`), упаковка в `resources/chronos-services/` через `scripts/build-desktop-artifact.ts`;
     - сохранение `Origin: t3code://app` для CORS портов сервисов — `apps/desktop/src/chronos/services/ServiceOrigins.ts` (подключён в `RemoteRequestHeaders.ts`).
   - **Перевод (`chronos/parity/l10n.md`, `chronos/parity/upstream-5209.md`):**
     - словари и дополнения — `chronos/l10n/` (`ru-final.json`, `gt-additions.json`, `occurrence-contexts.json`);
     - два Vite-хука в `apps/web/src/chronos/olympus/l10n/`: `catalog.ts` (`olympusCatalog` патчит `ru.json` GT до бандлинга) и `plugin.ts` (`olympusL10n` переводит AST-литералы и дописывает `runtime-translator.js`). Новые строки оформляй по глоссарию Olympus (`chronos-upstream-adopt`); формулировки Olympus главнее штатного `ru.json`.
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

## CI и проверка

- Workflow форка — только `.github/workflows/chronos-*.yml`:
  - `chronos-checks.yml` — `chronos-version`, `upstream-plan`, тесты сервисов/воркера под Electron `node:sqlite`, `vp lint apps/desktop/src/chronos`, typecheck (`contracts`, `shared`, `web`, `desktop`, `scripts`, `t3` — серверному typecheck нужен `--filter=@t3tools/scripts...`), юнит- и серверные регрессии;
  - `chronos-desktop.yml` — сборки Windows x64, macOS arm64, macOS x64 (нативный `macos-26-intel`) + сверка упакованных `chronos-services`;
  - `chronos-parity.yml` — сверка движка перевода на эталоне 4774;
  - `chronos-smoke.yml` — функциональный CDP smoke на `windows-latest` (`require_services=true`);
  - `chronos-upstream.yml` — ежедневный отчёт совместимости.
- Перед пушем проверь поверхность правок: `node chronos/scripts/upstream-plan.mjs feature <база-ветки>`.
- Тяжёлые сборки и полный монорепо-typecheck гоняй в CI; живое окно и паритет проверяй по `chronos-parity-check` и `chronos-ui-review`.
- В `main` — по решению пользователя (для регулярной синхронизации с T3 действует постоянное правило из `chronos-upstream-sync`).
