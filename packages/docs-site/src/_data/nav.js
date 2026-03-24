/**
 * Navigation data: top nav, CTA targets, sidebar tree, and per-section metadata.
 * Consumed by base.njk (top nav + CTA), sitenav.njk (sidebar), and T3/T4 section landers.
 */
export default {
  topNav: [
    { label: "Docs", href: "/docs/" },
    { label: "Tour", href: "/docs/tour/" },
    { label: "SDK", href: "/docs/sdk/" },
    { label: "API", href: "/docs/api/" },
    { label: "CLI", href: "/docs/cli/" },
    { label: "MCP", href: "/docs/mcp/" },
    { label: "Plugins", href: "/docs/plugins/" },
    {
      label: "GitHub",
      href: "https://github.com/borgius/kanban-lite",
      external: true,
    },
  ],

  ctaTargets: {
    primary: { label: "Get Started", href: "/docs/quick-start/" },
    secondary: {
      label: "View on GitHub",
      href: "https://github.com/borgius/kanban-lite",
    },
  },

  /** Sidebar navigation tree for the docs shell layout */
  sidebar: [
    {
      label: "Getting Started",
      items: [
        {
          label: "Overview",
          href: "/docs/",
          children: [
            { label: "Quick Start", href: "/docs/quick-start/" },
            { label: "Product Tour", href: "/docs/tour/" },
          ],
        },
      ],
    },
    {
      label: "Feature Guides",
      items: [
        {
          label: "Workflow Guides",
          href: "/docs/cards/",
          children: [
            { label: "Cards & Workflows", href: "/docs/cards/" },
            { label: "Search & Filtering", href: "/docs/search/" },
            { label: "Boards & Columns", href: "/docs/boards/" },
          ],
        },
      ],
    },
    {
      label: "Interfaces",
      items: [
        { label: "CLI", href: "/docs/cli/" },
        { label: "REST API", href: "/docs/api/" },
        { label: "MCP Server", href: "/docs/mcp/" },
      ],
    },
    {
      label: "Reference",
      items: [
        { label: "SDK", href: "/docs/sdk/" },
        { label: "Forms", href: "/docs/forms/" },
        { label: "Webhooks", href: "/docs/webhooks/" },
        { label: "Auth", href: "/docs/auth/" },
      ],
    },
    {
      label: "Extending",
      items: [
        {
          label: "Plugin System",
          href: "/docs/plugins/",
          children: [
            { label: "Storage Providers", href: "/docs/storage/" },
            { label: "Auth & Policies", href: "/docs/auth/" },
            { label: "Webhook Delivery", href: "/docs/webhooks/" },
          ],
        },
      ],
    },
    {
      label: "Resources",
      items: [
        {
          label: "Examples",
          href: "/docs/examples/",
          children: [
            { label: "Chat SDK / Vercel AI", href: "/docs/examples/chat-sdk/" },
            { label: "LangGraph Python", href: "/docs/examples/langgraph-python/" },
            { label: "Mastra Agent Ops", href: "/docs/examples/mastra/" },
          ],
        },
        { label: "FAQ", href: "/docs/faq/" },
      ],
    },
  ],

  /**
   * Major product sections used by the homepage feature grid and section landers (T3/T4).
   * Each entry carries enough metadata for a card or icon-link in the UI.
   */
  sections: [
    {
      id: "quick-start",
      title: "Quick Start",
      href: "/docs/quick-start/",
      icon: "rocket",
      description: "Get a kanban board running in under 60 seconds.",
    },
    {
      id: "tour",
      title: "Product Tour",
      href: "/docs/tour/",
      icon: "eye",
      description: "Visual walkthrough of the board, cards, and search.",
    },
    {
      id: "cards",
      title: "Cards & Workflows",
      href: "/docs/cards/",
      icon: "card",
      description: "Priority, labels, comments, logs, actions, and forms.",
    },
    {
      id: "search",
      title: "Search & Filtering",
      href: "/docs/search/",
      icon: "search",
      description: "Fuzzy search, metadata tokens, and clickable filters.",
    },
    {
      id: "boards",
      title: "Boards & Columns",
      href: "/docs/boards/",
      icon: "board",
      description: "Multi-board support, column management, and board settings.",
    },
    {
      id: "sdk",
      title: "SDK",
      href: "/docs/sdk/",
      icon: "code",
      description:
        "JavaScript/TypeScript SDK — create boards, cards, and collections programmatically.",
    },
    {
      id: "api",
      title: "REST API",
      href: "/docs/api/",
      icon: "api",
      description:
        "Full OpenAPI-documented REST API served by the standalone server.",
    },
    {
      id: "cli",
      title: "CLI",
      href: "/docs/cli/",
      icon: "terminal",
      description:
        "Manage every board resource from the terminal with `kl` or `kanban-lite`.",
    },
    {
      id: "mcp",
      title: "MCP Server",
      href: "/docs/mcp/",
      icon: "robot",
      description:
        "Model Context Protocol tools for AI agents — Claude, Codex, and more.",
    },
    {
      id: "plugins",
      title: "Plugins",
      href: "/docs/plugins/",
      icon: "puzzle",
      description:
        "Capability-based plugin system for storage, webhooks, and auth.",
    },
    {
      id: "forms",
      title: "Forms",
      href: "/docs/forms/",
      icon: "form",
      description:
        "Attach reusable forms to cards for structured data collection.",
    },
    {
      id: "webhooks",
      title: "Webhooks",
      href: "/docs/webhooks/",
      icon: "webhook",
      description: "Outbound webhook delivery on kanban events.",
    },
    {
      id: "auth",
      title: "Auth",
      href: "/docs/auth/",
      icon: "lock",
      description:
        "Identity and policy plugin contract for action-level authorization.",
    },
    {
      id: "examples",
      title: "Examples",
      href: "/docs/examples/",
      icon: "recipe",
      description:
        "Recipes and runnable patterns for common Kanban Lite workflows.",
    },
    {
      id: "storage",
      title: "Storage Providers",
      href: "/docs/storage/",
      icon: "database",
      description:
        "Switch between markdown, SQLite, MySQL, or S3-backed storage with one config change.",
    },
    {
      id: "faq",
      title: "FAQ",
      href: "/docs/faq/",
      icon: "question",
      description: "Common questions before you adopt a new tool.",
    },
  ],
};
