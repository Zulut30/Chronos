---
name: chronos-upstream-adopt
description: "Перенос отдельной функции T3 и разбор пересечений с Olympus. Use to adopt an upstream feature or resolve competing routes, hotkeys, providers or terminology."
---

# Встраивание новых функций T3 рядом с Olympus

Цель — принять полезные новинки T3 Code так, чтобы они естественно работали в Chronos, не затирали модули и горячие клавиши Olympus и говорили на русском языке глоссария Olympus.
Карта интеграций — в [описании форка](../../README.md), привязки модулей — в [описи 5209](../../parity/upstream-5209.md).

## 1. Инвентаризация новинки T3

По `git diff --stat <old>..<new>` и `git show` зафиксируй, какие поверхности затрагивает функция:
- **Страницы и маршруты:** `apps/web/src/routes/`, сайдбар (`SidebarChrome.tsx`), правая панель (`RightPanelTabs.tsx`).
- **Настройки:** `apps/web/src/components/settings/` (`SettingsSidebarNav`, `settingsSearch.ts`).
- **Клавиши и триггеры ввода:** `apps/web/src/composer-logic.ts`, `keybindings`, командная палитра.
- **Провайдеры и контракты:** `packages/contracts/src/usage.ts`, `apps/server/src/provider/`, `ProviderModelPicker.tsx`, `apps/{web,mobile}/.../usageProviders.ts`.
- **Строки интерфейса:** новые ключи в `apps/web/src/i18n/translations/{en,ru}.json` и обычные JS-литералы.
- **Заголовки / схемы / БД:** `RemoteRequestHeaders.ts`, `DesktopClerk.ts`, `apps/server/src/persistence/Migrations/`.

## 2. Поиск пересечений с модулями Olympus

Проверь новинку по всем точкам соприкосновения:

- [ ] **Сайдбар и шапка:** не перекрывает ли кнопки Olympus — «Задачи» (`30-tasks.js`, `[data-oly-tasks]`), «Студия» (`60-studio.js`), «Скиллы» (`extras.js`), «День / ночь» (`dayNightButton.tsx`) и знак Chronos (`ChronosSidebarMark.tsx`).
- [ ] **Настройки:** пункты Olympus (`80-integrations.js`, `90-mcp-manager.js`, `91-prompts-settings.js`) встраиваются в `nav[data-workspace-area=settings-nav]` возле `[data-settings-section="/settings/providers"]` и опираются на русские `aria-label` («Поиск в настройках», «Закрыть настройки»). Проверь, что новая секция не ломает инъекцию и поиск.
- [ ] **Композер и горячие клавиши:** триггер `#` занят доской задач Olympus (`30-tasks.js`), `!`/`$`/чипы `oly-` — модулями `50-machines.js` / `55-composer.js` / `70-openrouter.js`, кнопка режима ответа — `10-plan-mode.js` (рядом с `composer.effort`). Убедись, что новый триггер/шорткат T3 не перехватывает их.
- [ ] **Отправка и режимы:** если T3 добавил новый путь отправки (пример 5209: мультимодельный fan-out в `useComposerSend.ts`), проверь прохождение `__olyWrapModeText` и `__olySendPlan` (кроме служебного `/compact`).
- [ ] **Правая панель и карточка треда:** проверь совместимость с `93-chat-panels.js` (`PanelHost.tsx`, `panelSurfaces.ts`, `shims/rightPanelStore.ts`), `40-files.js`, `24-thread-details.js`, `25-bg-tasks.js`, `17-servers.js`.
- [ ] **Внешняя тема Olympus (`userdata/themes/`):** новые теги/классы в старых блоках не должны ломать CSS-селекторы темы (пример 5209: ссылки `<a>` вместо `<div>` в лимитах потребовали адаптации в `apps/web/src/themeCss.ts`).
- [ ] **Провайдеры и статистика:** новый провайдер → проверь `UsageProviderKind` во всех потребителях (`apps/web/src/components/usage/usageProviders.ts`, `apps/mobile/src/features/usage/usageProviders.ts`), учёт OpenRouter (`UsageService.ts`), выгрузку простоя Claude (`chronos/parity/perf-idle-unload.md`) и показ аккаунта в `28-model-account.js`.

## 3. Приоритет: Olympus vs апстрим T3

| Ситуация | Решение | Пример из опыта 5209 |
| --- | --- | --- |
| **Апстрим полностью покрыл патч форка** | Взять апстрим, удалить лишний модуль/патч Chronos, сохранить лишь узкие поля, нужные UI Olympus. Отметить в `chronos/parity/`. | `AntigravityChildWork.ts`, `AntigravityProtocol.ts`, CLI sign-in в `antigravityUsageLimits.ts` (оставлен только `olyAccountEmail` для модуля 28). |
| **Пересечение по клавише, слоту или термину, но разная суть** | **Оставить приоритет за Olympus** в привычном месте, а новинку T3 развести по отдельному названию/точке входа с минимальной правкой `// chronos:`. | `#` в композере оставлен за доской задач Olympus (`composer-logic.ts`); новая страница T3 `Issues` переведена как «Задачи трекеров», чтобы не путать с доской «Задачи» Olympus. |
| **Независимая новая фича T3** | Принять целиком, подключить существующие обёртки Olympus (режимы отправки, перевод, тема). | Мультимодельный запуск, история воркфлоу, связанные окружения, встроенные трекеры (куда Chronos добавил Trello — `chronos/parity/trello-tracker.md`). |
| **Жёсткий конфликт UX (нужно убрать или переделать привычное поведение)** | Не решать молча — остановиться и предложить пользователю 2 варианта с рекомендацией. | — |

## 4. Новые строки

Пройди [chronos-l10n](../chronos-l10n/SKILL.md) для новых GT-ключей, JS-литералов и склеенных подписей. Отдельно проверь, что перевод `aria-label` сохранил привязку Olympus и пользователь различает штатную функцию и одноимённую функцию форка.

## 5. Проверка в окне и фиксация

1. Открой собранный Chronos в **изолированном профиле** (`CHRONOS_HOME`, не `~/.t3`!) и пройди сценарий новой функции в светлой и тёмной теме Olympus, а также на узкой ширине (`chronos-ui`).
2. Проверь соседние функции Olympus (композер `#/@/!/$`, настройки API/MCP/шаблонов, правая панель, карточка треда, статистика).
3. Прогони `chronos-parity-check` (`smoke.mjs --strict-en` и `compare.py` с wording): 0 новых неожиданных EN, 0 сломанных русских формулировок Olympus. При необходимости добавь проверку нового критичного экрана или допуска в `chronos/scripts/smoke/checks.json` с явным обоснованием.
4. Обнови таблицу точек встраивания в `chronos/README.md` и зафиксируй решения в `chronos/parity/upstream-<build>.md` (или `chronos/parity/<фича>.md`).

## 6. Отчёт

Перечисли:
- какие новинки T3 разобраны;
- найденные пересечения с модулями Olympus и принятое решение по каждой (взяли апстрим / развели / адаптировали / ждёт решения);
- список добавленных переводов (`gt-additions.json`, `catalog.ts`);
- результат проверки в живом окне и `chronos-parity-check`.
