# Уведомления об авторстве и товарных знаках

Chronos — неофициальный независимый форк на базе исходного кода [pingdotgg/t3code](https://github.com/pingdotgg/t3code). Авторские права на исходный код T3 Code © 2026 T3 Tools Inc. Код распространяется по [лицензии MIT](LICENSE).

В форк перенесена Olympus, личная сборка автора. Изменения охватывают русский перевод и оформление, инструменты чатов, задач и студии, работу с провайдерами и статистику. У Chronos собственные идентификатор приложения, профиль, установщики и канал обновлений.

Chronos не связан с T3 Tools, Inc., не одобрен и не поддерживается компанией. Вопросы, сообщения об ошибках и предложения по форку направляйте в [Issues Chronos](https://github.com/Zulut30/Chronos/issues).

## Товарные знаки

«T3 Code», «T3 Connect», «T3 Tools», логотипы и иконки T3 являются товарными знаками T3 Tools, Inc. Лицензия MIT распространяется на код и не предоставляет прав на использование этих знаков. Названия упомянуты для указания происхождения кода и описания совместимости.

Claude, Codex, Cursor, OpenRouter, Excalidraw, WordPress и другие названия сторонних продуктов — товарные знаки соответствующих владельцев и используются в описательных целях.

## Сторонние зависимости

Для каждой зависимости действует её собственная лицензия. Имена пакетов приведены в [package.json](package.json), точные версии — в [pnpm-lock.yaml](pnpm-lock.yaml). Текст лицензии конкретной версии см. в самом пакете или его исходном репозитории.

## Управление ПК

В комплект входят нативные инструменты [agent-desktop 1.3.1](https://github.com/vercel-labs/agent-desktop/tree/v1.3.1) и [agent-browser 0.44.0](https://github.com/vercel-labs/agent-browser/tree/v0.44.0) от Vercel Labs, оба под Apache License 2.0. Полные тексты лицензий поставляются рядом с программами в `resources/chronos-pc`. Chromium поставляется отдельно.

## Студия Excalidraw и менеджер MCP

Редактор досок включает Excalidraw 0.18.1 (© 2020 Excalidraw, MIT), React и React DOM 19.1.0 (MIT),
Mermaid, Rough.js и библиотеки интерфейса, экспорта и геометрии из дистрибутива редактора.
С ним поставляются шрифты Assistant, Cascadia, Comic Shanns, Excalifont, Liberation Sans, Lilita,
Nunito, Virgil и Xiaolai. Уведомления авторов, лицензии и ссылки на исходники собраны в
[THIRD-PARTY-NOTICES.txt](chronos/services/studio-service/THIRD-PARTY-NOTICES.txt).
WordPress Playground, его PHP-мост и CLI в поставку Chronos не входят.

Для редактирования конфигураций Codex менеджер MCP включает smol-toml 1.9.1
(© Squirrel Chat et al., [BSD-3-Clause](chronos/services/mcp-manager/vendor/LICENSE)).
