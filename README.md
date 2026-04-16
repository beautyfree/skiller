# Skill<img src="docs/images/readme-skiller-er.svg" alt="" width="52" height="32" />

<!-- Pink "er": external SVG via img — GitHub's README sanitizer strips inline SVG, so em-sized SVG does not work on github.com. -->

![Skiller Hero Banner](docs/images/screenshots/hero.png)

Install, sync, and manage AI agent skills across your coding agents from one desktop app.

## Why Skill<img src="docs/images/readme-skiller-er.svg" alt="" width="39" height="24" />

Managing skills separately in every agent is repetitive and error-prone.  
Skill<img src="docs/images/readme-skiller-er.svg" alt="" width="26" height="16" /> gives you one control center to:

- **See everything at once** — agents, installed skills, and status in one dashboard
- **Install once, sync everywhere** — propagate skills across your agent stack
- **Edit confidently** — update `SKILL.md` content with immediate local visibility
- **Discover faster** — browse marketplace sources like [skills.sh](https://skills.sh) and [ClawHub](https://clawhub.ai)
- **Stay up to date** — refresh and manage skills without manual filesystem work

## Supported agents

Skill<img src="docs/images/readme-skiller-er.svg" alt="" width="26" height="16" /> talks to every listed agent natively — dropping a skill into one place propagates it to all of them.

<table>
  <tr>
    <td align="center" width="150"><a href="https://docs.anthropic.com/en/docs/claude-code/getting-started"><img src="docs/images/agents/claude-code.png" width="64" height="64" alt="Claude Code"><br><b>Claude Code</b></a><br><sub>CLI</sub></td>
    <td align="center" width="150"><a href="https://help.openai.com/en/articles/11096431-openai-codex-cli-getting-started"><img src="docs/images/agents/codex.png" width="64" height="64" alt="Codex"><br><b>Codex</b></a><br><sub>CLI</sub></td>
    <td align="center" width="150"><a href="https://google-gemini.github.io/gemini-cli/docs/get-started/"><img src="docs/images/agents/gemini-cli.png" width="64" height="64" alt="Gemini CLI"><br><b>Gemini CLI</b></a><br><sub>CLI</sub></td>
    <td align="center" width="150"><a href="https://docs.github.com/en/copilot/how-tos/set-up/install-copilot-in-the-cli"><img src="docs/images/agents/copilot-cli.png" width="64" height="64" alt="GitHub Copilot CLI"><br><b>Copilot CLI</b></a><br><sub>CLI</sub></td>
    <td align="center" width="150"><a href="https://opencode.ai/docs/"><img src="docs/images/agents/opencode.png" width="64" height="64" alt="OpenCode"><br><b>OpenCode</b></a><br><sub>CLI</sub></td>
    <td align="center" width="150"><a href="https://docs.openclaw.ai/start/getting-started"><img src="docs/images/agents/openclaw.png" width="64" height="64" alt="OpenClaw"><br><b>OpenClaw</b></a><br><sub>CLI</sub></td>
  </tr>
  <tr>
    <td align="center" width="150"><a href="https://www.codebuddy.ai/docs/cli/installation"><img src="docs/images/agents/codebuddy.png" width="64" height="64" alt="CodeBuddy"><br><b>CodeBuddy</b></a><br><sub>CLI</sub></td>
    <td align="center" width="150"><a href="https://docs.qoder.com/cli/quick-start"><img src="docs/images/agents/qoder.png" width="64" height="64" alt="Qoder"><br><b>Qoder</b></a><br><sub>CLI</sub></td>
    <td align="center" width="150"><a href="https://cursor.com/docs/cli/overview"><img src="docs/images/agents/cursor.png" width="64" height="64" alt="Cursor"><br><b>Cursor</b></a><br><sub>IDE</sub></td>
    <td align="center" width="150"><a href="https://formulae.brew.sh/cask/windsurf"><img src="docs/images/agents/windsurf.png" width="64" height="64" alt="Windsurf"><br><b>Windsurf</b></a><br><sub>IDE</sub></td>
    <td align="center" width="150"><a href="https://formulae.brew.sh/cask/trae"><img src="docs/images/agents/trae.png" width="64" height="64" alt="Trae"><br><b>Trae</b></a><br><sub>IDE</sub></td>
    <td align="center" width="150"><a href="https://formulae.brew.sh/cask/antigravity"><img src="docs/images/agents/antigravity.png" width="64" height="64" alt="Antigravity"><br><b>Antigravity</b></a><br><sub>IDE</sub></td>
  </tr>
  <tr>
    <td align="center" width="150"><a href="https://kiro.dev/downloads/"><img src="docs/images/agents/kiro.png" width="64" height="64" alt="Kiro"><br><b>Kiro</b></a><br><sub>IDE</sub></td>
    <td align="center" width="150"><a href="https://docs.cline.bot/getting-started/quick-start#cli"><img src="docs/images/agents/cline.png" width="64" height="64" alt="Cline"><br><b>Cline</b></a><br><sub>VS Code extension</sub></td>
    <td align="center" width="150"><a href="https://www.warp.dev/"><img src="docs/images/agents/warp.png" width="64" height="64" alt="Warp"><br><b>Warp</b></a><br><sub>Terminal</sub></td>
    <td align="center" width="150"><a href="https://factory.ai/"><img src="docs/images/agents/factory.png" width="64" height="64" alt="Factory"><br><b>Factory</b></a><br><sub>Cloud platform</sub></td>
    <td></td>
    <td></td>
  </tr>
</table>

## Product Tour

### Core experience

- **Dashboard** — system-wide visibility into your skill environment
- **Skills Manager** — inspect, edit, sync, and remove skills
- **Marketplace** — search and install community skills quickly
- **Settings** — configure behavior, sources, and runtime preferences

### Skills Manager

Browse every installed skill, see which agents consume it, edit `SKILL.md` inline, and sync with one click.

![Skills Manager](docs/images/screenshots/skills.png)

### Marketplace

Search `skills.sh` and `ClawHub` in-app, preview a skill's target agents and repository, and install without touching the filesystem.

![Marketplace](docs/images/screenshots/marketplace.png)

### Settings

Theme, accent color, window blur, language, close behavior, and cache controls — all in one place.

![Settings](docs/images/screenshots/settings.png)

## Installation

Grab the installer for your OS from the [**latest release**](https://github.com/beautyfree/skiller-skills-desktop-manager/releases/latest):

| OS | File | Notes |
| --- | --- | --- |
| macOS (Apple Silicon) | `stable-macos-arm64-Skiller.dmg` | Signed + notarized — opens with no Gatekeeper warnings. Open the DMG and drag Skill<img src="docs/images/readme-skiller-er.svg" alt="" width="23" height="14" /> to Applications. |
| Windows (x64) | `stable-win-x64-Skiller-Setup.zip` | Extract and run `Skiller.exe`. SmartScreen may show a one-time warning — click "More info" → "Run anyway". |
| Linux (x64) | `stable-linux-x64-Skiller-Setup.tar.gz` | Extract and run `bin/launcher` from the resulting folder. |

Every release is built and published by the CI matrix in `.github/workflows/release.yml` — tagging `vX.Y.Z` produces all three platforms automatically.

## Auto-updates

Once installed, Skill<img src="docs/images/readme-skiller-er.svg" alt="" width="26" height="16" /> keeps itself current:

- Checks for new versions on launch, then every 6 hours in the background.
- Downloads delta patches (~14 KB typical) when available; falls back to the full bundle if the patch chain breaks.
- Shows status and a one-click **Restart & install** button in **Settings → App Updates**.

The updater points at `github.com/.../releases/latest/download`, so every tagged release on GitHub automatically becomes the next update for existing installs.

## For Developers

All development, build, and debugging details are in **[docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)**.

## Contributing

Contributions are welcome.  
Open an issue first if you want to discuss a feature or behavior change.

## License

[MIT](./LICENSE)