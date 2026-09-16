"use client";

import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

const LAYER_LABEL: Record<number, string> = {
  1: "Layer 1: Intro",
  2: "Layer 2: Sourcing",
  3: "Layer 3: Sampling",
  4: "Layer 4: Quotation",
  5: "Layer 5: Shipped",
};

const DISAPPROVE_REASONS = ["Don't reply", "Wrong info", "Wrong tone", "Not now", "Other"];

interface DraftVersion {
  id: string;
  text?: string;
  suggestionText?: string;
  createdBy?: string;
  createdAt?: string;
}

interface Draft {
  id: string;
  status: "pending" | "sent" | "disapproved" | string;
  factoryName?: string;
  productName?: string;
  layer?: number;
  factoryLastMessage?: string;
  versions: DraftVersion[];
}

function latestVersion(d: Draft): DraftVersion | undefined {
  return d.versions && d.versions.length ? d.versions[d.versions.length - 1] : undefined;
}

function DraftCard({ draft, onChanged }: { draft: Draft; onChanged: () => void }) {
  const [suggestOpen, setSuggestOpen] = React.useState(false);
  const [editOpen, setEditOpen] = React.useState(false);
  const [disapproveOpen, setDisapproveOpen] = React.useState(false);
  const [suggestText, setSuggestText] = React.useState("");
  const [editText, setEditText] = React.useState("");
  const [reason, setReason] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const lv = latestVersion(draft);

  React.useEffect(() => {
    if (editOpen) setEditText(lv?.text || lv?.suggestionText || "");
  }, [editOpen, lv]);

  async function approve() {
    if (!lv) return;
    setBusy(true);
    try {
      await fetch(`/api/drafts/${draft.id}/versions/${lv.id}/approve`, { method: "POST" });
      onChanged();
    } catch {
      // ignore - endpoint may not exist yet
    } finally {
      setBusy(false);
    }
  }

  async function confirmDisapprove() {
    if (!lv || !reason) return;
    setBusy(true);
    try {
      await fetch(`/api/drafts/${draft.id}/versions/${lv.id}/disapprove`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      setDisapproveOpen(false);
      setReason(null);
      onChanged();
    } catch {
      // ignore
    } finally {
      setBusy(false);
    }
  }

  async function submitSuggestion() {
    if (!suggestText.trim()) return;
    setBusy(true);
    try {
      await fetch(`/api/drafts/${draft.id}/versions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ suggestionText: suggestText, createdBy: "ai_suggestion" }),
      });
      setSuggestText("");
      setSuggestOpen(false);
      onChanged();
    } catch {
      // ignore
    } finally {
      setBusy(false);
    }
  }

  async function submitEdit() {
    if (!editText.trim()) return;
    setBusy(true);
    try {
      await fetch(`/api/drafts/${draft.id}/versions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: editText, createdBy: "haim" }),
      });
      setEditOpen(false);
      onChanged();
    } catch {
      // ignore
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="flex flex-col gap-1">
          <span className="text-base font-medium">
            {draft.factoryName || "Unknown factory"} · {draft.productName || "Unknown product"}
          </span>
          <span className="text-xs font-normal text-muted-foreground">
            Draft #{draft.id} · {LAYER_LABEL[draft.layer || 0] || `Layer ${draft.layer ?? "?"}`}
          </span>
        </CardTitle>
        {draft.layer !== undefined && <Badge variant="outline">L{draft.layer}</Badge>}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {draft.factoryLastMessage && (
          <div className="rounded-md border bg-muted/40 p-2 text-sm">
            <div className="mb-1 text-xs font-medium text-muted-foreground">Factory's last message</div>
            {draft.factoryLastMessage}
          </div>
        )}
        <div className="rounded-md border p-2 text-sm">
          <div className="mb-1 text-xs font-medium text-muted-foreground">Latest draft</div>
          {lv?.text || lv?.suggestionText || <span className="text-muted-foreground">No draft text.</span>}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={busy || !lv} onClick={approve}>
            Approve
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setSuggestOpen((v) => !v);
              setEditOpen(false);
              setDisapproveOpen(false);
            }}
          >
            Suggest changes
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setEditOpen((v) => !v);
              setSuggestOpen(false);
              setDisapproveOpen(false);
            }}
          >
            Edit myself
          </Button>
          <Button
            size="sm"
            variant="destructive"
            onClick={() => {
              setDisapproveOpen((v) => !v);
              setSuggestOpen(false);
              setEditOpen(false);
            }}
          >
            Disapprove
          </Button>
        </div>

        {suggestOpen && (
          <div className="flex flex-col gap-2 rounded-md border p-2">
            <Textarea
              placeholder="Describe what should change..."
              value={suggestText}
              onChange={(e) => setSuggestText(e.target.value)}
            />
            <Button size="sm" disabled={busy || !suggestText.trim()} onClick={submitSuggestion}>
              Submit suggestion
            </Button>
          </div>
        )}

        {editOpen && (
          <div className="flex flex-col gap-2 rounded-md border p-2">
            <Textarea rows={6} value={editText} onChange={(e) => setEditText(e.target.value)} />
            <Button size="sm" disabled={busy || !editText.trim()} onClick={submitEdit}>
              Review
            </Button>
          </div>
        )}

        {disapproveOpen && (
          <div className="flex flex-col gap-2 rounded-md border p-2">
            <div className="flex flex-wrap gap-2">
              {DISAPPROVE_REASONS.map((r) => (
                <Button
                  key={r}
                  size="sm"
                  variant={reason === r ? "default" : "outline"}
                  onClick={() => setReason(r)}
                >
                  {r}
                </Button>
              ))}
            </div>
            <Button size="sm" variant="destructive" disabled={busy || !reason} onClick={confirmDisapprove}>
              Confirm disapprove
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function MessagesToApprove() {
  const [drafts, setDrafts] = React.useState<Draft[]>([]);
  const [tab, setTab] = React.useState<"pending" | "sent" | "disapproved">("pending");
  const [loading, setLoading] = React.useState(true);
  const [errored, setErrored] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/drafts?status=pending");
      if (!res.ok) throw new Error("bad response");
      const data = await res.json();
      setDrafts(Array.isArray(data) ? data : []);
      setErrored(false);
    } catch {
      setDrafts([]);
      setErrored(true);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    load();
  }, [load]);

  const filtered = drafts.filter((d) => (d.status || "pending") === tab);

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3">
        <CardTitle>Messages to approve</CardTitle>
        <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
          <TabsList>
            <TabsTrigger value="pending">Pending</TabsTrigger>
            <TabsTrigger value="sent">Sent</TabsTrigger>
            <TabsTrigger value="disapproved">Disapproved</TabsTrigger>
          </TabsList>
        </Tabs>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {loading && <p className="text-sm text-muted-foreground">Loading...</p>}
        {!loading && errored && (
          <p className="text-sm text-muted-foreground">Could not load drafts. Nothing to show right now.</p>
        )}
        {!loading && !errored && filtered.length === 0 && (
          <p className="text-sm text-muted-foreground">
            {tab === "pending" ? "No drafts waiting for approval." : `No ${tab} drafts.`}
          </p>
        )}
        {!loading && !errored && tab === "pending" && (
          <div className="flex flex-col gap-3">
            {filtered.map((d) => (
              <DraftCard key={d.id} draft={d} onChanged={load} />
            ))}
          </div>
        )}
        {!loading && !errored && tab !== "pending" && filtered.length > 0 && (
          <div className="flex flex-col gap-2">
            {filtered.map((d) => {
              const lv = latestVersion(d);
              return (
                <div key={d.id} className="rounded-md border p-2 text-sm">
                  <div className="font-medium">
                    {d.factoryName || "Unknown factory"} · {d.productName || "Unknown product"}
                  </div>
                  <div className="truncate text-muted-foreground">{lv?.text || lv?.suggestionText || "—"}</div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
