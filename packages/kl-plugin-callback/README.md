# kl-plugin-callback

A first-party [kanban-lite](https://github.com/borgius/kanban-lite) package for the `callback.runtime` capability.

It establishes the provider metadata, shared plugin-settings schema, and listener-owned runtime contract for same-runtime callback automation. Configure it through the shared Plugin Options / CLI / REST API / MCP plugin-settings flow at `plugins["callback.runtime"]`, using one mixed `handlers[]` list that can describe both inline JavaScript handlers and subprocess handlers.

## Install

```bash
npm install kl-plugin-callback
```

## Provider id

`callbacks`

## Capability

- `callback.runtime`
- listener-only `event.listener` integration via `callbackListenerPlugin`

## What this package owns

- discovery and selection for the `callback.runtime` capability
- the shared provider-options contract surfaced through SDK/UI/API/CLI/MCP plugin settings at `plugins["callback.runtime"]`
- the inline authoring choice: an embedded CodeMirror JavaScript editor in the existing shared JSON Forms settings flow
- the runtime listener export that executes matching handlers for committed Kanban after-events

## Handler model

Callback configuration lives under `plugins["callback.runtime"].options.handlers` as one ordered mixed list. The same path is surfaced by the shared Plugin Options tab, `kl plugin-settings`, `/api/plugin-settings`, and the MCP plugin-settings tools.

Each handler entry includes:

- `name` — user-facing label for settings and logs
- `type` — `inline` or `process`
- `events` — one or more committed after-events to match
- `enabled` — disable without deleting
- `source` — inline JavaScript when `type` is `inline`
- `command` / `args` / `cwd` — subprocess launch details when `type` is `process`

### Inline handlers

Inline handlers are trusted same-runtime JavaScript evaluated with `new Function`. They are not sandboxed, run with host process privileges, and receive exactly one argument shaped as `({ event, sdk })`.

Inline JavaScript is authored through the shared plugin settings form using an embedded CodeMirror JavaScript editor (`uiSchema.options.editor = "code"`), not a separate callback-specific editor surface.

### Process handlers

Process handlers are configured in the same `handlers[]` array. They are normal subprocesses, not sandboxed. The subprocess contract is stdin-only: the runtime sends one serialized JSON payload to the child process and does not expose a live SDK object or other in-memory runtime handles.

## Failure behavior

Matching handlers run in order. If one handler throws or exits non-zero, the runtime logs the failure and then continues with later matching handlers.

## Example `.kanban.json`

```json
{
  "plugins": {
    "callback.runtime": {
      "provider": "callbacks",
      "options": {
        "handlers": [
          {
            "name": "log task creation",
            "type": "inline",
            "events": ["task.created"],
            "enabled": true,
            "source": "async ({ event, sdk }) => { console.log(event.event, sdk.constructor.name) }"
          },
          {
            "name": "notify local worker",
            "type": "process",
            "events": ["task.created", "task.updated"],
            "enabled": true,
            "command": "node",
            "args": ["scripts/callback-worker.mjs"],
            "cwd": "."
          }
        ]
      }
    }
  }
}
```

## Exports

- `pluginManifest` — package metadata used by shared provider discovery
- `callbackListenerPlugin` — listener-owned runtime export for `callback.runtime`
- `optionsSchemas` — explicit provider options schema/uiSchema metadata keyed by provider id

## Local development

```bash
# from the repository root
pnpm --filter kl-plugin-callback test
pnpm --filter kl-plugin-callback build
```

## License

MIT
