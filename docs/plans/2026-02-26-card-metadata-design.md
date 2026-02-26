# Card Metadata Feature

## Summary

Allow users to attach arbitrary key-value metadata (`Record<string, any>`) to cards. Metadata is stored as a native YAML block in frontmatter, supports nested objects/arrays, and is exposed through all interfaces (SDK, CLI, API, MCP, UI).

## Data Model

Add `metadata` as an optional field:

```typescript
// Feature, FeatureFrontmatter, CreateCardInput
metadata?: Record<string, any>
```

On disk (YAML frontmatter):

```yaml
---
id: "42"
status: "in-progress"
priority: "high"
metadata:
  sprint: "2026-Q1"
  links:
    jira: "PROJ-123"
    figma: "https://figma.com/..."
  estimate: 5
  tags: ["v2", "backend"]
---
```

## Parser Changes

- Add `js-yaml` as a dependency.
- Use `js-yaml` only for the `metadata:` block — extract the indented lines under `metadata:` from the frontmatter string, parse with `js-yaml.load()`.
- Serialize with `js-yaml.dump()` (indent: 2, no flow style for readability).
- The rest of the parser stays as-is (regex-based `getValue()`/`getArrayValue()`).

## Feature Parity

All interfaces support metadata on create and update:

| Interface | Create | Update | Read |
|-----------|--------|--------|------|
| SDK | `createCard({ metadata })` | `updateCard(id, { metadata })` | `getCard()` returns metadata |
| CLI | `create --metadata '{"key":"val"}'` | `update --metadata '{"key":"val"}'` | `get` shows metadata |
| API | `POST /cards` body `{ metadata }` | `PATCH /cards/:id` body `{ metadata }` | `GET /cards/:id` returns metadata |
| MCP | `create_card` tool param | `update_card` tool param | `get_card` returns metadata |
| Webview | `createFeature` message | `updateFeature` message | Feature object includes metadata |

## UI

### Card Grid (FeatureCard.tsx)

When a card has metadata, show a small indicator chip (e.g., `{3}` showing key count), styled like the attachments count. Keeps cards clean.

### Card Detail Panel

- **Collapsed (default):** Shows top-level keys as a row of chips (e.g., `sprint`, `links`, `estimate`).
- **Expanded (on click):** Tree view showing key-value pairs. Nested objects indent further. Values rendered as formatted text.
- Read-only display — metadata is set via CLI/API/MCP or the card editor.

## Storage

No new files. Metadata lives inside the existing card `.md` files as part of YAML frontmatter. Empty/undefined metadata is omitted from the frontmatter entirely.
