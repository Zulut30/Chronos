---
name: chronos-feature
description: Как добавлять и переносить функции в форк Chronos (Zulut30/Chronos), сохраняя паритет Olympus на базе T3 4774 и не ломая ручные слияния с апстримом. Используй перед любой правкой кода Chronos и по /chronos-feature.
---

# Функции и правки в Chronos (схема паритета Olympus)

Chronos базируется на T3 Code `v0.1.10-nightly.20261116.4774` (`16695c812fffe75e85f8cc3084d2c561aa3ca93f`).
Функциональность Olympus переносится как есть без переписывания на React; подробности и отчёты
потоков находятся в `chronos/README.md` и `chronos/parity/`.

## Где писать код
Начинай от `main` (перенос Olympus один в один; прежний `main` — `legacy/react-rewrite`, его не трогать).

1. **Новые файлы — в своих папках:**
   - десктоп (Electron main): `apps/desktop/src/chronos/…`
   - инструменты, скрипты, ассеты, отчёты паритета, доки: `chronos/…` (отчёты — `chronos/parity/…`)
   - общий код пакета: отдельный файл или блок `// --- chronos: begin … // --- chronos: end ---`
     в конце существующего файла (как в `packages/shared/src/cliRelease.ts`), без добавления новых
     экспортов в `package.json` апстрима без необходимости.
   - CI: только `.github/workflows/chronos-*.yml`.
2. **Правки в файлах апстрима — минимальные**: импорт + короткий вызов с комментарием
   `// chronos: <зачем>`. Не переформатируй и не «улучшай» окружающий код апстрима.
3. Не переписывай модули Olympus на новый React UI: если меняется поведение или вид внутри окна,
   сверяйся с эталоном Olympus и отчётами в `chronos/parity/`.
4. Каждую новую точку встраивания отрази в `chronos/README.md` и соответствующем отчёте
   `chronos/parity/`.

## Чего не трогать
У самостоятельной сборки Chronos свой `appId` (`io.github.zulut30.chronos`), профиль `Chronos`,
каталог `~/.chronos` (`CHRONOS_HOME`) и внешний callback `chronos://`.
Для совместимости с серверами T3 и CORS локальных сервисов Olympus сохраняй внутренний origin
`t3code://app`, публичные параметры relay/Clerk (`.env.example`), мобильный пейринг и не
перехватывай глобальный `t3` в PATH.

## Проверка
- `node chronos/scripts/upstream-plan.mjs feature <база-ветки>` покажет все файлы в `chronos/` и
  вне него.
- На слабом ПК не запускай тяжёлые сборки и полный монорепо-typecheck локально; проверяй через CI
  (`chronos-checks.yml`, `chronos-desktop.yml`, `chronos-parity.yml`):
  `gh workflow run chronos-desktop.yml --repo Zulut30/Chronos --ref <ветка>`.
- В `main` — только по решению пользователя.
