import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../");

let version = "1.2.0";
try {
  const pkg = JSON.parse(
    readFileSync(resolve(ROOT, "packages/kanban-lite/package.json"), "utf-8")
  );
  version = pkg.version ?? version;
} catch {}

export default {
  name: "Kanban Lite",
  tagline: "Kanban boards as markdown files",
  description:
    "Lightweight, extensible kanban boards stored as markdown. Manage tasks via web UI, CLI, REST API, or MCP server.",
  url: "",
  version,
  github: "https://github.com/borgius/kanban-lite",
  npm: "https://www.npmjs.com/package/kanban-lite",
  currentYear: new Date().getFullYear(),
};
