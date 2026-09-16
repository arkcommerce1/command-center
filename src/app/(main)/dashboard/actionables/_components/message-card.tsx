"use client";

import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { WordDiff } from "./word-diff";

export interface MessageVersion {
  id: string;
  versionNumber: number;
  text: string;
  suggestionText: string | null;
  status: string;
  createdBy: string;
  createdAt: number;
}

export interface MessageCardData {
  kind: "message";
  id: string;
  code: string;
  importance: string;
  createdAt: number;
  draftType: string;
  followup: boolean;
  factoryName: string | null;
  productName: string | null;
  layer: number | null;
  why: string | null;
  lastMessage: { text: string; translation: string | null } | null;
  versions: MessageVersion[];
}

function bubblesOf(text: string): string[] {
  return String(text || "")
    .split(/\n\s*\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function MessageCard({ card, onChanged }: { card: MessageCardData; onChanged: () => void }) {
  const [suggestOpen, setSuggestOpen] = React.useState(false);
  const [suggestText, setSuggestText] = React.useState("");
  const [disapproveOpen, setDisapproveOpen] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const versions = [...card.versions].sort((a, b) => a.versionNumber - b.versionNumber);
  const latest = versions[versions.length - 1];
  const previous = versions.length > 1 ? versions[versions.length - 2] : null;
  const showDiff = Boolean(previous && latest && previous.text !== latest.text);

  async function post(url: string, body?: unknown) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setError((data as any)?.error || `Request failed (${res.status})`);
      setSuggestOpen(false);
      setDisapproveOpen(false);
      setSuggestText("");
      onChanged();
    } catch {
      setError("Request failed.");
    } finally {
      setBusy(false);
    }
  }

  const approve = (sendAfter?: "now" | "tomorrow" | "in3days") =>
    latest ? post(`/api/drafts/${card.id}/versions/${latest.id}/approve`, { sendAfter: sendAfter || "now" }) : null;
  const submitSuggestion = () =>
    suggestText.trim() ? post(`/api/drafts/${card.id}/versions`, { suggestionText: suggestText.trim() }) : null;
  const confirmDisapprove = () =>
    post(`/api/drafts/${card.id}/versions/${latest.id}/disapprove`, reason.trim() ? { reason: reason.trim() } : {});

  return (
    <Card data-testid="card-message">
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="flex flex-col gap-1">
          <span className="text-base font-medium">
            {card.factoryName || "Unknown factory"} · {card.productName || "Unknown product"}
          </span>
          <span className="text-xs font-normal text-muted-foreground">
            {card.layer != null ? `Step ${card.layer} · ` : ""}
            {card.code} · reply Y{codeSuffix(card.code)} on WhatsApp
          </span>
        </CardTitle>
        <Badge variant="outline">{card.draftType}</Badge>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {card.why && (
          <div className="text-sm">
            <span className="font-medium">Why: </span>
            <span className="text-muted-foreground">{card.why}</span>
          </div>
        )}
        {card.lastMessage && (
          <div className="rounded-md border bg-muted/40 p-2 text-sm">
            <div className="mb-1 text-xs font-medium text-muted-foreground">Factory's last message</div>
            <div>{card.lastMessage.translation || card.lastMessage.text}</div>
            {card.lastMessage.translation && <div className="mt-1 text-xs text-muted-foreground">{card.lastMessage.text}</div>}
          </div>
        )}

        {versions.map((v, i) => {
          const isLatest = i === versions.length - 1;
          return (
            <div key={v.id} data-testid={`version-${v.versionNumber}`} className="rounded-md border p-2 text-sm">
              <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
                <span>v{v.versionNumber}</span>
                {v.suggestionText && <span className="truncate">Suggestion: {v.suggestionText}</span>}
                {!isLatest && <Badge variant="secondary">superseded</Badge>}
                {v.status !== "pending" && <Badge variant="outline">{v.status}</Badge>}
              </div>
              {isLatest && showDiff && previous ? (
                <WordDiff oldText={previous.text} newText={v.text} />
              ) : (
                bubblesOf(v.text).map((b, k) => (
                  <p key={k} className={k > 0 ? "mt-2 border-t pt-2" : undefined}>
                    {b}
                  </p>
                ))
              )}
              {!isLatest && <div className="mt-1 text-xs text-muted-foreground">Only the latest version can be approved.</div>}
            </div>
          );
        })}

        {latest && (
          <div className="flex flex-wrap gap-2">
            {card.followup ? (
              <>
                <Button size="sm" data-testid="send-now-btn" disabled={busy} onClick={() => approve("now")}>
                  Send now
                </Button>
                <Button size="sm" variant="outline" data-testid="send-tomorrow-btn" disabled={busy} onClick={() => approve("tomorrow")}>
                  Tomorrow 9:30 China time
                </Button>
                <Button size="sm" variant="outline" data-testid="send-3days-btn" disabled={busy} onClick={() => approve("in3days")}>
                  In 3 days
                </Button>
              </>
            ) : (
              <Button size="sm" data-testid="approve-btn" disabled={busy} onClick={() => approve("now")}>
                Approve
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              data-testid="suggest-btn"
              onClick={() => {
                setSuggestOpen((v) => !v);
                setDisapproveOpen(false);
              }}
            >
              Suggest changes
            </Button>
            <Button
              size="sm"
              variant="destructive"
              data-testid="disapprove-btn"
              onClick={() => {
                setDisapproveOpen((v) => !v);
                setSuggestOpen(false);
              }}
            >
              Disapprove
            </Button>
          </div>
        )}

        {suggestOpen && (
          <div className="flex flex-col gap-2 rounded-md border p-2">
            <Textarea
              data-testid="suggest-box"
              placeholder="What should change?"
              value={suggestText}
              onChange={(e) => setSuggestText(e.target.value)}
            />
            <Button size="sm" data-testid="suggest-submit" disabled={busy || !suggestText.trim()} onClick={submitSuggestion}>
              Save as new version
            </Button>
          </div>
        )}

        {disapproveOpen && (
          <div className="flex flex-col gap-2 rounded-md border p-2">
            <Textarea
              data-testid="disapprove-box"
              placeholder="Reason (optional, one line)"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            <Button size="sm" variant="destructive" data-testid="disapprove-confirm" disabled={busy} onClick={confirmDisapprove}>
              Confirm disapprove
            </Button>
          </div>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function codeSuffix(code: string): string {
  const m = String(code || "").match(/^D(\d+\.\d+)$/);
  return m ? m[1] : code;
}
