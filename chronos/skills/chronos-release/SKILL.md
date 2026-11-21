---
name: chronos-release
description: Выпуск релиза Chronos (Zulut30/Chronos) — версия в chronos/version.json, тег версии Chronos, CI-сборка Windows/macOS и GitHub Release с фидами обновлений. Тег и релиз создаются только по явному слову пользователя. Используй, когда просят «выпусти Chronos», «сделай релиз», «новая версия Chronos» или по /chronos-release.
---

# Релиз Chronos

Репозиторий `~/Documents/Chronos` (Windows: `%USERPROFILE%\Documents\Chronos`), origin = Zulut30/Chronos (публичный).
Схема версий и обновлений — `chronos/README.md` («Версии», «Обновления»).

## Правила
- Тег и релиз — **только после явного «выпускай/создай тег» пользователя в этом разговоре**.
  До этого можно всё подготовить и показать.
- Релиз собирается только из `main`. Force-push, перезапись и удаление тегов/релизов — только по
  отдельной явной просьбе.
- Никаких секретов: подпись не используется, все значения в workflow публичные.

## 1. Подготовка
```bash
cd ~/Documents/Chronos
git switch main && git pull --ff-only origin main && git status --short
node chronos/scripts/chronos-version.mjs
git tag -l 'chronos-v*' && gh release list --repo Zulut30/Chronos --limit 5
```
- Если тег из `chronos-version.mjs` уже выпущен — увеличь `revision` в `chronos/version.json`
  (после синхронизации с апстримом `revision` = 1, `upstream` уже обновлён).
- Коммит `Chronos <версия>` в `main`, push — после согласия пользователя на релиз.
- Для публикации нужны успешные **Chronos checks** и ручная **Chronos desktop** на точном SHA из `main`. Тег публикует проверенные артефакты этого прогона. Запуск сборки:
  `gh workflow run chronos-desktop.yml --repo Zulut30/Chronos --ref main`.

Покажи пользователю: версию, базу апстрима, что вошло с прошлого релиза
(`git log --oneline <прошлый тег>..main`), ссылку на зелёный прогон. Спроси разрешение.

## 2. Тег (по слову пользователя)
```bash
tag=$(node chronos/scripts/chronos-version.mjs | node -p 'JSON.parse(require("fs").readFileSync(0)).tag')
git tag -a "$tag" -m "Chronos ${tag#chronos-v}"
git push origin "$tag"
```
Пуш тега запускает `chronos-desktop.yml`: version → bundle → desktop (win x64, mac arm64, mac x64)
→ release. Тег, не совпадающий с `chronos/version.json`, роняет сборку на первом шаге.

## 3. CI и публикация
```bash
gh run list --repo Zulut30/Chronos --workflow chronos-desktop.yml --limit 1
gh run watch <id> --repo Zulut30/Chronos --exit-status
gh release view "$tag" --repo Zulut30/Chronos
```
Job `release` публикует обычный (не pre-release) релиз с `--latest`: установщики, `*.blockmap`,
`nightly.yml` (Windows) и `nightly-mac.yml` (macOS arm64+x64). Именно `releases/latest/download`
читает updater — pre-release или черновик обновления не получат.

При временном сбое скачивания или публикации проверь статус релиза и повтори упавший job. Если требуется исправление исходников, увеличь `revision`, создай новый тег (старый тег
удалять только с согласия пользователя).

## 4. Отчёт
Версия, ссылка на релиз и прогон, статус платформ, что проверить пользователю: установка на
Windows (SmartScreen → «Подробнее» → «Выполнить в любом случае»), на macOS (ПКМ → «Открыть»),
что прежняя версия Chronos видит обновление (Windows — ставит сама, macOS — открывает страницу релиза).
