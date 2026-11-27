### Точечный перенос коммита T3

Если в свежем клоне есть только `origin`, добавь апстрим:
`git remote add upstream https://github.com/pingdotgg/t3code.git`.

```sh
git fetch --no-tags upstream main
git log --oneline FETCH_HEAD
node chronos/scripts/upstream-plan.mjs pick <sha>
git show <sha>
git cherry-pick -x <sha>
```

Ключ `-x` сохраняет исходный SHA в истории. Версию базы в `chronos/version.json` обновляем только
при полном обновлении nightly.

### Обновление до новой nightly T3

```sh
git switch -c upstream-sync/nightly-<build> main
git fetch --no-tags upstream refs/tags/v<version>
node chronos/scripts/upstream-plan.mjs nightly FETCH_HEAD
```

Отчёт сравнивает обе стороны с `upstreamCommit` в `chronos/version.json` и пробует слияние через
`git merge-tree --merge-base`, не меняя ветку, индекс и рабочие файлы. Полная процедура — в
[chronos-upstream-sync](../skills/chronos-upstream-sync/SKILL.md).
