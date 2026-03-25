/**
 * Read-only content ingestion from existing repo markdown sources.
 * Returns raw markdown strings; templates render them via the `renderMarkdown` filter.
 * Sources are NEVER relocated or rewritten — this file is the sole adapter layer.
 */
import { readFile } from "fs/promises";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../");

/** Safe file reader — returns empty string when a source is missing. */
async function rd(relPath) {
  try {
    return await readFile(resolve(ROOT, relPath), "utf-8");
  } catch {
    return "";
  }
}

/**
 * Extract a top-level `## Heading` section from a markdown document.
 * Returns the heading line + body up to (but not including) the next `## ` heading.
 */
function extractSection(markdown, heading) {
  const re = new RegExp(`(## ${heading}\\n[\\s\\S]*?)(?=\\n## |$)`);
  const m = markdown.match(re);
  return m ? m[1] : "";
}

export default async function () {
  const [sdk, api, plugins, forms, webhooks, auth, readme] =
    await Promise.all([
      rd("docs/sdk.md"),
      rd("docs/api.md"),
      rd("docs/plugins.md"),
      rd("docs/forms.md"),
      rd("docs/webhooks.md"),
      rd("docs/auth.md"),
      rd("README.md"),
    ]);

  const cli = extractSection(readme, "CLI");
  const mcp = extractSection(readme, "MCP Server");

  return {
    sdk,
    api,
    plugins,
    forms,
    webhooks,
    auth,
    cli,
    mcp,
  };
}
