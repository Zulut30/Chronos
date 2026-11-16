<p align="center"><img src="brand/chronos-logo.png" width="160" alt="Chronos"></p>

# Chronos

Chronos is a set of customizations for the T3 Code desktop app (Nightly) that runs on top of the official build. It is still T3 Code underneath, so the tunnel / T3 Connect, mobile app pairing, `t3code://` links, providers and data folders work exactly as in upstream. Chronos only adds things on top:

- **Olympus theme**: one theme with a day mode (cream + royal blue) and a night mode (navy + gold), plus a one-click day/night switch in the sidebar.
- **Russian UI**: build-time dictionaries plus a runtime translator. Data keys and protocol strings are never translated.
- **Client features** injected into the main bundle (`client/features`):
  - tasks board with `#T-12` references;
  - file downloads;
  - `@` machines and servers;
  - composer context tabs (`@` context, `#` tasks, `!` search);
  - Studio: Excalidraw boards and WordPress Playground in the right panel. A board can be sent to the chat as an image plus its file path;
  - OpenRouter media models;
  - API keys page;
  - tok/s speed chip.
- **Local services** (`services/`, 127.0.0.1 only) and their MCP servers, so agents can use them too:
  - skills manager `:4517` (MCP `oly-skills`);
  - tasks `:4518` (MCP `oly-tasks`);
  - files `:4519`;
  - studio `:4520` (MCP `t3-studio`);
  - integrations / API keys `:4522` (MCP `oly-web`);
  - OpenRouter MCP.

## Layout

| Folder | What |
|---|---|
| `theme/` | Olympus theme sources and builder (`build.py` → `olympus.json`, published with `t3 theme set`) |
| `client/features/` | Client feature scripts (`NN-name.js`) |
| `client/l10n/` | Russian dictionaries and extraction scripts |
| `installer/` | Archive builder, SHA-checked installer with rollback, delayed restart, post-install verification, tests |
| `services/` | Local services and MCP servers |
| `upgrade/`, `skills/` | Keeping Chronos in sync with new official T3 Code builds (in progress) |
| `brand/` | Logo |

T3 Code's own compiled bundles, `server.asar`, service state, logs and keys are **not** in this repo. The installer patches the locally installed T3 build. `sync.ps1` refreshes this repo from the live install folders using a whitelist.

## Notes

- Target build: T3 Code 0.1.10-nightly.20261116.4774 (Windows).
- Installing replaces `resources\server.asar` while T3 is closed. Restarting T3 stops running agents.
- API keys stay in the user environment or the local integrations service and are never committed.
