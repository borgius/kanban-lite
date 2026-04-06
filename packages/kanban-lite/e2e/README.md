# Playwright E2E suite

Keep the standalone browser suite small, scenario-driven, and serial.

## Scenario map

- `core-workflow` → `standalone.spec.ts`, `standalone.search-filter.spec.ts`
- `comments-checklist` → `standalone.comments-checklist.spec.ts`
- `attachments-forms` → `standalone.attachments-forms.spec.ts`
- `auth-visibility` → `standalone.auth-visibility.spec.ts`
- `plugin-options` → `standalone.plugin-options.spec.ts`

## How to run

- Primary local run path from the repo root: `pnpm test:e2e`
- The root `playwright.config.ts` keeps this suite on one worker; maintain that serial expectation unless the fixture/bootstrap model changes first.

## Stability guardrails

- Prefer visible completion signals over sleeps.
- Keep selectors scoped to existing stable hooks (`data-testid`, explicit toggle labels, seeded card ids) before adding new affordances.
- When you touch this suite, re-run the affected spec set and one lightweight guardrail pass such as:
  - `pnpm exec playwright test --config=playwright.config.ts packages/kanban-lite/e2e/standalone.spec.ts packages/kanban-lite/e2e/standalone.search-filter.spec.ts packages/kanban-lite/e2e/standalone.comments-checklist.spec.ts packages/kanban-lite/e2e/standalone.attachments-forms.spec.ts packages/kanban-lite/e2e/standalone.auth-visibility.spec.ts packages/kanban-lite/e2e/standalone.plugin-options.spec.ts --reporter=list --repeat-each=2`
