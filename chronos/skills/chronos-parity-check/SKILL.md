---
name: chronos-parity-check
description: Запускает и разбирает проверки паритета Chronos — локальный CDP smoke (smoke.mjs), CI-smoke (chronos-smoke.yml), сравнение скриншотов с масками и русских формулировок (compare.py), отличает шум профиля от регрессии и осознанно обновляет эталон. Используй после сборки, синхронизации с T3, правок UI/перевода или по /chronos-parity-check.
---

# Проверка паритета Chronos (smoke, compare, wording)

Опорные файлы: `chronos/scripts/smoke/README.md`, `checks.json`, `smoke.mjs`, `compare.py`, `chronos/parity/baseline-4774.md`, `.github/workflows/chronos-smoke.yml`, `.github/workflows/chronos-parity.yml`.

## Важные границы

- **Приватность:** скриншоты и полные `report.json` содержат локальные проекты, задачи и аккаунты — сохраняй их **вне репозитория** (`%USERPROFILE%\.t3\caches\chronos-parity\runs\...`), в git не добавляй.
- **База данных:** для проверки новой nightly с миграциями запускай `Chronos.exe` с отдельным `CHRONOS_HOME`, никогда не открывай живой `~/.t3`.
- **Разница проверок:** `.github/workflows/chronos-parity.yml` проверяет движок перевода (`verify-l10n.mjs`) на **зафиксированном ASAR 4774** — его зелёный статус не проверяет окно новой nightly. Живое окно проверяют `smoke.mjs`, `chronos-smoke.yml` и `compare.py`.

## 1. Запуск smoke

### Локально (подключение к открытому Chronos с `--remote-debugging-port=9333`)
Не закрывает окно; в конце возвращает его на `/` и в исходную тему:
```powershell
node chronos/scripts/smoke/smoke.mjs `
  --port 9333 `
  --strict-en `
  --out "$env:USERPROFILE\.t3\caches\chronos-parity\runs\<метка>"
```

### Локально (автозапуск `Chronos.exe` в изолированном профиле)
```powershell
$env:CHRONOS_HOME = "$env:TEMP\chronos-smoke-profile"
node chronos/scripts/smoke/smoke.mjs `
  --launch "$env:LOCALAPPDATA\Programs\chronos\Chronos.exe" `
  --port 9333 `
  --strict-en `
  --out "$env:USERPROFILE\.t3\caches\chronos-parity\runs\<метка>"
```
Полезные флаги: `--only home,usage,settings-general` (выборочные экраны; `globals` и `scheme` идут всегда), `--keep-open`, `--profile clean` (без настроенного провайдера — `13/14` + `1 SKIP` на `composer-mode-menu`), `--allow-offline-services` (без сервисов `4517–4524`), `--no-screenshots`.

### В CI (`chronos-smoke.yml`, `windows-latest`, `--profile clean --strict-en`)
```bash
gh workflow run chronos-smoke.yml --repo Zulut30/Chronos --ref <ветка> \
  -f desktop_run_id=<id_прогона_chronos-desktop> \
  -f require_services=true
```
Для всех сборок, включающих `chronos-services`, передавай `require_services=true` — иначе пропуск сервисов скроет поломку sidecar-менеджера или CORS (`RemoteRequestHeaders`). В `clean` ожидаются **13 пройденных и 1 пропуск** (`composer-mode-menu`), `0` ошибок и `0` неожиданных EN-фраз.

## 2. Сравнение с эталоном (`compare.py`)

```powershell
python -I chronos/scripts/smoke/compare.py `
  "$env:USERPROFILE\.t3\caches\chronos-parity\baseline\4774" `
  "$env:USERPROFILE\.t3\caches\chronos-parity\runs\<метка>" `
  --out "$env:USERPROFILE\.t3\caches\chronos-parity\runs\<метка>\diff"
```

- **Формулировки против старого эталона без `visibleLines`:** передай `--baseline-text <путь к report.json>` (повторный прогон той же версии эталона, снятый версией v2 `smoke.mjs`).
- **Строгий режим по русским строкам:** `--strict-ru` (падает при любом отличии или неполном покрытии экранов).
- **Пороги и диагностика:** `--channel-threshold 4` (RGB), `--pixel-threshold 1.0` (% немаскированных пикселей), `--no-diff-images`, `--no-fail-on-en`, `--json`.
- **Чтение `diff-<screen>.png`:** голубые рамки — объединённые `dynamicMasks` обоих прогонов + статические `pixelMasks` из `checks.json`; ярко-красные пиксели — реальные отличия вне масок.

## 3. Как отличить регрессию от шума данных и профиля

| Признак | Регрессия (чинить) | Шум профиля / ожидаемое изменение (объяснить в отчёте) |
| --- | --- | --- |
| `globals` / `scheme` | `< 28/28` объектов `__oly*`; `/index.html` или `*.wasm` не `200` / не `\0asm` (сломаны `ChronosSchemes` или пролог). | Не бывает шумом — всегда блокер. |
| Ассерты и ошибки | Любой `PASS -> FAIL`, новые ошибки консоли, исключения, сетевые ошибки к `127.0.0.1:4517–4524` при включённых сервисах. | `ignoredNetworkErrors` только при явном `--allow-offline-services`; `SKIP` на `composer-mode-menu` в `--profile clean`. |
| Новые EN-фразы (`NewEN`) | Не переведённый новый UI T3 или отвалившийся хук `olympusCatalog` / `olympusL10n`. | Разрешённый серверный статус провайдера (напр. подсказка входа на `/usage` при разлогиненном аккаунте) или новое имя модели/провайдера. |
| Русские формулировки (`wording`) | Пропала формулировка Olympus и заменена другим переводом GT T3 («Расход» → «Использование», «Тред» → «Поток») или сломался шаблон с переменными. | Новые настройки T3/Chronos (`+N` строк); ранее не переведённые в 4774 строки стали русскими (`Worktrees` → «Рабочие деревья»); склейка узлов на одну строку («Выполнен вход как …»); загрузившиеся карточки серверов в iframe MCP; другой выбранный проект в Студии или статус лимитов. Числа, часы и длительности `compare.py` уже нормализует сам. |
| Пиксели (`Diff%`) | Поехала сетка/тема (напр. пропал стиль `div[tabindex]` на `<a>`), исчезла кнопка Olympus, обрезан текст, пустой iframe сервиса. | Старт прогона в другой теме (`light` vs `dark` даёт до ~31% на `day-night`); другой список тредов/карточек/состояние провайдеров в профиле; субпиксельный рендер шрифтов (`< 0.1%`). |

**Правило приёмки:** каждое расхождение в `wording` и каждый экран с `Diff% > 1.0%` разбирай до конкретной причины. **Необъяснённых расхождений должно быть `0`.**

## 4. Осознанное обновление эталона и `checks.json`

Никогда не перезаписывай старый эталон (`baseline/4774/`) вслепую и не обновляй эталон, чтобы «позеленить» неразобранный провал.

Создавай новый каталог эталона `%USERPROFILE%\.t3\caches\chronos-parity\baseline\<build>\` только когда выполнены все условия:
1. Новая база T3 (или крупная намеренная правка UI) принята пользователем / прошла полный разбор.
2. Локальный `smoke.mjs --strict-en` прошёл **14/14** (`0` пропусков, `0` ошибок, `0` неожиданных EN) в той же теме, при активных сервисах Olympus.
3. Сравнение с прежним эталоном показало **0 необъяснённых замен** русских формулировок, а все красные зоны `diff-*.png` подтверждены визуально как намеренные.
4. Два последовательных контрольных прогона против нового каталога дают `PASS` (`regressions=0`, `new_errors=0`, `new_en=0`, `Diff% < 0.1%`).
5. Зафиксирована обезличенная сводка в `chronos/parity/baseline-<build>.md` (по образцу `chronos/parity/baseline-4774.md`); прежний `baseline/4774/` сохраняется.

Правки `chronos/scripts/smoke/checks.json`:
- добавляй новые экраны, селекторы или `maskSelectors` при появлении устойчивых динамических блоков;
- в `allowedEnglish` / `cleanAllowedEnglish` допускай только собственные имена (бренды, шрифты, модели) и подтверждённые серверные сообщения без перевода — не прячь туда непереведённый UI.
