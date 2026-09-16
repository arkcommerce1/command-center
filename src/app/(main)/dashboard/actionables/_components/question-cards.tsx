"use client";

import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";

export interface QuestionCardData {
  kind: "question" | "fee" | "product_pick" | "guardrail_block" | "send_uncertain" | "sample_flag" | "sample_review";
  id: string;
  importance: string;
  createdAt: number;
  factoryName: string | null;
  productName: string | null;
  body: any;
  answer: unknown;
  feeMessage?: string;
}

function Head({ card, label }: { card: QuestionCardData; label: string }) {
  return (
    <CardTitle className="flex flex-col gap-1">
      <span className="text-base font-medium">
        {card.factoryName || "Unknown factory"} · {card.productName || "Unknown product"}
      </span>
      <span className="flex items-center gap-2 text-xs font-normal text-muted-foreground">
        <Badge variant={card.importance === "high" ? "destructive" : "outline"}>{card.importance}</Badge>
        {label}
      </span>
    </CardTitle>
  );
}

function useAnswer(id: string, onChanged: () => void) {
  const [text, setText] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const send = async (payload: unknown) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/questions/${id}/answer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setError((data as any)?.error || `Request failed (${res.status})`);
      setText("");
      onChanged();
    } catch {
      setError("Request failed.");
    } finally {
      setBusy(false);
    }
  };
  return { text, setText, busy, error, send };
}

export function QuestionCard({ card, onChanged }: { card: QuestionCardData; onChanged: () => void }) {
  const a = useAnswer(card.id, onChanged);
  const body = card.body || {};
  return (
    <Card data-testid="card-question">
      <CardHeader>
        <Head card={card} label="Question from factory" />
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {body.translation && <div className="text-sm">{body.translation}</div>}
        {body.text && <div className="text-sm text-muted-foreground">{body.text}</div>}
        {!body.text && !body.translation && <div className="text-sm text-muted-foreground">{JSON.stringify(body)}</div>}
        <div className="flex flex-col gap-2 rounded-md border p-2">
          <Textarea data-testid="answer-box" placeholder="Type the answer…" value={a.text} onChange={(e) => a.setText(e.target.value)} />
          <Button size="sm" data-testid="answer-save" disabled={a.busy || !a.text.trim()} onClick={() => a.send({ answer: a.text.trim() })}>
            Save answer
          </Button>
        </div>
        {a.error && (
          <p role="alert" className="text-sm text-destructive">
            {a.error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export function FeeCard({ card, onChanged }: { card: QuestionCardData; onChanged: () => void }) {
  const a = useAnswer(card.id, onChanged);
  const [suggestOpen, setSuggestOpen] = React.useState(false);
  const body = card.body || {};
  return (
    <Card data-testid="card-fee">
      <CardHeader>
        <Head card={card} label={`Sample fee${body.amount ? `: ${body.amount}${body.currency ? ` ${body.currency}` : ""}` : ""}`} />
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        {body.covers && (
          <div>
            <span className="font-medium">Covers: </span>
            {body.covers}
          </div>
        )}
        {body.factoryMessage && (
          <div className="rounded-md border bg-muted/40 p-2">
            <div className="mb-1 text-xs font-medium text-muted-foreground">Factory's message</div>
            {body.factoryMessage}
          </div>
        )}
        <div className="rounded-md border p-2">
          <div className="mb-1 text-xs font-medium text-muted-foreground">Exact message that will be posted</div>
          <div data-testid="fee-message">{card.feeMessage}</div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" data-testid="fee-approve" disabled={a.busy} onClick={() => a.send({ resolution: "approve-fee" })}>
            Approve fee
          </Button>
          <Button size="sm" variant="outline" data-testid="fee-decline" disabled={a.busy} onClick={() => a.send({ resolution: "decline" })}>
            Don't pay
          </Button>
          <Button size="sm" variant="outline" data-testid="fee-suggest" onClick={() => setSuggestOpen((v) => !v)}>
            Suggest changes
          </Button>
        </div>
        {suggestOpen && (
          <div className="flex flex-col gap-2 rounded-md border p-2">
            <Textarea data-testid="fee-suggest-box" placeholder="What should change?" value={a.text} onChange={(e) => a.setText(e.target.value)} />
            <Button size="sm" data-testid="fee-suggest-submit" disabled={a.busy || !a.text.trim()} onClick={() => a.send({ resolution: "changes", answer: a.text.trim() })}>
              Save suggestion
            </Button>
          </div>
        )}
        {a.error && (
          <p role="alert" className="text-sm text-destructive">
            {a.error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export function ProductPickCard({ card, onChanged }: { card: QuestionCardData; onChanged: () => void }) {
  const a = useAnswer(card.id, onChanged);
  const body = card.body || {};
  const options: { productId: string; name: string }[] = Array.isArray(body.likelyProducts) ? body.likelyProducts : [];
  return (
    <Card data-testid="card-product_pick">
      <CardHeader>
        <Head card={card} label="Which product?" />
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        {body.groupName && (
          <div>
            <span className="font-medium">New group: </span>
            {body.groupName}
          </div>
        )}
        {body.firstMessages && <div className="rounded-md border bg-muted/40 p-2">{body.firstMessages}</div>}
        <div className="flex flex-wrap gap-2">
          {options.map((o) => (
            <Button key={o.productId} size="sm" data-testid={`pick-${o.productId}`} disabled={a.busy} onClick={() => a.send({ answer: { productId: o.productId } })}>
              {o.name || o.productId}
            </Button>
          ))}
          {options.length === 0 && <span className="text-muted-foreground">No likely products listed.</span>}
        </div>
        {a.error && (
          <p role="alert" className="text-sm text-destructive">
            {a.error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export function BlockedCard({ card, onChanged }: { card: QuestionCardData; onChanged: () => void }) {
  const a = useAnswer(card.id, onChanged);
  const body = card.body || {};
  return (
    <Card data-testid="card-guardrail_block">
      <CardHeader>
        <Head card={card} label="Draft touched a blocked topic" />
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        {body.reason && (
          <div>
            <span className="font-medium">Blocked because: </span>
            {body.reason}
          </div>
        )}
        {body.bubbles && <div className="rounded-md border p-2">{(body.bubbles as string[]).join("\n\n")}</div>}
        <div className="flex flex-col gap-2 rounded-md border p-2">
          <Textarea data-testid="blocked-answer-box" placeholder="Guidance for the drafter…" value={a.text} onChange={(e) => a.setText(e.target.value)} />
          <Button size="sm" data-testid="blocked-answer-save" disabled={a.busy || !a.text.trim()} onClick={() => a.send({ answer: a.text.trim() })}>
            Send to drafter
          </Button>
        </div>
        {a.error && (
          <p role="alert" className="text-sm text-destructive">
            {a.error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export function UncertainCard({ card, onChanged }: { card: QuestionCardData; onChanged: () => void }) {
  const a = useAnswer(card.id, onChanged);
  const body = card.body || {};
  return (
    <Card data-testid="card-send_uncertain">
      <CardHeader>
        <Head card={card} label="Couldn't confirm a send" />
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        {body.chatName && (
          <div>
            <span className="font-medium">Chat: </span>
            {body.chatName}
          </div>
        )}
        {body.message && <div className="rounded-md border p-2">{body.message}</div>}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" data-testid="uncertain-sent" disabled={a.busy} onClick={() => a.send({ resolution: "mark-sent" })}>
            Mark as sent
          </Button>
          <Button size="sm" variant="outline" data-testid="uncertain-resend" disabled={a.busy} onClick={() => a.send({ resolution: "send-again" })}>
            Send again
          </Button>
        </div>
        {a.error && (
          <p role="alert" className="text-sm text-destructive">
            {a.error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export function SampleCard({ card }: { card: QuestionCardData }) {
  const body = card.body || {};
  return (
    <Card data-testid={`card-${card.kind}`}>
      <CardHeader>
        <Head card={card} label={card.kind === "sample_flag" ? "Yuki flagged a sample" : "Sample arrived in New York"} />
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-sm">
        {body.notes && <div>{body.notes}</div>}
        {body.qcNotes && <div>{body.qcNotes}</div>}
        {Object.keys(body).length === 0 && <div className="text-muted-foreground">No details yet.</div>}
      </CardContent>
    </Card>
  );
}
