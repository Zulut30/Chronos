---
name: chronos-ci
description: "Запуск, ожидание, повтор CI и установка сборки Chronos. Use for GitHub Actions, failed or cancelled jobs, build artifacts, silent install and desktop CDP launch."
---

# GitHub Actions и установка Chronos

Работай с `-R Zulut30/Chronos`. Перед запуском запиши ветку и полный SHA на origin. Проверь уже начатые прогоны нужного workflow с `gh run list --workflow <workflow> --branch <branch> --commit <sha> -R Zulut30/Chronos`. Пуш в `docs/**` сам не запускает checks. Для задачи на документацию достаточно запрошенного workflow, полный набор ниже нужен перед слиянием.

| Workflow | Назначение |
| --- | --- |
| [chronos-checks.yml](../../../.github/workflows/chronos-checks.yml) | Проверки форка, типов, web/desktop и сервера. `packaged-ui` запускается с `ui_builds`. |
| [chronos-desktop.yml](../../../.github/workflows/chronos-desktop.yml) | Установщики Windows x64 и macOS arm64/x64. Для тега нужен ручной прогон на SHA main. |
| [chronos-smoke.yml](../../../.github/workflows/chronos-smoke.yml) | Проверяет Windows-артефакт конкретного desktop run. Для слияния нужны оба строгих входа. |
| [chronos-parity.yml](../../../.github/workflows/chronos-parity.yml) | Сравнение перевода на закреплённом ASAR 4774. |
| [chronos-upstream.yml](../../../.github/workflows/chronos-upstream.yml) | Совместимость nightly по расписанию или вручную, без слияния. |
| `chronos-perf.yml` | Парное сравнение пакетов с main. Поставляется веткой `perf/guard`. Когда workflow зарегистрирован, проверь входы в целевой версии и SHA пары в отчёте. |

Запусти нужный workflow вручную. Возьми ID из ответа или списка с фильтрами ветки, SHA и события. Перед повторным использованием сравни `headSha` и тип события. При новом коммите нужны результаты для нового SHA. Для проверки паритета или отчёта nightly подставь в команду соответствующее имя из таблицы. Для perf после интеграции используй `gh workflow run chronos-perf.yml --ref <branch> -f target=<branch> -R Zulut30/Chronos` и дождись результата пары.

```bash
gh workflow run chronos-checks.yml --ref <branch> -R Zulut30/Chronos
gh run view <id> -R Zulut30/Chronos --json workflowName,headBranch,headSha,event,status,conclusion
gh run watch <id> -R Zulut30/Chronos --exit-status
```

Дождись desktop тем же способом. Для smoke выбери тот же ref и ID успешной сборки. В summary требуются 14/14, 0 пропусков, 0 ошибок и 0 неожиданных EN. В отчёт перенеси ссылки и проверенный SHA.

```bash
gh workflow run chronos-desktop.yml --ref <branch> -R Zulut30/Chronos
# После успешного desktop:
gh workflow run chronos-smoke.yml --ref <branch> -R Zulut30/Chronos -f desktop_run_id=<desktop-id> -f require_services=true -f require_provider=true
```

При сбое проверь `gh run view <id> --log-failed -R Zulut30/Chronos` и статус каждой job. При отмене macOS-раннера или временном сетевом сбое повтори `gh run rerun <id> --failed -R Zulut30/Chronos` и снова дождись `gh run watch`. Если GitHub не выделил отменённые job для повтора, перезапусти весь этот run. Ошибку кода исправляй в своей ветке. При повторяющемся инфраструктурном сбое сохрани лог и причину.

## Windows-пакет и порт 9333

Для запрошенной установки скачай только Windows-артефакт проверенного desktop SHA в новый каталог. Сверь имя, версию и манифест сборки. Дай закончиться активным ходам и штатно выйди именно из Chronos через меню приложения. Если в нём работает текущая сессия, выбери песочницу или согласуй перерыв. Проверь путь оставшихся процессов и владельца порта. При занятом 9333 используй уже проверенное окно Chronos или дождись освобождения порта.

```powershell
$dir = Join-Path $env:TEMP ("chronos-package-" + [guid]::NewGuid())
gh run download <desktop-id> -n chronos-win-x64 -D $dir -R Zulut30/Chronos
if ($LASTEXITCODE) { throw 'Скачивание не удалось' }
$pkg = @(Get-ChildItem -LiteralPath $dir -Filter 'Chronos-*-x64.exe' -File)
if ($pkg.Count -ne 1) { throw 'Ожидался один установщик' }
$exe = Join-Path $env:LOCALAPPDATA 'Programs\chronos\Chronos.exe'
if (Get-Process Chronos -ErrorAction SilentlyContinue | Where-Object Path -eq $exe) { throw 'Закрой Chronos через меню' }
$install = Start-Process -FilePath $pkg[0].FullName -ArgumentList '/S' -Wait -PassThru
if ($install.ExitCode) { throw "Установщик вернул $($install.ExitCode)" }
```

Повтори проверку после установки на случай автозапуска. Выйди из автозапущенного Chronos перед добавлением флага. Посмотри владельца `Get-NetTCPConnection -LocalPort 9333 -State Listen -ErrorAction SilentlyContinue`. Для свободного порта запусти окно и дождись появления страницы приложения.

```powershell
Start-Process -FilePath $exe -ArgumentList '--remote-debugging-address=127.0.0.1','--remote-debugging-port=9333'
Invoke-RestMethod http://127.0.0.1:9333/json/list | Select-Object type,title,url
```

Сопоставь PID владельца порта с полным путём Chronos.exe, версию в окне — с артефактом. Сценарии приёмки описаны в [chronos-live-verify](../chronos-live-verify/SKILL.md).
