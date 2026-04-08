# kl-plugin-callback

A first-party [kanban-lite](https://github.com/borgius/kanban-lite) package for the `callback.runtime` capability.

It establishes the provider metadata, shared plugin-settings schema, and listener-owned runtime contract for same-runtime callback automation. Configure it through the shared Plugin Options / CLI / REST API / MCP plugin-settings flow at `plugins["callback.runtime"]`, using one mixed `handlers[]` list that can describe shared `module` handlers plus legacy Node-only inline JavaScript and subprocess handlers.

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

- `id` — stable durable handler identifier
- `name` — user-facing label for settings and logs
- `type` — `module`, `inline`, or `process`
- `events` — one or more committed after-events to match
- `enabled` — disable without deleting
- `module` / `handler` — shared Worker-safe module specifier plus named export when `type` is `module`
- `source` — inline JavaScript when `type` is `inline`
- `command` / `args` / `cwd` — subprocess launch details when `type` is `process`

### Module handlers

Module handlers are the canonical shared callback contract. They live in the same `handlers[]` list and store an explicit module specifier plus named export (`module` + `handler`) so Node and Cloudflare runtimes can resolve the same saved row shape instead of introducing host-specific callback dialects. The transport-neutral normalization, event-pattern matching, execution-plan ordering, module-target resolution, and export validation rules now live in the shared SDK callback core.

On Node, `kl-plugin-callback` resolves matching `module` rows through the public SDK `resolveCallbackRuntimeModule(...)` seam and invokes the configured export with exactly one argument shaped as `({ event, sdk, callback })`. Relative module specifiers resolve from the workspace root while the configured specifier remains the stable cross-host identity, malformed enabled module rows fail closed during shared normalization, and `default` is only used when you write `handler: "default"` explicitly.

Cloudflare deploys statically bundle those module specifiers through the Worker `KANBAN_MODULES` registry, validate own callable exports before publish, persist one durable D1 event record per committed event, and drive queue-backed at-least-once delivery through the logical `callbacks` queue with compact `{ version, kind, eventId }` envelopes. That Cloudflare path is module-only by contract, retries only failed handlers while skipping completed ones on replay, and rejects enabled `inline` / `process` rows. The legacy bare CommonJS `module.exports = function` default shortcut remains an explicit Node-only compatibility behavior and is not part of the shared cross-host export contract.

### Inline handlers

Inline handlers are trusted same-runtime JavaScript evaluated with `new Function`. They are not sandboxed, run with host process privileges, remain a legacy Node-only mode, and receive exactly one argument shaped as `({ event, sdk, callback })`.

Inline JavaScript is authored through the shared plugin settings form using an embedded CodeMirror JavaScript editor (`uiSchema.options.editor = "code"`), not a separate callback-specific editor surface.

### Process handlers

Process handlers are configured in the same `handlers[]` array. They are normal subprocesses, not sandboxed, remain a legacy Node-only mode, and use a stdin-only contract: the runtime sends one serialized `{ event, callback }` JSON payload to the child process and does not expose a live SDK object or other in-memory runtime handles.

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
            "id": "module-task-created",
            "name": "module task creation",
            "type": "module",
            "events": ["task.created"],
            "enabled": true,
            "module": "./callbacks/task-created",
            "handler": "onTaskCreated"
          },
          {
            "id": "inline-task-created",
            "name": "log task creation",
            "type": "inline",
            "events": ["task.created"],
            "enabled": true,
            "source": "async ({ event, sdk, callback }) => { console.log(callback.handlerId, event.event, sdk.constructor.name) }"
          },
          {
            "id": "process-task-events",
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
