---
name: chronos-release
description: Выпуск релиза Chronos (Zulut30/Chronos) — версия в chronos/version.json, тег chronos-v*, CI-сборка Windows/macOS и GitHub Release с фидами обновлений. Тег и релиз создаются только по явному слову пользователя. Используй, когда просят «выпусти Chronos», «сделай релиз», «новая версия Chronos» или по /chronos-release.
---

# Релиз Chronos

Репозиторий `~/Documents/Chronos` (Windows: `%USERPROFILE%\Documents\Chronos`), `origin` = `Zulut30/Chronos` (публичный).
Схема версий и обновлений — `chronos/README.md` («Версии», «Обновления»).

## Правила
- Тег и релиз — **только после явного «выпускай/создай тег» пользователя в этом разговоре**.
  До этого можно всё подготовить и показать.
- Релиз публикуется только из `main` (после слияния проверенной ветки, например `parity/olympus`).
  Force-push, перезапись и удаление тегов/релизов — только по отдельной явной просьбе.
- Никаких секретов: подпись не используется, все значения в workflow публичные.

## 1. Подготовка
```bash
cd ~/Documents/Chronos
git switch main && git pull --ff-only origin main && git status --short
node chronos/scripts/chronos-version.mjs
git tag -l 'chronos-v*' && gh release list --repo Zulut30/Chronos --limit 5
```
- Убедись, что `upstream`, `upstreamCommit` и `revision` в `chronos/version.json` актуальны
  (для паритета на базе 4774 — `upstream: "0.1.10-nightly.20261116.4774"`,
  `upstreamCommit: "16695c812fffe75e85f8cc3084d2c561aa3ca93f"`). Если тег уже выпущен, увеличь
  `revision`.
- Коммит `Chronos <версия>` в `main`, push — после согласия пользователя.
- Для публикации нужны успешные **Chronos checks** (`chronos-checks.yml`) и ручная
  **Chronos desktop** (`chronos-desktop.yml`, `event=workflow_dispatch`) на точном SHA `main`
  (а также зелёный `chronos-parity.yml`, если он активен). Запуск сборки:
  `gh workflow run chronos-desktop.yml --repo Zulut30/Chronos --ref main`.

Покажи пользователю: версию, базу апстрима, что вошло с прошлого релиза
(`git log --oneline <прошлый тег>..main`), ссылку на зелёный прогон. Спроси разрешение.

## 2. Тег (по слову пользователя)
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
gh run list --repo Zulut30/Chronos --workflow chronos-desktop.yml --limit 1
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
