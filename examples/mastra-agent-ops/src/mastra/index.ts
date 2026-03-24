/**
 * src/mastra/index.ts — Mastra Registry
 *
 * This is the single entry point for the Mastra agent graph used by this
 * example. It registers the Coordinator agent and exports the `mastra`
 * instance so Next.js route handlers can call it without re-initialising.
 *
 * Add additional agents, workflows, or memory providers here as the example
 * grows. See the Mastra quickstart docs for configuration options:
 * https://mastra.ai/docs/getting-started/installation
 */

import { Mastra } from "@mastra/core";
import { coordinatorAgent } from "./agents/coordinator";

export const mastra = new Mastra({
  agents: {
    coordinator: coordinatorAgent,
  },
});
