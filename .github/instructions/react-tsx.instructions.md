---
description: "Use when editing React, TSX, or JSX components in this repo. Covers Hooks discipline, JSX preferences, stable keys, and lint-safe React patterns."
name: "react tsx lint contract"
applyTo:
  - "**/*.tsx"
  - "**/*.jsx"
---

# React / TSX lint contract

- When editing React or TSX, write code that passes `eslint.config.mjs` without adding new inline `eslint-disable` comments.
- Follow Hooks rules and prefer fixing dependency arrays over suppressing `react-hooks/exhaustive-deps`.
- Prefer self-closing JSX for elements without children.
- Prefer boolean props like `disabled` over `disabled={true}`.
- Avoid useless fragments when a single element or expression is enough.
- Do not use array indexes as React keys when a stable identifier exists.
- Avoid defining components inside other components unless there is a clear, local reason.
- After React or TSX edits, run the relevant lint target and fix the violations introduced by your change.
