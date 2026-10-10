import { useEffect, useRef, useState } from "react";
import type { ChatMessage } from "./types";
type History = {
  messages: ChatMessage[];
  has_more: boolean;
  next_after_id: string;
  next_before_id: string | null;
};
export default function ChatPanel({ listingId }: { listingId: string }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState("Connecting…");
  const [ready, setReady] = useState(false);
  const [notice, setNotice] = useState("");
  const [user, setUser] = useState("");
  const [pending, setPending] = useState<{
    client_message_id: string;
    body: string;
  } | null>(null);
  const [older, setOlder] = useState<string | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const socket = useRef<WebSocket | null>(null);
  const conversation = useRef("");
  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  const merge = (incoming: ChatMessage[]) =>
    setMessages((prev) =>
      [...new Map([...prev, ...incoming].map((m) => [m.id, m])).values()].sort(
        (a, b) =>
          BigInt(a.id) < BigInt(b.id)
            ? -1
            : BigInt(a.id) > BigInt(b.id)
              ? 1
              : 0,
      ),
    );
  useEffect(() => {
    let stopped = false;
    let reconnect: ReturnType<typeof setTimeout>;
    let poll: ReturnType<typeof setInterval>;
    let watermark = "0",
      initialized = false,
      syncing = false,
      attempt = 0;
    const abort = new AbortController();
    setMessages([]);
    setOlder(null);
    setPending(null);
    setReady(false);
    setNotice("");
    async function syncHistory() {
      if (stopped || syncing || !conversation.current) return;
      syncing = true;
      try {
        do {
          const suffix = initialized ? `?after_id=${watermark}` : "";
          const r = await fetch(
            `/api/conversations/${conversation.current}/messages${suffix}`,
            {
              credentials: "same-origin",
              cache: "no-store",
              signal: abort.signal,
            },
          );
          if (!r.ok)
            throw new Error(
              r.status === 401
                ? "Sign in to read your messages."
                : "Message history is temporarily unavailable.",
            );
          const page: History = await r.json();
          if (stopped) return;
          merge(page.messages);
          watermark = page.next_after_id;
          if (!initialized) {
            setOlder(page.next_before_id);
            initialized = true;
            break;
          }
          if (!page.has_more) break;
        } while (!stopped);
      } catch (e) {
        if (!stopped)
          setNotice(e instanceof Error ? e.message : "History unavailable.");
      } finally {
        syncing = false;
      }
    }
    function connect() {
      if (stopped) return;
      const url = new URL(
        `/api/ws/conversations/${conversation.current}`,
        location.href,
      );
      url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(url);
      socket.current = ws;
      ws.onmessage = (event) => {
        if (stopped) return;
        let value: any;
        try {
          value = JSON.parse(event.data);
        } catch {
          return;
        }
        if (value.type === "ready") {
          attempt = 0;
          setReady(true);
          setStatus("Connected");
          setUser(value.current_user_id);
          void syncHistory();
        }
        if (value.type === "message") {
          merge([value as ChatMessage]);
          const currentPending = pendingRef.current;
          if (
            currentPending &&
            value.client_message_id === currentPending.client_message_id
          ) {
            const sentBody = currentPending.body;
            setPending(null);
            setDraft((prev) => (prev === sentBody ? "" : prev));
            setNotice("");
          }
        }
        if (value.type === "error") setNotice(value.detail);
      };
      ws.onclose = (event) => {
        if (stopped) return;
        setReady(false);
        if (event.code === 1008) {
          clearInterval(poll);
          setStatus("Sign in or check conversation access.");
          return;
        }
        setStatus("Connection lost. Reconnecting…");
        reconnect = setTimeout(
          connect,
          Math.min(30000, 1000 * 2 ** Math.min(attempt++, 5)) +
            Math.random() * 500,
        );
      };
      ws.onerror = () => {
        if (!stopped)
          setNotice(
            "The connection was interrupted. Messages remain in your history.",
          );
      };
    }
    (async () => {
      try {
        const r = await fetch("/api/conversations", {
          method: "POST",
          credentials: "same-origin",
          cache: "no-store",
          signal: abort.signal,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ listing_id: listingId }),
        });
        if (!r.ok)
          throw new Error(
            r.status === 401
              ? "Sign in to negotiate with this seller."
              : r.status === 409
                ? "You cannot negotiate on your own listing."
                : "This conversation cannot be opened right now.",
          );
        const c = await r.json();
        if (stopped) return;
        conversation.current = c.id;
        setUser(c.current_user_id);
        connect();
        poll = setInterval(() => void syncHistory(), 20000); // Recovery for missed Pub/Sub frames.
      } catch (e) {
        if (!stopped)
          setStatus(e instanceof Error ? e.message : "Chat unavailable.");
      }
    })();
    return () => {
      stopped = true;
      abort.abort();
      clearTimeout(reconnect);
      clearInterval(poll);
      socket.current?.close(1000);
      socket.current = null;
      conversation.current = "";
    };
  }, [listingId]);
  async function loadOlder() {
    if (!older || loadingOlder) return;
    setLoadingOlder(true);
    const room = conversation.current;
    try {
      const r = await fetch(
        `/api/conversations/${room}/messages?before_id=${older}`,
        { credentials: "same-origin", cache: "no-store" },
      );
      if (!r.ok) throw new Error("Older messages could not be loaded.");
      const page: History = await r.json();
      if (room !== conversation.current) return;
      merge(page.messages);
      setOlder(page.next_before_id);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "History unavailable.");
    } finally {
      setLoadingOlder(false);
    }
  }
  function send(retry = false) {
    const ws = socket.current;
    if (!ready || ws?.readyState !== WebSocket.OPEN) {
      setNotice("Reconnect before sending. Your draft stays here.");
      return;
    }
    const body = draft.trim();
    if (!body && !retry) return;
    const outgoing =
      retry && pending
        ? pending
        : { client_message_id: crypto.randomUUID(), body };
    setPending(outgoing);
    pendingRef.current = outgoing;
    ws.send(JSON.stringify({ type: "message", ...outgoing }));
    setNotice("Waiting for the server to save your message…");
  }
  return (
    <section
      aria-label="Seller negotiation"
      className="mt-6 border-t border-[#D5D9CD] pt-5"
    >
      <h3 className="text-lg font-semibold">Talk to the seller</h3>
      <p role="status" className="mt-1 text-sm text-[#5E675E]">
        {status}
      </p>
      <div className="my-4 max-h-64 space-y-3 overflow-y-auto rounded-lg border border-[#D5D9CD] p-3">
        {older && (
          <button
            onClick={() => void loadOlder()}
            disabled={loadingOlder}
            className="min-h-11 w-full text-sm text-[#A8442F]"
          >
            {loadingOlder ? "Loading…" : "Load older messages"}
          </button>
        )}
        {!messages.length && (
          <p className="text-sm text-[#5E675E]">
            Ask about price, availability, health records or collection.
          </p>
        )}
        {messages.map((m) => (
          <div
            key={m.id}
            className={`max-w-[90%] rounded-lg px-3 py-2 ${m.sender_id === user ? "ml-auto bg-[#DCE5D6]" : "bg-white"}`}
          >
            <p className="whitespace-pre-wrap break-words text-sm">{m.body}</p>
            <time
              dateTime={m.created_at}
              className="mt-1 block text-xs text-[#5E675E]"
            >
              {new Date(m.created_at).toLocaleTimeString("en-ZA", {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </time>
          </div>
        ))}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <label htmlFor="negotiation-message" className="text-sm font-medium">
          Your message
        </label>
        <textarea
          id="negotiation-message"
          maxLength={2000}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className="mt-2 min-h-24 w-full rounded-lg border border-[#D5D9CD] bg-white p-3 text-base"
        />
        <button
          disabled={!ready || !!pending || !draft.trim()}
          className="mt-3 min-h-11 rounded-lg bg-[#A8442F] px-5 text-sm font-semibold text-white"
        >
          Send message
        </button>
        {pending && (
          <button
            type="button"
            disabled={!ready}
            onClick={() => send(true)}
            className="ml-3 min-h-11 text-sm text-[#A8442F]"
          >
            Retry same message
          </button>
        )}
      </form>
      {notice && (
        <p role="status" className="mt-3 text-sm text-[#5E675E]">
          {notice}
        </p>
      )}
    </section>
  );
}
