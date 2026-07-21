# @noisebound/app

Next.js application surfacing σ-1's wallet-import, send-money, and
notifications/escalation UI over the `sigma-execute` / `sigma-core`
packages.

σ-1 acts privately by default and never gets a blank check on real money:
money-touching actions are gated by session-key scopes, and anything that
would leave σ-1's private zone shows up here as a disclosed, confirmable
escalation rather than a background notification.

## Usage

```bash
pnpm --filter @noisebound/app dev
```

Runs the app at `http://localhost:3000` with pages for the dashboard,
wallet sessions, and notifications.

```bash
pnpm --filter @noisebound/app build
pnpm --filter @noisebound/app start
```

## Depends on

- `@noisebound/sigma-core` — deterministic escalation and notification-budget policy.
- `@noisebound/sigma-execute` — action execution against session-key scopes.
- `@noisebound/identity` — ML-DSA-65 identity keys and capability tokens.
- `@noisebound/pqc-wallet` — post-quantum wallet key management.
- `@noisebound/networks` — network/chain configuration.
- `@noisebound/memory-store` — persistence for session/escalation state.
- `@noisebound/observe-loop` — background fact-observation loop.

## Test

```bash
pnpm --filter @noisebound/app test
```
