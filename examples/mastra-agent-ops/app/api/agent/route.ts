/**
 * app/api/agent/route.ts — Streaming Chat Route
 *
 * Receives a list of messages from the client and streams the Coordinator
 * agent's text response back as a plain UTF-8 text stream.
 *
 * The Mastra agent may call kanban-lite tools during the stream; those tool
 * calls are handled server-side and only resulting text reaches the client.
 *
 * POST body: { messages: { role: "user" | "assistant", content: string }[] }
 * Response : text/plain stream (UTF-8, chunked)
 */

import { mastra } from "@/src/mastra";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export async function POST(req: Request): Promise<Response> {
  const body = (await req.json()) as { messages: ChatMessage[] };
  const { messages } = body;

  const agent = mastra.getAgent("coordinator");

  // agent.stream() returns a MastraModelOutput. We pipe text-delta chunks
  // from its fullStream as a plain UTF-8 streaming response.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await agent.stream(messages as any);

  const encoder = new TextEncoder();
  const readable = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        // fullStream is an AsyncIterable of AgentChunkType chunks.
        // Each text-delta chunk carries the incremental text in payload.text.
        for await (const chunk of result.fullStream as AsyncIterable<{
          type: string;
          payload: { text?: string };
        }>) {
          if (chunk.type === "text-delta" && chunk.payload.text) {
            controller.enqueue(encoder.encode(chunk.payload.text));
          }
        }
      } catch (err) {
        controller.error(err);
        return;
      }
      controller.close();
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache",
      "X-Accel-Buffering": "no",
    },
  });
}
