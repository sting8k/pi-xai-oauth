# pi-xai-oauth

**xAI (Grok) OAuth provider for pi** — 1M context, reasoning, and custom xAI tools.

```bash
npx pi-xai-oauth
```

This package adds **Grok 4.3** as a fully-integrated provider in pi, with proper OAuth login, automatic token refresh, and a suite of custom tools (`xai_generate_text`, `xai_web_search`, `xai_x_search`, etc.).

---

## Table of Contents

- [Features](#features)
- [How It Works](#how-it-works)
- [Installation](#installation)
- [Authentication](#authentication)
- [Usage](#usage)
  - [Switching Models](#switching-models)
  - [Reasoning / Thinking Levels](#reasoning--thinking-levels)
- [Custom Tools](#custom-tools)
- [Quick Reference](#quick-reference)
- [Troubleshooting](#troubleshooting)
- [Updating](#updating)
- [Uninstalling](#uninstalling)
- [Development](#development)
- [Contributing](#contributing)

---

## Features

- **Real OAuth login** — authenticates through xAI's official OAuth endpoint (same flow as the Grok CLI)
- **Automatic browser open** — pi opens your default browser automatically; fall back to manual paste if needed
- **Token refresh** — refresh tokens are stored and rotated automatically before expiry
- **Reuses existing credentials** — auto-detects `~/.grok/auth.json` from the official Grok CLI
- **1M context window** — Grok 4.3's full context, no truncation
- **Reasoning support** — configurable thinking levels: `low` / `medium` / `high`
- **Custom xAI tools** — generate text, web search, X/Twitter search, multi-agent research, code analysis
- **Modern API** — uses OpenAI's `responses` API format via `https://api.x.ai/v1`

---

## How It Works

`pi-xai-oauth` registers an OAuth provider called `xai-auth` in pi's provider registry. When you run `pi /login xai-auth`:

1. pi starts a local HTTP callback server on `127.0.0.1`
2. It builds an xAI OAuth authorize URL with PKCE challenge
3. **Your default browser opens automatically** to the xAI login page
4. After you approve, xAI redirects to the local callback server
5. The authorization code is exchanged for access + refresh tokens
6. Tokens are persisted and refreshed automatically

If localhost callbacks are blocked (VPN, Docker, remote dev), the TUI shows a text field where you can paste the redirect URL manually.

---

## Installation

### One-command install (recommended)

```bash
npx pi-xai-oauth
```

This runs the setup script which:
1. Installs `npm:pi-xai-oauth` into pi
2. Sets `xai-auth` as your default provider
3. Sets `grok-4.3` as your default model
4. Enables `high` thinking level by default

### Manual install

```bash
pi install npm:pi-xai-oauth
```

Then optionally configure it as default:

```bash
# In ~/.pi/agent/settings.json:
{
  "defaultProvider": "xai-auth",
  "defaultModel": "grok-4.3",
  "defaultThinkingLevel": "high"
}
```

### Try without installing

```bash
pi -e npm:pi-xai-oauth --model xai-auth/grok-4.3 "What's the meaning of life?"
```

This loads the extension ephemerally — useful for testing before committing.

---

## Authentication

```bash
pi /login xai-auth
```

**What happens:**

1. pi checks for existing Grok CLI credentials (`~/.grok/auth.json`). If found, it asks if you want to skip re-authentication.
2. The xAI OAuth page opens in your **default browser**.
3. Sign in with your xAI / Grok account and approve the authorization.
4. The browser redirects back to pi's local server — you can close the browser tab.
5. Tokens are stored and refreshed automatically.

> **Choosing a different browser/profile?** The instructions in the TUI explain how. You can copy the shown URL, open your preferred browser manually, and paste it there.

### Re-authenticating

Tokens are refreshed automatically, but if you want to force a fresh login:

```bash
pi /login xai-auth
```

The existing `~/.grok/auth.json` prompt lets you either reuse or re-authenticate.

---

## Usage

Once authenticated, start using Grok:

```bash
pi "Explain quantum computing like I'm 5"
```

Or use a specific model:

```bash
pi --model grok-4.3 "Write a poem about Rust"
```

### Switching Models

| Model ID | Description |
|----------|-------------|
| `grok-4.3` | **Default.** Full reasoning, 1M context. |
| `grok-4.20-0309-reasoning` | Legacy Grok 4.2 with reasoning. |
| `grok-4.20-0309-non-reasoning` | Legacy Grok 4.2, fast responses. |

From the pi TUI:

```
/model grok-4.3
/model grok-4.20-0309-reasoning
```

From the command line:

```bash
pi --model grok-4.3 "Your prompt here"
pi --model grok-4.20-0309-non-reasoning "Quick answer"
```

### Reasoning / Thinking Levels

All reasoning models support three levels:

```
/think high
/think medium
/think low
```

Or via CLI:

```bash
pi --model grok-4.3:high "Solve a complex math problem"
pi --model grok-4.3:low "What's the weather?"
```

- **`high`** — Deep reasoning, longer deliberation. Best for complex code, math, analysis.
- **`medium`** — Balanced speed and depth.
- **`low`** — Fast responses, minimal reasoning. Good for simple Q&A.

---

## Custom Tools

This package registers five custom tools that use the xAI API directly. They appear alongside your other agent tools:

### `xai_generate_text`
Generate text with full reasoning and stateful conversations.

```json
{
  "prompt": "Explain neural networks",
  "model": "grok-4.3",
  "reasoning_effort": "high"
}
```

### `xai_multi_agent`
Deep multi-agent research. Simulates a team of researchers collaborating on a topic.

```json
{
  "query": "Latest advances in LLM quantization",
  "num_agents": 16,
  "reasoning_effort": "high"
}
```

### `xai_web_search`
Search the web — powered by Grok's web knowledge.

```json
{
  "query": "Rust vs Go performance 2026"
}
```

### `xai_x_search`
Search X/Twitter for recent posts, trends, and sentiment.

```json
{
  "query": "grok 4.3"
}
```

### `xai_code_execution`
Ask Grok to analyze or simulate Python code execution.

```json
{
  "code": "print(sum(range(100)))"
}
```

> **Note:** These tools use the xAI API under the hood — they count toward your SuperGrok rate limits.

---

## Quick Reference

| Action | Command |
|--------|---------|
| Install | `pi install npm:pi-xai-oauth` |
| One-command setup | `npx pi-xai-oauth` |
| Try ephemeral | `pi -e npm:pi-xai-oauth` |
| Authenticate | `pi /login xai-auth` |
| Update | `pi update npm:pi-xai-oauth` |
| Remove | `pi remove npm:pi-xai-oauth` |
| List packages | `pi list` |
| Set default model | `/model grok-4.3` (in TUI) |
| Set thinking level | `/think high` (in TUI) |

---

## Troubleshooting

### "Browser didn't open automatically"

pi runs `open <url>` on macOS / `xdg-open` on Linux to launch your default browser. If nothing happens:

- **Copy the URL** shown in the TUI and paste it into your preferred browser manually.
- The local callback server is still listening — once you authorize, the redirect will be caught even if the browser doesn't match.

### "Callback server didn't receive the redirect"

If localhost is blocked (VPN, Docker, remote SSH, WSL):

1. After authorizing in the browser, the page will show an error (can't reach localhost).
2. **Copy the full URL** from the browser's address bar.
3. **Paste it into the TUI's input field** that says "Paste redirect URL below."
4. pi parses the authorization code from the URL and completes the login.

### "Cannot find provider xai-auth"

Run `pi list` to verify the package is installed. If not:

```bash
pi install npm:pi-xai-oauth
```

Then run `pi /list-providers` — you should see `xai-auth` listed.

### "Token expired / auth failed"

Tokens refresh automatically, but if something goes wrong:

```bash
pi /login xai-auth
```

This re-runs the full OAuth flow and replaces your stored tokens.

### "Does this need an xAI API key?"

**No.** This uses OAuth — the same authentication as the official Grok CLI and chat interface. You sign in with your xAI / Grok account credentials. No API key required.

If you have the official Grok CLI installed and authenticated (`~/.grok/auth.json`), this package detects and reuses those credentials automatically.

### "What model am I using?"

In the pi TUI, the current model is shown in the status bar. You can also check with:

```
/model
```

---

## Updating

```bash
pi update npm:pi-xai-oauth
```

This pulls the latest version from npm and updates your installed extension.

---

## Uninstalling

```bash
pi remove npm:pi-xai-oauth
```

This removes the extension from pi's package list. Your stored OAuth tokens remain in pi's credential store.

---

## Development

```bash
# Clone
git clone https://github.com/BlockedPath/pi-xai-oauth.git
cd pi-xai-oauth

# Install deps
npm install

# Type-check
npx tsc --noEmit

# Install local version in pi
pi install .
```

### Project Structure

```
pi-xai-oauth/
├── extensions/
│   └── xai-oauth.ts       # Provider registration + OAuth logic
├── bin/
│   └── setup.js           # One-command setup script (npx pi-xai-oauth)
├── package.json
├── tsconfig.json
└── README.md
```

### Publishing

```bash
# Bump version in package.json
# Then:
npm publish

# Users update with:
# pi update npm:pi-xai-oauth
```

---

## Contributing

PRs welcome! If you find issues or want to improve the OAuth flow, feel free to open an issue or pull request on [GitHub](https://github.com/BlockedPath/pi-xai-oauth).

---

*Powered by Grok 4.3 — 1M context, reasoning, and the full xAI API.*
