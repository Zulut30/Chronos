<p align="center"><img src="chronos/brand/chronos-icon-256.png" width="110" height="110" alt="Chronos"></p>
<h1 align="center">Chronos</h1>

<p align="center">A desktop app for coding agents<br>with a Russian interface and tools from Olympus.</p>

<p align="center"><strong>English</strong> · <a href="README.md">Русский</a></p>

<p align="center">
  <a href="https://github.com/Zulut30/Chronos/releases/latest"><img src="https://img.shields.io/github/v/release/Zulut30/Chronos?color=7B54F8&amp;label=release" alt="Latest release"></a>
  <a href="https://github.com/Zulut30/Chronos/releases"><img src="https://img.shields.io/github/downloads/Zulut30/Chronos/total?color=57E1BD&amp;label=downloads" alt="Total downloads"></a>
  <a href="#download"><img src="https://img.shields.io/badge/platforms-Windows%20%7C%20macOS-7B54F8" alt="Windows | macOS"></a>
  <a href="https://github.com/pingdotgg/t3code"><img src="https://img.shields.io/badge/based%20on-T3%20Code-57E1BD" alt="Based on T3 Code"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-7B54F8" alt="MIT"></a>
</p>

<p align="center"><a href="#download">Download</a> · <a href="#differences-from-t3-code">Differences from T3 Code</a> · <a href="#features">Features</a> · <a href="#updates-and-upstream-sync">Updates</a> · <a href="#faq">FAQ</a></p>

> [!IMPORTANT]
> Chronos is an unofficial, independent fork of the T3 Code source. It is not affiliated with, endorsed by, or supported by T3 Tools, Inc.<br>
> Chronos installs alongside T3 Code and keeps its data separate. Please use [Chronos Issues](https://github.com/Zulut30/Chronos/issues) for questions, bugs, and ideas.

![Chronos home screen in the Olympus theme with the Russian prompt “What shall we work on?”](chronos/brand/screenshots/chronos-home.webp)

## Download

| Platform | Installer | Installation |
| --- | --- | --- |
| Windows x64 | [Chronos-Setup-x64.exe](https://github.com/Zulut30/Chronos/releases/latest/download/Chronos-Setup-x64.exe) | Run the NSIS installer. |
| macOS · Apple Silicon | [Chronos-mac-arm64.dmg](https://github.com/Zulut30/Chronos/releases/latest/download/Chronos-mac-arm64.dmg) | Open the DMG and drag Chronos to Applications. |
| macOS · Intel | [Chronos-mac-x64.dmg](https://github.com/Zulut30/Chronos/releases/latest/download/Chronos-mac-x64.dmg) | Open the DMG and drag Chronos to Applications. |

These links point to the latest release. Linux builds are unavailable.

To verify a download, compare the command output with the entry for your file in [SHA256SUMS](https://github.com/Zulut30/Chronos/releases/latest/download/SHA256SUMS).

- Windows — `certutil -hashfile Chronos-Setup-x64.exe SHA256`
- macOS — `shasum -a 256 Chronos-mac-arm64.dmg` (on Intel, use `Chronos-mac-x64.dmg`)

<details>
<summary>Opening an unsigned build for the first time</summary>

**Windows.** In SmartScreen, select **More info** → **Run anyway**.

**macOS.** In Applications, right-click Chronos and choose **Open**. For a copy in the standard location, you can also run `xattr -dr com.apple.quarantine /Applications/Chronos.app`.

</details>

Release files ending in `.blockmap`, `.zip` and `.yml` are used by the automatic updater.

## Differences from T3 Code

The comparison uses T3 Code nightly `0.1.10-nightly.20261116.4774`, the base for the Olympus port.

| Area | T3 Code | Chronos |
| --- | --- | --- |
| Origin | Upstream project | A port of Olympus, the author’s personal build |
| App profile | T3 Code profile | Separate Chronos profile |
| Server directory | `T3CODE_HOME` | `CHRONOS_HOME` |
| App links | `t3code://` | `chronos://` |
| Updates | T3 Code channel | Zulut30/Chronos releases |
| Interface | T3 Code interface | Olympus Russian translation, including dynamic text |
| Appearance | Theme settings | Olympus theme and a day/night switch in the sidebar |
| Chats | Project threads | Two chats side by side and a response mode saved per thread |
| Statistics | Provider statistics | OpenRouter spending included on the statistics page |

## Features

### Interface and theme

The build applies the Olympus dictionary and translation rules to produce a fully Russian interface. Dynamic strings are translated at runtime. The Greek-inspired Olympus theme has day and night variants, with a switch in the sidebar. Theme CSS can contain up to 4 MB to accommodate embedded images.

Agents can use color and text formatting in chat. Formatting is preserved when you copy a message.

### Agents, models, and token usage

The Electron app works with Claude Code, Codex, Cursor, OpenCode, Antigravity, OpenRouter, and other providers through your own subscriptions or API keys.

- Choose from five response modes, including planning. Chronos remembers the mode for each thread.
- The model picker shows the selected account’s email and plan. OpenRouter has its own provider entry, logo, and models. Its spending appears on the statistics page.
- Track generation speed in tokens per second, token usage, and provider budgets and limits. Chronos sends budget and limit notifications. The details card shows limits and related threads. Background tasks have their own details view.
- In the message composer, use `@` for context, `#` for tasks, `!` for search, `$` for skills, `/` for commands. A selected reference appears as a chip in the message.

### Tasks, studio, and chat panels

Each project has a task board with Kanban and list views, due dates, filters, and links to chats. The studio includes Excalidraw boards and WordPress Playground. You can send a board to a chat as an image. Open any chat in the right panel to work with two chats side by side.

### Files and environments

Upload files and folders from any environment and give machines aliases. Language icons are color-coded in the file tree and in diff headers.

### Settings and local services

Settings includes pages for API keys, MCP servers, and prompt templates, along with a skill manager.

> [!NOTE]
> The task board, studio, skill manager, file uploads, API keys page, and MCP manager rely on separate local Olympus Node.js services on `127.0.0.1`. The installer does not yet include them. Without these services, those sections are empty or unavailable. Bundling the services is the next step. Other features run independently of them.

![Chronos Appearance settings showing themes, with API keys, MCP servers, and prompt templates in the sidebar.](chronos/brand/screenshots/chronos-settings.webp)

## Updates and upstream sync

CI tracks T3 Code nightly builds daily and prepares updates on `upstream-sync/*` branches. Installed copies update through `electron-updater`, using the `nightly.yml` and `nightly-mac.yml` feeds from [Chronos Releases](https://github.com/Zulut30/Chronos/releases).

Chronos uses its own app ID `io.github.zulut30.chronos`.

| Data | Location |
| --- | --- |
| Windows profile | `%APPDATA%\Chronos` |
| macOS profile | `~/Library/Application Support/Chronos` |
| Server data | `~/.chronos` (override with `CHRONOS_HOME`) |
| CLI command | `~/.chronos/bin/t3` |

## FAQ

<details>
<summary>Can I install Chronos alongside T3 Code?</summary>

Yes. The apps use separate profiles, data directories, and update channels. Chronos leaves T3 Code data untouched.

</details>

<details>
<summary>Why does my system warn about an unknown publisher?</summary>

Chronos builds are unsigned. See [Download](#download) for the first-launch steps on Windows and macOS.

</details>

<details>
<summary>Why can’t I sign in with GitHub or Google?</summary>

You can sign in to a T3 Connect account with a code sent by email. Apple, GitHub, Google, and Microsoft sign-in buttons are unavailable in Chronos because the T3 sign-in service does not accept the `chronos://` callback.

</details>

<details>
<summary>Why is the task board or studio empty?</summary>

Both sections get their data from local Olympus services, which are currently installed separately. [See all features that require these services](#settings-and-local-services).

</details>

<details>
<summary>How do I report a bug?</summary>

Open an [issue in the Chronos repository](https://github.com/Zulut30/Chronos/issues) with your OS, Chronos version, and steps to reproduce the problem.

</details>

## For developers

<details>
<summary>Fork layout, local builds, and CI</summary>

Olympus modules are copied byte for byte. Where the port requires changes to T3 Code source files, those edits are kept minimal. See the [fork guide](chronos/README.md) and [parity reports](chronos/parity/).

Local builds follow upstream requirements for Node.js, pnpm, and Vite+. See the [T3 Code docs](https://github.com/pingdotgg/t3code/tree/main/docs) and [package.json](package.json).

CI [builds the bundle and installers](.github/workflows/chronos-desktop.yml), [runs checks](.github/workflows/chronos-checks.yml), and [verifies translation parity](.github/workflows/chronos-parity.yml).

</details>

## License and trademarks

Thank you to the T3 Code team for making the source available. The code is licensed under the [MIT License](LICENSE). T3 Code, T3 Connect, T3 Tools, and the T3 logos and icons are trademarks of T3 Tools, Inc. The code license grants no rights to those marks. See [NOTICE.md](NOTICE.md).

Chronos is an unofficial, independent project. It is not affiliated with, endorsed by, or supported by T3 Tools, Inc. Direct questions and bug reports to [Chronos Issues](https://github.com/Zulut30/Chronos/issues).
