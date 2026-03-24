"use client";

/**
 * app/page.tsx — Project Coordinator Chat UI
 *
 * A minimal chat interface for the Mastra Coordinator agent.
 *
 * Streaming
 * ─────────
 * Uses a custom `useAgentChat` hook that POSTs to `/api/agent` and reads the
 * plain-text streaming response via the Fetch Streams API — no third-party
 * chat hook required.
 *
 * Approval UX
 * ───────────
 * When the agent proposes a write operation it emits a PROPOSED ACTION block
 * (delimited by ──── PROPOSED ACTION ──── and ─────────────────────────────).
 * This page detects that pattern and renders Approve / Reject buttons.
 * The buttons inject "approve" or "reject" as the next user message.
 */

import {
  useState,
  useCallback,
  useEffect,
  useRef,
  type ChangeEvent,
  type KeyboardEvent,
} from "react";

// ---------------------------------------------------------------------------

const PROPOSAL_RE =
  /──── PROPOSED ACTION[^\n]*\n([\s\S]*?)─{5,}[\s\S]*?(?:Type \*\*approve\*\*|approve)/i;

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
}

// ---------------------------------------------------------------------------
// Custom streaming chat hook
// ---------------------------------------------------------------------------

function useAgentChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const sendMessage = useCallback(
    async (userText: string) => {
      const userMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: "user",
        content: userText,
      };

      const history = [...messages, userMsg];
      setMessages(history);
      setIsLoading(true);

      const assistantId = crypto.randomUUID();
      setMessages((prev) => [
        ...prev,
        { id: assistantId, role: "assistant", content: "" },
      ]);

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const response = await fetch("/api/agent", {
          method: "POST",
          signal: controller.signal,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: history.map((m) => ({
              role: m.role,
              content: m.content,
            })),
          }),
        });

        if (!response.ok || !response.body) {
          throw new Error(`API error: ${response.status}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? { ...m, content: m.content + chunk }
                : m
            )
          );
        }
      } catch (err: unknown) {
        if (err instanceof Error && err.name !== "AbortError") {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? {
                    ...m,
                    content:
                      "[Error: could not reach the agent. Check your .env and kanban-lite server.]",
                  }
                : m
            )
          );
        }
      } finally {
        setIsLoading(false);
      }
    },
    [messages]
  );

  const append = useCallback(
    (msg: { role: "user"; content: string }) => sendMessage(msg.content),
    [sendMessage]
  );

  return { messages, isLoading, sendMessage, append };
}

// ---------------------------------------------------------------------------
// Message bubble
// ---------------------------------------------------------------------------

function MessageBubble({
  msg,
  onApprove,
  onReject,
}: {
  msg: ChatMessage;
  onApprove: () => void;
  onReject: () => void;
}) {
  const hasProposal =
    msg.role === "assistant" && PROPOSAL_RE.test(msg.content);

  let preText = msg.content;
  let proposalText = "";

  if (hasProposal) {
    const proposalStart = msg.content.search(/──── PROPOSED ACTION/i);
    preText =
      proposalStart > 0 ? msg.content.slice(0, proposalStart).trim() : "";
    proposalText = msg.content.slice(proposalStart).trim();
  }

  return (
    <div className={`message ${msg.role}`}>
      <span className="message-role">
        {msg.role === "user" ? "You" : "Coordinator"}
      </span>

      {preText && !hasProposal && (
        <div className="message-content">{preText}</div>
      )}

      {hasProposal && (
        <>
          {preText && <div className="message-content">{preText}</div>}
          <div className="proposal-block">
            <div className="proposal-label">
              Proposed Action — awaiting approval
            </div>
            {proposalText}
            <div className="proposal-actions">
              <button className="btn-approve" onClick={onApprove}>
                ✓ Approve
              </button>
              <button className="btn-reject" onClick={onReject}>
                ✗ Reject
              </button>
            </div>
          </div>
        </>
      )}

      {!hasProposal && (
        <div className="message-content">{msg.content}</div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Suggestions and page
// ---------------------------------------------------------------------------

const SUGGESTIONS = [
  "Show current board status",
  "Intake: add a new bug report",
  "Plan: organize backlog by priority",
  "Report: what is currently in progress?",
];

export default function CoordinatorPage() {
  const { messages, isLoading, sendMessage, append } = useAgentChat();
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = () => {
    const text = input.trim();
    if (!text || isLoading) return;
    setInput("");
    sendMessage(text);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="page">
      <header className="header">
        <h1>Kanban Project Coordinator</h1>
        <p>
          Supervisor-style Mastra agent — intake · planning · reporting ·
          approval-gated writes
        </p>
      </header>

      <div className="messages">
        {messages.length === 0 && (
          <div
            style={{
              color: "#475569",
              fontSize: "0.85rem",
              paddingTop: "0.5rem",
            }}
          >
            Start by asking the coordinator to survey the board, triage new
            work, or generate a status report.
          </div>
        )}

        {messages.map((msg) => (
          <MessageBubble
            key={msg.id}
            msg={msg}
            onApprove={() => append({ role: "user", content: "approve" })}
            onReject={() => append({ role: "user", content: "reject" })}
          />
        ))}

        <div ref={bottomRef} />
      </div>

      {messages.length === 0 && (
        <div className="suggestions">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              className="suggestion-chip"
              onClick={() => append({ role: "user", content: s })}
            >
              {s}
            </button>
          ))}
        </div>
      )}

      <div className="status-bar" style={{ opacity: isLoading ? 1 : 0.5 }}>
        {isLoading ? "Coordinator is responding…" : "Ready"}
      </div>

      <div className="input-bar">
        <textarea
          rows={1}
          value={input}
          placeholder="Message the coordinator… (Enter to send, Shift+Enter for newline)"
          onChange={(e: ChangeEvent<HTMLTextAreaElement>) =>
            setInput(e.target.value)
          }
          onKeyDown={handleKeyDown}
          disabled={isLoading}
        />
        <button onClick={handleSend} disabled={isLoading || !input.trim()}>
          Send
        </button>
      </div>
    </div>
  );
}
