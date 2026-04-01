# kl-plugin-auth-visibility

A first-party [kanban-lite](https://github.com/borgius/kanban-lite) plugin package that implements the opt-in `auth.visibility` capability for role-based card visibility.

This package does **not** resolve identity, tokens, or sessions. `kl-plugin-auth` still owns identity resolution and role lookup. `kl-plugin-auth-visibility` only filters cards using the resolved identity/context that the SDK passes into it.

## Install

```bash
npm install kl-plugin-auth-visibility
```

## Capability

- `auth.visibility`

## Scope and v1 limits

`kl-plugin-auth-visibility` intentionally keeps the first release small and declarative:

- rules are selected by **roles only**
- matching rules are merged by **union**
- fields inside a rule use **AND** semantics
- multiple values inside one field use **OR** semantics
- assignees support explicit names plus `@me`
- supported card selectors are limited to:
  - status / column
  - labels
  - priority
  - assignee

Out of scope in v1:

- subject- or email-based rule selection
- groups, tokens, or metadata selectors
- board selectors
- standalone HTTP middleware/routes
- CLI commands
- MCP tools

Host surfaces should keep consuming SDK-filtered results rather than importing host-specific helpers from this package.

## Configuration

Install both auth packages, then select `kl-plugin-auth` for identity/policy and `kl-plugin-auth-visibility` for visibility.

```json
{
  "plugins": {
    "auth.identity": { "provider": "kl-plugin-auth" },
    "auth.policy": { "provider": "kl-plugin-auth" },
    "auth.visibility": {
      "provider": "kl-plugin-auth-visibility",
      "options": {
        "rules": [
          {
            "roles": ["design"],
            "statuses": ["backlog", "in-progress"],
            "labels": ["ux", "research"]
          },
          {
            "roles": ["manager"],
            "priorities": ["critical"],
            "assignees": ["@me", "casey"]
          }
        ]
      }
    }
  }
}
```

## Rule semantics

- If a caller matches **multiple** rules by role, the plugin returns the **union** of cards granted by those rules.
- If a caller matches **no** rules, the plugin returns **no visible cards**.
- Within a single rule:
  - different fields are combined with **AND** semantics
  - values inside the same field are combined with **OR** semantics
- `assignees: ["@me"]` matches cards assigned to the current resolved identity subject.

## Shared Plugin Options workflow

The provider exposes `optionsSchema()` and an explicit JSON Forms `uiSchema` so the shared Plugin Options flow can edit nested visibility rules without bespoke UI code.

## Local development

```bash
# From the repository root
pnpm --filter kanban-lite run build:sdk
pnpm --filter kl-plugin-auth-visibility test
pnpm --filter kl-plugin-auth-visibility build
```

## License

MIT
