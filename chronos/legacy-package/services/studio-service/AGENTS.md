# T3 Studio — Excalidraw boards and WordPress Playground (for AI agents)

Local service `http://127.0.0.1:4520` (this folder, `server.mjs`, no dependencies, bound to 127.0.0.1).
The user opens everything in T3's right panel ("шторка") as built-in browser tabs, so you can also drive the
pages with T3's preview tools (`preview_snapshot`, `preview_act`, …).

## Excalidraw boards — just edit the files

- A board is a JSON file `*.excalidraw`.
- Where boards live:
  - project threads: `<project root>\.excalidraw\<name>.excalidraw`
  - threads without a project: `C:\Users\zulut\.t3\caches\t3-customizations\studio-service\data\boards\`
  - any extra folder the user added in the studio ("Папка…").
  - Deleted boards are moved to `.trash\` next to them (never destroyed).
- Format:
  ```json
  {"type":"excalidraw","version":2,"elements":[ ... ],"appState":{"viewBackgroundColor":"#ffffff"},"files":{}}
  ```
- You may write either full Excalidraw elements or the **simplified skeleton form**; the open board converts
  skeletons to full elements and saves them back:
  ```json
  {"type":"rectangle","id":"api","x":0,"y":0,"width":220,"height":90,"backgroundColor":"#a5d8ff","fillStyle":"solid","label":{"text":"API"}}
  {"type":"ellipse","id":"db","x":360,"y":0,"width":200,"height":90,"label":{"text":"DB"}}
  {"type":"diamond","x":0,"y":160,"width":160,"height":100,"label":{"text":"?"}}
  {"type":"arrow","x":220,"y":45,"width":140,"height":0,"start":{"id":"api"},"end":{"id":"db"},"label":{"text":"SQL"}}
  {"type":"text","x":0,"y":300,"text":"Notes","fontSize":20}
  ```
  Colors are hex (`strokeColor`, `backgroundColor`); `fillStyle`: `solid` | `hachure` | `cross-hatch`.
  Keep `id`s stable when editing an existing element; full elements keep their `version`/`seed` fields.
- An open board reloads live when the file changes on disk (the user sees your edit immediately) and autosaves
  the user's drawing back into the same file.
- Show a board to the user: MCP `open_board`, or `POST /api/open {"board":"<abs path>"}` with header `x-oly: 1`.

## WordPress Playground sites

Persistent local sites (`@wp-playground/cli@3.1.64` via npx): files + SQLite database in
`studio-service\data\wp\<id>\` (or `<project>\.wordpress\<id>\`), the project folder mounted as a plugin / theme /
`wp-content`. Ports from 9410 up (9400–9409 are left for manual `npx @wp-playground/cli` runs). Auto-login as admin.
Stopping a site only kills that site's own Playground processes (matched by its data folder).

## MCP server (`mcp.mjs`, stdio)

Tools: `studio_context`, `list_boards`, `read_board`, `write_board`, `create_board`, `open_board`,
`wp_list`, `wp_create`, `wp_start`, `wp_stop`, `wp_status`, `wp_open`. Needs the service running.

Registration (done by the lead / the user, not by agents):
```
claude mcp add --scope user t3-studio -- "C:\Program Files\nodejs\node.exe" "C:\Users\zulut\.t3\caches\t3-customizations\studio-service\mcp.mjs"
codex mcp add t3-studio -- "C:\Program Files\nodejs\node.exe" "C:\Users\zulut\.t3\caches\t3-customizations\studio-service\mcp.mjs"
```

## HTTP API (mutating calls need header `x-oly: 1`)

| Method | Path | |
|---|---|---|
| GET | `/api/context` | current T3 thread, project, `boardsDir` |
| GET | `/api/locations?cwd=` | board folders (T3 projects, studio folder, added folders) |
| GET | `/api/boards?dir=` / `/api/boards` | boards in a folder / everywhere |
| GET | `/api/recent` | recently opened boards |
| GET / PUT | `/api/board?path=[&base=<mtime>]` | read / write a board (409 if `base` is stale) |
| POST | `/api/board/create` `{dir,name,content?}` · `/rename` `{path,name}` · `/delete` `{path}` | |
| GET | `/api/watch?path=` | SSE `change` events for a board |
| POST | `/api/open` `{board}` \| `{site}` \| `{hub:"boards"\|"wp"}` | open in the T3 right panel |
| GET / POST | `/api/wp/sites` | list / create sites |
| POST | `/api/wp/start` · `/api/wp/stop` · `/api/wp/remove` `{id}` | `remove` keeps the files |
| GET | `/api/wp/log?id=` | last log lines |
| POST | `/api/chat/send` `{board, png?, selection?, to?}` | board "В чат": T3 window attaches the PNG + board path to the composer |
| GET | `/api/chat/png?id=` | PNG snapshot of a chat send (kept 10 min) |

Pages: `/` studio hub (boards + WordPress), `/board?path=<abs>` board editor (Excalidraw 0.18.1, built locally into
`public/excalidraw`, no cloud). Rebuild the editor: see `app-src/build.mjs`.
