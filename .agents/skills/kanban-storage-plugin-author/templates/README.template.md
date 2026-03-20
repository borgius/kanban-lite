# __PACKAGE_NAME__

`__PACKAGE_NAME__` is a kanban-lite storage plugin that provides `__CAPABILITIES__`.

## Install

```bash
npm install __PACKAGE_NAME__
```

If the provider depends on an optional runtime driver, install that too:

```bash
npm install __OPTIONAL_DRIVER__
```

## Provider id

Use `__PROVIDER_ID__` in `.kanban.json`.

## Example config

```json
{
  "plugins": {
    "card.storage": {
      "provider": "__PROVIDER_ID__",
      "options": {
        __OPTIONS_EXAMPLE__
      }
    }
  }
}
```

If this package also exports `attachmentStoragePlugin`, add:

```json
{
  "plugins": {
    "attachment.storage": {
      "provider": "__PROVIDER_ID__"
    }
  }
}
```

## Runtime notes

- File-backed: `__IS_FILE_BACKED__`
- Watch glob: `__WATCH_GLOB__`
- Attachments: `__ATTACHMENT_STRATEGY__`

## Development

```bash
npm install
npm run build
```

## What to customize

- Replace the placeholder engine options with the real backend config.
- Implement actual card persistence in `src/index.ts`.
- Remove the attachment export if this package should only provide `card.storage`.
- Add tests once the backend behavior is concrete.
