"use client";

import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface Chat {
  id: string; name: string; channel: string; kind: string;
  last_at: number; message_count: number;
}
interface Msg {
  id: string; direction: string; text: string; translation: string; sent_at: number | null;
}

function fmtTime(ts: number | null) {
  if (!ts) return "";
  return new Date(ts).toLocaleString("en-US", {
    month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit",
  });
}

export default function MessagesPage() {
  const [chats, setChats] = React.useState<Chat[] | null>(null);
  const [activeId, setActiveId] = React.useState<string | null>(null);
  const [msgs, setMsgs] = React.useState<Msg[]>([]);
  const bottomRef = React.useRef<HTMLDivElement>(null);

  const loadChats = React.useCallback(async () => {
    try {
      const r = await fetch("/api/chats");
      if (r.ok) {
        const list = await r.json();
        setChats(list);
        if (!activeId && list.length > 0) setActiveId(list[0].id);
      } else setChats([]);
    } catch { setChats([]); }
  }, [activeId]);

  const loadMsgs = React.useCallback(async (chatId: string) => {
    try {
      const r = await fetch(`/api/messages?chat_id=${encodeURIComponent(chatId)}`);
      if (r.ok) setMsgs([...(await r.json())].reverse());
    } catch { /* keep old */ }
  }, []);

  React.useEffect(() => { loadChats(); }, [loadChats]);
  React.useEffect(() => {
    if (!activeId) return;
    loadMsgs(activeId);
    const t = setInterval(() => { loadChats(); loadMsgs(activeId); }, 10000);
    return () => clearInterval(t);
  }, [activeId, loadChats, loadMsgs]);
  React.useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs]);

  const active = chats?.find((c) => c.id === activeId);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">Messages</h1>
        <p className="text-sm text-muted-foreground">
          Everything Donna ingests from WhatsApp and email, live. Read-only.
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-[280px_1fr]">
        <Card>
          <CardHeader><CardTitle className="text-sm">Chats</CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-1">
            {chats === null && <p className="text-sm text-muted-foreground">Loading…</p>}
            {chats !== null && chats.length === 0 && (
              <p className="text-sm text-muted-foreground">No chats yet. Messages from factory groups appear here.</p>
            )}
            {chats?.map((c) => (
              <button
                key={c.id}
                onClick={() => setActiveId(c.id)}
                className={`rounded-md border p-2 text-left ${c.id === activeId ? "border-primary bg-accent" : ""}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium">{c.name}</span>
                  <Badge variant="outline">{c.message_count}</Badge>
                </div>
                <div className="text-xs text-muted-foreground">
                  {c.channel} · {c.kind} · {fmtTime(c.last_at)}
                </div>
              </button>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">{active?.name || "Select a chat"}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex max-h-[60vh] flex-col gap-2 overflow-y-auto">
              {msgs.map((m) => (
                <div
                  key={m.id}
                  className={`max-w-[80%] rounded-lg border p-2 ${
                    m.direction === "out" ? "self-end bg-primary/10" : "self-start"
                  }`}
                >
                  <div className="text-sm whitespace-pre-wrap">{m.text || "(media)"}</div>
                  {m.translation && (
                    <div className="mt-1 text-xs text-muted-foreground">{m.translation}</div>
                  )}
                  <div className="mt-1 text-[10px] text-muted-foreground">
                    {m.direction === "out" ? "Donna" : "them"} · {fmtTime(m.sent_at)}
                  </div>
                </div>
              ))}
              {activeId && msgs.length === 0 && (
                <p className="text-sm text-muted-foreground">No messages in this chat yet.</p>
              )}
              <div ref={bottomRef} />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
