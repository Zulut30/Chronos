### Trello

| Точка встраивания в T3                                                                                                                           | Назначение                                                                           |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| `packages/contracts/src/issue.ts`, `packages/source-control-core/src/server/IssueTracker.ts`                                                     | Необязательные срок и вложения, разрешение срока и определение доски карточки        |
| `apps/server/src/issue/{IssueTrackerRegistry,IssueService}.ts`                                                                                   | Регистрация драйвера, выбор доски и аккаунта для короткой ссылки, обработка срока    |
| `apps/server/src/mcp/toolkits/issues/{tools,handlers}.ts`                                                                                        | Чтение вложений и срока, создание и обновление карточек                              |
| `packages/client-runtime/src/issueLinks.ts`, `apps/web/src/lib/openIssueLink.ts`, `apps/mobile/src/native/useOpenPullRequest.ts`                 | Распознавание ссылки в чате и переход на реальную доску                              |
| `apps/web/src/components/settings/{IssueTrackerSettings.tsx,settingsSearch.ts}`, `components/issue/{issuePresentation,IssueDetailPanel}.tsx`     | Поиск и настройка подключения, обозначение Trello и поля карточки                    |
| `apps/mobile/src/features/issues/IssueRouteScreen.tsx`                                                                                           | Срок и ссылки вложений в мобильной карточке                                          |
| `packages/client-runtime/src/issueLinks.test.ts`, `apps/server/src/mcp/toolkits/issues/handlers.test.ts`, `.github/workflows/chronos-checks.yml` | Моки REST, короткие ссылки, реальные обработчики инструментов, регрессии подключений |

[Возможности и проверка Trello](../parity/trello-tracker.md)
