# Brief for sub-sessions: extending the user's T3 Code (read fully before starting)

The user runs **T3 Code (Nightly) 0.1.10-nightly.20261116.4774** desktop app on Windows (Electron). We customize it by patching the
client bundle inside `C:\Users\zulut\AppData\Local\Programs\t3code\resources\server.asar` plus small local services.
The UI language is Russian; the user writes in Russian. Reply/report in Russian.

## Hard rules
- **Never** restart/close T3, never run `olympus-v2\patch-combined.py`, `apply*.ps1`, `restore.ps1`, `t3 theme set`. The lead
  session builds, installs and restarts once everything is ready. You only produce source files and test them in headless Chrome.
- Only edit files you own (listed in your task). Do not edit `ru-l10n\extras.js`, `runtime-final.json`, `day.add.css`,
  `night.add.css`, `build.py`, `patch-combined.py` unless your task explicitly says so.
- Never delete or overwrite user data (skills, projects, repos, server files). On SSH servers only read, unless your task needs a
  write and then only inside a sandbox folder you create. No secrets in files, logs or reports. No git push.
- Bind local services to `127.0.0.1` only. Mutating HTTP endpoints must require header `x-oly: 1` (blocks cross-site requests).
- Write Russian UI text directly in your code. Keep product names (T3, Claude, Codex, GitHub, OpenRouter…) as is.

## How features are added (no React source access — bundle is minified)
1. **Runtime feature module**: `C:\Users\zulut\.t3\caches\t3-customizations\ru-l10n\features\NN-<name>.js`. It is concatenated
   (sorted by name) into the start of the main bundle `main-lxHaZZx7.js` as a classic script body. Write it as one IIFE:
   `;(()=>{try{ ... }catch(e){console.warn('oly <name>',e)}})();`. It runs before the app renders.
   Inject UI by watching the DOM (`MutationObserver` throttled with `requestAnimationFrame`), insert **your own** nodes next to app
   nodes; never remove/reorder React-managed nodes. Identify app elements with stable hooks: `data-slot=…`, `data-*`, `aria-label`
   (labels may be translated to Russian at runtime by our translator — match both English and Russian).
   Globals only as `globalThis.__oly<Name>`. Persist small client state in `localStorage` keys `oly-<name>-*`.
2. **Local service** (if the feature needs filesystem/SSH/network): Node ≥ 24 (`C:\Program Files\nodejs\node.exe`), prefer no
   dependencies (vendor them inside your service folder if unavoidable), folder `C:\Users\zulut\.t3\caches\t3-customizations\<name>-service\`,
   own port (assigned in your task), a `start-hidden.vbs` like `skills-manager\start-hidden.vbs`. The lead installs autostart.
   The T3 desktop page (origin `t3code://app`) may `fetch` `http://127.0.0.1:<port>` (CSP allows http:) — send CORS headers
   `Access-Control-Allow-Origin` for `t3code://app` and `http://localhost:3773` on GET, or use `mode:'no-cors'` for fire-and-forget;
   iframes to `http://127.0.0.1:<port>` are allowed too (pattern used by the skills manager: sidebar button → in-app dialog → iframe).
   Windows tar: use `C:\Windows\System32\tar.exe` (Git's GNU tar misreads `C:\`).
3. **Theme styling** for your UI: `C:\Users\zulut\.t3\caches\t3-customizations\olympus-v2\feature-css\<name>.day.css` and
   `<name>.night.css` (scoped automatically to light/dark Olympus). Base styles inside your module must use T3 variables so it
   also works with other themes: `--background --foreground --muted-foreground --border --accent --card --primary
   --primary-foreground --radius --control-radius`.
4. **Translations** of remaining English UI: `ru-l10n\runtime-extra-<name>.json` = `{"exact":{"English":"Русский"},"patterns":[["^regex$","замена $1"]]}`
   (applied to rendered text nodes and aria-label/placeholder/title; chat content, code and composer text are skipped).

## Visual style (the user insists: native T3 look + adapted to the Olympus theme)
- Native T3: Inter 13–14px, controls 28px tall, ghost/outline buttons, lucide-style 15px stroke icons, muted secondary text,
  cards = 1px `--border`, `--radius`; dialogs like T3 settings (left nav, breadcrumb header, grouped rows: title + muted description
  left, actions right). Look at existing screens before designing.
- Olympus day: cream `#F3EFE6`/`#FFFDF8`, ink `#0E1116`, royal blue `#1952C5` accents, 2px radii, headings in
  `"Cormorant Garamond",Didot,Georgia,serif` (≈27px, weight 500), dialog shadow `3px 3px 0 #0E11160d,0 12px 32px -12px #0E111640`.
  Chat area is royal blue with an Apollo statue — anything placed over it needs a cream card or a light text with shadow.
- Olympus night: navy `#081530`/`#0E1E3E`, text `#E8F0FB`, gold `#E3BF5C` accents, gold hairline borders `#E3BF5C4d`,
  headings Didot uppercase letter-spaced gold `#E9C76A`, glass cards with `backdrop-filter:blur(12px)`.
- Existing additions to stay consistent with: composer chips "≈ N ток/с" and "План" (ghost, muted), sidebar button "Скиллы"
  (footer icon row) opening an in-app dialog with the skills manager (`skills-manager\index.html`, `style.css`) — reuse its look.

## Headless test harness (use it; screenshots are your eyes)
Dir: `C:\Users\zulut\AppData\Local\Temp\claude\c8110349984fd5ae\0b8bd3e0-413c-4dcf-af1a-2273cee6dcc9\scratchpad\pw`.
`node shot.js plan.json` drives headless Chrome against the running T3 web UI `http://localhost:3773`.
```json
{"profile":"profile-<you>","routeDir":"C:/Users/zulut/.t3/caches/t3-customizations/olympus-v2/staged-assets",
 "initScripts":["C:/Users/zulut/.t3/caches/t3-customizations/ru-l10n/features/NN-<name>.js"],
 "steps":[{"path":"/","wait":3500},{"eval":"return document.title"},{"click":"css"},{"hover":"css"},{"press":"Control+k"},
          {"type":"text"},{"shot":"out/x.png","clip":{"x":0,"y":0,"width":800,"height":400}}]}
```
`routeDir` serves the currently staged (patched) bundle; `initScripts` loads your module so you test without rebuilding.
Login: first run with env `TOKEN` set from `t3 auth pairing create --scope orchestration:read --ttl 10m --label olympus-<you> --json`
(PowerShell: `(… | ConvertFrom-Json).credential`). If your feature needs live thread events or writes, omit `--scope` (default scopes)
and keep TTL short. **Revoke your sessions when done**: `t3 auth session list --json`, then `t3 auth session revoke <exact id>` only for
labels starting with `olympus-<you>` (never the "T3 Code Desktop" or "T3 Connect" sessions).
Light/dark: `localStorage.setItem('t3code:theme-appearance-mode','dark'|'light')` then navigate. Check both. Read PNGs with the Read tool.
Use your own profile dir name and output folder; never use `profile`, `profile-probe`, `profile-a/b/c`.
Do not put a `.py` file named like a stdlib module (e.g. `bisect.py`) in a folder you run Python from; run Python with `-I`.

## Report (final message)
Russian, concise: what works (with evidence: screenshots/paths), files you created, ports/services, how the lead should install
(autostart, configs), what the user must do (e.g. paste an API key), known limitations. No code dumps.
