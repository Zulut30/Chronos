# Chronos на T3 nightly 5209

База T3 обновлена с `v0.1.10-nightly.20261116.4774` до `v0.1.12-nightly.20261124.5209`. На старте задачи это был последний nightly в `git ls-remote --refs --tags upstream`. Родители merge-коммита `4a73fd9b3d` — Chronos `a1a49b5739df5bce06621030e0b50ff1674ea86b` и T3 `84e4264bb347e36e97f6c3bd95d666eecfa12e07`. Между SHA двух nightly Git насчитал 1 648 коммитов и 5 100 изменённых файлов. `chronos-version.mjs` выдаёт `0.1.12-nightly.20261124.5209.chronos.5`.

В апстриме появились трекеры задач, запуск нескольких моделей, изменения фоновой работы, связанные окружения и панели тредов. Веб-чат перешёл на Words, расширились каталоги GT, в desktop появился нативный помощник диктовки для macOS. Миграции 097–111 меняют схему и индексы данных, включая привязки трекеров и воркфлоу. Для проверки запуска нужен отдельный профиль. Совместимость обновлённой базы с 4774 не проверялась.

## Разрешение 38 конфликтов

Первые 22 конфликта — modify/delete в `.github/workflows`. Сохранено удаление каждого из следующих файлов.

| | | |
|---|---|---|
| agent-context-budget.yml | ci.yml | deploy-relay.yml |
| issue-labels.yml | issue-vouch.yml | mobile-android-apk.yml |
| mobile-eas-preview-fork.yml | mobile-eas-preview.yml | mobile-eas-production.yml |
| mobile-fingerprint-check.yml | mobile-fingerprint-label.yml | mobile-showcase-screenshots.yml |
| pr-limits.yml | pr-size.yml | pr-vouch.yml |
| relay-preview-cleanup.yml | relay-preview.yml | release-desktop.yml |
| release.yml | stale-needs-more-info.yml | thread-transfer-report.yml |
| web-preview.yml | | |

Два новых workflow T3, `mobile-eas-preview-build.yml` и `mobile-eas-production-build.yml`, также исключены. Остались четыре workflow Chronos.

| Файл | Решение |
|---|---|
| Корневой README.md | Сохранено описание форка. Указатель на новую базу и таблица мест подключения обновлены в `chronos/README.md`. |
| pnpm-workspace.yaml | Конфигурация 5209 плюс запись патча `@pierre/trees@1.0.0-beta.6`. |
| pnpm-lock.yaml | Lock 5209 со всеми новыми версиями и изменившимся upstream-патчем `@pierre/diffs`. Добавлены только хеш trees, две ссылки импортёров и ключ snapshot. SHA-256 патча с LF — `8f24f3a60b888b16e44548333f1cf066687891e59fca25cd641966237e0891d6`. Проверена SHA-512 tarball из lock. `git apply --check` прошёл на обоих файлах пакета, включая декларации типов. |
| desktop/main.ts | Принят файл 5209. Поправка для SSH перенесена в `ssh/DesktopSshEnvironment.ts`. Версия удалённого CLI лишается суффикса Chronos. Настройка зеркала и запуск dev-сервера сохранены. |
| server/provider/acp/AntigravityChildWork.ts | Принят upstream. Его decoder поддерживает один вызов и пачку, поиск отделённого потомка и откат к SQLite. Для переданного log URI остаётся сравнение realpath. Удалён отдельный модуль Olympus для поиска потомков. |
| server/provider/acp/AntigravityProtocol.ts | В 5209 уже есть заголовок `Run invoke_subagent`. Принят upstream целиком. |
| server/provider/antigravityUsageLimits.ts | Штатные пути чтения CLI-сессии и проверки срока действия заменяют локальный модуль sign-in. Сохранено извлечение необязательной почты из уже выбранной сессии. Она нужна модулю 28. Используется изоляция keyring по типу аккаунта из 5209. |
| web/components/DiffPanel.tsx | Сохранены GT, загрузка отложенного diff и иконка Pierre в заголовке файла рядом с кнопкой сворачивания. |
| web/components/chat/useComposerSend.ts | Текст проходит через обёртку Olympus до проверки провайдером. Остаётся проверка текущего маршрута. При отправке нескольким моделям валидируется текст каждого адресата и передаётся выбранный режим, в том числе при создании треда. Внутренняя команда сжатия сохраняет штатный режим. |
| web/components/desktopUpdate.logic.ts | Объединены импорты. Ссылки на версии Chronos получают префикс `chronos-v`, ссылки на T3 — `v`. Сохранены выбор канала и сообщения 5209. |
| web/components/sidebar/SidebarChrome.tsx | Сохранены навигация Issues, Pull Requests, ссылка домой и фирменный знак Chronos. Для доступного имени используется исходный ключ GT с заменой названия продукта. |
| web/composerPlaceholder.ts | Принято определение `msg()` из 5209. Русская подсказка задаётся в каталоге и учитывает `@`, `#`, `!`, `$`, `/`. Превью шрифта разрешает тот же ключ, что и композер. |
| web/i18n/runtime.ts | Вызов нового `resolveWebLocaleSelection` сохраняет региональный формат и асинхронную загрузку GT. Для отсутствующего языка и старого значения `en` применяется `ru`, как в Olympus. |
| contracts/server.ts | В 5209 предел составляет 100 000 символов. Сохранён предел Olympus 4 194 304, на него ссылаются контракт и валидатор темы в клиенте. |
| shared/markdownPipeline.ts | В конвейере rehype оставлены pre/post Olympus вокруг санитизации. Схема переехала в `markdownHast.ts`. Основной рендерер Words вызывает `sanitizeChatHast` напрямую, поэтому в этой точке также работают оба фильтра. Список допустимых стилей по-прежнему определяет исходный модуль 88. |
| shared/themeCss.ts | Сохранены обе возможности — встроенные изображения Olympus до предела CSS и отдельные файлы фона через `--theme-background-image` из 5209. Фильтр URL остаётся штатным. |

Учёт OpenRouter ещё требует правок форка. Апстрим не разделяет записи OpenCode/OpenRouter по квитанциям Olympus. Сохранены чтение каталога расхода, идентификатор провайдера, ключ дедупликации, бесплатные записи, разделение статистики и логика цены. Второй независимый механизм авторизации Antigravity убран, а штатное вычисление отпечатка аккаунта и отображение адреса в меню остались разными операциями.

## Клиент и риски запуска

Сверены пометки `chronos` в приложениях, пакетах и упаковщике, пересечение правок 4774 с изменениями upstream и список `upstream-plan.mjs surface`. У всех 25 JS-файлов в `features/` прежнее Git-дерево `0392e4e975f2f599276507de849760974150dc93`. В артефакте `js-bundle` прогона 45514019844 проверены три выпущенных JS-ассета. Размеры пролога, markdown и Pierre составили соответственно 539 519, 2 407 и 71 732 байта. SHA-256 содержимого каждого совпал с хешем в имени.

| Привязка | Что сверено в 5209 | Проверка в окне |
|---|---|---|
| 24, лимиты | `ThreadDetailsUsage` передаёт `window` в `LimitRow` и `PoolRow`. Навигационные строки стали ссылками. Восстановлен явный `tabIndex=0`, по которому Olympus находит строку. Заголовок `thread-details-usage-heading` сохранён. | Остаток и сброс для одного аккаунта и пула, подпись при фокусе. |
| 24, родственные треды | `ThreadLineageGroup` получает `rows`, обычный `li` получает ключ `threadId`, заголовок имеет ID `thread-details-lineage-heading`. Для обычной строки кнопка содержит `span.min-w-0.flex-1`. В новых группах удалённый субагент и составная кнопка имеют другую вложенность. | У обычной строки проверить модель/статус. У удалённого субагента и составной строки отдельная вторая подпись Olympus не подтверждена. |
| 25, фоновые задачи | `ThreadDetailsPanel` и `ThreadDetailsCard` несут идентификаторы и `threadRef`. Запасной путь читает `details:<environmentId>:<threadId>` из `data-workspace-focus-key`. | Карточки двух окружений, обновление статуса и переход к нужному треду. |
| 28, модель и аккаунт | В одном вызове компонента `ProviderModelPicker` присутствуют `environmentId`, `instanceEntries`, `activeInstanceId`. В разметке присутствуют панель провайдеров, активная кнопка и поле поиска. Для UI почта берётся из метаданных экземпляра. | Переключить два аккаунта, проверить почту и тариф, в том числе отсутствие почты после выхода. |
| 93, чанки и store | В ZIP найдены все четыре исторических имени. Шим `entities.u` вызывает `readThreadShells()`; `rightPanelStore.d` предоставляет `getState/subscribe`. Адаптер преобразует `thread:<id>/thread/openThread` в `side-chat:<id>/side-chat/openSideChat`. Чтение `byThreadKey`, подписка, `activateSurface/closeSurface/show` и рендер используют согласованные ID. Другие виды панелей передаются без преобразования. | Alt/средний клик, меню, перетаскивание, закрытие, две колонки и восстановление сохранённого разделения. |
| 93, ChatView | `PanelHost` получает список **отрисованных** поверхностей и активный ID. Когда Olympus подменяет вторую поверхность, адаптер передаёт её обратно в родной `RightPanelSurfaceContent`. Проверено тестом преобразования данных и действий реального Zustand store. | Сменить главный чат, поменять колонки местами, проверить фокус активной вкладки. |
| 22/26/93, роутер | В tarball `@tanstack/router-core@1.171.8` с проверенной integrity найдена установка `self.__TSR_ROUTER__ = this`. Маршрут треда содержит идентификаторы окружения и треда. | Открыть уведомление, перейти между тредами, проверить подписку на изменение маршрута. |
| 10/55, ввод | Штатное разбиение текста передаётся в `__olyReferences.lex` из `splitPromptIntoComposerSegments`. Сохранены рендер чипов, свёрнутое превью, отправка, возобновление и повторная отправка; для fan-out добавлено применение режима. | Ввести чипы, сменить режим, отправить одной и двум моделям, возобновить тред. |
| 15, 88, Diff | Патч обоих файлов Pierre применим к точной версии из lock. `pierre-icons.ts` вызывает `__olyLangIcons.apply`. В Words и rehype действует одна схема. Сырые ассеты Olympus в ZIP сохранили байты. | Иконки файлов в diff, дерево и строка заголовка, цветной текст, фон, копирование кода. |
| Упаковка, T3 Connect | Точки входа сохраняют `io.github.zulut30.chronos`, `CHRONOS_HOME`, профиль Chronos, `chronos://` для Clerk и `t3code://app` для клиента. Сверены настройки публичного релея, окружение дочернего сервера, SSH/WSL, лента обновлений и ограничение nightly. | Вход по коду, возврат по callback, SSH/WSL, обновление, раздельные профили. |
| Модули с внешними сервисами | Точки меню, карточек и поля ввода перечислены ниже. Этап 1 не переносит процессы задач, файлов, MCP и Studio. | Доска, уведомления, файлы, скиллы, интеграции, Studio и OpenRouter с работающими сервисами. |

## Перевод и CI

В 5209 английский каталог веб-клиента содержит 10 214 записей с такими же ID в русском каталоге. Из них 242 хранят дерево фрагментов GT. Старый переводчик обрабатывает литералы собранного JS и намеренно исключает ключи, свойства данных и экспортированные привязки каталогов. Замена уже переведённого русского текста по английскому литералу здесь не срабатывает. До сверки экранов хук 5209 переопределял 1 793 записи. В принятой для проверки сборке после сверки — 1 807. Изменились значения 30 ID относительно предыдущей сборки ветки. Новый Vite-хук собирает **русский** каталог по английскому источнику и исходному ID до импорта JSON. Он сохраняет именованные переменные, узлы GT и штатные правила множественного числа. Для шаблона с разными допустимыми подстановками остаётся штатный перевод. За каталоги других языков отвечает T3.

При прямом совпадении переносятся статические формулировки Olympus, затем учитываются его контекстные подписи карточки треда и финальная подсказка композера. В остальных сообщениях применяются вычитанные дополнения и штатный русский каталог. Среди проверенных результатов — «Уровень рассуждения», «Запустить скилл провайдера», «Расход», «Показать или скрыть правую панель», «Связанные треды». Добавлены переводы выбора нескольких моделей, трекеров задач и истории запусков воркфлоу. Словарь находится в `chronos/l10n/gt-additions.json`. Сопоставление работает на целых сообщениях; произвольный перевод отдельных частей сложного ICU не выполняется.

Сверка с окном 4774 выявила три разных источника видимых подписей. В настройках часть заголовков уже переводил GT версии 4774. Для подтверждённых подписей `settings4774` сверяет и ID контекста, и английский оригинал. В навигации 5209 `Source control & issues` сменил `Source control`. На экране провайдеров статические таблицы обычно имеют приоритет, но у трёх подтверждённых подписей фактически отображался `DICT.exact`. Для сообщений с переменными используются только полные шаблоны `DICT.patterns` с буквальным окружением и сохранением всех подстановок. У `Authenticated · {method}` отдельные полные формулировки подписок извлекаются из `DICT.exact`, остальные названия проходят через `{method}`. Из `87-ru-fixes.js` применяются целые статусы `Waiting` и `Running`. Формы заголовка изменённых файлов остаются в ICU 5209.

| Английское сообщение 5209 | ID каталога | Источник результата |
| --- | --- | --- |
| General | `81d0d1e78b196630` | GT 4774, «Общие» |
| Appearance | `fa19046edd6cfbd4`, `a1f05362e8741905` | GT 4774, «Внешний вид» |
| Source control & issues | `0a59e086514a62a9`, `4ec62c39ca3192bf` | GT 4774, прежнее название раздела «Контроль версий» |
| Authenticated · {method} | `170d8586394fb04b` | Шаблон «Авторизовано · …», две полные записи DICT для подписок |
| Authenticated as + Var | `ab4e8ccc69c28a8c` | Статическая таблица «Выполнен вход как» и исходный узел аккаунта |
| Shadow home path | `bc8971b240b10317` | DICT.exact, «Путь к теневому home» |
| Checked {time} / Checked + Var + ago | `5602db67733bdfd7`, `5db22d69327dcf35` | «Проверено только что» до минуты, затем «Проверено … назад». В 4774 значение `1m` выводилось в моноширинном узле вне runtime-перевода. |

Проверены и допустимые переводы T3 для английских строк эталона. Это `Worktrees` (`4889f7885396c26b`), `Not authenticated` (`d6845667c3278af2`), его форма с методом (`b2768aa900b19198`), `Installed · Sign-in not checked` (`24a4bbee246a576f`) и `Disabled` (три контекста `934c7cd7805fc3f9`, `8cd230b6b3c829c6`, `0b236f40b2a852aa`). Для них сохранены значения русского каталога 5209.

**Приёмка на Windows.** На коммите `01802432ab` прошли [checks](https://github.com/Zulut30/Chronos/actions/runs/45579934691) и [паритет 4774](https://github.com/Zulut30/Chronos/actions/runs/45579934847). [Desktop 45579934371](https://github.com/Zulut30/Chronos/actions/runs/45579934371) собрал Windows x64, macOS x64 и arm64. SHA-512 [установщика Windows](https://github.com/Zulut30/Chronos/actions/runs/45579934371/artifacts/15006322200) совпал с манифестом. После установки поверх существующего Chronos английский и русский модули из установленного ASAR совпали с ожидаемыми по всем 10 214 ключам и значениям. Полный smoke с `--strict-en` на CDP 9333 прошёл 14/14, без пропусков, ошибок и неожиданных английских фраз.

Для текста использован smoke `98dfba58a3` из `feature/smoke`. Исходный отчёт 4774 сохранял только английские фразы. Русские строки сняты повторно с архивной 4774 в отдельном профиле. Оригинальные PNG, английские фразы и проверки остались источником остальных метрик. У повторного прогона 4774 с исходным эталоном 11 из 12 экранов уложились в порог изображения 1%, на странице расхода изменилось состояние провайдеров. Различия в формулировках подсчитаны по экрану и направлению после нормализации времени и чисел.

| Причина различий между 4774 и установленной сборкой | Исчезло | Появилось |
| --- | ---: | ---: |
| Новые настройки подтверждения закрытия терминала и ширины HTML-превью | 0 | 5 |
| «Рабочие деревья» вместо Worktrees в шести отображениях меню | 0 | 6 |
| Полностью русские счётчики вместо двух смешанных фраз 4774 | 2 | 2 |
| Три статуса провайдеров, которые 4774 оставляла по-английски | 0 | 3 |
| «Выполнен вход как» и аккаунт теперь лежат на одной строке текста | 1 | 1 |
| В iframe MCP при новом замере загрузились карточки серверов и их поля | 0 | 6 |
| Статус получения лимитов и другой выбранный проект в Студии | 3 | 4 |
| **Итого по 12 экранам после правки** | **6** | **27** |
| До правки на тех же экранах | 52 | 73 |

Необъяснённых замен русских формулировок — 0. Общее сравнение с исходными PNG вернуло `FAIL`: на 11 экранах превышен порог 1% изменившихся немаскированных пикселей (максимум 31,17% при переключении темы). На экране расхода появилось одно разрешённое английское сообщение провайдера о входе. Скриншоты, аккаунты и полные отчёты остались вне репозитория.

В первом логе сборки найдено 643 срабатывания старого детектора, 431 различный текст. 642 вхождения совпали с ключевым текстом английского GT-каталога. Оставшееся — сообщение контракта `not_a_file_request`, которое подсказывает агенту повторить запрос секрета. Исходный английский текст этого протокола сохранён. В логе 45514019844 осталось 28 вхождений после защиты ключей GT в вызовах и JSX. Среди них были варианты условных выражений для избранного, переноса строк, кода и папок. Эти ветви также защищены. Восемь повторов сообщения об ограничении 50 МБ принадлежат таблице кодов ZIP, для UI есть `zipErrorMessages.ts`; `File comment` служит ключом карты и переводится при отображении. `Project` в поисковом индексе отображается через `searchMatchHintLabel`. В логе 45515634728 осталось 11 записей: восемь резервных сообщений ZIP и по одному вхождению `not_a_file_request`, `Project`, `File comment`. При чтении модулей выпуска английский и русский каталоги вернули по 10 214 ID. Проверены значения ключей подсказки и обеих форм заголовка связанных тредов, а также полные байты трёх ассетов Olympus против исходников.

- Первый merge — [checks](https://github.com/Zulut30/Chronos/actions/runs/45512623580), [паритет исходного 4774](https://github.com/Zulut30/Chronos/actions/runs/45512623387), [desktop](https://github.com/Zulut30/Chronos/actions/runs/45512603390). Windows собран. Обе сборки macOS упёрлись в отсутствие SpeechTranscriber в SDK.
- Адаптеры и сверка русских ключей — [checks](https://github.com/Zulut30/Chronos/actions/runs/45514020300), [паритет 4774](https://github.com/Zulut30/Chronos/actions/runs/45514019674), [desktop](https://github.com/Zulut30/Chronos/actions/runs/45514019844). Windows и macOS arm64 собраны. На Apple Silicon генерация кэша серверного байткода через Electron x64 превысила лимит процесса. Сборка Intel перенесена на нативный раннер `macos-26-intel`.
- Расширенный [серверный прогон](https://github.com/Zulut30/Chronos/actions/runs/45515635146) обнаружил две проверки, в которых список источников OpenCode не учитывал каталог Olympus. [Повторный checks](https://github.com/Zulut30/Chronos/actions/runs/45516136559) и [паритет](https://github.com/Zulut30/Chronos/actions/runs/45516136588) прошли. В фикстуре квитанция проверяется отдельно: 13 выходных токенов OpenRouter и прежние 5, 7 и 11 у OpenCode. Из 196 выделенных серверных проверок прошли 195; тест Windows Credential Manager на Linux пропущен по условию платформы. В пакете OpenCode прошли 12 проверок.
- [Desktop 45515634728](https://github.com/Zulut30/Chronos/actions/runs/45515634728) успешно собрал все три платформы на SHA `9c237a5582`. Артефакты — [Windows x64](https://github.com/Zulut30/Chronos/actions/runs/45515634728/artifacts/14978265409), [macOS arm64](https://github.com/Zulut30/Chronos/actions/runs/45515634728/artifacts/14977419976), [macOS x64](https://github.com/Zulut30/Chronos/actions/runs/45515634728/artifacts/14979116148). После этой сборки изменялись только тесты ожиданий и этот отчёт.
- Результаты для вершины ветки — [checks](https://github.com/Zulut30/Chronos/actions/workflows/chronos-checks.yml?query=branch%3Aupstream-sync%2F2026-11-25), [паритет](https://github.com/Zulut30/Chronos/actions/workflows/chronos-parity.yml?query=branch%3Aupstream-sync%2F2026-11-25), [desktop и установщики](https://github.com/Zulut30/Chronos/actions/workflows/chronos-desktop.yml?query=branch%3Aupstream-sync%2F2026-11-25). Паритет проверяет зафиксированный ASAR 4774. Его зелёный статус не удостоверяет окно 5209.

## Опись DOM и текстовых привязок

По AST исходных JS-модулей извлечены аргументы вызовов DOM API и простых обёрток над ними. Всего 538 вызовов. В 508 случаях аргумент — литерал или разрешённая строковая константа. Остальные 30 выражений приведены как написаны. Для атрибутов учтена запись через DOMStringMap, например `dataset.contextMenu` создаёт `data-context-menu`. Наличие имени в исходнике не подтверждает одновременное наличие всех частей составного селектора в одном элементе. Геометрию, глубину Fiber, содержимое iframe и время появления элементов следует проверить в окне.

| Модуль | Вызовы | Атрибуты и слоты из селекторов, найденные в исходниках T3 | Имена, для которых нужен DOM модуля или внешнего компонента |
|---|---:|---|---|
| 05-oly-core.js | 2 | — | — |
| 10-plan-mode.js | 8 | <code>composer-host</code>, <code>data-composer-shortcut</code>, <code>data-slot</code> | <code>data-plan-icon</code>, <code>data-plan-label</code> |
| 15-lang-icons.js | 0 | — | — |
| 17-servers.js | 5 | — | — |
| 20-speed.js | 39 | <code>combobox-item</code>, <code>combobox-item-content</code>, <code>composer-host</code>, <code>data-composer-shortcut</code>, <code>data-effort-level</code>, <code>data-model-picker-effort</code>, <code>data-model-picker-option-menu</code>, <code>data-slot</code>, <code>data-user-message-bubble</code>, <code>dialog-popup</code>, <code>dialog-title</code>, <code>scroll-area-viewport</code> | <code>data-armed</code> |
| 22-budget.js | 5 | <code>composer-host</code>, <code>data-composer-shortcut</code>, <code>data-slot</code> | <code>data-oly-ik-nav</code> |
| 24-thread-details.js | 6 | <code>data-slot</code>, <code>data-thread-details-card</code>, <code>menu-popup</code>, <code>tooltip-popup</code> | — |
| 25-bg-tasks.js | 15 | <code>data-thread-details-card</code>, <code>data-workspace-focus-key</code> | <code>data-oly-bg-act</code>, <code>data-since</code> |
| 26-notifications.js | 14 | <code>composer-host</code>, <code>data-sidebar</code>, <code>data-slot</code>, <code>data-workspace-area</code>, <code>sidebar-container</code>, <code>sidebar-content</code>, <code>sidebar-footer</code>, <code>sidebar-gap</code>, <code>sidebar-inset</code>, <code>sidebar-menu-item</code>, <code>sidebar-trigger</code>, <code>sidebar-wrapper</code> | — |
| 28-model-account.js | 11 | <code>data-model-picker-content</code>, <code>data-model-picker-provider</code>, <code>data-model-picker-sidebar</code> | — |
| 30-tasks.js | 133 | <code>composer-host</code>, <code>data-chat-composer-form</code>, <code>data-chat-composer-main-surface</code>, <code>data-composer-shortcut</code>, <code>data-sidebar-action-for</code>, <code>data-sidebar-row</code>, <code>data-slot</code>, <code>select-value</code>, <code>sidebar</code>, <code>sidebar-group</code>, <code>workspace-breadcrumb-text</code> | <code>data-act</code>, <code>data-ci</code>, <code>data-crm</code>, <code>data-ct</code>, <code>data-f</code>, <code>data-l</code>, <code>data-md</code>, <code>data-openchat</code>, <code>data-openthread</code>, <code>data-quick-status</code>, <code>data-reset-filters</code>, <code>data-run</code>, <code>data-sel</code>, <code>data-tf</code>, <code>data-tv</code> |
| 40-files.js | 41 | <code>data-context-menu</code>, <code>data-context-menu-chevron</code>, <code>data-file-breadcrumbs</code>, <code>data-file-crumb</code>, <code>data-level</code>, <code>data-right-panel-tab-list</code>, <code>data-surface-subheader</code>, <code>data-title</code> | <code>data-oly-dl</code> |
| 50-machines.js | 19 | <code>command-item</code>, <code>data-composer-command-drawer</code>, <code>data-slot</code>, <code>data-user-message-bubble</code> | <code>data-machine-index</code> |
| 55-composer.js | 21 | <code>composer-host</code>, <code>data-composer-command-drawer</code>, <code>data-composer-drawer-layer</code>, <code>data-slot</code>, <code>data-testid</code>, <code>data-user-message-bubble</code> | <code>data-oly-display</code>, <code>data-oly-mode-chip</code>, <code>data-oly-mode-source</code> |
| 60-studio.js | 40 | <code>composer-host</code>, <code>data-active-tab</code>, <code>data-right-panel-tab-list</code>, <code>data-slot</code>, <code>data-surface-launcher-keys</code>, <code>menu-item</code>, <code>menu-popup</code>, <code>sidebar</code> | <code>data-board</code>, <code>data-hub</code>, <code>data-new</code>, <code>data-oly-skills</code>, <code>data-oly-studio</code>, <code>data-oly-studio-launch</code>, <code>data-oly-studio-mi</code>, <code>data-oly-studio-overlay</code>, <code>data-site</code>, <code>data-sites</code> |
| 70-openrouter.js | 24 | <code>command-item</code>, <code>data-composer-command-drawer</code>, <code>data-composer-drawer-layer</code>, <code>data-composer-item-id</code>, <code>data-slot</code>, <code>data-testid</code>, <code>data-user-message-bubble</code> | <code>data-oly-or-logo</code>, <code>data-oly-or-orig</code> |
| 80-integrations.js | 29 | <code>data-settings-section</code>, <code>data-slot</code>, <code>data-workspace-area</code>, <code>sidebar-menu-button</code> | <code>data-oly-ik-act</code>, <code>data-oly-ik-crumb</code>, <code>data-oly-ik-input</code>, <code>data-oly-ik-nav</code> |
| 87-ru-fixes.js | 5 | <code>data-user-message-bubble</code> | <code>data-changed-files-header</code> |
| 88-rich-markdown.chat.js | 0 | — | — |
| 88-rich-text.js | 31 | <code>data-message-id</code>, <code>data-message-role</code>, <code>data-sidebar-row</code>, <code>data-thread-item</code>, <code>data-timeline-row-id</code> | <code>data-oly-rich</code> |
| 90-mcp-manager.js | 15 | <code>data-active</code>, <code>data-app-modal</code>, <code>data-settings-section</code>, <code>data-workspace-area</code> | <code>data-oly-mcp-nav</code> |
| 91-prompts-settings.js | 20 | <code>data-active</code>, <code>data-app-modal</code>, <code>data-settings-section</code>, <code>data-workspace-area</code> | <code>data-oly-mcp-nav</code>, <code>data-oly-prompts-nav</code>, <code>data-oly-ps-nav-button</code> |
| 92-studio-shell.js | 2 | — | — |
| 93-chat-panels.js | 39 | <code>data-active-tab</code>, <code>data-context-menu</code>, <code>data-right-panel-tab-list</code>, <code>data-right-panel-tabbar</code>, <code>data-side-chat-pane</code>, <code>data-sidebar-row</code>, <code>data-slot</code>, <code>data-thread-context-drop</code>, <code>data-thread-item</code>, <code>data-workspace-area</code>, <code>sidebar</code>, <code>sidebar-inset</code> | <code>data-a</code>, <code>data-oly-pm</code>, <code>data-oly-promote</code>, <code>data-oly-split</code>, <code>data-oly-tabctl</code>, <code>data-oly-zones</code> |
| extras.js | 14 | <code>data-message-id</code>, <code>data-slot</code>, <code>data-workspace-area</code>, <code>sidebar</code>, <code>sidebar-inner</code> | <code>data-oly-skills</code> |

`data-context-menu`, `data-context-menu-chevron` и `data-level` создаёт `contextMenuFallback.ts` через `dataset`. У 87 прежний `[data-changed-files-header]` отсутствует в собственных исходниках T3. В новом представлении PR число файлов выводится ICU-сообщением с формами `one/few/many/other`.

| Функция | Текст или шаблон в модуле | Сверка с интерфейсом 5209 |
|---|---|---|
| Режим, скорость, серверы | `composer.effort`, `fast`/`быстр`, `Стоимость`/`Cost`, `кэш`/`cache`, разделитель ` · ` | Команда композера и ключ `Cost` присутствуют. Русская подпись — «Стоимость». Для серверов 17 читает последний фрагмент второй строки. |
| Карточка треда | `Usage limits`, `Lineage`, `Servers`, `Initialize Git`, `Disconnect agent session`, `Ahead of pace`, `On pace`, `Under pace`, `Context compacts automatically when needed.` | Для изменившихся GT-подписей явно перенесены слова из 24. Проверить длительность, относительный темп и группы удалённых агентов. |
| Studio, скиллы | `Usage`/`Расход`, `Toggle right panel`/`Показать или скрыть правую панель`, `Терминал`/`Terminal`, `Файлы`/`Files` | SidebarChrome и PanelLayoutControls формируют подписи через GT. Проверены соответствующие записи эффективного каталога. |
| Настройки | `Close settings`/`Закрыть настройки`, `Close`/`Закрыть`, `Поиск в настройках`, `Очистить поиск по настройкам` | Для поиска SettingsSidebarNav использует `Search settings` и `Clear settings search`. Русские значения совпадают с селекторами. Навигация `/settings/providers` сохранена. |
| Файлы, копирование, расход | `Скачать`, `Скачать папку (.zip)`, `copy message`/`копировать сообщение`, `Waiting`/`Running`, `changed file` и отдельная `s` | Скачивание добавляет модуль 40. Копирование зависит от кнопки в таймлайне. Модуль 87 пропускает пользовательский текст и отдельно обрабатывает грамматику старых заголовков. |
| Страницы Olympus | `Проекты`, `Задача`, `Ждут внимания`, `Режим уведомлений`, `Серверы MCP`, `Студия` | Собственная отрисовка 26/30/60/90/92. Байты исходных модулей сохранены. Ответы сервисов и вкладки iframe здесь не проверялись. |

<details>
<summary>Все извлечённые селекторы, включая внутреннюю разметку Olympus</summary>

**05-oly-core.js**

—

Вычисляемые аргументы — <code>sel</code>.

**10-plan-mode.js**

<code>.oly-plan</code>, <code>[aria-checked=true]</code>, <code>[data-plan-icon]</code>, <code>[data-plan-label]</code>, <code>[data-slot=composer-host]</code>, <code>button</code>, <code>button[data-composer-shortcut~="composer.effort"]</code>

**17-servers.js**

<code>button &gt; span &gt; span:nth-child(2)</code>, <code>li</code>, <code>section:has(#thread-details-servers-heading)</code>

**20-speed.js**

<code>.chat-markdown,[data-user-message-bubble],pre,code,.composer-tiptap,[contenteditable="true"],textarea,input,select,.xterm</code>, <code>.flex-1</code>, <code>.ms-auto</code>, <code>.oly-dl-speed</code>, <code>.oly-pick-speed</code>, <code>.oly-plan</code>, <code>.oly-speed</code>, <code>.oly-stats</code>, <code>.oly-stats-reset</code>, <code>.oly-stats-reset[data-armed=true]</code>, <code>.sr-only</code>, <code>:scope&gt;div</code>, <code>:scope&gt;div&gt;dt</code>, <code>[aria-label]</code>, <code>[data-effort-level]</code>, <code>[data-model-picker-effort]</code>, <code>[data-model-picker-option-menu]</code>, <code>[data-slot=combobox-item-content] .truncate</code>, <code>[data-slot=combobox-item]</code>, <code>[data-slot=composer-host]</code>, <code>[data-slot=scroll-area-viewport]</code>, <code>[role=dialog][data-slot=dialog-popup]</code>, <code>[role=menuitemradio]</code>, <code>[role=radio]</code>, <code>[role=radiogroup]</code>, <code>[role=radiogroup] [role=radio]</code>, <code>button[data-composer-shortcut~="composer.effort"]</code>, <code>dd</code>, <code>dl</code>, <code>dt</code>, <code>h2[data-slot=dialog-title]</code>, <code>label</code>

**22-budget.js**

<code>.chat-markdown,pre,code,.xterm,[contenteditable=true],.oly-budget-pop,.oly-notify-wrap</code>, <code>.oly-plan,button[data-composer-shortcut~="composer.effort"]</code>, <code>.oly-speed</code>, <code>[data-oly-ik-nav]</code>, <code>[data-slot=composer-host]</code>

**24-thread-details.js**

<code>[data-slot="tooltip-popup"],[data-slot="menu-popup"]</code>, <code>[data-thread-details-card]</code>

Вычисляемые аргументы — <code>ANY</code>, <code>CARD+' [data-oly-td="usage"]'</code>.

**25-bg-tasks.js**

<code>#oly-bg-base</code>, <code>[data-thread-details-card]</code>, <code>[data-workspace-focus-key^="details:"]</code>, <code>a[href]</code>, <code>section.oly-bg</code>, <code>section.oly-bg [data-oly-bg-act]</code>, <code>section.oly-bg time[data-since]</code>, <code>section:not(.oly-bg)</code>

Вычисляемые аргументы — <code>':scope&gt;section&gt;div&gt;h3#'+id</code>, <code>'[data-work-entry-id="'+CSS.escape(id)+'"]'</code>.

**26-notifications.js**

<code>[data-slot=sidebar-container],[data-slot=sidebar-gap]</code>, <code>[data-slot=sidebar-content]</code>, <code>[data-slot=sidebar-footer]:not(nav[data-workspace-area=settings-nav] *)</code>, <code>[data-slot=sidebar-footer]:not(nav[data-workspace-area=settings-nav] *)&gt;ul[data-sidebar=menu]</code>, <code>[data-slot=sidebar-trigger]</code>, <code>[data-slot=sidebar-wrapper],[data-slot=sidebar-inset]</code>, <code>[data-slot^=sidebar],.peer,[data-sidebar]</code>, <code>a[href]</code>, <code>button</code>, <code>input[type=search][role=combobox]</code>, <code>li[data-slot=sidebar-menu-item]</code>, <code>nav[data-workspace-area=settings-nav],[data-slot=composer-host],.oly-notify-menu</code>

**28-model-account.js**

<code>#oly-model-account-style</code>, <code>.oly-acct</code>, <code>.oly-acct-mail</code>, <code>.oly-acct-plan</code>, <code>[data-model-picker-content]</code>, <code>[data-model-picker-provider]</code>, <code>[data-model-picker-sidebar]</code>, <code>[data-model-picker-sidebar] [aria-pressed="true"]</code>, <code>input[placeholder]</code>

**30-tasks.js**

<code>.composer-tiptap</code>, <code>.dragging</code>, <code>.oly-tk-add input</code>, <code>.oly-tk-addbtn</code>, <code>.oly-tk-board</code>, <code>.oly-tk-body</code>, <code>.oly-tk-body :is(input,textarea,select):focus</code>, <code>.oly-tk-card</code>, <code>.oly-tk-card [data-openchat]</code>, <code>.oly-tk-card [data-run]</code>, <code>.oly-tk-card:not(.dragging)</code>, <code>.oly-tk-card[aria-selected=true]</code>, <code>.oly-tk-checks input:checked</code>, <code>.oly-tk-dbody</code>, <code>.oly-tk-detail</code>, <code>.oly-tk-detail .sv</code>, <code>.oly-tk-detail [data-f=cnew]</code>, <code>.oly-tk-drop</code>, <code>.oly-tk-err</code>, <code>.oly-tk-head</code>, <code>.oly-tk-launch</code>, <code>.oly-tk-launch .oly-tk-lboard</code>, <code>.oly-tk-launch input[name=oly-tk-lmode]:checked</code>, <code>.oly-tk-ldesc</code>, <code>.oly-tk-list</code>, <code>.oly-tk-list.over</code>, <code>.oly-tk-main</code>, <code>.oly-tk-nav</code>, <code>.oly-tk-opt</code>, <code>.oly-tk-row .oly-tk-rowcount</code>, <code>.oly-tk-title</code>, <code>.sv</code>, <code>:scope &gt; .oly-tk-nav</code>, <code>:scope &gt; .oly-tk-row</code>, <code>[data-act=addnote]</code>, <code>[data-act=addproj]</code>, <code>[data-act=addtitle]</code>, <code>[data-act=autostart]</code>, <code>[data-act=dclose]</code>, <code>[data-act=del]</code>, <code>[data-act=gcancel]</code>, <code>[data-act=gdel]</code>, <code>[data-act=gsave]</code>, <code>[data-act=launch]</code>, <code>[data-act=q]</code>, <code>[data-act=retry]</code>, <code>[data-act=tochat]</code>, <code>[data-chat-composer-form="true"]</code>, <code>[data-chat-composer-main-surface]</code>, <code>[data-ci]</code>, <code>[data-composer-shortcut="composer.workspace"]</code>, <code>[data-crm]</code>, <code>[data-ct]</code>, <code>[data-f=cnew]</code>, <code>[data-f=desc]</code>, <code>[data-f=due]</code>, <code>[data-f=gname]</code>, <code>[data-f=labels]</code>, <code>[data-f=note]</code>, <code>[data-f=priority]</code>, <code>[data-f=project]</code>, <code>[data-f=status]</code>, <code>[data-l=board]</code>, <code>[data-l=boardpath]</code>, <code>[data-l=close]</code>, <code>[data-l=draft]</code>, <code>[data-l=send]</code>, <code>[data-md]</code>, <code>[data-openthread]</code>, <code>[data-quick-status]</code>, <code>[data-reset-filters]</code>, <code>[data-sel]</code>, <code>[data-sidebar-action-for^="folder:"]</code>, <code>[data-sidebar-row]</code>, <code>[data-slot=composer-host]</code>, <code>[data-slot=composer-host] .composer-tiptap</code>, <code>[data-slot=select-value]</code>, <code>[data-slot=sidebar-group] &gt; div</code>, <code>[data-slot=sidebar] input[type=search]</code>, <code>[data-slot=workspace-breadcrumb-text]</code>, <code>[data-tf]</code>, <code>[data-tv]</code>, <code>[role=option]</code>, <code>button</code>, <code>input,textarea,select,[contenteditable=true]</code>, <code>input:not([type=checkbox]),textarea</code>, <code>input[data-f]:not([type=checkbox]),textarea[data-f]</code>, <code>input[name=oly-tk-lmode]</code>, <code>input[name=oly-tk-lwt]</code>, <code>span.truncate</code>

Вычисляемые аргументы — <code>'.oly-tk-card[data-id="'+focusId+'"]'</code>, <code>'.oly-tk-card[data-id="'+id+'"]'</code>, <code>':is(.oly-tk-nav,.oly-tk-head,.oly-tk-body) '+s</code>, <code>'[data-f="'+f+'"]'</code>, <code>'[data-f="'+k+'"]'</code>, <code>s</code>, <code>sel</code>.

**40-files.js**

<code>#oly-files-css</code>, <code>#oly-files-toasts</code>, <code>.oly-ftoast-act</code>, <code>.oly-ftoast-bar i</code>, <code>.oly-ftoast-d</code>, <code>.oly-ftoast-ic</code>, <code>.oly-ftoast-t</code>, <code>.oly-ftoast-x</code>, <code>.oly-icon-local</code>, <code>:scope &gt; .oly-dl-head</code>, <code>:scope &gt; button</code>, <code>:scope &gt; div &gt; [role=menuitem]</code>, <code>:scope &gt; svg</code>, <code>[data-context-menu-chevron], span.ms-auto</code>, <code>[data-context-menu][role=menu][data-level="0"]:not([data-oly-dl])</code>, <code>[data-file-breadcrumbs]</code>, <code>[data-right-panel-tab-list]</code>, <code>[data-surface-subheader]</code>, <code>[data-title]</code>, <code>button</code>, <code>h3</code>, <code>input</code>, <code>input[name="project-files-search"]</code>, <code>li[data-file-crumb]</code>, <code>span</code>, <code>span.truncate</code>

Вычисляемые аргументы — <code>s</code>, <code>sel</code>.

**50-machines.js**

<code>#oly-machines-style</code>, <code>.chat-markdown,[data-user-message-bubble],pre,code,.composer-tiptap,[contenteditable="true"],textarea,input,select,.xterm</code>, <code>.oly-mach-empty</code>, <code>[aria-selected=true]</code>, <code>[class]</code>, <code>[data-composer-command-drawer]</code>, <code>[data-machine-index]</code>, <code>[data-slot=command-item]</code>, <code>button[aria-label]</code>, <code>div</code>, <code>div.grid</code>, <code>p.truncate.text-sm.font-medium</code>, <code>span.truncate.text-xs.text-muted-foreground</code>

Вычисляемые аргументы — <code>'['+OWN+'=edit]'</code>, <code>'['+OWN+'=rename]'</code>, <code>'['+OWN+']'</code>, <code>SKIP</code>.

**55-composer.js**

<code>.chat-markdown,[data-user-message-bubble]</code>, <code>.chat-markdown,[data-user-message-bubble],.oly-search-menu,.oly-prompt-dialog,.xterm</code>, <code>.user-message-markdown</code>, <code>.user-message-markdown p</code>, <code>:not(br,strong,b,em,i,del,s,u,mark,code,kbd,sub,sup)</code>, <code>[data-composer-command-drawer]</code>, <code>[data-composer-drawer-layer]</code>, <code>[data-oly-display]</code>, <code>[data-oly-mode-chip]</code>, <code>[data-oly-mode-source]</code>, <code>[data-slot=composer-host]</code>, <code>[data-testid="composer-editor"],.composer-tiptap</code>, <code>[data-user-message-bubble]</code>, <code>button</code>, <code>button:not([hidden])</code>, <code>code,kbd</code>

**60-studio.js**

<code>.group</code>, <code>.oly-studio-pop</code>, <code>.oly-studio-toast</code>, <code>[data-active-tab]</code>, <code>[data-board]</code>, <code>[data-hub]</code>, <code>[data-new]</code>, <code>[data-oly-skills]</code>, <code>[data-oly-studio-launch]</code>, <code>[data-oly-studio-mi]</code>, <code>[data-oly-studio-overlay]</code>, <code>[data-oly-studio]</code>, <code>[data-right-panel-tab-list]</code>, <code>[data-site]</code>, <code>[data-sites]</code>, <code>[data-slot=composer-host] .composer-tiptap</code>, <code>[data-slot=menu-item]</code>, <code>[data-slot=menu-popup]</code>, <code>[data-slot=sidebar] button[aria-label="Usage"],[data-slot=sidebar] button[aria-label="Расход"]</code>, <code>[data-surface-launcher-keys]</code>, <code>button</code>, <code>button:not(:first-of-type)</code>, <code>button[aria-label="Toggle right panel"],button[aria-label="Показать или скрыть правую панель"]</code>, <code>input</code>, <code>li</code>, <code>svg</code>

**70-openrouter.js**

<code>#oly-openrouter-style</code>, <code>.chat-markdown,[data-user-message-bubble],pre,code,.composer-tiptap,[contenteditable="true"],textarea,input,select,.xterm</code>, <code>.oly-or-chip</code>, <code>.oly-or-chips</code>, <code>.oly-or-count</code>, <code>.oly-or-hint</code>, <code>.oly-or-item</code>, <code>.oly-or-item,.oly-or-list</code>, <code>.oly-or-list</code>, <code>.oly-or-title</code>, <code>:scope &gt; [data-oly-or-logo]</code>, <code>:scope &gt; [data-oly-or-orig]</code>, <code>[data-composer-command-drawer]</code>, <code>[data-composer-command-drawer] [data-slot="command-item"],[data-composer-command-drawer] [data-composer-item-id]</code>, <code>[data-composer-drawer-layer]</code>, <code>[data-oly-or-logo]</code>, <code>[data-oly-or-orig]</code>, <code>[data-testid="composer-editor"]</code>

Вычисляемые аргументы — <code>`#oly-or-opt-${active}`</code>, <code>`[data-provider-accent-color="${ACCENT}" i]`</code>.

**80-integrations.js**

<code>.oly-ik-eye</code>, <code>.oly-ik-panel</code>, <code>.oly-ik-panel,[data-oly-ik-crumb]</code>, <code>[data-oly-ik-act]</code>, <code>[data-oly-ik-crumb]</code>, <code>[data-oly-ik-input]</code>, <code>[data-oly-ik-nav]</code>, <code>[data-oly-ik-nav] [data-slot="sidebar-menu-button"]</code>, <code>[data-slot="sidebar-menu-button"]</code>, <code>[data-slot="sidebar-menu-button"][data-settings-section="/settings/providers"]</code>, <code>[data-slot="sidebar-menu-button"][data-settings-section]</code>, <code>[data-workspace-area="settings"]</code>, <code>[id]</code>, <code>header nav ol</code>, <code>li</code>, <code>span</code>, <code>svg</code>

Вычисляемые аргументы — <code>SECTION_BTN + '[data-active="true"]'</code>, <code>`[data-oly-ik-input="${id}"]`</code>, <code>sel</code>.

**87-ru-fixes.js**

<code>.chat-markdown,[data-user-message-bubble],pre,code,.composer-tiptap,[contenteditable="true"],textarea,input,.xterm</code>, <code>[data-changed-files-header]</code>

**88-rich-text.js**

<code>#oly-rich-text</code>, <code>*</code>, <code>.chat-markdown</code>, <code>.oly-wp-action</code>, <code>.oly-wp-action,.oly-wp-pop,.oly-wp-toast</code>, <code>.oly-wp-pop</code>, <code>.oly-wp-toast</code>, <code>[data-message-role="assistant"]</code>, <code>[data-oly-rich],mark,u</code>, <code>[data-thread-item] [data-sidebar-row][aria-current]:not([aria-current="false"]) .truncate</code>, <code>[data-timeline-row-id],[data-message-id]</code>, <code>[role=status]</code>, <code>[type=button]</code>, <code>[type=submit]</code>, <code>button</code>, <code>button,svg,[aria-hidden="true"],script,style</code>, <code>h1,h2</code>, <code>img</code>, <code>mark</code>, <code>pre,code,[contenteditable="true"],textarea,input</code>, <code>u</code>

**90-mcp-manager.js**

<code>[data-app-modal]</code>, <code>[data-oly-mcp-nav]</code>, <code>[data-oly-mcp-nav] button</code>, <code>[data-settings-section="/settings/providers"]</code>, <code>[data-settings-section]</code>, <code>[data-settings-section][data-active="true"]</code>, <code>button</code>, <code>iframe</code>, <code>li</code>, <code>nav[data-workspace-area=settings-nav]</code>, <code>span</code>, <code>ul</code>

**91-prompts-settings.js**

<code>[aria-label="Поиск в настройках"],[aria-label="Очистить поиск по настройкам"]</code>, <code>[data-app-modal]</code>, <code>[data-oly-mcp-nav]</code>, <code>[data-oly-prompts-nav]</code>, <code>[data-oly-ps-nav-button]</code>, <code>[data-settings-section="/settings/providers"]</code>, <code>[data-settings-section]</code>, <code>[data-settings-section][data-active="true"]</code>, <code>button</code>, <code>button,a,[role=option]</code>, <code>header button:is([aria-label="Закрыть"],[aria-label="Закрыть настройки"],[aria-label="Close settings"],[aria-label="Close"])</code>, <code>li</code>, <code>nav[data-workspace-area="settings-nav"]</code>, <code>span</code>

**92-studio-shell.js**

<code>iframe</code>

**93-chat-panels.js**

<code>#oly-panels-css</code>, <code>.oly-pn-ghost</code>, <code>.oly-pn-toast</code>, <code>:scope &gt; [data-oly-promote]</code>, <code>:scope &gt; [data-oly-tabctl]</code>, <code>[data-a=follow]</code>, <code>[data-a=split]</code>, <code>[data-active-tab]</code>, <code>[data-oly-pm]</code>, <code>[data-right-panel-tab-list]</code>, <code>[data-side-chat-pane]</code>, <code>[data-slot=sidebar]</code>, <code>[data-slot=sidebar] [data-thread-item] &gt; [data-sidebar-row]:not([draggable])</code>, <code>[data-thread-item]</code>, <code>[data-thread-item] &gt; [data-sidebar-row]</code>, <code>[data-workspace-area=panel],[data-oly-zones]</code>, <code>[role=menu][data-context-menu]</code>, <code>[role=menuitem]</code>, <code>[role=menuitem]:not([disabled]):not([aria-disabled=true])</code>, <code>[role=separator]</code>, <code>button, a</code>, <code>button, a, input</code>, <code>main[data-slot=sidebar-inset]</code>, <code>main[data-slot=sidebar-inset] [data-oly-split=on]</code>, <code>main[data-slot=sidebar-inset] [data-right-panel-tabbar]</code>, <code>main[data-slot=sidebar-inset] [data-thread-context-drop]</code>, <code>main[data-slot=sidebar-inset] [data-workspace-area=panel]</code>, <code>script[type=module][src]</code>, <code>span</code>

**extras.js**

<code>.oly-skills-overlay</code>, <code>.tabular-nums</code>, <code>[data-message-id]</code>, <code>[data-oly-skills]</code>, <code>[data-slot=sidebar] button[aria-label="Usage"],[data-slot=sidebar] button[aria-label="Расход"]</code>, <code>[data-workspace-area^=conv]</code>, <code>[data-workspace-area^=conv],[data-slot=sidebar-inner]</code>, <code>button</code>, <code>li</code>, <code>main</code>, <code>svg</code>

</details>
