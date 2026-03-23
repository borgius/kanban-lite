# n8n-nodes-kanban-lite

First-party [n8n](https://n8n.io) node package for [Kanban Lite](https://github.com/borgius/kanban-lite).

It exposes one app node and one trigger node backed by the same normalized transport layer, so the node UX stays consistent whether n8n talks to Kanban Lite through the local SDK or the remote standalone API.

Provides two nodes:

| Node | Type | Description |
|------|------|-------------|
| **Kanban Lite** | App node | Action node covering boards, cards, columns, comments, attachments, labels, settings, storage, forms, webhooks, workspace info, and auth status |
| **Kanban Lite Trigger** | Trigger node | Event-driven trigger node with transport-aware before/after event availability |

Both nodes support two transport modes:

| Mode | Credential | When to use |
|------|-----------|-------------|
| **Remote API** | `Kanban Lite API` | n8n connects to a running Kanban Lite standalone server over HTTP |
| **Local SDK** | `Kanban Lite SDK (Local)` | n8n runs on the same machine as the workspace and accesses it directly via the SDK |

> **Transport availability note** – Local SDK mode can observe **before-events** and **after-events**. Remote API mode receives **after-events only** through webhook delivery from the standalone server.

## Action coverage

The **Kanban Lite** app node currently exposes these resource groups and operations:

| Resource | Operations |
|----------|------------|
| **Board** | `list`, `get`, `create`, `update`, `delete`, `setDefault`, `triggerAction` |
| **Card** | `list`, `get`, `create`, `update`, `move`, `delete`, `transfer`, `purgeDeleted`, `triggerAction` |
| **Column** | `list`, `add`, `update`, `remove`, `reorder`, `setMinimized`, `cleanup` |
| **Comment** | `list`, `add`, `update`, `delete` |
| **Attachment** | `list`, `add`, `remove` |
| **Label** | `list`, `set`, `rename`, `delete` |
| **Settings** | `get`, `update` |
| **Storage** | `getStatus`, `migrateToSqlite`, `migrateToMarkdown` |
| **Form** | `submit` |
| **Webhook** | `list`, `create`, `update`, `delete` |
| **Workspace** | `getInfo` |
| **Auth** | `getStatus` |

This is the implemented node surface today; no extra n8n-only operations are documented here beyond what the package actually routes through the transport adapters.

---

## Install

### Via n8n community nodes UI

1. Open n8n → **Settings → Community Nodes**
2. Enter `n8n-nodes-kanban-lite` and install

### Manual / private node

```bash
# inside your n8n custom data directory
cd ~/.n8n
npm install n8n-nodes-kanban-lite
```

Then restart n8n.

## Transport setup

### Remote API mode

Use **Remote API** when n8n talks to a running Kanban Lite standalone server.

Create a **Kanban Lite API** credential:

| Field | Description |
|-------|-------------|
| Base URL | URL of the Kanban Lite standalone server (for example `http://localhost:3000`) |
| Auth Mode | `None`, `Bearer Token`, or `API Key Header` |
| Token / API Key | Secret value used when auth is enabled |
| API Key Header Name | Header name to use when Auth Mode is `API Key Header` (default: `X-Api-Key`) |

Use this mode when:

- n8n and Kanban Lite run on different machines or containers
- you already expose the standalone Kanban Lite server over HTTP
- you want trigger delivery via registered webhooks rather than in-process subscriptions

### Local SDK mode

Use **Local SDK** when n8n runs on the same machine as the Kanban Lite workspace and can access the board files directly.

Create a **Kanban Lite SDK (Local)** credential:

| Field | Description |
|-------|-------------|
| Workspace Root | Absolute path to the directory containing `.kanban.json` |
| Board Directory | Optional absolute path to the `.kanban` directory; when omitted the node resolves `<workspaceRoot>/.kanban` |

Local SDK mode requirements:

- n8n must run on the same machine as the Kanban Lite workspace
- the workspace path must be readable by the n8n process
- the standalone server does **not** need to be running
- the n8n runtime must have `kanban-lite` installed so the node can load `kanban-lite/sdk` at runtime

Example local install for SDK mode:

```bash
cd ~/.n8n
npm install kanban-lite n8n-nodes-kanban-lite
```

---

## Private / local development

To use this package from source in the monorepo during development:

```bash
# Build the package
cd packages/n8n-nodes-kanban-lite
pnpm run build

# Symlink into your n8n custom nodes directory
ln -s "$(pwd)" ~/.n8n/custom/n8n-nodes-kanban-lite
```

Then restart n8n and the nodes will be available.

---

## Trigger setup and limitations

The **Kanban Lite Trigger** node is built from the exported SDK event catalog, so its event names and transport limits follow the code exactly.

### Remote API trigger mode

Remote API mode registers a Kanban Lite webhook and receives **after-events only**.

Use this mode for events such as:

- card lifecycle: `task.created`, `task.updated`, `task.moved`, `task.deleted`
- board lifecycle: `board.created`, `board.updated`, `board.deleted`, `board.action`
- comments / columns / attachments / labels: `comment.created|updated|deleted`, `column.created|updated|deleted`, `attachment.added|removed`
- other committed events: `settings.updated`, `storage.migrated`, `form.submitted`, `board.log.added|cleared`, `log.added|cleared`, `auth.allowed|denied`

Remote API trigger limitations:

- n8n must expose a reachable webhook URL so Kanban Lite can POST deliveries back to the workflow
- before-events are **not** available remotely
- if you pick a before-event in API mode, the node fails with an explicit unsupported-event error instead of silently ignoring it

### Local SDK trigger mode

Local SDK mode subscribes directly to the in-process SDK event bus, so it can observe both **before-events** and **after-events**.

Examples of **SDK-only before-events**:

- card mutations: `card.create`, `card.update`, `card.move`, `card.delete`, `card.transfer`, `card.action.trigger`, `card.purgeDeleted`
- column and config flows: `column.reorder`, `column.setMinimized`, `settings.update`, `storage.migrate`
- workflow/admin events: `webhook.create|update|delete`, `form.submit`, `board.setDefault`, `board.action.trigger`

### Trigger payload shape

Each delivered trigger item includes:

- `event` — canonical event name
- `label` and `resource` — human-friendly catalog metadata
- `transport` — `sdk` or `api`
- `phase` — `before` or `after`
- `capabilities` — transport availability flags
- `timestamp`, `payload`, and `raw`

### Suggested setup flow

1. Install `n8n-nodes-kanban-lite`
2. Choose **Remote API** when you already run the standalone Kanban Lite server, or **Local SDK** when n8n is co-located with the workspace
3. For trigger workflows, choose an **after-event** if you need Remote API mode, or switch to **Local SDK** for SDK-only before-events
4. Keep the trigger node active so n8n can hold the local subscription or remote webhook registration open

---

## Links

- [Kanban Lite docs](https://github.com/borgius/kanban-lite)
- [API reference](https://github.com/borgius/kanban-lite/blob/main/docs/api.md)
- [Auth & security](https://github.com/borgius/kanban-lite/blob/main/docs/auth.md)
