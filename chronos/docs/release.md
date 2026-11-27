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

Парный Windows-замер main и ветки, правила бюджета и формат отчёта описаны в [шлюзе производительности](../parity/perf-guard.md).

Апстримные workflow из `.github/workflows/` удалены (им нужны платные раннеры и расписание релизов
T3). Оставлены только workflow Chronos:

- `.github/workflows/chronos-desktop.yml`:
  - **push в `main`** и **`workflow_dispatch`** — собирают Windows x64 (NSIS) и macOS
    arm64/x64 (`dmg` + `zip`) с постоянной подписью Chronos и загружают установщики в артефакты прогона
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
- macOS использует постоянный самоподписанный сертификат Chronos и MacUpdater. После перехода с ad-hoc через DMG обновления устанавливаются из приложения.
  Подробнее — в [chronos/parity/macos.md](../parity/macos.md).
