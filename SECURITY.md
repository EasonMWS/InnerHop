# Security & Platform Compliance Policy

## 1. Local-Only Threat Model

InnerHop runs entirely on the user's local machine:

- **Loopback Binding Only**: By default, the proxy binds strictly to `127.0.0.1`. Non-loopback hosts are rejected unless `INNERHOP_ALLOW_REMOTE=1` is explicitly set.
- **Browser Origin / CSRF Guard**: Management endpoints (`/api/*`) reject browser requests whose `Origin` is not `localhost` / `127.0.0.1` / `file://` / `null` with `403 Forbidden`, preventing malicious websites from reading local API keys or altering Harness configurations.
- **Credential Storage**: API keys and configurations are stored locally in `~/.innerhop/config.json` (with automatic non-destructive read-only migration from legacy `~/.orchestrator/` if present, and `0600` permissions on POSIX systems) and are never transmitted to any telemetry or third-party service.
- **Safe External Links**: Electron IPC `app:openExternal` strictly restricts opened URLs to `http:` and `https:` schemes.
- **Loop & Retry Bounds**: Inner-Hop transitions are hard-capped (`<= 3` per HTTP request), and upstream `401` / `403` / `429` errors terminate the turn immediately without automated retry loops.

## 2. Platform Terms of Service Compliance

- **Developer API Keys & Local Models Only**: InnerHop exclusively supports official developer API Keys (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, Google Gemini, DeepSeek, OpenRouter, etc.) and local inference runtimes (e.g., Ollama).
- **Consumer Subscription Proxying Strictly Blocked**: OpenAI and Anthropic Terms of Use prohibit proxying consumer subscription sessions (ChatGPT Plus/Pro, Claude Pro/Max) through third-party gateways or mixing consumer subscription tokens with developer API workflows. InnerHop does **not** support consumer OAuth passthrough and actively rejects requests carrying consumer ChatGPT session headers (`chatgpt-account-id`) with HTTP `403`.

## 3. Reporting a Vulnerability

If you discover a security issue, please avoid opening a public issue with exploit details and contact the repository maintainers privately once the repository URL is published.
