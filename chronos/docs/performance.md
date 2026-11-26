## Точки встраивания оптимизаций при параллельных запусках

| Файл апстрима                                                                            | Назначение                                                    |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `apps/server/src/orchestration-v2/ProviderSessionManager.ts`, `RunExecutionService.ts`   | Привязка очереди к запуску и выбор получателей событий Codex  |
| `apps/server/src/orchestration-v2/ProviderCommitBatch.ts`                                | Размер неизменного snapshot перед постановкой в очередь       |
| `apps/server/src/orchestration-v2/EventSink.ts`                                          | Каналы подписок на committed events одного треда              |
| `apps/server/src/usage/UsageService.ts`                                                  | Общий скан OpenCode и OpenRouter и раздельные итоги           |
| `apps/server/src/observability/Observability.ts`, `packages/shared/src/observability.ts` | Решение о записи локального span после завершения             |
| `apps/web/src/components/chat/useThreadFind.ts`                                          | Подписка поиска на открытую проекцию                          |
| `packages/client-runtime/src/state/shellReducer.ts`, `threadShell.ts`                    | Индекс позиций и повторное использование списка ссылок тредов |

[Методика стенда](../scripts/bench/README.md) и [замеры](../parity/perf-quick-wins.md).

## Ресурсы параллельных сессий

`apps/desktop/src/chronos/services/Sidecars.ts` проверяет владельца каждого порта и запускает один `chronos/services/host.mjs` по первому свободному порту. Хост исполняет семь HTTP-сервисов в отдельных Node Worker. Менеджер повторяет проверку при выходе воркера или хоста.

Для SSH десктоп выбирает источник через `CHRONOS_SSH_CLI_SOURCE`. Значение `chronos` выбирает архив текущей ревизии Chronos, `upstream` или отсутствие переменной — прежний официальный CLI. После изменения перезапустите десктоп и переподключите управляемое окружение. Встраивание: `DesktopSshEnvironment.ts`, `packages/shared/src/cliRelease.ts`, `packages/ssh/src/tunnel.ts`, сборка и SHA256SUMS в `chronos-desktop.yml`.

В Windows-сборке `DesktopBackendConfiguration.ts` передаёт путь своего `resource-monitor` серверу. `KeepAwake.ts` удерживает запрос Windows через режим `--chronos-keep-awake` этого помощника, пока работает агент и действует штатная минутная отсрочка.

В Windows `DesktopSnapShot.ts` оставляет запуск двух помощников SnapShot до первого запроса. Пулы `RegionSnapShot.ts` и `SnapShotAccessibilityProcess.ts` держат запасного помощника минуту после использования. Действующий захват владеет своим процессом независимо от этого таймера.

`apps/server/src/persistence/Sqlite.ts` ограничивает размер повторно используемого WAL 32 МиБ. Методика и все замеры приведены в [отчёте](../parity/perf-resources-2.md).
