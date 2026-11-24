English | [简体中文](./README.zh-CN.md)

# Orchestrator

**Give any AI coding harness a stateful "Frontier Planner + Fast Executor" dual-model orchestration loop — without changing your workflow.**

Keep using **Claude Code, Codex CLI, OpenCode, Cline, Roo Code, Cursor, or Aider**. Point your client to the local `Orchestrator` proxy (`127.0.0.1:8787`), and every session automatically runs:

```mermaid
flowchart TD
    U["Your Request"] --> P["Planner (Frontier Model · Read-Only Exploration)"]
    P -- "Verified Plan · Single-Stream Handoff" --> E["Executor (Fast Low-Cost Model · Code & Tests)"]
    E -- "Consecutive Errors / Drift · Auto-Escalate" --> P
    E -- "Verified Done" --> D["Returned to Your AI Coding Tool"]
```

---

## Real-World Benchmark

In a live end-to-end build & verification task pairing **`gpt-6.2-astra` (read-only architecture + review)** with **`deepseek-flash` (coding + self-verification)**:
- **83% lower cost** compared to running `gpt-6.2-astra` end-to-end across all turns;
- Planner stays strictly read-only while exploring the codebase and drafting the plan, then hands off seamlessly inside the same SSE stream to the low-cost Executor — escalating back automatically if the Executor hits consecutive errors.

---

## Key Features

- **4-Tab Bilingual Desktop App (`EN / 中文`)**: Clean navigation (`Home · Console` → `API Keys` → `Strategies` → `Live Cockpit`) with system tray background execution and clean port release on quit.
- **Direct Home Control & Reasoning Effort**: Pick preset strategies or freely pair any vendor, model, and **5-level Reasoning Effort (`Default / Low / Medium / High / Extra High`)** directly from the console.
- **Non-Intrusive Smart-Split Routing**: Multi-select routing table lets you pick exactly which client model keywords trigger Orchestrator while all other models pass straight through to official APIs untouched.
- **Cross-Vendor & Multi-Protocol Translation**: Frontend harnesses and backend API providers are decoupled. Automatically adapts **OpenAI `/v1/responses`**, **Anthropic Adaptive Thinking & signed thinking blocks**, **DeepSeek `reasoning_content`**, and **Google Gemini `thought_signature`** across heterogeneous handoffs.

---

## Quick Start

### Option 1: Desktop App (Windows / macOS / Linux)

1. Download the release package for your OS from [GitHub Releases](https://github.com/EasonMWS/orchestrator/releases) (or build locally — see below).
   - **Windows**: Extract `Orchestrator-0.1.1-win.zip` and launch `Orchestrator.exe`.
   - **macOS / Linux**: Build locally with `pnpm desktop:pack:mac` (`.dmg` / `.zip` for Apple Silicon & Intel) or `pnpm desktop:pack:linux` (`.AppImage` / `.tar.gz`), or download the Linux archive from Releases.
2. Open **API Keys** in the left sidebar, paste your official developer API keys, and click **Test Key**.
3. Go to **Home · Console**, choose a strategy or manually select your Planner, Executor, and Reasoning Effort.
4. Connect your AI coding harness below and continue coding in your native tool.

### Option 2: CLI (`orch`)

```bash
# Launch a tool with ephemeral proxy env vars (does not touch global configs)
orch run claude
orch run codex
orch run opencode
orch run aider

# Or run the standalone local daemon
orch serve --port 8787
orch status
```

---

## Supported Harnesses

> **Frontend vs. Backend Decoupling**: Connecting a harness only controls which coding client enters Orchestrator — it works with **any** backend API provider you configure (e.g., Codex CLI or OpenCode can seamlessly dispatch Claude, Gemini, or DeepSeek models).

| Harness | Integration | Routing Behavior |
| :--- | :--- | :--- |
| **Claude Code** | One-click toggle (auto-backups `~/.claude/settings.json` and restores byte-for-byte) | Smart-Split intercepts only checked slots (`opus`, `opusplan`, etc.); other native models pass straight through to Anthropic. |
| **OpenAI Codex CLI** | One-click toggle (appends isolated `[profiles.orchestrator]` to `~/.codex/config.toml`) | Leaves the official Codex / ChatGPT Desktop app untouched; launch in terminal via `codex -p orchestrator`. |
| **OpenCode** | One-click toggle (backups & updates `~/.config/opencode/opencode.json`) | Injects `orchestrator` (follows active Home choice) plus pinned `orch:<strategy-id>` aliases while preserving existing providers. |
| **Other Harnesses (Cline / Roo Code / Cursor / Aider)** | Click **Setup Guide** in the unified card | Set Provider to `OpenAI Compatible`, Base URL `http://127.0.0.1:8787/v1`, any placeholder API Key, and Model `orchestrator` (or `orch:<id>`). |

---

## Recommended Model Pairings

| Use Case | Planner | Executor | Reasoning Effort | Notes |
| :--- | :--- | :--- | :--- | :--- |
| **Cross-Vendor Cost Saver (83% Cheaper)** | `gpt-6.2-astra` / `claude-opus-5-5` | `deepseek-flash` / `gemini-4-hydrogen` | Planner `High` · Executor `Low` | Frontier planning + ultra-low-cost execution |
| **OpenAI Flagship Stack** | `gpt-6.2-astra` | `gpt-6.2-sol` | Planner `High` · Executor `Low/Med` | Long-horizon engineering & reliable tool calls |
| **Anthropic Native Stack** | `claude-opus-5-5` / `claude-fable-5-2` | `claude-sonnet-5-5` | Planner `High` · Executor `Low` | Large refactors & architecture design |
| **100% Local & Free** | `deepseek-pro` or local model | Ollama `qwen3-coder:14b` | `Default` | Air-gapped / zero API spend |

---

## Compliance & Local Security

1. **Developer API Keys & Local Models Only**: Consumer subscriptions (ChatGPT Plus/Pro, Claude Pro/Max) prohibit third-party OAuth proxying. Orchestrator **only** uses official developer API keys or local Ollama, and explicitly rejects consumer session headers (`chatgpt-account-id`) with HTTP `403`.
2. **ChatGPT Pro Promotional API Credit Boundary**: OpenAI terms exclude using ChatGPT Pro monthly promotional API credits with Codex via API keys. Use non-Codex harnesses (e.g., OpenCode / Cline) if spending promotional credits, or use a separate pay-as-you-go API key with Codex CLI.
3. **Strict Local Threat Model**:
   - Binds strictly to `127.0.0.1` loopback by default;
   - Management endpoints (`/api/*`) enforce strict browser `Origin` checks against CSRF;
   - API keys stay exclusively on disk at `~/.orchestrator/config.json` (never transmitted or bundled). See [SECURITY.md](./SECURITY.md).

---

## Local Development & Packaging

Requirements: Node.js `>= 20`, `pnpm >= 10`.

```bash
# Install dependencies
pnpm install

# Run full test suite (FSM, security guards, cross-protocol E2E)
pnpm test

# Workspace typecheck & build
pnpm typecheck
pnpm build

# Desktop app dev mode
pnpm desktop:dev

# Package installers per platform (outputs to packages/desktop/release/)
pnpm desktop:pack          # Windows (.exe + .zip)
pnpm desktop:pack:mac      # macOS (.dmg + .zip, run on macOS)
pnpm desktop:pack:linux    # Linux (.AppImage + .tar.gz)
```

## License

[MIT](./LICENSE)
