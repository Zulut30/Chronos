@AGENTS.md

<!-- chronos: begin fork instructions -->
## Chronos: перед любой работой возьми `chronos-router`

Открой [chronos-router](chronos/skills/chronos-router/SKILL.md) из текущей ветки. Подробные правила импортированы из AGENTS.md.

- Береги ресурсы слабого ПК и SSH-хостов. Функции включаются по запросу или загружаются лениво.
- Сохраняй байты Olympus, минимальные стыки `// chronos:` и глоссарий.
- Зависимости, сборка и полный typecheck выполняются в CI. Живая проверка — Chronos на 9333 или песочница.
- Оставляй T3/Olympus, `~/.t3`, 4517–4524 и чужие процессы в покое. На gildra и debian-151 по умолчанию только чтение. Секреты запрашивай через `request_secret`.
- У каждого исполнителя свои ветка и worktree, `codex` / `gpt-6.2-astra` с `xhigh` и ожиданием CI в шелле.
- Перед main нужны зелёные checks, desktop, строгий smoke 14/14 и perf. Постоянное разрешение на слияние и релиз действует только для ежедневной синхронизации T3 по `chronos-upstream-sync` и `chronos-release`.
<!-- chronos: end fork instructions -->
