"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";

interface Product {
  id: string;
  name: string;
}

interface DraftCard {
  id: string;
  kind: "message";
  factoryProductId: string | null;
  factoryName: string | null;
  productName: string | null;
  lastMessage: { text: string; translation: string | null; sender: string; company: string; time: number } | null;
  bubbles: string[];
  versions: { id: string; versionNumber: number; text: string; bubbles: string[]; status: string }[];
}

interface DecisionsPayload {
  counts: { toApprove: number; questions: number; samples: number };
  cards: DraftCard[];
}

export function ActionablesView() {
  const [data, setData] = React.useState<DecisionsPayload | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState(false);
  const [products, setProducts] = React.useState<Product[]>([]);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/decisions");
      if (!res.ok) throw new Error("bad response");
      setData(await res.json());
      setError(false);
    } catch {
      setData(null);
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    load();
    fetch("/api/products")
      .then((r) => r.json())
      .then((d) => {
        const arr = Array.isArray(d) ? d : d.products || [];
        setProducts(arr.map((p: any) => ({ id: p.id, name: p.name || "Untitled" })));
      })
      .catch(() => {});
  }, [load]);

  const cards = data?.cards || [];
  const counts = data?.counts;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-3xl tracking-tight">Actionables</h2>
        <p className="text-muted-foreground" data-testid="counter">
          {loading ? "Loading…" : error ? "Could not load." : `${counts?.toApprove || 0} to approve`}
        </p>
      </div>

      {!loading && !error && cards.length === 0 && (
        <p className="text-muted-foreground" data-testid="empty-state">
          Nothing needs you right now.
        </p>
      )}

      {!loading && !error && (
        <div className="flex flex-col gap-3">
          {cards.map((c) => (
            <ActionableCard key={c.id} card={c} products={products} onChanged={load} />
          ))}
        </div>
      )}
    </div>
  );
}

function timeAgo(ts: number | null): string {
  if (!ts) return "";
  const diff = Date.now() - ts;
  if (diff < 60_000) return "just now";
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3600_000)}h ago`;
  return new Date(ts).toLocaleDateString();
}

function ActionableCard({ card, products, onChanged }: { card: DraftCard; products: Product[]; onChanged: () => void }) {
  const [busy, setBusy] = React.useState(false);
  const [suggestOpen, setSuggestOpen] = React.useState(false);
  const [suggestText, setSuggestText] = React.useState("");
  const [disapproveOpen, setDisapproveOpen] = React.useState(false);
  const [disapproveText, setDisapproveText] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [selectedProductId, setSelectedProductId] = React.useState<string>("");
  const [closed, setClosed] = React.useState(false);

  if (closed) return null;

  const latest = card.versions?.[card.versions.length - 1];
  const draftText = latest?.text || (card.bubbles?.join("\n\n") || "");
  const msg = card.lastMessage;

  async function post(url: string, body?: unknown) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error || `Failed (${res.status})`);
        return false;
      }
      setSuggestOpen(false);
      setDisapproveOpen(false);
      setSuggestText("");
      setDisapproveText("");
      onChanged();
      return true;
    } catch {
      setError("Request failed.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  const approve = () => {
    if (latest) {
      post(`/api/drafts/${card.id}/versions/${latest.id}/approve`, {}).then((ok) => ok && setClosed(true));
    }
  };

  const submitSuggestion = () => {
    if (!suggestText.trim()) return;
    post(`/api/drafts/${card.id}/versions`, { suggestionText: suggestText.trim() }).then(() => {
      setSuggestText("");
      onChanged();
    });
  };

  const disapprove = () => {
    // Disapprove the current draft, then Donna writes a new one (same card)
    if (latest) {
      post(`/api/drafts/${card.id}/versions/${latest.id}/disapprove`, disapproveText.trim() ? { reason: disapproveText.trim() } : {}).then(() => {
        setDisapproveOpen(false);
        setDisapproveText("");
        onChanged();
      });
    }
  };

  const ignore = () => {
    setClosed(true);
  };

  const hasProduct = card.productName || card.factoryProductId;
  const needsProductPick = !hasProduct && products.length > 0;

  return (
    <Card data-testid="card-message">
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <CardTitle className="flex flex-col gap-1">
          <span className="text-base font-medium">
            {msg?.sender || card.factoryName || "Unknown sender"}
            {msg?.company ? ` · ${msg.company}` : ""}
          </span>
          <span className="text-xs font-normal text-muted-foreground">
            {timeAgo(msg?.time || null)}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {/* Product dropdown if unknown */}
        {needsProductPick && (
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Product:</span>
            <NativeSelect
              value={selectedProductId}
              onChange={(e) => setSelectedProductId(e.target.value)}
              className="max-w-60"
            >
              <NativeSelectOption value="">Select a product…</NativeSelectOption>
              {products.map((p) => (
                <NativeSelectOption key={p.id} value={p.id}>{p.name}</NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
        )}
        {hasProduct && (
          <div className="text-sm">
            <span className="text-muted-foreground">Product: </span>
            <span>{card.productName || "—"}</span>
          </div>
        )}

        {/* They said */}
        {msg && (
          <div className="rounded-md border bg-muted/40 p-2 text-sm">
            <div className="mb-1 text-xs font-medium text-muted-foreground">They said</div>
            <div>{msg.translation || msg.text}</div>
            {msg.translation && <div className="mt-1 text-xs text-muted-foreground">{msg.text}</div>}
          </div>
        )}

        {/* Donna will reply */}
        <div className="rounded-md border p-2 text-sm">
          <div className="mb-1 text-xs font-medium text-muted-foreground">Donna will reply</div>
          {draftText ? (
            <div className="whitespace-pre-wrap">{draftText}</div>
          ) : (
            <div className="text-muted-foreground">No draft yet.</div>
          )}
        </div>

        {/* Buttons */}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={busy} onClick={approve} data-testid="approve-btn">
            Approve
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => { setSuggestOpen(!suggestOpen); setDisapproveOpen(false); }}
            data-testid="suggest-btn"
          >
            Suggest changes
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => { setDisapproveOpen(!disapproveOpen); setSuggestOpen(false); }}
            data-testid="disapprove-btn"
          >
            Disapprove
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={ignore}
            data-testid="ignore-btn"
          >
            Ignore
          </Button>
        </div>

        {suggestOpen && (
          <div className="flex flex-col gap-2 rounded-md border p-2">
            <Textarea
              data-testid="suggest-box"
              placeholder="What should change?"
              value={suggestText}
              onChange={(e) => setSuggestText(e.target.value)}
            />
            <Button size="sm" disabled={busy || !suggestText.trim()} onClick={submitSuggestion} data-testid="suggest-submit">
              Save
            </Button>
          </div>
        )}

        {disapproveOpen && (
          <div className="flex flex-col gap-2 rounded-md border p-2">
            <Textarea
              data-testid="disapprove-box"
              placeholder="Reason (optional)"
              value={disapproveText}
              onChange={(e) => setDisapproveText(e.target.value)}
            />
            <Button size="sm" variant="destructive" disabled={busy} onClick={disapprove} data-testid="disapprove-confirm">
              Disapprove — write a new draft
            </Button>
          </div>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}
