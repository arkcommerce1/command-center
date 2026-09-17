"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";

export interface ActionableCard {
  id: string;
  senderName: string | null;
  company: string | null;
  time: number;
  productId: string | null;
  productName: string | null;
  productLinked: boolean;
  allProducts: { id: string; name: string }[] | null;
  conversationKey: string;
  theySaid: { text: string; translation: string | null }[];
  donnaReply: { bubbles: string[] } | null;
  decisionNeeded: string | null;
  previousDrafts: { bubbles: string[]; outcome: string }[];
  canApprove: boolean;
  canSuggest: boolean;
  canDisapprove: boolean;
  canIgnore: boolean;
}

function fmtTime(ts: number) {
  if (!ts) return "";
  return new Date(ts).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function ActionCard({ card, onChanged }: { card: ActionableCard; onChanged: () => void }) {
  const [suggestOpen, setSuggestOpen] = React.useState(false);
  const [suggestText, setSuggestText] = React.useState("");
  const [showPrevious, setShowPrevious] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function act(action: "approve" | "suggest" | "disapprove" | "ignore", text?: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/decisions/${card.id}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, text }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError((data as any)?.error || "That didn't work — try again.");
        return;
      }
      setSuggestOpen(false);
      setSuggestText("");
      onChanged();
    } catch {
      setError("That didn't work — try again.");
    } finally {
      setBusy(false);
    }
  }

  async function pickProduct(productId: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/decisions/link-product", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationKey: card.conversationKey,
          productId,
          factoryName: card.senderName ?? card.company ?? "",
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError((data as any)?.error || "Could not link this chat to that product.");
        return;
      }
      onChanged();
    } catch {
      setError("Could not link this chat to that product.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card data-testid="card-actionable">
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <CardTitle className="flex flex-col gap-1">
          <span className="font-medium text-base">
            {card.senderName ?? "Unknown sender"}
            {card.company ? ` · ${card.company}` : ""}
          </span>
          <span className="font-normal text-muted-foreground text-xs">{fmtTime(card.time)}</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex items-center gap-2 text-sm">
          <span className="font-medium">Product:</span>
          {card.productLinked ? (
            <span>{card.productName ?? "Unknown product"}</span>
          ) : (
            <select
              className="rounded-md border bg-background px-2 py-1 text-sm"
              data-testid="product-picker"
              disabled={busy}
              defaultValue=""
              onChange={(e) => e.target.value && pickProduct(e.target.value)}
            >
              <option value="" disabled>
                Which product is this?
              </option>
              {(card.allProducts ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          )}
        </div>

        {card.theySaid.length > 0 && (
          <div className="rounded-md border bg-muted/40 p-2 text-sm">
            <div className="mb-1 font-medium text-muted-foreground text-xs">They said</div>
            {card.theySaid.map((m, i) => (
              <p key={i} className={i > 0 ? "mt-2 border-t pt-2" : undefined}>
                {m.translation || m.text}
                {m.translation && <span className="mt-1 block text-muted-foreground text-xs">{m.text}</span>}
              </p>
            ))}
          </div>
        )}

        {card.decisionNeeded && (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-sm">{card.decisionNeeded}</div>
        )}

        {card.donnaReply && (
          <div className="rounded-md border p-2 text-sm">
            <div className="mb-1 font-medium text-muted-foreground text-xs">Donna will reply</div>
            {card.donnaReply.bubbles.map((b, i) => (
              <p key={i} className={i > 0 ? "mt-2 border-t pt-2" : undefined}>
                {b}
              </p>
            ))}
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          {card.canApprove && (
            <Button size="sm" data-testid="approve-btn" disabled={busy} onClick={() => act("approve")}>
              Approve
            </Button>
          )}
          {card.canSuggest && (
            <Button
              size="sm"
              variant="outline"
              data-testid="suggest-btn"
              disabled={busy}
              onClick={() => setSuggestOpen((v) => !v)}
            >
              Suggest changes
            </Button>
          )}
          {card.canDisapprove && (
            <Button
              size="sm"
              variant="destructive"
              data-testid="disapprove-btn"
              disabled={busy}
              onClick={() => act("disapprove")}
            >
              Disapprove
            </Button>
          )}
          {card.canIgnore && (
            <Button size="sm" variant="ghost" data-testid="ignore-btn" disabled={busy} onClick={() => act("ignore")}>
              Ignore
            </Button>
          )}
        </div>

        {suggestOpen && (
          <div className="flex flex-col gap-2 rounded-md border p-2">
            <Textarea
              data-testid="suggest-box"
              placeholder="What should change?"
              value={suggestText}
              onChange={(e) => setSuggestText(e.target.value)}
            />
            <Button
              size="sm"
              data-testid="suggest-submit"
              disabled={busy || !suggestText.trim()}
              onClick={() => act("suggest", suggestText.trim())}
            >
              Save
            </Button>
          </div>
        )}

        {error && (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}

        {card.previousDrafts.length > 0 && (
          <div>
            <button
              type="button"
              className="text-muted-foreground text-xs underline"
              onClick={() => setShowPrevious((v) => !v)}
            >
              {showPrevious ? "Hide" : "Show"} previous drafts ({card.previousDrafts.length})
            </button>
            {showPrevious && (
              <div className="mt-2 flex flex-col gap-2">
                {card.previousDrafts.map((v, i) => (
                  <div key={i} className="rounded-md border p-2 text-muted-foreground text-xs">
                    {v.bubbles.join(" / ")}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
