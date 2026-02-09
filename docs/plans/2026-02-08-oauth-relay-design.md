# OAuth Relay Escalation

## Problem

mallex-code currently requires an Anthropic API key for escalating complex tasks to Claude. Users with Claude Pro Max subscriptions can't use their subscription — they must pay separately for API access. The proxy sets `ANTHROPIC_AUTH_TOKEN=local`, hijacking Claude Code's auth flow entirely.

## Solution

Act as a transparent HTTP relay. Let Claude Code authenticate normally with its OAuth token (Pro/Max subscription). When escalating, forward the exact request — headers, body, query string — to `api.anthropic.com`. From Anthropic's perspective, the request is indistinguishable from a direct Claude Code request.

## Verified Assumptions (empirically tested)

- Claude Code sends auth via `Authorization: Bearer sk-ant-oat01-...` header (not `X-Api-Key`)
- Request path includes query string: `/v1/messages?beta=true`
- User agent: `claude-cli/2.1.37 (external, cli)`
- Includes `anthropic-beta`, `anthropic-version`, `x-app: cli`, and `X-Stainless-*` telemetry headers
- OAuth credentials stored in macOS Keychain under `Claude Code-credentials`
- Token refresh handled internally by Claude Code

## Architecture

### Routing Rules

```
POST /v1/messages  → intent router (local MLX or relay to Anthropic)
*                  → relay to api.anthropic.com
```

All paths except `/v1/messages` are relayed transparently — this covers `count_tokens`, token refresh, and any future Claude Code endpoints we don't know about.

When the intent router decides "local", `/v1/messages` is handled by MLX as today. When it decides "claude", `/v1/messages` is relayed.

### Relay Function

A new `relayToAnthropic()` function in `proxy.ts` (or a new `relay.ts`):

1. Copy all incoming request headers
2. Replace `host` with `api.anthropic.com`
3. Forward to `https://api.anthropic.com` + original path + query string
4. Pipe response back to client (works for both JSON and SSE streaming)

Zero header manipulation. Zero body parsing. Just change the destination and upgrade to HTTPS.

### Spawning Claude Code

When OAuth is the auth method, spawn `claude` with only `ANTHROPIC_BASE_URL` — do NOT set `ANTHROPIC_AUTH_TOKEN`:

```typescript
const env: Record<string, string> = {
  ...process.env,
  ANTHROPIC_BASE_URL: `http://localhost:${proxyPort}`,
};
if (routing?.authMethod !== "oauth") {
  env.ANTHROPIC_AUTH_TOKEN = "local";
}
```

This lets Claude Code use its real OAuth token, which arrives at our proxy in request headers.

### Setup Flow

Remove the API key prompt from router setup. When any tier targets Claude:

```
Claude escalation will use your Claude Code login (Pro/Max).
Make sure you've run 'claude login' first.
```

Store `authMethod: "oauth"` in config. The `claudeApiKey` config field and `claude-client.ts` remain in the codebase but are not surfaced in the UI.

### Error Handling

For relayed requests, pass all Anthropic error responses through unchanged:

- **401 (auth error):** Claude Code handles token refresh. If the refresh request hits our proxy (because of `ANTHROPIC_BASE_URL`), the catch-all relay forwards it to Anthropic.
- **429 (rate limit):** Claude Code has its own retry logic.
- **Network failure (can't reach Anthropic):** Fall back to local MLX. Log `[mallex] Anthropic unreachable, falling back to local`.

## Config Changes

```typescript
interface RoutingConfig {
  rules: Record<IntentCategory, RoutingRule>;
  tiers: Record<ModelTierNumber, TierModel>;
  claudeApiKey?: string;              // kept for backwards compat, not surfaced in UI
  authMethod?: "apikey" | "oauth";    // new, defaults to "oauth"
}
```

## Files Changed

| File | Change |
|------|--------|
| `src/config.ts` | Add `authMethod` to `RoutingConfig` |
| `src/setup-router.ts` | Remove API key prompt, add OAuth messaging, set `authMethod: "oauth"` |
| `src/proxy.ts` | Add relay function, change routing: relay all non-`/v1/messages` paths, use relay for Claude escalation in OAuth mode |
| `src/index.ts` | Conditionally set `ANTHROPIC_AUTH_TOKEN` based on `authMethod` |

## Files NOT Changed

| File | Reason |
|------|--------|
| `src/claude-client.ts` | Kept for potential future API key mode, not used in OAuth path |
| `src/router.ts` | Intent classification unchanged |
| `src/translate-*.ts` | Only used for local MLX path, unchanged |

## Testing

- Unit test: `relayToAnthropic` correctly forwards headers (mock HTTPS)
- Unit test: setup flow sets `authMethod: "oauth"` and skips API key prompt
- Unit test: proxy routes non-`/v1/messages` paths to relay
- Manual test: run mallex with OAuth, verify escalation works with Pro Max subscription
- Manual test: verify token refresh works through the relay (let token expire or force 401)
