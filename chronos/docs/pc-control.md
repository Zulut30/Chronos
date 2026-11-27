## Управление ПК

Настройки и индикатор подключены в `SettingsPanels.tsx`, `routes/_chat.tsx` и `AppRouteModal.tsx`. Локальный backend получает путь к командному клиенту в `DesktopBackendConfiguration.ts`. Электронная оболочка подключает управление через `DesktopApp.ts`, защищённый IPC и `preload.ts`. Нативные инструменты упаковывает `scripts/build-desktop-artifact.ts`. [Возможности и проверка](../parity/pc-control.md) · [Скилл для агента](../skills/chronos-pc-control/SKILL.md).
