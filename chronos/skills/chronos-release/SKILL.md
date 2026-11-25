---
name: chronos-release
description: "Выпуск версии, тега и обновлений Chronos. Use for release preparation, verified main artifacts, chronos-v tags, publication and update feeds."
---

# Релиз Chronos

Репозиторий `~/Documents/Chronos` (Windows: `%USERPROFILE%\Documents\Chronos`), `origin` = `Zulut30/Chronos` (публичный).
Схема версий и обновлений — `chronos/README.md` («Версии», «Обновления»).

## Правила
- Основание для тега и релиза — явная просьба пользователя либо постоянное разрешение на ежедневную синхронизацию по [chronos-upstream-sync](../chronos-upstream-sync/SKILL.md) после всех зелёных проверок. Задание только на ветку, отчёт или подготовку этим разрешением не расширяется.
- Релиз публикуется только из `main` (после слияния проверенной ветки `feature/*` или `upstream-sync/*`).
  Force-push, перезапись и удаление тегов/релизов — только по отдельной явной просьбе.
- Никаких секретов: подпись не используется, все значения в workflow публичные.

## 1. Подготовка
```bash
cd ~/Documents/Chronos
git switch main && git pull --ff-only origin main && git status --short
node chronos/scripts/chronos-version.mjs
git tag -l 'chronos-v*' && gh release list --repo Zulut30/Chronos --limit 5
```
- Сверь `upstream`, `upstreamCommit` и свободную `revision` с целевой nightly и предыдущим релизом. Версию готовь в проверяемом кандидате. Изменение `revision` создаёт новый SHA для проверок.
- На точном SHA main проверь Chronos checks, chronos-parity, ручной chronos-desktop (все платформы), smoke 14/14 с обоими строгими входами и chronos-perf.yml по [chronos-ci](../chronos-ci/SKILL.md). Сверь ссылки на прогоны и версию до создания тега.
- Составь список изменений `git log --oneline <прошлый тег>..main`. При действующем разрешении продолжай до результата. Когда запрошена только подготовка, передай версию, SHA и ссылки.

## 2. Тег на проверенном SHA

```bash
tag=$(node chronos/scripts/chronos-version.mjs | node -p 'JSON.parse(require("fs").readFileSync(0)).tag')
git tag -a "$tag" -m "Chronos ${tag#chronos-v}"
git push origin "$tag"
```
Пуш тега `chronos-v*` запускает `chronos-desktop.yml`: `version` → `release`. Тег, не совпадающий с
`chronos/version.json`, роняет сборку на первом шаге; при отсутствии проверенного `workflow_dispatch`
на точном SHA `main` job `release` остановится до публикации.

## 3. CI и публикация
```bash
gh run list --repo Zulut30/Chronos --workflow chronos-desktop.yml --branch "$tag" --event push --commit "$(git rev-parse HEAD)"
gh run watch <id> --repo Zulut30/Chronos --exit-status
gh release view "$tag" --repo Zulut30/Chronos
```
Job `release` сверяет артефакты через `chronos/scripts/verify-release.mjs` и публикует обычный
(не pre-release) релиз с `--latest`: установщики (`Chronos-${VERSION}-*` и постоянные имена
`Chronos-Setup-x64.exe`, `Chronos-mac-arm64.dmg`, `Chronos-mac-x64.dmg`), `SHA256SUMS`,
`*.blockmap`, `nightly.yml` и `nightly-mac.yml`.

При временном сбое скачивания или публикации проверь статус релиза и повтори упавший job. Если
требуется исправление исходников, увеличь `revision` и создай новый тег (старый тег удалять только
с согласия пользователя).

## 4. Отчёт
Версия, ссылка на релиз и прогон, статус платформ, что проверить пользователю: установка на
Windows (SmartScreen → «Подробнее» → «Выполнить в любом случае»), на macOS (ПКМ → «Открыть»),
запуск рядом с T3 (`%APPDATA%\Chronos`, `~/.chronos/userdata`) и проверка автообновления.
