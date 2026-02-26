# Fix: Comment parser breaks when card content contains `---`

## Problem

`parseFeatureFile` in `src/sdk/parser.ts` splits post-frontmatter content by `\n---\n` and iterates in pairs (`i += 2`). When card content contains a `---` horizontal rule, it creates an extra section that shifts all subsequent pairs, causing comments to be silently dropped.

This leads to data loss: any SDK operation that reads and re-serializes a card (`updateCard`, `addLabel`, `moveCard`, `removeLabel`) will permanently destroy comments if the card body contains `---`.

## Root Cause

The pair-stepping loop assumes sections alternate strictly between comment headers and comment bodies. A `---` HR in card content breaks this assumption by inserting an extra section. The else branch consumes the next section (which may be a real comment header) as body text, then the `i += 2` skip causes further comment blocks to be missed.

## Solution

### Fix 1: Sequential scan in `parseFeatureFile`

Replace the `i += 2` pair-stepping loop with a sequential scan that checks each section individually:

```typescript
let i = 1
while (i < sections.length) {
  const section = sections[i]
  if (section?.trimStart().startsWith('comment:')) {
    const commentBody = sections[i + 1] || ''
    const comment = parseCommentBlock(section, commentBody)
    if (comment) comments.push(comment)
    i += 2
  } else {
    body += `\n---\n${section}`
    i += 1
  }
}
```

Comment headers are self-identifying (`comment: true`), so the parser can unambiguously distinguish them from content HRs without any escaping or delimiter changes.

### Fix 2: Empty comment validation in `addComment`

Add a guard at the top of `KanbanSDK.addComment`:

```typescript
if (!content?.trim()) throw new Error('Comment content cannot be empty')
```

## Files Changed

- `src/sdk/parser.ts` — replace pair-stepping loop with sequential scan
- `src/sdk/KanbanSDK.ts` — add empty content validation in `addComment`
- `src/sdk/__tests__/parser.test.ts` — add tests for `---` in content with comments

## Tests

1. Parse card with `---` HR in content, no comments
2. Parse card with `---` HR in content + comments after
3. Parse card with multiple `---` HRs in content + comments
4. Round-trip card with `---` in content + comments
5. `addComment` rejects empty content
