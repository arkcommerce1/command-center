"use client";

import * as React from "react";
import { MessageCard, MessageCardData } from "./message-card";
import { BlockedCard, FeeCard, ProductPickCard, QuestionCard, QuestionCardData, SampleCard, UncertainCard } from "./question-cards";

interface DecisionsPayload {
  counts: { toApprove: number; questions: number; samples: number };
  cards: (MessageCardData | QuestionCardData)[];
}

export function ActionablesView() {
  const [data, setData] = React.useState<DecisionsPayload | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [errored, setErrored] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/decisions");
      if (!res.ok) throw new Error("bad response");
      setData(await res.json());
      setErrored(false);
    } catch {
      setData(null);
      setErrored(true);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    load();
  }, [load]);

  const counts = data?.counts;
  const cards = data?.cards || [];

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-3xl tracking-tight">Actionables</h2>
        <p className="text-muted-foreground" data-testid="counter">
          {loading
            ? "Loading…"
            : errored
              ? "Could not load decisions."
              : `${counts?.toApprove || 0} to approve, ${counts?.questions || 0} questions, ${counts?.samples || 0} samples`}
        </p>
      </div>

      {!loading && !errored && cards.length === 0 && (
        <p className="text-muted-foreground" data-testid="empty-state">
          Nothing needs you right now.
        </p>
      )}

      {!loading && !errored && (
        <div className="flex flex-col gap-3">
          {cards.map((c) => {
            if (c.kind === "message") return <MessageCard key={c.id} card={c} onChanged={load} />;
            if (c.kind === "fee") return <FeeCard key={c.id} card={c} onChanged={load} />;
            if (c.kind === "product_pick") return <ProductPickCard key={c.id} card={c} onChanged={load} />;
            if (c.kind === "guardrail_block") return <BlockedCard key={c.id} card={c} onChanged={load} />;
            if (c.kind === "send_uncertain") return <UncertainCard key={c.id} card={c} onChanged={load} />;
            if (c.kind === "sample_flag" || c.kind === "sample_review") return <SampleCard key={c.id} card={c} />;
            return <QuestionCard key={c.id} card={c as QuestionCardData} onChanged={load} />;
          })}
        </div>
      )}
    </div>
  );
}
