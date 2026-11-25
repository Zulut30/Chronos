---
name: chronos-release
description: "Выпуск версии и проверка фида Chronos. Prepare a release, tag a verified main commit or check the latest update assets."
---

# Релиз Chronos

Для тега и публикации нужна просьба пользователя о выпуске или постоянное разрешение на ежедневную синхронизацию T3 после всех проверок. Для запроса только на подготовку передай версию, SHA, проверки и список изменений. Для проверки уже выпущенного релиза переходи сразу к последнему разделу.

## Версия и проверенный коммит

Из своего checkout выполни в Bash:

```bash
set -euo pipefail
git fetch origin refs/heads/main:refs/remotes/origin/main
sha=$(git rev-parse 'origin/main^{commit}')
tag=$(git show "$sha:chronos/version.json" | node -e '
  const { upstream, revision } = JSON.parse(require("node:fs").readFileSync(0, "utf8"));
  console.log(`chronos-v${upstream}.chronos.${revision}`);
')
gh release list -R Zulut30/Chronos --limit 5
git ls-remote --tags --refs origin "refs/tags/$tag"
```

Сверь `upstreamCommit` в [version.json](../../version.json) с коммитом nightly. В рабочей ветке кандидата командой `node chronos/scripts/chronos-version.mjs` проверь формат и вычисленную версию до слияния. Новая ревизия получает свой SHA и проверки. Если тег уже существует, сверь его коммит и статус публикации. Для новой версии нужен свободный тег.

Проверь Chronos checks, паритет перевода, успешный ручной Chronos desktop на точном SHA main (включая CLI и все платформы), строгий smoke его Windows-артефакта и результат perf для того же SHA. Используй пару предыдущего main и кандидата, проверенную **до слияния**. Для fast-forward SHA сохраняется. Если появился другой коммит слияния, его тоже нужно проверить до продвижения main. Контрольное сравнение main с собой после слияния не измеряет внесённое изменение. Список изменений даёт `git log --oneline <предыдущий-тег>.."$sha"`. Команды Actions и сверка артефактов — в [chronos-ci](../chronos-ci/SKILL.md).

## Публикация

При разрешённом выпуске продолжи в том же Bash. Перед отправкой снова сверь SHA удалённого main. Смена SHA возвращает к проверкам.

```bash
test "$sha" = "$(gh api repos/Zulut30/Chronos/commits/main --jq .sha)"
git tag -a "$tag" "$sha" -m "Chronos ${tag#chronos-v}"
git push origin "refs/tags/$tag"
gh run list -R Zulut30/Chronos --workflow chronos-desktop.yml --branch "$tag" --event push --commit "$sha"
gh run watch <id> -R Zulut30/Chronos --exit-status
```

Тег запускает `version` и `release` в [desktop workflow](../../../.github/workflows/chronos-desktop.yml). Job проверяет версию и текущий main, находит успешные проверки и ручную desktop-сборку этого SHA, проверяет манифесты и публикует релиз с `--latest`. При временном сбое проверь, успел ли появиться релиз и все его assets. При исправлении исходников собери и проверь новую ревизию. Удаление, замена тега или перезапись опубликованного релиза требуют отдельного согласия.

## Проверка публикации и фида

```bash
gh release view "$tag" -R Zulut30/Chronos --json tagName,isDraft,isPrerelease,url,assets
gh api repos/Zulut30/Chronos/releases/latest --jq .tag_name
```

Для проверки latest без заданного тега сначала получи его второй командой. Сверь тег, статус, `nightly.yml`, `nightly-mac.yml`, установщики, архивы CLI и `SHA256SUMS`. Для проверки самого фида скачай оба файла в новый пустой каталог командой `gh release download "$tag" -R Zulut30/Chronos -p 'nightly*.yml' -D <каталог>`. Поле `version` должно совпасть с версией без `chronos-v`, а имена в `files[].url` после URL-декодирования должны присутствовать в assets. В отчёт включи SHA, версию, ссылку на run и релиз, результат проверки фидов.
