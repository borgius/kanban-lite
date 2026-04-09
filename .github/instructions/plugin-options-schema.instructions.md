---
description: "Use when changing plugin option schemas, optionsSchema(), uiSchema, policyOptionsSchemas, secret field metadata, or JSON Forms provider options. Load the repo skill and keep array and nested-object layouts explicit."
name: "plugin options schema"
---

# Plugin options schema guidance

- Load `.agents/skills/plugin-options-schema-author/SKILL.md` before changing `optionsSchema()` or `uiSchema` metadata.
- Prefer explicit JSON Forms layouts for arrays and nested objects instead of relying on fallback-generated layouts.
- Keep secret-field and provider-option metadata aligned with the shared Plugin Options form behavior.
