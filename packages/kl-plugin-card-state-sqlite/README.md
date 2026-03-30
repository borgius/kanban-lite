# kl-plugin-card-state-sqlite

A first-party [kanban-lite](https://github.com/borgius/kanban-lite) package for a SQLite-backed `card.state` provider.

## What it provides

This package implements the shared `card.state` contract used by `kanban-lite` for:

- actor-scoped unread cursor persistence
- explicit open-card state persistence
- parity with the built-in file-backed `card.state` backend for unread derivation inputs and read/open mutations when exercised through the SDK

Unread derivation itself remains SDK-owned; this package persists the actor/card/domain state that the SDK reads and writes.

## Provider id

`sqlite`

## Capability

- `card.state`

## Install

```bash
npm install kl-plugin-card-state-sqlite
```

## Configure

Use the `sqlite` compatibility id under `plugins['card.state']`:

```json
{
	"version": 2,
	"plugins": {
		"card.state": {
			"provider": "sqlite",
			"options": {
				"sqlitePath": ".kanban/card-state.db"
			}
		}
	}
}
```

### Options

- `sqlitePath` — optional relative or absolute SQLite database path. Defaults to `.kanban/card-state.db`.

## Exports

The package exports:

- `createCardStateProvider(context)`
- `default` → `createCardStateProvider`
- `SQLITE_CARD_STATE_PROVIDER_ID`
- `DEFAULT_SQLITE_CARD_STATE_PATH`

The factory returns a contract-compatible provider with the same four operations expected by the SDK capability loader:

- `getCardState(...)`
- `setCardState(...)`
- `getUnreadCursor(...)`
- `markUnreadReadThrough(...)`

## Semantics

- unread state is scoped by `actorId + boardId + cardId`
- explicit open state is stored independently from unread cursor state
- reads are side-effect free until the SDK calls an explicit mutation (`markCardOpened()` / `markCardRead()`)
- auth-absent mode still uses the same stable default actor contract as the built-in backend because actor resolution lives in the SDK, not in the provider

## Build output

The published CommonJS entrypoint is:

```text
dist/index.cjs
```

Declaration output is emitted to `dist/index.d.ts`.

## Development

```bash
npm install
npm run build
npm test
npm run test:integration
npm run typecheck
```

From the repository root you can also run:

```bash
pnpm --filter kl-plugin-card-state-sqlite build
pnpm --filter kl-plugin-card-state-sqlite test
pnpm --filter kl-plugin-card-state-sqlite test:integration
pnpm --filter kl-plugin-card-state-sqlite typecheck
```
