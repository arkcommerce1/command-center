"use client";

import * as React from "react";

import { type ActionableCard, ActionCard } from "./action-card";

interface DecisionsPayload {
  count: number;
  cards: ActionableCard[];
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
    void load();
  }, [load]);

  const cards = data?.cards ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-3xl tracking-tight">Actionables</h2>
        <p className="text-muted-foreground" data-testid="counter">
          {loading ? "Loading…" : errored ? "Could not load Actionables." : `${data?.count ?? 0} need you`}
        </p>
      </div>

      {!loading && !errored && cards.length === 0 && (
        <p className="text-muted-foreground" data-testid="empty-state">
          Nothing needs you right now.
        </p>
      )}

      {!loading && !errored && (
        <div className="flex flex-col gap-3">
          {cards.map((c) => (
            <ActionCard key={c.id} card={c} onChanged={load} />
          ))}
        </div>
      )}
    </div>
  );
}
