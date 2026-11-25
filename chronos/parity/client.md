# Клиент Olympus в Chronos

База — тег `v0.1.10-nightly.20261116.4774`, коммит `16695c812fffe75e85f8cc3084d2c561aa3ca93f`. Эталон — байты установленных чанков из `inventory/asar/extract/live/server.asar/apps/server/dist/client/assets/` и разборы в `inventory/asar/details/`. Все 25 клиентских блоков совпали с соответствующими диапазонами LIVE. Для 27 правок штатного кода проверены места и поведение. Интеграционная проверка собранного Chronos остаётся за CI и запуском приложения.

## Навигация в настройках

В 4774 и 5209 кнопки «API-ключи» и «Серверы MCP» открывают панели поверх текущего раздела T3. Обработчики ухода в `80-integrations.js` и `90-mcp-manager.js` распознают штатный атрибут `data-settings-section`, который оба модуля удаляют со своих кнопок. Эталонный smoke 4774 открывал и закрывал каждую панель по отдельности.

Хост [settingsNavigation.ts](../../apps/web/src/chronos/olympus/settingsNavigation.ts) закрывает соседнюю панель до обработки клика и обе панели при смене URL в роутере. Подсветка и `aria-current` следуют видимой панели, а после её закрытия — штатному разделу. Встроенные панели сохраняют URL и историю родительского раздела. Сценарий smoke `settings-panel-navigation` проверяет смену панели и возврат в «Общие».

## Блоки LIVE

Проверка каждой строки включала прямое сравнение трёх последовательностей байтов — файл Chronos, копия из `verbatim/blocks` и указанный срез чанка LIVE. Для каждого JS прошёл `node --check`. Хеш в таблице — первые 16 знаков SHA-256.

| Элемент описи | Файл и строка в Chronos | Подключение | Срез LIVE, байты · SHA-256 |
|---|---|---|---|
| `05-oly-core.js` | [`apps/web/src/chronos/olympus/features/05-oly-core.js:1`](../../apps/web/src/chronos/olympus/features/05-oly-core.js#L1) | [`apps/web/src/chronos/olympus/prologue.ts:1`](../../apps/web/src/chronos/olympus/prologue.ts#L1) | `[0, 6914)` · `316e94900ad6ee1a` |
| `17-servers.js` | [`apps/web/src/chronos/olympus/features/17-servers.js:1`](../../apps/web/src/chronos/olympus/features/17-servers.js#L1) | [`apps/web/src/chronos/olympus/prologue.ts:2`](../../apps/web/src/chronos/olympus/prologue.ts#L2) | `[6914, 7629)` · `28da8c8d464977bf` |
| `10-plan-mode.js` | [`apps/web/src/chronos/olympus/features/10-plan-mode.js:1`](../../apps/web/src/chronos/olympus/features/10-plan-mode.js#L1) | [`apps/web/src/chronos/olympus/prologue.ts:4`](../../apps/web/src/chronos/olympus/prologue.ts#L4) | `[7630, 22699)` · `eb069222c5d348c7` |
| `92-studio-shell.js` | [`apps/web/src/chronos/olympus/features/92-studio-shell.js:1`](../../apps/web/src/chronos/olympus/features/92-studio-shell.js#L1) | [`apps/web/src/chronos/olympus/prologue.ts:6`](../../apps/web/src/chronos/olympus/prologue.ts#L6) | `[22700, 29638)` · `19c08e2129f7e32e` |
| `90-mcp-manager.js` | [`apps/web/src/chronos/olympus/features/90-mcp-manager.js:1`](../../apps/web/src/chronos/olympus/features/90-mcp-manager.js#L1) | [`apps/web/src/chronos/olympus/prologue.ts:8`](../../apps/web/src/chronos/olympus/prologue.ts#L8) | `[29639, 38707)` · `14e0607abd90cf5d` |
| `91-prompts-settings.js` | [`apps/web/src/chronos/olympus/features/91-prompts-settings.js:1`](../../apps/web/src/chronos/olympus/features/91-prompts-settings.js#L1) | [`apps/web/src/chronos/olympus/prologue.ts:9`](../../apps/web/src/chronos/olympus/prologue.ts#L9) | `[38707, 70000)` · `686332849829ed7d` |
| `88-rich-text.js` | [`apps/web/src/chronos/olympus/features/88-rich-text.js:1`](../../apps/web/src/chronos/olympus/features/88-rich-text.js#L1) | [`apps/web/src/chronos/olympus/prologue.ts:11`](../../apps/web/src/chronos/olympus/prologue.ts#L11) | `[70001, 85058)` · `c151a51c8c0f8648` |
| `extras.js` | [`apps/web/src/chronos/olympus/features/extras.js:1`](../../apps/web/src/chronos/olympus/features/extras.js#L1) | [`apps/web/src/chronos/olympus/prologue.ts:13`](../../apps/web/src/chronos/olympus/prologue.ts#L13) | `[85059, 96052)` · `cbbd17bfb07c5a76` |
| `20-speed.js` | [`apps/web/src/chronos/olympus/features/20-speed.js:1`](../../apps/web/src/chronos/olympus/features/20-speed.js#L1) | [`apps/web/src/chronos/olympus/prologue.ts:15`](../../apps/web/src/chronos/olympus/prologue.ts#L15) | `[96053, 149802)` · `f7c10e7ac6ffa0e7` |
| `22-budget.js` | [`apps/web/src/chronos/olympus/features/22-budget.js:1`](../../apps/web/src/chronos/olympus/features/22-budget.js#L1) | [`apps/web/src/chronos/olympus/prologue.ts:17`](../../apps/web/src/chronos/olympus/prologue.ts#L17) | `[149803, 171519)` · `cdf044efb22be6e4` |
| `24-thread-details.js` | [`apps/web/src/chronos/olympus/features/24-thread-details.js:1`](../../apps/web/src/chronos/olympus/features/24-thread-details.js#L1) | [`apps/web/src/chronos/olympus/prologue.ts:19`](../../apps/web/src/chronos/olympus/prologue.ts#L19) | `[171520, 185073)` · `9731067d5a550ba8` |
| `25-bg-tasks.js` | [`apps/web/src/chronos/olympus/features/25-bg-tasks.js:1`](../../apps/web/src/chronos/olympus/features/25-bg-tasks.js#L1) | [`apps/web/src/chronos/olympus/prologue.ts:20`](../../apps/web/src/chronos/olympus/prologue.ts#L20) | `[185073, 220819)` · `c390e728fa6b965e` |
| `26-notifications.js` | [`apps/web/src/chronos/olympus/features/26-notifications.js:1`](../../apps/web/src/chronos/olympus/features/26-notifications.js#L1) | [`apps/web/src/chronos/olympus/prologue.ts:22`](../../apps/web/src/chronos/olympus/prologue.ts#L22) | `[220820, 242061)` · `b3e471eddfce16f7` |
| `28-model-account.js` | [`apps/web/src/chronos/olympus/features/28-model-account.js:1`](../../apps/web/src/chronos/olympus/features/28-model-account.js#L1) | [`apps/web/src/chronos/olympus/prologue.ts:23`](../../apps/web/src/chronos/olympus/prologue.ts#L23) | `[242061, 248742)` · `bf09f3249218988d` |
| `30-tasks.js` | [`apps/web/src/chronos/olympus/features/30-tasks.js:1`](../../apps/web/src/chronos/olympus/features/30-tasks.js#L1) | [`apps/web/src/chronos/olympus/prologue.ts:25`](../../apps/web/src/chronos/olympus/prologue.ts#L25) | `[248743, 349882)` · `a6bf6760e8a1384e` |
| `40-files.js` | [`apps/web/src/chronos/olympus/features/40-files.js:1`](../../apps/web/src/chronos/olympus/features/40-files.js#L1) | [`apps/web/src/chronos/olympus/prologue.ts:27`](../../apps/web/src/chronos/olympus/prologue.ts#L27) | `[349883, 382385)` · `79b98e58b16399b6` |
| `55-composer.js` | [`apps/web/src/chronos/olympus/features/55-composer.js:1`](../../apps/web/src/chronos/olympus/features/55-composer.js#L1) | [`apps/web/src/chronos/olympus/prologue.ts:29`](../../apps/web/src/chronos/olympus/prologue.ts#L29) | `[382386, 413253)` · `e3a509e8c39816fd` |
| `50-machines.js` | [`apps/web/src/chronos/olympus/features/50-machines.js:1`](../../apps/web/src/chronos/olympus/features/50-machines.js#L1) | [`apps/web/src/chronos/olympus/prologue.ts:31`](../../apps/web/src/chronos/olympus/prologue.ts#L31) | `[413254, 434729)` · `49bb7932283e6bd1` |
| `60-studio.js` | [`apps/web/src/chronos/olympus/features/60-studio.js:1`](../../apps/web/src/chronos/olympus/features/60-studio.js#L1) | [`apps/web/src/chronos/olympus/prologue.ts:33`](../../apps/web/src/chronos/olympus/prologue.ts#L33) | `[434730, 461857)` · `cf2faf1cd8e1d784` |
| `70-openrouter.js` | [`apps/web/src/chronos/olympus/features/70-openrouter.js:1`](../../apps/web/src/chronos/olympus/features/70-openrouter.js#L1) | [`apps/web/src/chronos/olympus/prologue.ts:35`](../../apps/web/src/chronos/olympus/prologue.ts#L35) | `[461858, 479618)` · `a0a9f35e6f4b2b12` |
| `80-integrations.js` | [`apps/web/src/chronos/olympus/features/80-integrations.js:1`](../../apps/web/src/chronos/olympus/features/80-integrations.js#L1) | [`apps/web/src/chronos/olympus/prologue.ts:37`](../../apps/web/src/chronos/olympus/prologue.ts#L37) | `[479619, 506993)` · `ebfb65a0ddb13b87` |
| `87-ru-fixes.js` | [`apps/web/src/chronos/olympus/features/87-ru-fixes.js:1`](../../apps/web/src/chronos/olympus/features/87-ru-fixes.js#L1) | [`apps/web/src/chronos/olympus/prologue.ts:39`](../../apps/web/src/chronos/olympus/prologue.ts#L39) | `[506994, 510219)` · `9c617dcf023e8796` |
| `93-chat-panels.js` | [`apps/web/src/chronos/olympus/features/93-chat-panels.js:1`](../../apps/web/src/chronos/olympus/features/93-chat-panels.js#L1) | [`apps/web/src/chronos/olympus/prologue.ts:40`](../../apps/web/src/chronos/olympus/prologue.ts#L40) | `[510219, 539519)` · `3216c563a87a3167` |
| `15-lang-icons.js` | [`apps/web/src/chronos/olympus/features/15-lang-icons.js:1`](../../apps/web/src/chronos/olympus/features/15-lang-icons.js#L1) | [`apps/web/src/pierre-icons.ts:1`](../../apps/web/src/pierre-icons.ts#L1) | `[0, 71732)` · `698ddb15cab3bad9` |
| `88-rich-markdown.chat.js` | [`apps/web/src/chronos/olympus/features/88-rich-markdown.chat.js:1`](../../apps/web/src/chronos/olympus/features/88-rich-markdown.chat.js#L1) | [`apps/web/src/chronos/olympus/plugin.ts:16`](../../apps/web/src/chronos/olympus/plugin.ts#L16) | `[301660, 303996)` · `739406df824fed4a` |

Сумма размеров отдельных блоков — 613 570 байт. Пролог с разделителями занимает 539 519 байт. Изолированный вызов Vite-плагина выдал точную копию диапазона `[0, 539519)` чанка `main-lxHaZZx7.js` с SHA-256 `8fc1c9a9a489a8b3ec96465a9205fbb38026aeebd0f2ff52cb399da333d102ac`. Блок Pierre совпал во всех 71 732 байтах, блок Markdown — во всех 2 336 байтах до добавленного экспорта.

## Правки исходников T3

Каждая строка сверена с контекстом и телом «после» своего файла `details/<чанк>.md`. Для компонентов сопоставлен JS, который выдаёт установленный `oxc-transform-react@0.152.0` с production JSX и React Compiler. Это преобразование отдельных исходников в памяти. Проверенные поля и порядок перечислены по строкам.

| Чанк и hunk | Файл и строка в Chronos | Проверка поведения |
|---|---|---|
| `_chat-CZ9dvfEY.js N01` | [`apps/web/src/components/chat/useThreadLifecycle.tsx:521`](../../apps/web/src/components/chat/useThreadLifecycle.tsx#L521) | В обработчике самостоятельной команды режим читается по зафиксированному ID перед созданием сообщения и первым await. |
| `_chat-CZ9dvfEY.js N02` | [`apps/web/src/components/chat/useThreadLifecycle.tsx:547`](../../apps/web/src/components/chat/useThreadLifecycle.tsx#L547) | В настройки треда передаётся сохранённый `olySendPlan`. |
| `_chat-CZ9dvfEY.js N03` | [`apps/web/src/components/chat/useThreadLifecycle.tsx:560`](../../apps/web/src/components/chat/useThreadLifecycle.tsx#L560) | Тот же `olySendPlan` передаётся в `startThreadTurn` самостоятельной команды. |
| `_chat-CZ9dvfEY.js N04` | [`apps/web/src/components/chat/useComposerSend.ts:784`](../../apps/web/src/components/chat/useComposerSend.ts#L784) | В обычной отправке вычисление режима идёт после захвата ID и перед `snapshotComposerSend`. |
| `_chat-CZ9dvfEY.js N05` | [`apps/web/src/components/chat/useComposerSend.ts:861`](../../apps/web/src/components/chat/useComposerSend.ts#L861) | Сначала `formatOutgoingPrompt`, затем условный `__olyWrapModeText(text, threadIdForSend)` и валидация того же текста. |
| `_chat-CZ9dvfEY.js N06` | [`apps/web/src/components/chat/useComposerSend.ts:1261`](../../apps/web/src/components/chat/useComposerSend.ts#L1261) | При сохранении настроек используется `olySendPlan`. |
| `_chat-CZ9dvfEY.js N07` | [`apps/web/src/components/chat/useComposerSend.ts:1316`](../../apps/web/src/components/chat/useComposerSend.ts#L1316) | В `bootstrap.createThread.interactionMode` идёт тот же режим. |
| `_chat-CZ9dvfEY.js N08` | [`apps/web/src/components/chat/useComposerSend.ts:1366`](../../apps/web/src/components/chat/useComposerSend.ts#L1366) | Основной turn получает тот же режим. У служебного `/compact` по-прежнему `DEFAULT_INTERACTION_MODE`. |
| `_chat-CZ9dvfEY.js N09` | [`apps/web/src/components/chat/useComposerResume.ts:102`](../../apps/web/src/components/chat/useComposerResume.ts#L102) | При resume режим фиксируется по ID до установки флага отправки. |
| `_chat-CZ9dvfEY.js N10` | [`apps/web/src/components/chat/useComposerResume.ts:123`](../../apps/web/src/components/chat/useComposerResume.ts#L123) | Этот режим передаётся в сохранение настроек возобновления. |
| `_chat-CZ9dvfEY.js N11` | [`apps/web/src/components/chat/useComposerResume.ts:140`](../../apps/web/src/components/chat/useComposerResume.ts#L140) | Проверены режим и `dispatchMode: "start"` в возобновляемом turn. |
| `_chat-CZ9dvfEY.js N12` | [`apps/web/src/components/chat/CollapsedComposerPromptPreview.tsx:96`](../../apps/web/src/components/chat/CollapsedComposerPromptPreview.tsx#L96) | Ветка `oly-` предшествует поиску записи. В JSX проверены ключ сегмента, `span.oly-reference-chip`, label и title для модели. |
| `_chat-CZ9dvfEY.js N13` | [`apps/web/src/components/ChatView.tsx:1912`](../../apps/web/src/components/ChatView.tsx#L1912) | При отправке из приложения вычисляется режим целевого `activeThreadId`, сохраняется `dispatchMode: "queue"`. |
| `_chat-CZ9dvfEY.js N14` | [`apps/web/src/components/ChatView.tsx:3236`](../../apps/web/src/components/ChatView.tsx#L3236) | Проверен сгенерированный JSX. При каждом рендере читается текущий host с резервным `RightPanelSurfaceContent`. В `__hj` передан этот компонент, в `__surfaces` — `renderedRightPanelSurfaces` из `rightPanelPresence.value?.surfaces ?? []`. В LIVE это `Hj` и `ma`. |
| `ThreadDetailsItemsMenu-nmodI3O-.js N01` | [`apps/web/src/composer-editor-mentions.ts:213`](../../apps/web/src/composer-editor-mentions.ts#L213) | Штатный лексер передаётся в `__olyReferences.lex`, есть nullish fallback. В Node исходный модуль 55 и лексер Chronos дали текстовый сегмент и чип `oly-model` с исходным ID и короткой подписью. |
| `ThreadDetailsItemsMenu-nmodI3O-.js N02` | [`apps/web/src/components/composerContextPresentation.tsx:493`](../../apps/web/src/components/composerContextPresentation.tsx#L493) | Проверены чтение контекста, отдельный `span.oly-reference-chip`, title по `kind`, текст из label и штатный реестр для остальных ссылок. |
| `ThreadDetailsItemsMenu-nmodI3O-.js N03` | [`apps/web/src/composerPlaceholder.ts:1`](../../apps/web/src/composerPlaceholder.ts#L1) | Русская строка подсказки сверена с LIVE целиком, включая пробелы и символы @, #, !, $ и /. |
| `ChatMarkdown-lT6xQ6yD.js N01` | [`packages/shared/src/markdownPipeline.ts:210`](../../packages/shared/src/markdownPipeline.ts#L210) | В веб-схему добавлены `mark` и `u`. Оба тега сохранены при прогоне настоящего shared-конвейера. |
| `ChatMarkdown-lT6xQ6yD.js N02` | [`packages/shared/src/markdownPipeline.ts:214`](../../packages/shared/src/markdownPipeline.ts#L214) | К глобальным разрешённым атрибутам добавлен `dataOlyStyle`. В результирующем HAST цвет и курсив пережили санитайзер, временный атрибут исчез. |
| `ChatMarkdown-lT6xQ6yD.js N03` | [`packages/shared/src/markdownPipeline.ts:365`](../../packages/shared/src/markdownPipeline.ts#L365) | Между теми же штатными плагинами выполнены `pre → rehypeSanitize → post`. Прогнан пример с `mark/font/u`, проверено преобразование `font` в `span`, тематический цвет и курсив. |
| `DiffPanel-BVARAjwr.js N01` | [`apps/web/src/components/DiffPanel.tsx:1`](../../apps/web/src/components/DiffPanel.tsx#L1) | Импорт совпадает с компонентом, который штатный код экспортирует из `chat/PierreEntryIcon`. |
| `DiffPanel-BVARAjwr.js N02` | [`apps/web/src/components/DiffPanel.tsx:1470`](../../apps/web/src/components/DiffPanel.tsx#L1470) | В сгенерированном JSX первый ребёнок Fragment — прежний переключатель, включая загрузчик для pending. |
| `DiffPanel-BVARAjwr.js N03` | [`apps/web/src/components/DiffPanel.tsx:1484`](../../apps/web/src/components/DiffPanel.tsx#L1484) | Второй ребёнок — иконка того же пути с `kind="file"`, текущей темой и классом `size-3.5`. |
| `pierre-icons-Bzfbe5S-.js N01` | [`apps/web/src/pierre-icons.ts:195`](../../apps/web/src/pierre-icons.ts#L195) | На исходнике Pierre 1.0.0-beta.6 в памяти применён JS-hunk патча. Проверены общая таблица standard/complete, реальный resolver для CMD и Excalidraw и итоговая строка document-спрайта. Вызов apply и синхронизация строки идут перед созданием resolver. |
| `UsageLimits-MnFl4D3C.js N01` | [`apps/web/src/components/usage/usageProviders.ts:35`](../../apps/web/src/components/usage/usageProviders.ts#L35) | Проверены место после OpenCode, label `OpenRouter`, цвет `#6467F2` и driverKind `opencode`. |
| `UsageLimits-MnFl4D3C.js N02` | [`apps/web/src/components/usage/usageProviders.ts:70`](../../apps/web/src/components/usage/usageProviders.ts#L70) | Вызов настоящей функции с одной записью при нулевых токенах и цене вернул OpenRouter. Запись без всех трёх показателей исключена. Порядок провайдеров сохранён. |
| `main-lxHaZZx7.js N01` | [`apps/web/src/components/sidebar/SidebarThreadHeader.tsx:129`](../../apps/web/src/components/sidebar/SidebarThreadHeader.tsx#L129), [`apps/web/src/chronos/olympus/dayNightButton.tsx:5`](../../apps/web/src/chronos/olympus/dayNightButton.tsx#L5) | Последний ребёнок того же контейнера — штатная SidebarHeaderIconButton. Сверены точная русская подпись, классы span/Moon/Sun, вся CSS-строка, выбор противоположной темы и обработчик отказа сохранения. |

## Привязки к 4774

| Кто читает | Где проверено | Результат |
|---|---|---|
| 24, `memoizedProps.window` | [`apps/web/src/components/chat/ThreadDetailsUsage.tsx:78`](../../apps/web/src/components/chat/ThreadDetailsUsage.tsx#L78) | LimitRow получает объект окна от родителя. |
| 24, `memoizedProps.rows`, ключ строки | [`apps/web/src/components/chat/ThreadRelationshipsControl.tsx:155`](../../apps/web/src/components/chat/ThreadRelationshipsControl.tsx#L155), [`apps/web/src/components/chat/ThreadRelationshipsControl.tsx:1034`](../../apps/web/src/components/chat/ThreadRelationshipsControl.tsx#L1034), [`apps/web/src/components/chat/ThreadRelationshipsControl.tsx:893`](../../apps/web/src/components/chat/ThreadRelationshipsControl.tsx#L893) | Группа принимает rows, обычный DOM-элемент списка получает ключ threadId. |
| 25, идентификаторы треда и окружения | [`apps/web/src/components/chat/ThreadDetailsPanel.tsx:55`](../../apps/web/src/components/chat/ThreadDetailsPanel.tsx#L55), [`apps/web/src/components/chat/ThreadDetailsCard.tsx:30`](../../apps/web/src/components/chat/ThreadDetailsCard.tsx#L30) | Есть оба представления, а у карточки — штатный data-workspace-focus-key. |
| 28, данные меню моделей | [`apps/web/src/components/chat/ProviderModelPicker.tsx:286`](../../apps/web/src/components/chat/ProviderModelPicker.tsx#L286), [`apps/web/src/components/chat/ProviderModelPicker.tsx:288`](../../apps/web/src/components/chat/ProviderModelPicker.tsx#L288), [`apps/web/src/components/chat/ProviderModelPicker.tsx:300`](../../apps/web/src/components/chat/ProviderModelPicker.tsx#L300) | Три поля передаются одному ModelPickerContent. В React DOM 19.3.0 production есть DOM-ключ с префиксом `__reactFiber$`. |
| 22, 26, 93, глобальный роутер | [`apps/web/src/router.ts:6`](../../apps/web/src/router.ts#L6) | В router-core 1.171.8, `src/router.ts:1034–1035`, условие проверяет наличие document. В production LIVE `Match-CtCj-_Kc.js` найдено ``typeof document<`u`&&(self.__TSR_ROUTER__=this)``. |
| 93, данные и store | [`apps/web/src/chronos/olympus/shims/entities.ts:1`](../../apps/web/src/chronos/olympus/shims/entities.ts#L1), [`apps/web/src/chronos/olympus/shims/rightPanelStore.ts:1`](../../apps/web/src/chronos/olympus/shims/rightPanelStore.ts#L1) | Шимы реэкспортируют настоящие привязки. В изолированном Node запуске блок 93 завершил ready, установил host, его u и rp строго равны исходным объектам Chronos. Чтение оболочек вернуло массив. |
| 93, React и JSX | [`apps/web/src/chronos/olympus/shims/react.ts:3`](../../apps/web/src/chronos/olympus/shims/react.ts#L3), [`apps/web/src/chronos/olympus/shims/jsx-runtime.ts:3`](../../apps/web/src/chronos/olympus/shims/jsx-runtime.ts#L3) | Оригинальные экспорты t в официальном ASAR 4774 — фабрики CommonJS. Обе фабрики Chronos при том же запуске дали объекты, строго равные React и react/jsx-runtime приложения. |

## Подключение и границы проверки

- Точка входа — [`apps/web/src/bootstrap.ts:4`](../../apps/web/src/bootstrap.ts#L4). Первый импорт в [`apps/web/src/main.tsx:1`](../../apps/web/src/main.tsx#L1) подключает упорядоченный пролог. Pierre подключает блок 15 до применения таблиц. Shared-цепочка получает пару функций блока 88 через веб-резолвер. Для других потребителей shared оставлен штатный конвейер.

- В production плагин выпускает три ESM-файла с хешем содержимого. Первый содержит весь пролог, второй — блок 15, третий — блок 88 с именованным экспортом после оригинальных байтов. Это отличие от физической раскладки Olympus, где код находился внутри штатных чанков. Такой способ сохраняет minified-литералы, атлас и оригинальный порядок при работе React Compiler и финального переводчика. При изменении JS-блока меняется имя его ассета. В обычном dev используются исходные импорты.

- Для четырёх вычисляемых URL модуля 93 плагин создаёт entry-чанки с исходными именами и строгой сигнатурой. В обычном dev те же URL разрешаются на TypeScript-шимы. В Node был вызван фактический резолвер с префиксом пути и загружены четыре реальных модуля. Документ, хранилище и планировщик кадров заменялись тестовыми объектами. Внешние сервисы не вызывались.

- Pierre держит встроенные строки спрайтов в закрытой таблице `BUILT_IN_SVG_SPRITE_SHEETS`. Малый pnpm-патч открывает ту же ссылку через свойство существующей функции. Так встроенные фабрики, включая код для shadow root, читают обновлённую таблицу. Сверены контексты обоих hunk пакета и SHA-256 во всех четырёх ссылках lockfile. Применение pnpm при установке и отображение shadow root предстоит проверить в CI и приложении.

- Папка verbatim исключена из React Compiler, lint, format и сканирования Tailwind. Отдельно защищены пробелы и переводы строк списка импорта. Конфиги TypeScript не включают allowJs/checkJs. Узкая проверка TypeScript 6.0.3 для плагина, пролога, двух React-шимов и fallback Markdown прошла с включённой проверкой side-effect imports. Сгенерированный JSX и поведение Markdown, панелей, учёта использования, лексера и спрайтов проверялись небольшими скриптами с локальными зависимостями.

В тестовой обвязке изолированная проверка загрузчика подменяет пролог, а браузерные тесты компонентов без main получают штатный режим по умолчанию. Все 27 пар диапазонов «до/после» в деталях сверены с байтами двух архивов. Проверка списка из 58 путей и `git diff --check` прошли.

## Зависимости и открытые проверки

- Серверный поток владеет `UsageProviderKind` и пределом `THEME_CSS_MAX_LENGTH`. В общей копии при проверке уже присутствовали `openrouter` и `4_194_304`. Статические переводы, runtime-translator, тема пользователя и внешние службы поставляются другими потоками.

- CI должен проверить установку с замороженным lockfile, финальный граф чанков и разрешение трёх ESM-ассетов и четырёх LIVE-имён в упакованном Electron. При холодном старте проверить порядок исполнения относительно общих чанков T3 и готовность панелей к первому рендеру. Отдельно проверить загрузку ассетов при открытии клиента под префиксом пути. Локального бандла и результата CI в этом отчёте нет.

- После сборки проверить 24/25/28 в настоящем React-дереве. Наличие нужных пропсов проверено по тегу, но глубина прохода по Fiber, момент появления DOM и совпадение селекторов после локализации требуют запуска. Для 93 проверить две колонки, переходы между тредами, смену активного чата и восстановление после перезагрузки.

- Для визуального совпадения проверить обе темы, кнопку «День / ночь», файл в diff и дереве с shadow root, чипы композера и форматирование реального сообщения. HTML/CSS и логика проверены по исходникам и данным. Сравнения экранов установленного Olympus и собранного Chronos не проводилось.

## Полный список путей клиентского потока

Всего 58 путей вместе с этим отчётом. Пути даны от корня рабочей копии, по одному на строку. В общем `apps/web/vite.config.ts` клиенту принадлежат подключение `olympusFeatures` и исключение React Compiler. В `apps/web/src/main.tsx` клиенту принадлежит импорт пролога. Соседние изменения перевода учитывает его поток.

~~~text
apps/web/src/chronos/olympus/dayNightButton.tsx
apps/web/src/chronos/olympus/features/05-oly-core.js
apps/web/src/chronos/olympus/features/10-plan-mode.js
apps/web/src/chronos/olympus/features/15-lang-icons.js
apps/web/src/chronos/olympus/features/17-servers.js
apps/web/src/chronos/olympus/features/20-speed.js
apps/web/src/chronos/olympus/features/22-budget.js
apps/web/src/chronos/olympus/features/24-thread-details.js
apps/web/src/chronos/olympus/features/25-bg-tasks.js
apps/web/src/chronos/olympus/features/26-notifications.js
apps/web/src/chronos/olympus/features/28-model-account.js
apps/web/src/chronos/olympus/features/30-tasks.js
apps/web/src/chronos/olympus/features/40-files.js
apps/web/src/chronos/olympus/features/50-machines.js
apps/web/src/chronos/olympus/features/55-composer.js
apps/web/src/chronos/olympus/features/60-studio.js
apps/web/src/chronos/olympus/features/70-openrouter.js
apps/web/src/chronos/olympus/features/80-integrations.js
apps/web/src/chronos/olympus/features/87-ru-fixes.js
apps/web/src/chronos/olympus/features/88-rich-markdown.chat.js
apps/web/src/chronos/olympus/features/88-rich-text.js
apps/web/src/chronos/olympus/features/90-mcp-manager.js
apps/web/src/chronos/olympus/features/91-prompts-settings.js
apps/web/src/chronos/olympus/features/92-studio-shell.js
apps/web/src/chronos/olympus/features/93-chat-panels.js
apps/web/src/chronos/olympus/features/extras.js
apps/web/src/chronos/olympus/globals.d.ts
apps/web/src/chronos/olympus/plugin.ts
apps/web/src/chronos/olympus/prologue.ts
apps/web/src/chronos/olympus/shims/entities.ts
apps/web/src/chronos/olympus/shims/jsx-runtime.ts
apps/web/src/chronos/olympus/shims/react.ts
apps/web/src/chronos/olympus/shims/rightPanelStore.ts
apps/web/src/components/ChatView.tsx
apps/web/src/components/DiffPanel.tsx
apps/web/src/components/chat/CollapsedComposerPromptPreview.tsx
apps/web/src/components/chat/useComposerResume.ts
apps/web/src/components/chat/useComposerSend.ts
apps/web/src/components/chat/useThreadLifecycle.tsx
apps/web/src/components/composerContextPresentation.tsx
apps/web/src/components/sidebar/SidebarThreadHeader.tsx
apps/web/src/components/usage/usageProviders.ts
apps/web/src/composer-editor-mentions.ts
apps/web/src/composerPlaceholder.ts
apps/web/src/index.css
apps/web/src/main.test.ts
apps/web/src/main.tsx
apps/web/src/pierre-icons.ts
apps/web/test/browserSetup.ts
apps/web/vite.config.ts
chronos/parity/client.md
knip.jsonc
packages/shared/src/markdownPipeline.ts
packages/shared/src/olympusRichMarkdown.ts
patches/@pierre__trees@1.0.0-beta.6.patch
pnpm-lock.yaml
pnpm-workspace.yaml
vite.config.ts
~~~

Настраиваемые модули, зависимости, ключи localStorage и точки проверки описаны в [описи настроек чата](chat-settings.md).
