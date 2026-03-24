'use client';

/**
 * app/page.tsx — Chat triage UI
 *
 * Single-page chat interface.  Connects to /api/chat via Vercel AI SDK's
 * useChat hook, streams responses, and renders tool call results inline.
 */

import { useChat } from 'ai/react';
import type { ToolInvocation } from 'ai';
import { useEffect, useRef } from 'react';

const SUGGESTIONS = [
  'Create a card: Fix the signup email flow, high priority',
  'List all backlog cards',
  'What cards are in progress?',
  'Move card mock-1 to done',
];

export default function ChatPage() {
  const { messages, input, setInput, handleInputChange, handleSubmit, isLoading } = useChat({
    api: '/api/chat',
  });

  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  return (
    <div style={s.page}>
      {/* ── Header ── */}
      <header style={s.header}>
        <h1 style={s.h1}>Kanban Chat Triage</h1>
        <p style={s.sub}>
          Natural-language card management &bull; kanban-lite + Vercel AI
        </p>
      </header>

      {/* ── Messages ── */}
      <main style={s.messages}>
        {messages.length === 0 && (
          <div style={s.empty}>
            <p style={s.emptyTitle}>Try one of these:</p>
            <ul style={s.suggestionList}>
              {SUGGESTIONS.map((text) => (
                <li key={text}>
                  <button
                    type="button"
                    style={s.suggestion}
                    onClick={() => setInput(text)}
                  >
                    {text}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {messages.map((msg) => (
          <div
            key={msg.id}
            style={{ ...s.bubble, ...(msg.role === 'user' ? s.bubbleUser : s.bubbleAI) }}
          >
            <span style={{ ...s.label, ...(msg.role === 'user' ? s.labelUser : s.labelAI) }}>
              {msg.role === 'user' ? 'You' : 'Assistant'}
            </span>

            {msg.content && <p style={s.text}>{msg.content}</p>}

            {msg.toolInvocations?.map((inv: ToolInvocation) => (
              <ToolCallBubble key={inv.toolCallId} inv={inv} />
            ))}
          </div>
        ))}

        {isLoading && (
          <div style={{ ...s.bubble, ...s.bubbleAI }}>
            <span style={{ ...s.label, ...s.labelAI }}>Assistant</span>
            <p style={{ ...s.text, color: '#94a3b8' }}>Thinking…</p>
          </div>
        )}

        <div ref={bottomRef} />
      </main>

      {/* ── Input ── */}
      <form onSubmit={handleSubmit} style={s.form}>
        <input
          value={input}
          onChange={handleInputChange}
          placeholder="Create a card, list cards, move a card…"
          disabled={isLoading}
          style={s.input}
          autoComplete="off"
        />
        <button
          type="submit"
          disabled={isLoading || !input.trim()}
          style={{ ...s.btn, ...(isLoading || !input.trim() ? s.btnDisabled : {}) }}
        >
          Send
        </button>
      </form>
    </div>
  );
}

// ── Tool call inline display ──────────────────────────────────────────────────

function ToolCallBubble({ inv }: { inv: ToolInvocation }) {
  const done = inv.state === 'result';
  return (
    <div style={{ ...s.toolWrap, ...(done ? s.toolDone : s.toolPending) }}>
      <span style={s.toolName}>⚡ {inv.toolName}</span>
      {done && 'result' in inv && (
        <pre style={s.toolResult}>{JSON.stringify(inv.result, null, 2)}</pre>
      )}
    </div>
  );
}

// ── Styles (inline — no external CSS framework needed) ────────────────────────

const s = {
  page: {
    display: 'flex',
    flexDirection: 'column' as const,
    height: '100dvh',
    maxWidth: 780,
    margin: '0 auto',
    background: '#fff',
    boxShadow: '0 0 0 1px #e2e8f0',
  },
  header: {
    padding: '1.2rem 1.5rem',
    borderBottom: '1px solid #e2e8f0',
    flexShrink: 0,
  },
  h1: { fontSize: '1.15rem', fontWeight: 700, color: '#0f172a', margin: 0 },
  sub: { fontSize: '0.78rem', color: '#64748b', margin: '0.2rem 0 0' },

  messages: {
    flex: 1,
    overflowY: 'auto' as const,
    padding: '1.5rem',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '0.9rem',
    background: '#f8fafc',
  },

  empty: { textAlign: 'center' as const, padding: '1.5rem 0', color: '#64748b' },
  emptyTitle: { fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.75rem' },
  suggestionList: { listStyle: 'none', padding: 0, display: 'flex', flexDirection: 'column' as const, gap: '0.4rem' },
  suggestion: {
    width: '100%',
    padding: '0.55rem 1rem',
    background: '#fff',
    border: '1px solid #e2e8f0',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '0.82rem',
    textAlign: 'left' as const,
    color: '#374151',
  },

  bubble: {
    padding: '0.7rem 1rem',
    borderRadius: '12px',
    maxWidth: '82%',
    wordBreak: 'break-word' as const,
  },
  bubbleUser: {
    alignSelf: 'flex-end' as const,
    background: '#3b82f6',
    color: '#fff',
  },
  bubbleAI: {
    alignSelf: 'flex-start' as const,
    background: '#fff',
    border: '1px solid #e2e8f0',
    color: '#1e293b',
  },
  label: {
    display: 'block',
    fontSize: '0.65rem',
    fontWeight: 700,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.06em',
    marginBottom: '0.3rem',
  },
  labelUser: { color: 'rgba(255,255,255,0.75)' },
  labelAI: { color: '#94a3b8' },
  text: { margin: 0, fontSize: '0.88rem', lineHeight: 1.55 },

  toolWrap: {
    marginTop: '0.5rem',
    padding: '0.45rem 0.7rem',
    borderRadius: '6px',
    fontSize: '0.78rem',
  },
  toolDone: { background: '#f0fdf4', border: '1px solid #bbf7d0' },
  toolPending: { background: '#fefce8', border: '1px solid #fde68a' },
  toolName: { fontWeight: 700, color: '#16a34a', display: 'block', marginBottom: '0.3rem' },
  toolResult: {
    margin: 0,
    fontSize: '0.72rem',
    whiteSpace: 'pre-wrap' as const,
    wordBreak: 'break-word' as const,
    color: '#374151',
    maxHeight: 200,
    overflowY: 'auto' as const,
  },

  form: {
    display: 'flex',
    gap: '0.6rem',
    padding: '1rem 1.5rem',
    background: '#fff',
    borderTop: '1px solid #e2e8f0',
    flexShrink: 0,
  },
  input: {
    flex: 1,
    padding: '0.6rem 0.85rem',
    border: '1px solid #cbd5e1',
    borderRadius: '8px',
    fontSize: '0.88rem',
    outline: 'none',
    background: '#f8fafc',
    color: '#1e293b',
  },
  btn: {
    padding: '0.6rem 1.2rem',
    background: '#3b82f6',
    color: '#fff',
    border: 'none',
    borderRadius: '8px',
    fontSize: '0.88rem',
    fontWeight: 600,
    cursor: 'pointer',
  },
  btnDisabled: { opacity: 0.5, cursor: 'not-allowed' as const },
} as const;
