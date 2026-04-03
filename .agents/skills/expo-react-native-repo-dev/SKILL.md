---
name: expo-react-native-repo-dev
description: 'Expo and React Native app-development workflow for this repo. Use when building or updating `packages/mobile`, Expo Router screens, React Native components, mobile iOS or Android behavior, safe area, navigation, gestures, deep links, offline sync, camera, QR, app config, or EAS profile work.'
license: MIT
metadata:
  author: kanban-lite
  version: "1.0.0"
---

# Expo React Native Repo Dev

Use this skill when the task is about **building the mobile app in this workspace**, not generic React Native advice.

## When to Use

Use when the request mentions any of these terms:

- Expo, React Native, or `packages/mobile`
- Expo Router routes, app shell, navigation, or screen structure
- iOS or Android behavior
- safe area, gestures, transitions, or mobile layout work
- deep links, QR entry, or app scheme handling
- offline sync, auth restore, or local draft flows
- camera, document capture, media handling, or QR scanning
- `app.config.ts`, `eas.json`, `package.json`, or Expo profile changes
- repo-specific mobile commands, monorepo behavior, or pnpm filters

## Current Repo Contract

Treat these as hard constraints unless the user explicitly changes them:

- the Expo app lives at `packages/mobile`
- the package name is `@kanban-lite/mobile`
- the stack is Expo SDK 55 + Expo Router
- the root layout already uses `SafeAreaProvider` in `packages/mobile/app/_layout.jsx`
- `packages/mobile/app.config.ts` owns the app `scheme` and variant-specific native identifiers
- `packages/mobile/eas.json` defines `development`, `preview`, and `production` profiles
- the mobile app must **not** import the Node-only `kanban-lite/sdk` runtime at runtime
- mobile code should talk to Kanban Lite through REST and mobile-local client modules
- the repo currently prefers lint + Expo validation over package-local TypeScript gating because React type majors differ across workspaces

## Procedure

1. **Start from the repo entry points.**
   - Check `packages/mobile/package.json` for the supported scripts.
   - Check `packages/mobile/app.config.ts` before touching bundle identifiers, scheme, or variant logic.
   - Check `packages/mobile/eas.json` before changing preview or release behavior.
   - Check the mobile docs in `docs/` when the change touches auth, offline sync, deep links, checklist actions, or visibility.

2. **Keep the runtime boundary clean.**
   - Do not import `kanban-lite/sdk` into Expo runtime code.
   - Prefer transport-safe DTOs, REST payloads, or mobile-local modules under `packages/mobile/src/**` as the app grows.
   - If shared logic is needed, make sure it is browser/mobile-safe rather than Node-runtime-specific.

3. **Build mobile flows around the approved shell.**
   - Keep navigation and screen organization aligned with Expo Router.
   - Respect safe area insets in every screen and sticky action region.
   - Treat dark mode and outdoor readability as defaults, not afterthoughts.
   - Keep deep-link and QR entry behind session/workspace validation.

4. **Handle mobile-only constraints deliberately.**
   - For camera, attachments, or QR work, prefer capture-first flows and durable local drafts.
   - For offline sync, use explicit resend later instead of implicit replay on reconnect.
   - For auth restore, rely on the mobile session contract rather than cookie-oriented browser assumptions.

5. **Avoid monorepo hacks unless a real bug proves they are needed.**
   - Prefer Expo SDK 55 built-in monorepo behavior.
   - Do not add custom Metro patches, ad hoc symlink fixes, or extra workspace plumbing unless there is a documented failure.
   - If a monorepo issue is real, fix it with documented Expo configuration rather than one-off workarounds.

6. **Validate with the repo-supported commands.**
   - `pnpm --filter @kanban-lite/mobile run lint`
   - `pnpm --filter @kanban-lite/mobile run doctor`
   - `pnpm --filter @kanban-lite/mobile run start -- --offline --clear --port 8088`
   - `cd packages/mobile && APP_VARIANT=development pnpm exec expo config --json`
   - `cd packages/mobile && APP_VARIANT=preview pnpm exec expo config --json`

7. **Treat release/profile edits as app-identity changes.**
   - Keep `development`, `preview`, and `production` aligned between `app.config.ts` and `eas.json`.
   - Preserve variant-specific package identifiers so preview and development builds can coexist.
   - Do not quietly broaden `production` assumptions; this repo’s mobile release path is still staged.

## Good Defaults

Use these defaults unless the request says otherwise:

- make the smallest possible change inside `packages/mobile`
- route with Expo Router, not ad hoc manual navigation state
- keep safe-area handling at the app shell and screen edges
- prefer repo-supported Expo validation commands over inventing new package-level gates
- keep mobile features REST-driven and workspace-local

## Avoid

Avoid these mistakes:

- importing `kanban-lite/sdk` into the mobile runtime
- assuming browser cookies are the right mobile session boundary
- adding custom Metro complexity before a real reproducible need exists
- introducing a package-local `typecheck` gate as the main quality bar while React type majors are still mixed
- changing EAS profiles without checking the variant-specific app config output
- building deep-link, navigation, camera, or offline flows without consulting the mobile docs first

## Done When

The change is in good shape when:

- it stays inside the repo’s Expo/React Native architecture
- iOS and Android behavior is considered explicitly
- safe area, navigation, gestures, deep links, and offline sync are accounted for
- mobile runtime code stays on the REST/mobile-local side of the boundary
- the supported lint, doctor, start, and Expo config validations still make sense for the change
