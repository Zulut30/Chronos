---
name: chronos-artifacts
description: Создаёт и обновляет интерактивные HTML-страницы и мини-приложения в галерее «Артефакты» настольного Chronos через MCP Студии.
---

# Артефакты Chronos

Сделай артефакт, когда пользователь хочет работать с результатом в окне Chronos или установить его как приложение. Подходят формы, калькуляторы, планы и графики с фильтрами.

## Публикация и версии

В сессии Chronos используй `artifact_studio`: `action: "guide"` возвращает схемы, `action: "publish"` принимает параметры в `input` и связывает результат с текущим тредом. Вставь возвращённый `markdown` в сообщение для карточки. Для готового одиночного HTML в сессии с полным доступом достаточно абсолютного пути `source`. При ограниченном доступе передавай `files`. В отдельном MCP Студии вызови `artifact_publish`. Укажи стабильный абсолютный `source`, заголовок `title` из 2–4 слов, краткое `description`, значок `icon` (например, эмодзи), подпись версии `label`, массив `capabilities` и полную карту `files`. Точка входа — `index.html`. Текст передавай строками UTF-8. Имена файлов относительные, разделитель — `/`. Для изображений, PDF и шрифтов передавай объект `{"encoding":"base64","data":"…"}` без префикса data URL. На одну публикацию отводится 255 файлов вместе с точкой входа, по 15 МиБ на файл, суммарно 16 МиБ декодированных данных.

Для первой публикации используй `expectedVersion: 0`. Покажи результат через `artifact_open({id})`. Вернуться к странице можно через «Артефакты» в сайдбаре.

Найди существующую страницу через `artifact_list`, прочитай её целиком через `artifact_read({id})` и передай её `id` при следующей публикации. В `expectedVersion` передай номер прочитанной версии. При конфликте прочитай свежую версию и совмести изменения, включая файлы и возможности. `artifact_history` показывает подписи, `artifact_restore({id,version,expectedVersion})` создаёт новую версию из выбранной. `artifact_pin` принимает `{id,pinned}`. `artifact_delete({id})` открывает подтверждение у пользователя.

## Возможности

Объявляй только нужные для страницы возможности. API виден под именами `window.chronos` и `window.claude`.

- `theme` предоставляет `theme.get()` с полями `mode` (`light`, `dark`) и `tokens`. Для перерисовки canvas слушай событие окна `chronosthemechange`.
- `db` предоставляет асинхронные методы. Коллекция и ключ — непустые строки длиной до 256 символов. `get({collection,key})` возвращает объект или `null`. `set({collection,key,value})` заменяет документ, `update` объединяет верхние поля существующего документа, `delete({collection,key})` удаляет его. Размер JSON-документа до 1 МиБ.
- `list({collection,after?,limit?})` возвращает массив `{key,value}` по ключу. `after` — последний ключ предыдущей страницы, `limit` от 1 до 500. `query({collection,where,after?,limit?})` фильтрует по равенству скалярных полей. `batch({operations:[{method:"set",collection,key,value},…]})` выполняет до 256 операций set/update/delete одной транзакцией. Агент использует те же аргументы, добавляя `id` в инструментах `artifact_db_get`, `artifact_db_list`, `artifact_db_query`, `artifact_db_set`, `artifact_db_update`, `artifact_db_delete` и `artifact_db_batch`.
- `files.open` предоставляет `await files.open()` с выбором одного файла и результатом `{name,base64}` или `null`. `files.save` предоставляет `await files.save({name,base64})`, результат — логическое значение. Привяжи диалог к кнопке пользователя.

## Оформление

Задай `<meta name="viewport" content="width=device-width, initial-scale=1">`. В `<title>` помести те же 2–4 слова, что в карточке. Определи резервные значения токенов на `:root` и явно задай фон `body`. Для ночной темы поддержи и системную настройку, и переключатель Olympus. На узком экране оставь 16 px по краям.

```css
:root { color-scheme: light; --background: #faf9f6; --foreground: #252421; }
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) { color-scheme: dark; --background: #202022; --foreground: #f4f3ef; }
}
:root[data-theme="dark"] { color-scheme: dark; --background: #202022; --foreground: #f4f3ef; }
body { margin: 0; background: var(--background); color: var(--foreground); }
main { max-width: 60rem; margin: auto; padding: 1rem 16px; }
```

Локальные ассеты подключай относительными путями. Внешние ресурсы доступны через HTTPS на cdnjs.cloudflare.com, cdn.jsdelivr.net и unpkg.com. В URL зависимости указывай точную версию. Данные страницы между публикациями храни в документной БД.
