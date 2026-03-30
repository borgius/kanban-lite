# React and lint expectations

When editing React or TSX in this workspace, write code that passes `eslint.config.mjs` without relying on new inline disable comments.

- Follow the Hooks rules and prefer fixing dependency arrays over suppressing `react-hooks/exhaustive-deps`.
- Prefer self-closing JSX for elements without children.
- Prefer boolean props like `disabled` over `disabled={true}`.
- Avoid useless fragments when a single element or expression is enough.
- Do not use array indexes as React keys when a stable identifier exists.
- Avoid defining components inside other components unless there is a clear, local reason.
- After React or TSX edits, run the relevant lint target and fix any violations introduced by the change.
- If a lint rule conflicts with an implementation idea, change the implementation before considering a rule suppression.
