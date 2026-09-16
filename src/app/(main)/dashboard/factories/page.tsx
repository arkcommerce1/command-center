"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface FactoryProductLink {
  id: string;
  productId: string;
  companyName: string;
  productName: string;
  currentLayer: number;
  statusLine?: string;
  waitingOn?: "haim" | "factory" | string;
  since: string;
  nextStep?: string;
  agentStatus?: string;
  dropped?: boolean;
  droppedReason?: string;
}

type Filter = "all" | "waiting_me" | "stuck" | "dropped";

function hoursSince(iso: string): number {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return 0;
  return (Date.now() - t) / (1000 * 60 * 60);
}

function formatRelative(hours: number): string {
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))}m`;
  if (hours < 24) return `${Math.round(hours)}h`;
  return `${Math.round(hours / 24)}d`;
}

function sinceColor(hours: number): string {
  if (hours > 48) return "text-red-600 dark:text-red-400 font-medium";
  if (hours > 24) return "text-amber-600 dark:text-amber-400 font-medium";
  return "text-muted-foreground";
}

function LayerDots({ currentLayer, dropped }: { currentLayer: number; dropped?: boolean }) {
  const dots = [1, 2, 3, 4, 5];
  return (
    <div className="flex items-center gap-1">
      {dots.map((layer) => {
        if (dropped && layer === currentLayer) {
          return (
            <span
              key={layer}
              title={`Dropped at layer ${layer}`}
              className="flex h-3 w-3 items-center justify-center rounded-full bg-red-500 text-[8px] leading-none text-white"
            >
              ×
            </span>
          );
        }
        const done = layer < currentLayer;
        const inProgress = layer === currentLayer && !dropped;
        return (
          <span
            key={layer}
            title={`Layer ${layer}`}
            className={
              "h-3 w-3 rounded-full border " +
              (done
                ? "border-primary bg-primary"
                : inProgress
                  ? "border-primary bg-primary/40"
                  : "border-muted-foreground/30 bg-transparent")
            }
          />
        );
      })}
    </div>
  );
}

export default function FactoriesPage() {
  const router = useRouter();
  const [links, setLinks] = React.useState<FactoryProductLink[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [errored, setErrored] = React.useState(false);
  const [filter, setFilter] = React.useState<Filter>("all");

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/factory-product-links");
        if (!res.ok) throw new Error("bad response");
        const data = await res.json();
        if (!cancelled) setLinks(Array.isArray(data) ? data : []);
      } catch {
        if (!cancelled) {
          setLinks([]);
          setErrored(true);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = links.filter((l) => {
    if (filter === "waiting_me") return l.waitingOn === "haim";
    if (filter === "stuck") return hoursSince(l.since) > 24 && !l.dropped;
    if (filter === "dropped") return !!l.dropped;
    return true;
  });

  const sorted = [...filtered].sort((a, b) => {
    const aWaiting = a.waitingOn === "haim" ? 0 : 1;
    const bWaiting = b.waitingOn === "haim" ? 0 : 1;
    if (aWaiting !== bWaiting) return aWaiting - bWaiting;
    return new Date(a.since).getTime() - new Date(b.since).getTime();
  });

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-3xl tracking-tight">Factories</h2>
        <p className="text-muted-foreground">All factory-product relationships and where they stand.</p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant={filter === "all" ? "default" : "outline"} onClick={() => setFilter("all")}>
          All
        </Button>
        <Button
          size="sm"
          variant={filter === "waiting_me" ? "default" : "outline"}
          onClick={() => setFilter("waiting_me")}
        >
          Waiting on me
        </Button>
        <Button size="sm" variant={filter === "stuck" ? "default" : "outline"} onClick={() => setFilter("stuck")}>
          Stuck (24h+)
        </Button>
        <Button
          size="sm"
          variant={filter === "dropped" ? "default" : "outline"}
          onClick={() => setFilter("dropped")}
        >
          Dropped
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            Board · {sorted.length}
            {errored && <span className="ml-2 text-xs font-normal text-muted-foreground">(offline)</span>}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading && <p className="text-sm text-muted-foreground">Loading...</p>}
          {!loading && sorted.length === 0 && (
            <p className="text-sm text-muted-foreground">
              {errored ? "Could not load factory links." : "No factory-product links match this filter."}
            </p>
          )}
          {!loading && sorted.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Factory</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead>Layers</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Waiting on</TableHead>
                  <TableHead>Since</TableHead>
                  <TableHead>Next step</TableHead>
                  <TableHead>Agent status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map((l) => {
                  const hrs = hoursSince(l.since);
                  return (
                    <TableRow
                      key={l.id}
                      className="cursor-pointer"
                      onClick={() => router.push(`/dashboard/products/${l.productId}`)}
                    >
                      <TableCell className="font-medium">{l.companyName}</TableCell>
                      <TableCell>{l.productName}</TableCell>
                      <TableCell>
                        <LayerDots currentLayer={l.currentLayer} dropped={l.dropped} />
                      </TableCell>
                      <TableCell className="max-w-[220px] truncate text-sm text-muted-foreground">
                        {l.statusLine || "—"}
                      </TableCell>
                      <TableCell>
                        {l.waitingOn ? (
                          <Badge variant={l.waitingOn === "haim" ? "destructive" : "outline"}>{l.waitingOn}</Badge>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell className={sinceColor(hrs)}>{formatRelative(hrs)}</TableCell>
                      <TableCell className="max-w-[200px] truncate text-sm">{l.nextStep || "—"}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{l.agentStatus || "—"}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
