@AGENTS.md

<!-- chronos: begin fork instructions -->

В форке Zulut30/Chronos сначала прочитай [chronos-router](chronos/skills/chronos-router/SKILL.md) из текущего checkout. Выбери профиль по запрошенному результату. Для задач на изменение Chronos постоянно разрешён полный цикл без дополнительных вопросов: сессии-исполнители → проверка → слияние в `main` → push → тег и релиз `chronos-v*`. Явное ограничение задачи (только отчёт, план или ветка) определяет, на каком шаге остановиться.

До продвижения `main` нужны зелёные **Chronos checks**, полный ручной `chronos-desktop` на точном SHA кандидата, `chronos-smoke` 14/14 по его `desktop_run_id` с `require_services=true` и `require_provider=true` и `chronos-perf.yml` для пары прежний main / кандидат. Пока шлюза нет в `main`, используй workflow из `perf/guard`. Без зелёного результата для этой пары слияние и выпуск ждут.

Всегда нужно явное согласие пользователя на запись в устройства и прошивку, установку или любые изменения на gildra и debian-151, изменения установленного T3/Olympus и `~/.t3`, удаление данных пользователя, платные прогоны API, force-push и удаление тегов или релизов. Остальные правила импортированы из AGENTS.md.
<!-- chronos: end fork instructions -->
