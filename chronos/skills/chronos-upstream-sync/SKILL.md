---
name: chronos-upstream-sync
description: Вливает новые изменения официального T3 Code (pingdotgg/t3code) в форк Chronos (Zulut30/Chronos) вручную и безопасно — сводка новых коммитов апстрима, ветка синхронизации, слияние, разрешение конфликтов, CI, отчёт. В main ничего не вливается без явного решения пользователя. Используй, когда просят «обнови Chronos до T3», «синхронизируй с апстримом», «что нового в T3» или по /chronos-upstream-sync.
---

# Синхронизация Chronos с апстримом T3

Репозиторий: `~/Documents/Chronos` (Windows: `%USERPROFILE%\Documents\Chronos`; `origin` = `Zulut30/Chronos`,
публичный; `upstream` = `pingdotgg/t3code`). Устройство форка — `chronos/README.md` и отчёты
`chronos/parity/`; прочитай таблицу точек встраивания перед работой.

## Жёсткие правила
- В `main` **ничего не вливать и не пушить** без явного «вливай» от пользователя в этом разговоре.
  Force-push в `main` запрещён всегда.
- Теги и релизы не создавать (это `chronos-release`).
- Не трогать установленный T3/Chronos, `resources\server.asar`, службы; не перезапускать приложение.
- Репозиторий публичный: никаких секретов и личных данных в коммитах и отчётах.

## 1. Разведка (ничего не меняет)
```bash
cd ~/Documents/Chronos
git status --short            # рабочее дерево должно быть чистым, иначе спросить
git fetch origin && git fetch upstream main
# последний nightly-тег апстрима (Chronos базируется только на nightly-тегах):
git ls-remote --tags upstream 'v*-nightly.*' | grep -v '\^{}' | sed 's#.*refs/tags/##' | sort -V | tail -3
node chronos/scripts/chronos-version.mjs     # текущая база: поле upstream
```
Целевая база — самый новый nightly-тег `vX-nightly.YYYYMMDD.N` (или тот, что назвал пользователь).
Получи его коммит командой `git fetch --no-tags upstream refs/tags/<tag>` и запиши SHA из
`git rev-parse "FETCH_HEAD^{commit}"` (`<target-sha>`). Старую базу возьми из `upstreamCommit` в
`chronos/version.json`. Выполни `node chronos/scripts/upstream-plan.mjs nightly <target-sha>`.

Сводка для пользователя (`git log --oneline --no-merges <upstreamCommit>..<target-sha>` и
`git diff --stat` по тем же точкам):
- что меняется — сгруппируй по темам (desktop, server, web, mobile, CI, обновления, темы);
- риски: миграции БД, смена appId/userData/протокола/релея/Clerk, updater, сборка
  (`scripts/build-desktop-artifact.ts`), перенос `resolveDesktopSshCliRunner` (в 4774 в `main.ts`,
  в 4838+ в `DesktopSshEnvironment.ts`), несовместимость точек подключения модулей Olympus и
  словаря перевода;
- затронутые точки встраивания Chronos: пересечение изменённых файлов с `git grep -l "chronos:"`
  и отчётами в `chronos/parity/`.

## 2. Ветка и слияние
```bash
git switch -c upstream-sync/<дата> <рабочая-ветка-Chronos>
git merge --no-ff <target-sha> -m "Merge upstream T3 <tag> into Chronos"
```
Конфликты:
- `.github/workflows/*` (кроме `chronos-*.yml`): апстримные workflow удалены — оставляй удаление
  (`git rm`), новые апстримные workflow тоже удаляй.
- Файлы с пометкой `chronos:` — бери версию апстрима и заново накладывай правку Chronos по смыслу
  (см. `chronos/README.md` и `chronos/parity/`). Если функция апстрима переехала (например,
  `resolveDesktopSshCliRunner` из `main.ts` в `DesktopSshEnvironment.ts`), перенеси правку туда же
  и обнови документацию.
- `pnpm-lock.yaml` — бери апстримную версию (если Chronos не добавлял зависимостей).
- Проверь, что апстрим не сломал: отдельный `appId` `io.github.zulut30.chronos`, профиль `Chronos`,
  callback `chronos://`, внутренний origin `t3code://app`, `.env.example` (Clerk/relay), регулярки
  версий nightly (`git grep -n "nightly|preview"`). Если поменял — остановись и опиши пользователю.

После слияния:
1. В `chronos/version.json` поставь `upstream` = новая версия, `upstreamCommit` = полный SHA
   коммита nightly-тега, `revision` = 1. Проверь `node chronos/scripts/upstream-plan.mjs surface`.
2. `git grep -n "chronos:"` — все точки на месте; `node chronos/scripts/chronos-version.mjs` — ок.
3. Коммит, `git push -u origin upstream-sync/<дата>` (пуш новой ветки разрешён).

## 3. CI на ветке
```bash
gh workflow run chronos-desktop.yml --repo Zulut30/Chronos --ref upstream-sync/<дата>
gh workflow run chronos-checks.yml --repo Zulut30/Chronos --ref upstream-sync/<дата>
gh run list --repo Zulut30/Chronos --workflow chronos-desktop.yml --limit 1
gh run watch <id> --repo Zulut30/Chronos --exit-status
```
Также проверь `chronos-parity.yml` (если присутствует на ветке). Падения разбирай по логам
(`gh run view <id> --log-failed | tail -100`), чини в той же ветке. Цель: зелёные проверки и
сборки Windows x64 и macOS arm64 (macOS x64 желательно).

## 4. Отчёт пользователю
- база была → стала (теги, число коммитов), главное из сводки и риски;
- как разрешены конфликты, какие точки встраивания и модули Olympus затронуты;
- ссылки на прогоны CI и статус по платформам;
- ветка `upstream-sync/<дата>` и результат проверок.

Для слияния или push в `main` требуется явное решение пользователя. Релиз проходит отдельно через
`chronos-release`.
