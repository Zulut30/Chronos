---
name: chronos-release
description: "Выпуск версии и проверка фида Chronos. Prepare a release, tag a verified main commit or check the latest update assets."
---

# Релиз Chronos

Полный цикл разработки включает слияние проверенного кандидата в `main`, push, тег и релиз `chronos-v*` без дополнительного вопроса. Ограничение «только подготовь» означает передать версию, SHA, проверки и список изменений. Для проверки уже выпущенного релиза переходи к последнему разделу.

Откат опубликованной версии делай новой ревизией с возвратом нужных изменений: подготовь кандидат и проведи его через те же барьеры. На force-push, замену или удаление тега, удаление или перезапись релиза всегда нужно явное согласие пользователя на конкретное действие. Полный список исключений — в [chronos-router](../chronos-router/SKILL.md).

## Версия и проверенный коммит

В чистом checkout кандидата сверь `upstreamCommit` в [version.json](../../version.json) с коммитом nightly. Запиши базу, SHA и тег до проверок:

```bash
set -euo pipefail
git fetch origin refs/heads/main:refs/remotes/origin/main
base=$(git rev-parse 'origin/main^{commit}')
sha=$(git rev-parse 'HEAD^{commit}')
tag=$(node chronos/scripts/chronos-version.mjs | node -p 'JSON.parse(require("node:fs").readFileSync(0, "utf8")).tag')
gh release list -R Zulut30/Chronos --limit 5
git ls-remote --tags origin "refs/tags/$tag" "refs/tags/$tag^{}"
```

У аннотированного тега строка с `^{}` указывает на коммит. Если версия уже занята другим SHA, подними `revision` в ветке и заново определи SHA и тег до проверок. Если тег указывает на нужный SHA, проверь существующую публикацию или продолжи её workflow с места сбоя.

До продвижения main проверь Chronos checks, паритет перевода, полный ручной `chronos-desktop` на точном SHA кандидата и `chronos-smoke` 14/14 по его Windows-артефакту (`desktop_run_id`, `require_services=true`, `require_provider=true`). Для `chronos-perf.yml` требуется зелёная пара прежний main / кандидат в `pair.json`. Пока шлюза нет в main, используй ref `perf/guard`. Отсутствующий результат блокирует слияние и выпуск. Перед обычным fast-forward push сверь текущий SHA удалённого main с `$base`. При выпуске уже проверенного main возьми прежнюю базу из отчёта об интеграции. Если база сдвинулась или нужен отдельный merge-коммит, сначала проверь новый кандидат в интеграционной ветке. Список изменений даёт `git log --oneline <предыдущий-тег>.."$sha"`. Команды Actions и сверка артефактов — в [chronos-ci](../chronos-ci/SKILL.md).

## Публикация

Для нового тега продолжи в том же Bash. Workflow публикации выбирает последний успешный ручной desktop run этого SHA. Перед отправкой сверь его ID с проверенным smoke: если появился другой run, проведи строгий smoke по его артефакту. Повторно сверь SHA удалённого main.

```bash
test "$sha" = "$(gh api repos/Zulut30/Chronos/commits/main --jq .sha)"
test "${desktop_run_id:?ID полного desktop, прошедшего строгий smoke}" = "$(gh api "repos/Zulut30/Chronos/actions/workflows/chronos-desktop.yml/runs?head_sha=$sha&event=workflow_dispatch&status=success" --jq '.workflow_runs[0].id')"
git tag -a "$tag" "$sha" -m "Chronos ${tag#chronos-v}"
git push origin "refs/tags/$tag"
gh run list -R Zulut30/Chronos --workflow chronos-desktop.yml --branch "$tag" --event push --commit "$sha"
gh run watch <id> -R Zulut30/Chronos --interval 60 --exit-status
```

Тег запускает `version` и `release` в [desktop workflow](../../../.github/workflows/chronos-desktop.yml). Job проверяет версию и текущий main, находит успешные проверки и ручную desktop-сборку этого SHA, проверяет манифесты и публикует релиз с `--latest`. При временном сбое проверь, успел ли появиться релиз и все его assets. При исправлении исходников собери и проверь новую ревизию. Удаление, замена тега или перезапись опубликованного релиза требуют отдельного согласия.

## Проверка публикации и фида

```bash
gh release view "$tag" -R Zulut30/Chronos --json tagName,isDraft,isPrerelease,url,assets
gh api repos/Zulut30/Chronos/releases/latest --jq .tag_name
```

Для проверки latest без заданного тега сначала получи его второй командой. Сверь тег, статус, `nightly.yml`, `nightly-mac.yml`, установщики, архивы CLI и `SHA256SUMS`. Для проверки самого фида скачай оба файла в новый пустой каталог командой `gh release download "$tag" -R Zulut30/Chronos -p 'nightly*.yml' -D <каталог>`. Поле `version` должно совпасть с версией без `chronos-v`, а имена в `files[].url` после URL-декодирования должны присутствовать в assets. В отчёт включи SHA, версию, ссылку на run и релиз, результат проверки фидов.
