"use client";

import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface Msg {
  id: string;
  chat_id: string;
  chat_name: string;
  sender: string;
  direction: string;
  text: string;
  translation: string;
  sent_at: number;
}

function fmtTime(ts: number) {
  if (!ts) return "";
  try {
    return new Date(ts).toLocaleString("en-US", { month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" });
  } catch {
    return "";
  }
}

// Thin read-only live view over GET /api/messages. Auto-refreshes every 10s.
// The full Goal 6 timeline comes later; this slice is only for SEEING ingest.
export function MessagesView() {
  const [msgs, setMsgs] = React.useState<Msg[]>([]);
  const [chatId, setChatId] = React.useState("");
  const [error, setError] = React.useState("");

  const load = React.useCallback(async () => {
    try {
      const r = await fetch("/api/messages?limit=100", { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setMsgs(await r.json());
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "load failed");
    }
  }, []);

  React.useEffect(() => {
    load();
    const t = setInterval(load, 10_000);
    return () => clearInterval(t);
  }, [load]);

  // Chat list derived from the unfiltered batch; display filters client-side
  // so picking one chat never hides the others from the dropdown.
  const chats = React.useMemo(() => {
    const m = new Map<string, string>();
    for (const x of msgs) if (x.chat_id && !m.has(x.chat_id)) m.set(x.chat_id, x.chat_name || x.chat_id);
    return [...m.entries()];
  }, [msgs]);

  const shown = chatId ? msgs.filter((x) => x.chat_id === chatId) : msgs;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <CardTitle>Messages</CardTitle>
        <select
          aria-label="Chat"
          value={chatId}
          onChange={(e) => setChatId(e.target.value)}
          className="rounded-md border bg-background px-2 py-1 text-sm"
        >
          <option value="">All chats</option>
          {chats.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {error && <p className="text-sm text-destructive">Load failed: {error}</p>}
        {!error && shown.length === 0 && (
          <p className="text-sm text-muted-foreground">No messages yet. Ingested WhatsApp/email will appear here.</p>
        )}
        {shown.map((m) => {
          const out = m.direction === "out";
          return (
            <div key={m.id} className={`flex ${out ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[80%] rounded-lg border p-2 text-sm ${out ? "bg-primary text-primary-foreground" : "bg-muted"}`}
              >
                <div className="flex items-baseline justify-between gap-3 text-xs opacity-70">
                  <span>{m.sender || m.chat_name || (out ? "Us" : "Unknown")}</span>
                  <span>{fmtTime(m.sent_at)}</span>
                </div>
                {m.text && <p className="mt-1 whitespace-pre-wrap">{m.text}</p>}
                {m.translation && <p className="mt-1 whitespace-pre-wrap italic opacity-80">{m.translation}</p>}
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
