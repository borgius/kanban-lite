# Kanban Lite

Kanban Lite is a markdown-first kanban board that works as a **CLI**, **REST API**, **MCP server**, **SDK**, **standalone web app**, and **VS Code extension**.

[![npm](https://img.shields.io/npm/v/kanban-lite)](https://www.npmjs.com/package/kanban-lite)
![License](https://img.shields.io/badge/license-MIT-green)

Manage tasks in plain files, keep everything version-controllable, and expose the same board through human and agent-friendly interfaces.

## Install

```bash
npm install -g kanban-lite
```

## Quick start

```bash
# initialize a workspace board
kl init

# create a card
kl add --title "My first task" --priority high

# start the standalone UI
kl serve

# start the MCP server for agent tools
kl mcp
```

## What you get

- **Markdown-first storage** by default
- **Web UI** with drag-and-drop board management
- **CLI** for automation and local workflows
- **REST API** for integrations
- **MCP server** for AI agents
- **SDK** for embedding Kanban Lite in your own tooling
- **Multi-board support**, comments, logs, forms, actions, labels, attachments, filters, and webhooks

## Common commands

```bash
# list cards
kl list

# create a card on a specific board
kl add --board bugs --title "Fix login bug"

# move a card
kl move fix-login-bug in-progress

# show current storage/provider status
kl storage status

# run the MCP server
kanban-mcp --dir .kanban
```

## SDK

```ts
import { KanbanSDK } from 'kanban-lite/sdk'

const sdk = new KanbanSDK('/path/to/.kanban')

const cards = await sdk.listCards()
const card = await sdk.createCard({
  content: '# Investigate outage',
  status: 'todo',
  priority: 'high',
})

await sdk.moveCard(card.id, 'in-progress')
```

## Docs

- Docs site: <https://borgius.github.io/kanban-lite/>
- Quick start: <https://borgius.github.io/kanban-lite/docs/quick-start/>
- Repository: <https://github.com/borgius/kanban-lite>
- Full README: <https://github.com/borgius/kanban-lite#readme>
- SDK docs: <https://github.com/borgius/kanban-lite/blob/main/docs/sdk.md>
- API docs: <https://github.com/borgius/kanban-lite/blob/main/docs/api.md>
- Webhooks docs: <https://github.com/borgius/kanban-lite/blob/main/docs/webhooks.md>
- Forms docs: <https://github.com/borgius/kanban-lite/blob/main/docs/forms.md>
- Auth docs: <https://github.com/borgius/kanban-lite/blob/main/docs/auth.md>

## Notes for npm users

The npm package is published from `packages/kanban-lite`, so the npm package page reads documentation from this package-local `README.md`.

For the full project documentation, screenshots, examples, and workspace-level guides, start with the docs site above.

## License

MIT
