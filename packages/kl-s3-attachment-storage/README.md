# kl-s3-attachment-storage

A [kanban-lite](https://github.com/borgius/kanban-lite) `attachment.storage` plugin that stores card attachments in Amazon S3 (or any S3-compatible object store such as MinIO or LocalStack).

The plugin also exposes an optional `appendAttachment(...)` hook for workloads such as card logs. When the target backend supports S3 native append (`WriteOffsetBytes` on directory buckets / S3 Express One Zone), appends happen in-place. When the backend does not support native append (for example standard S3 buckets or MinIO), the plugin reports that limitation so kanban-lite can fall back to a safe rewrite flow.

## Install

```bash
npm install kl-s3-attachment-storage
```

The package already declares `@aws-sdk/client-s3` as a dependency, so you do not need to install it separately unless you are managing dependencies manually for a custom bundle.

## Provider id

`kl-s3-attachment-storage`

## Capability

- `attachment.storage` only (this plugin does **not** provide `card.storage`)

## Configuration

All configuration is read from environment variables. No options are embedded in `.kanban.json` — this keeps credentials out of version-controlled config files.

| Variable | Required | Default | Description |
|---|---|---|---|
| `KL_S3_BUCKET` | **yes** | — | S3 bucket name |
| `KL_S3_REGION` | no | `AWS_REGION` → `us-east-1` | AWS region |
| `KL_S3_ENDPOINT` | no | AWS default | Custom endpoint URL (MinIO, LocalStack, etc.) |
| `KL_S3_PREFIX` | no | `""` | Object key prefix, e.g. `"kanban/"` |
| `KL_S3_FORCE_PATH_STYLE` | no | `"false"` | Set `"true"` for path-style addressing (required by MinIO) |

**Credentials** use the standard [AWS credential provider chain](https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/setting-credentials-node.html):
environment variables → `~/.aws/credentials` → EC2/ECS instance metadata, etc.

### Example environment variables

```bash
export KL_S3_BUCKET=my-kanban-attachments
export AWS_REGION=us-east-1
# AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY are picked up automatically
```

### MinIO / LocalStack example

```bash
export KL_S3_BUCKET=kanban
export KL_S3_ENDPOINT=http://localhost:9000
export KL_S3_FORCE_PATH_STYLE=true
export AWS_ACCESS_KEY_ID=minioadmin
export AWS_SECRET_ACCESS_KEY=minioadmin
export AWS_REGION=us-east-1
```

## `.kanban.json` example

```json
{
  "plugins": {
    "attachment.storage": {
      "provider": "kl-s3-attachment-storage"
    }
  }
}
```

Keep your default `card.storage` provider (e.g. `"markdown"`) as-is; this plugin only handles attachment storage.

When running locally from this monorepo, that usually means selecting the provider in your workspace `.kanban.json` and making sure the host environment can resolve the package from the installed path above.

## S3 object key pattern

Attachment objects are stored at a deterministic, collision-free key:

```
{prefix}boards/{boardId}/{cardId}/{filename}
```

For example, with `KL_S3_PREFIX=kanban/` and a card whose boardId is `"main"`:

```
kanban/boards/main/implement-search-2026-02-21/screenshot.png
```

## How `materializeAttachment` works

Because S3 is not a local filesystem, this plugin does **not** implement `getCardDir`. Instead, it implements `materializeAttachment`, which:

1. Validates the attachment name (rejects path traversal characters)
2. Confirms the attachment is registered on the card
3. Downloads the object from S3 to a deterministic temp-file path:
   `{os.tmpdir()}/kl-s3/{boardId}/{cardId}/{filename}`
4. Returns the local temp-file path

The temp file persists until the OS clears the temp directory. Your application is responsible for cleaning it up if needed.

## Native append support

`appendAttachment(...)` is intended for append-heavy workloads like card logs.

- **Native append path**: S3 directory buckets / S3 Express One Zone via `PutObject` + `WriteOffsetBytes`
- **Fallback path**: standard S3 buckets and S3-compatible APIs (including MinIO) return control to kanban-lite, which then performs a normal read/modify/write update through the attachment provider

This means log attachments still work everywhere, while append-capable backends can avoid re-uploading the full object on every append.

## File-backed

No. This provider stores attachments in S3 and has no local directory representation.

## Development

```bash
cd packages/kl-s3-attachment-storage
npm install
npm run build   # produces dist/index.cjs and dist/index.d.ts
npm run test:integration
npm run typecheck
```

From the repository root you can run the same package workflow with workspace filters:

```bash
pnpm --filter kl-s3-attachment-storage build
pnpm --filter kl-s3-attachment-storage test:integration
```
