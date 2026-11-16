# Olympus v3 — T3 customizations (staging, install, evidence)

Target: T3 Code 0.1.10-nightly.20261116.4774, `resources\server.asar`. v2 archive sha `e599bc1e…`, v3 archive sha in `patch-manifest.json` (`patchedSha256`).

## Layout
- `src/` — canonical sources (client feature scripts injected into `main-lxHaZZx7.js`, service files). `native/` — patched compiled bundles (originals in `installed/`).
- `build-archive.py` — rebuilds `server.asar` from `before/server.asar` + `src/` + `native/`; verifies every packed file (integrity hashes, unchanged files byte-identical). Do NOT rerun `patch-*.py` (one-time generators; would overwrite final fixes).
- `install.py --prepare | --apply | --rollback` — SHA-checked atomic install of the archive + 16 service files, MCP `oly-skills` registration for Claude Code (`claude mcp add-json -s user`) and Codex (`~/.codex/config.toml` block; backup `before/codex-config.toml`). Any failure rolls back everything. Rollback needs T3 closed.
- `apply-restart.ps1` — detached helper: wait (file `restart-now` / `restart-cancel` control it) → close T3 → `install.py --apply` → restart tasks (4518) and skills (4517) services via their `start-hidden.vbs` → move Chromium `Cache`/`Code Cache` aside → relaunch T3 via explorer (normal window, desktop environment) → `post-verify.mjs`. Status: `restart-check.json`, log: `restart.log`.
- `post-verify.mjs` — checks the LIVE system: installed hashes, new server pid/startedAt after install, served client assets byte-equal to the archive, service health + new APIs + restarted pids, MCP initialize/tools/list/safe reads (oly-skills, oly-tasks, oly-web, openrouter), Claude/Codex registrations, and a real UI check (`test-work/ui-check.mjs`: headless Edge + 5-minute read-only pairing session, revoked afterwards). Result: `post-verify.json`.

## Changes in this pass (Claude Opus 5.5)
- New: agent access to the skills manager — `skills-manager/mcp.mjs` (MCP `oly-skills`, 13 tools: list_locations, list_skills, read_skill, read_skill_file, create_skill, write_skill_file, set_skill_enabled, copy_skill, trash_skill, search_catalog, install_skill, check_updates, update_skill). It only calls the skills-manager HTTP service, so validation, trash backups and SSH handling are shared with the UI. Service gained `GET /api/file` (read one file inside a skill, path-confined, symlink-safe, 512 KiB, text only) and `POST /api/write` (edit/add a file; whole skill folder copied to trash first). No shell/proxy tool.
- Fixes from review: OpenCode records with `cost: 0` for OpenRouter are no longer shown as real $0 (only `:free` models or our MCP receipts); Enter/arrows are no longer swallowed after the @ menu closes on the Servers tab; sent messages render model/server/search references as normal chips (chat bundle `_chat-CZ9dvfEY.js` patched); task counter follows desktop hash routes; T3 relaunches visibly.

## Evidence (pre-install)
- `node --test test-work/regression.test.mjs` — 11/11.
- `node --test test-work/skills-mcp.test.mjs` — 7/7 (isolated fake home + port 4597; real skills untouched).
- Browser fixtures (`test-work/mkharness.py` → headless Edge `--dump-dom`) — 32/32, `test-work/browser-results.json`. These are fixtures with fake editor/bridge, not proof of real GUI behaviour.
- Live read-only MCP calls against the running skills service; archive rebuild verified 3593 files (3586 unchanged byte-identical, 7 changed).
- Post-install proof is `post-verify.json` + `restart-check.json`, produced on the real system after restart.

## Rollback
Close T3, then `python -I install.py --rollback`, then start T3. Restores v2 archive, previous service files, removes the `oly-skills` registrations.

## Update 2026-11-17: board to chat + compact studio hub (`update-studio-chat/`)
- Board editor: «В чат» button / menu item → PNG of the selection or whole board (`exportToBlob`) → studio `POST /api/chat/send` → SSE `chat` → T3 window (`60-studio.js` §3b) pastes the PNG into the composer as a normal image attachment and inserts the board path. Hub rows have the same action (opens the board with `#send=1`). Optional `to` targets one window (`localStorage oly-studio-client`), used by the e2e test so your real draft is untouched.
- Studio service / hub / editor bundle are live without T3 restart (backup: `before/studio-service-20261117/`). The T3 part is an incremental archive: `update.py --build|--apply|--rollback` (v3 → v3+studio-chat, only `main-lxHaZZx7.js` changes); `restart.ps1` installs it detached; `post-verify.mjs` + `verify-e2e.mjs` check the live system.
- Rollback: close T3 → `python -I update.py --rollback` (restores v3 archive). Studio service files: copy back from the backup folder and restart port 4520.
