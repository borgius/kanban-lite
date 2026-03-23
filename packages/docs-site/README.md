# docs-site

Eleventy-powered product and documentation website for [kanban-lite](https://github.com/borgius/kanban-lite).

## Local development

```bash
# From the workspace root:
pnpm --filter @kanban-lite/docs-site dev

# Or from this directory:
pnpm dev      # start dev server with live reload
pnpm build    # static build → _site/
pnpm clean    # remove _site/
```

## Structure

```
packages/docs-site/
  eleventy.config.mjs   ← Eleventy configuration
  package.json
  src/
    _data/              ← Global data files
    _includes/          ← Partials / macros
    _layouts/           ← Page layout templates
    assets/             ← Static assets (passthrough copy)
    index.njk           ← Homepage
  _site/                ← Build output (git-ignored)
```

## Content model

This package is a *rendering layer* on top of existing sources of truth.
It reads `README.md`, `CHANGELOG.md`, `docs/*.md`, `docs/press/*.md`, and
package `README.md` files **in-place** — it does not copy or relocate them.
