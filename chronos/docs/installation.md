## Установка рядом с T3

- Установщик Windows регистрирует приложение **Chronos** с идентификатором
  `io.github.zulut30.chronos` (без T3-скрипта `installer.nsh`).
- Профиль Electron: `%APPDATA%\Chronos` (Windows), `~/Library/Application Support/Chronos` (macOS).
  Миграция legacy-профиля T3 отключена.
- Сервер и его база: `~/.chronos/userdata` (переопределяется через `CHRONOS_HOME`; переменная
  `T3CODE_HOME` от установленного T3 игнорируется). WSL-бэкенд получает `--base-dir ~/.chronos`.
- Встроенный клиент сохраняет внутренний origin `t3code://app` для совместимости с серверами T3 и
  CORS-политиками локальных сервисов Olympus. Внешний OAuth/deep-link callback Chronos — `chronos://`.
- T3 Connect использует официальные публичные параметры Clerk и relay из `.env.example`.
- Глобальная команда `t3` в PATH остаётся за установленным T3; для Chronos используется
  `~/.chronos/bin/t3` (на Windows `~/.chronos/bin/t3.cmd`), жёстко привязанный к `~/.chronos`.
