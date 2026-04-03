# Mobile Expo monorepo ADR

- Status: accepted
- Date: 2026-04-02
- Task: MF1 (`docs/plan/20260401-mobile-field-app/plan.yaml`)

## Context

The mobile field app needs a hard go/no-go gate before backend/mobile contract work continues. The gate must prove four things inside the existing monorepo:

1. `packages/mobile` works under the current `packages/*` pnpm workspace without changing workspace globs.
2. Expo boots from that package and Metro resolves dependencies from the repo-root workspace install without ad hoc symlink hacks.
3. Root-level pnpm filtering can target the mobile package predictably.
4. Initial EAS development and preview profiles are viable enough to continue implementation.

The plan also freezes a non-negotiable runtime boundary: the mobile app must not import the Node-only `kanban-lite/sdk` runtime directly.

## Decision

### Package boundary

- The Expo app lives at `packages/mobile`.
- `pnpm-workspace.yaml` stays unchanged because `packages/*` already covers the new package.
- The package name is `@kanban-lite/mobile`, which becomes the stable root filter target for commands such as `pnpm --filter @kanban-lite/mobile <script>`.

### Metro and monorepo behavior

- Use Expo SDK 55 and Expo Router.
- Rely on Expo's built-in monorepo detection for SDK 55 instead of custom `watchFolders`, `extraNodeModules`, or symlink patches.
- Keep the initial scaffold free of custom Metro overrides. If a future package introduces a real monorepo resolution issue, fix it with documented `expo/metro-config` configuration rather than ad hoc hacks.

### Root workflow stability

- MF1 intentionally did **not** add package-local `build`, `watch`, or `dev` scripts during the initial gate.
- MF9C later adds a package-local `build` entry backed by `expo export --platform web --output-dir dist`, so root `pnpm run build` now exercises the mobile package without introducing the deferred React-type-gated `typecheck` path.
- Existing root aggregate flows such as `pnpm run watch` and `pnpm run dev:workspace` still keep their original behavior because MF9C only closes build coverage, not watch/dev orchestration.
- MF1 also avoids publishing a package-local `typecheck` script because the current repo mixes React 18 and React 19 type roots across workspaces. Keeping that script out of the package prevents `pnpm run typecheck:workspace` from becoming unstable before the monorepo chooses a shared React-type isolation strategy.
- Predictable targeting comes from explicit package filtering (`pnpm --filter @kanban-lite/mobile run <script>`) plus package-local `build`, `start`, `doctor`, and `lint` scripts.

### Runtime boundary

- The mobile app may **not** import `kanban-lite/sdk` at runtime.
- Mobile code must speak to Kanban Lite through REST endpoints and mobile-local client modules under `packages/mobile/src/**` as later tasks land.
- If shared types are needed later, prefer transport-safe DTOs or generated API/client types over reusing Node runtime modules.

### Initial EAS contract

- `development` is a development-client profile with internal distribution and `APP_VARIANT=development`.
- `preview` is an internal-distribution profile with `APP_VARIANT=preview` and Android APK output for easier stakeholder installs.
- `production` exists only as a baseline placeholder and is intentionally not release-ready in MF1.
- App config derives variant-specific native identifiers from `APP_VARIANT` so development and preview builds have a viable path to coexist without overwriting each other.

## Validation evidence

MF1 is considered passed only if the following commands succeed from the workspace root:

- `pnpm install`
- `pnpm --filter @kanban-lite/mobile run lint`
- `pnpm --filter @kanban-lite/mobile run doctor`
- `pnpm --filter @kanban-lite/mobile run start -- --offline --clear --port 8088`
- `cd packages/mobile && APP_VARIANT=development pnpm exec expo config --json`
- `cd packages/mobile && APP_VARIANT=preview pnpm exec expo config --json`

## Consequences

### Positive

- Expo/pnpm compatibility is proven before SDK/API/mobile contract work expands.
- The package boundary is additive and low-risk for the rest of the repo.
- The no-`kanban-lite/sdk` runtime rule is explicit before UI code grows around the wrong abstraction.
- Existing workspace build/watch/dev/typecheck flows remain unchanged while the mobile package is still in the gating phase.

### Deferred

- No production release automation is enabled in MF1.
- No native directories, credentials, or store-submission settings are added yet.
- Static boundary enforcement tests and the real REST client layer are deferred to later mobile tasks.
- Mobile-local TypeScript compile gating is deferred until the repo's mixed React type-major setup is isolated cleanly for Expo Router.
- Authenticated `eas-cli` project/build commands are deferred until an Expo account token/project is provisioned for the repo; MF1 validates the same env-driven app-config surface locally instead.
