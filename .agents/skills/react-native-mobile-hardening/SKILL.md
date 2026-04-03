---
name: react-native-mobile-hardening
description: 'React Native mobile testing, performance, and release hardening for this repo. Use when validating Expo or React Native changes across mobile, iOS, Android, safe area, navigation, gestures, deep links, offline sync, camera, QR, testing, release, preview builds, startup performance, or no-stale-flash regressions.'
license: MIT
metadata:
  author: kanban-lite
  version: "1.0.0"
---

# React Native Mobile Hardening

Use this skill when the goal is to **test, harden, and de-risk** Kanban Lite mobile changes before they surprise users in the field. Small bugs become big bugs once a worker is offline, gloved up, and standing in the rain.

## When to Use

Use when the task mentions any of these ideas:

- React Native testing or Expo validation
- mobile regression checks for iOS or Android
- safe area, navigation, gesture, keyboard, or bottom-dock issues
- deep links, QR flows, restore gate, or wrong-workspace/wrong-user recovery
- offline sync, pending resend, conflict review, or stale-cache bugs
- camera, attachment capture, upload states, or QR scanning
- performance, startup time, jank, list scrolling, or render churn
- release hardening, preview builds, EAS profiles, or app identity checks

## Focus Areas

Always test these risk areas first:

1. **Protected-content safety**
   - no stale task flash during restore, reauth, workspace switch, deep links, or QR entry
   - cache purge behavior when workspace, subject, or session no longer match

2. **Offline truthfulness**
   - explicit resend for comments, forms, checklist intents, and attachment drafts
   - no silent replay of unsafe server mutations
   - clear `Pending`, `Needs connection`, and conflict states

3. **Field-worker ergonomics**
   - safe area clearance
   - large touch targets
   - one obvious primary action in the thumb zone
   - outdoor-readable contrast and short recovery copy

4. **Cross-platform correctness**
   - iOS and Android navigation behavior
   - deep links and scheme handling
   - keyboard overlap, gesture interactions, and back behavior

## Procedure

1. **Run the repo-supported validation set first.**
   - `pnpm --filter @kanban-lite/mobile run lint`
   - `pnpm --filter @kanban-lite/mobile run doctor`
   - `pnpm --filter @kanban-lite/mobile run start -- --offline --clear --port 8088`
   - `cd packages/mobile && APP_VARIANT=development pnpm exec expo config --json`
   - `cd packages/mobile && APP_VARIANT=preview pnpm exec expo config --json`

2. **Walk the highest-risk product flows.**
   - cold start and restore gate
   - `My Work` and `Due`
   - task detail
   - deep-link open
   - QR open
   - account/logout/recovery

3. **Exercise every mutation state, not just the happy path.**
   - comments: create, edit, delete, pending, resend
   - attachments: take photo, scan document, choose file, discard draft, remove synced attachment
   - forms: edit, save draft, submit, validation error
   - checklist: show, add, edit, delete, check, uncheck, conflict review
   - named actions: allowed online, denied, and offline-disabled

4. **Check capability and visibility behavior.**
   - hidden task means no task UI, not a disabled shell
   - denied mutation capability means hidden control, not a teasing disabled button
   - allowed-but-offline means either explicit local draft or a clear disabled state

5. **Profile the mobile experience for friction.**
   - look for unnecessary re-renders, long list jank, layout jumps, and oversized media work
   - verify the sticky action dock does not fight the keyboard or safe area
   - check that loading and sync states are calm instead of noisy or duplicated
   - prefer simple, stable interactions before adding fancy transitions

6. **Re-check release and app identity assumptions.**
   - `app.config.ts` and `eas.json` must agree on variant handling
   - preview and development identifiers should remain coexistence-safe
   - release changes should not assume production readiness beyond the current staged contract

7. **Document any failure by class, not just by symptom.**
   - safety issue: stale flash, wrong-workspace content, auth leakage
   - offline issue: pending state lies, silent replay, missing resend review
   - platform issue: iOS only, Android only, keyboard/gesture/back behavior
   - performance issue: slow startup, scroll jank, heavy image flow, repeated renders

## Hardening Checklist

Use this quick pass before calling a change done:

- restore gate never shows protected content too early
- deep links and QR routes validate workspace and session before task detail mounts
- safe area and bottom action dock work on iOS and Android
- offline sync states are explicit and truthful
- camera and attachment flows preserve durable local drafts when needed
- checklist, forms, comments, and actions respect capability gates
- preview/development config still resolves cleanly from Expo config

## Avoid

Avoid these release-footguns:

- treating lint success as sufficient mobile validation
- testing only online happy paths
- assuming browser auth behavior maps directly to Expo
- hiding a denial or mismatch bug behind cached content
- queuing destructive offline actions without explicit user review
- changing release profiles without re-checking variant-specific identifiers

## Done When

The mobile change is hardened when:

- correctness, offline behavior, and protected-content safety were all exercised
- iOS and Android interaction details were checked intentionally
- performance regressions were considered, not merely hoped away
- Expo validation and variant config still align with the repo contract
- release confidence comes from verified flows, not vibes
