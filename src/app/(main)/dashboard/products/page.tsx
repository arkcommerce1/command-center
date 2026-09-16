"use client";

import * as React from "react";

import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface Product {
  id: string;
  name: string;
  asin: string;
  imageUrl: string;
  started: boolean;
  stage: string;
  startDate: string;
  stageUpdatedAt?: number;
  specDone?: boolean;
  specVersion?: number;
  spec?: { sheetUrl?: string; lastUpdate?: string };
  factoriesCount?: number;
  furthestFactoryStage?: string | null;
  furthestFactoryStageLabel?: string | null;
}

const STAGE_LABEL: Record<string, string> = {
  idea: "Idea",
  spec: "Spec Sheet",
  sourcing: "Sourcing (Yuki)",
  outreach: "Outreach",
  sampling: "Sampling",
  quotation: "Quotation",
  live: "Live",
  dead: "Dead",
};

const NEXT_STEP: Record<string, string> = {
  idea: "Start the product",
  spec: "Finish the spec sheet",
  sourcing: "Find factories (Yuki)",
  outreach: "Reach out to factories",
  sampling: "Get samples confirmed",
  quotation: "Get quotes, negotiate",
  live: "Monitor & optimize",
  dead: "—",
};

function stageString(p: Product) {
  return p.started ? STAGE_LABEL[p.stage] || p.stage : "Idea";
}

function specString(p: Product) {
  if (typeof p.specVersion === "number" && p.specVersion > 0) return `Approved v${p.specVersion}`;
  if (p.specDone || p.spec?.sheetUrl || p.spec?.lastUpdate) return "Draft";
  return "None";
}

function lastActivity(p: Product) {
  const ts = p.stageUpdatedAt;
  if (!ts) return "—";
  const d = new Date(ts);
  return d.toLocaleDateString();
}

function nextStep(p: Product) {
  if (!p.started) return NEXT_STEP.idea;
  return NEXT_STEP[p.stage] || "—";
}

function factoriesString(p: Product) {
  const count = p.factoriesCount ?? 0;
  if (count === 0) return "0";
  return `${count} · ${p.furthestFactoryStageLabel || "—"}`;
}

type FilterTab = "all" | "active" | "ideas";

export default function ProductsPage() {
  const [products, setProducts] = React.useState<Product[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState(false);
  const [name, setName] = React.useState("");
  const [asin, setAsin] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [filter, setFilter] = React.useState<FilterTab>("all");

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const r = await fetch("/api/products");
      if (!r.ok) throw new Error("bad response");
      setProducts(await r.json());
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);
  React.useEffect(() => {
    load();
  }, [load]);

  async function add() {
    if (!name.trim() && !asin.trim()) return;
    setBusy(true);
    try {
      let title = name.trim();
      let imageUrl = "";
      const a = asin.trim().toUpperCase();
      if (a) {
        const r = await (await fetch(`/api/lookup-asin?asin=${encodeURIComponent(a)}`)).json();
        if (r.title && !title) title = r.title;
        if (r.imageUrl) imageUrl = r.imageUrl;
        if (!r.title && !r.imageUrl) alert("ASIN lookup failed (ASIN not found — fill in manually)");
      }
      await fetch("/api/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: title || a || "Untitled", asin: a, imageUrl }),
      });
      setName("");
      setAsin("");
      load();
    } finally {
      setBusy(false);
    }
  }

  async function start(id: string) {
    await fetch(`/api/products/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ started: true }),
    });
    load();
  }

  async function del(id: string, n: string) {
    if (!confirm(`Delete ${n}?`)) return;
    await fetch(`/api/products/${id}`, { method: "DELETE" });
    load();
  }

  const filtered = React.useMemo(() => {
    if (filter === "ideas") return products.filter((p) => !p.started || p.stage === "idea");
    if (filter === "active") return products.filter((p) => p.started && p.stage !== "idea");
    return products;
  }, [products, filter]);

  const ideasCount = products.filter((p) => !p.started || p.stage === "idea").length;
  const activeCount = products.filter((p) => p.started && p.stage !== "idea").length;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-3xl tracking-tight">Products</h2>
        <p className="text-muted-foreground">Every product, every stage. ASIN pulls title + photo.</p>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1" data-testid="filter-tabs">
        <Button
          size="sm"
          variant={filter === "all" ? "default" : "outline"}
          onClick={() => setFilter("all")}
          data-testid="tab-all"
        >
          All ({products.length})
        </Button>
        <Button
          size="sm"
          variant={filter === "active" ? "default" : "outline"}
          onClick={() => setFilter("active")}
          data-testid="tab-active"
        >
          Active ({activeCount})
        </Button>
        <Button
          size="sm"
          variant={filter === "ideas" ? "default" : "outline"}
          onClick={() => setFilter("ideas")}
          data-testid="tab-ideas"
        >
          Ideas ({ideasCount})
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>New product</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 sm:flex-row">
          <Input
            value={asin}
            onChange={(e) => setAsin(e.target.value.toUpperCase())}
            placeholder="ASIN"
            maxLength={10}
            className="font-mono uppercase sm:max-w-[150px]"
          />
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Product name (optional if ASIN)…"
            className="flex-1"
          />
          <Button onClick={add} disabled={busy}>
            {busy ? "…" : "Add"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead>Stage</TableHead>
                <TableHead>Factories</TableHead>
                <TableHead>Spec</TableHead>
                <TableHead>Samples</TableHead>
                <TableHead>Last activity</TableHead>
                <TableHead>Next step</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading &&
                Array.from({ length: 4 }).map((_, i) => (
                  <TableRow key={`skeleton-${i}`} data-testid="skeleton-row">
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Skeleton className="h-9 w-9 rounded-md" />
                        <Skeleton className="h-4 w-32" />
                      </div>
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-5 w-16" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-4 w-20" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-4 w-16" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-4 w-8" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-4 w-20" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-4 w-28" />
                    </TableCell>
                    <TableCell className="text-right">
                      <Skeleton className="ml-auto h-8 w-16" />
                    </TableCell>
                  </TableRow>
                ))}
              {!loading && error && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center">
                    <div className="flex flex-col items-center gap-2 py-8" data-testid="products-error">
                      <p className="text-muted-foreground">Could not load products.</p>
                      <Button variant="outline" size="sm" onClick={load} data-testid="retry-btn">
                        Retry
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              )}
              {!loading &&
                !error &&
                filtered.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell>
                      <Link href={`/dashboard/products/${p.id}`} className="flex items-center gap-3">
                        {p.imageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={p.imageUrl} alt="" className="h-9 w-9 rounded-md border object-cover" />
                        ) : (
                          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-muted text-muted-foreground">
                            ◈
                          </div>
                        )}
                        <span>
                          <span className="block font-medium">{p.name}</span>
                          {p.asin && <span className="font-mono text-xs text-muted-foreground">{p.asin}</span>}
                        </span>
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Badge variant={p.started ? "default" : "outline"}>{stageString(p)}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{factoriesString(p)}</TableCell>
                    <TableCell className="text-muted-foreground">{specString(p)}</TableCell>
                    <TableCell className="text-muted-foreground">0</TableCell>
                    <TableCell className="text-muted-foreground">{lastActivity(p)}</TableCell>
                    <TableCell className="text-muted-foreground">{nextStep(p)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        {!p.started && (
                          <Button size="sm" onClick={() => start(p.id)}>
                            Start
                          </Button>
                        )}
                        <Button size="sm" variant="ghost" onClick={() => del(p.id, p.name)}>
                          Delete
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              {!loading && !error && filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-muted-foreground" data-testid="products-empty">
                    {filter === "ideas"
                      ? "No ideas yet."
                      : filter === "active"
                        ? "No active products yet."
                        : "No products yet."}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
