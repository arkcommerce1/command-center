"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  formatSince,
  hoursSince,
  sinceColorClass,
  sortBoardRows,
  waitingRank,
  type WaitingOnUI,
} from "@/lib/cc/factory-board";

interface Proof {
  step: number;
  done: boolean;
  messageId: string | null;
  text: string | null;
  translation: string | null;
  sentAt: number | null;
}

interface BoardRow {
  id: string;
  companyId: string;
  companyName: string;
  productId: string;
  productName: string;
  currentLayer: number;
  statusLine?: string;
  waitingOn?: WaitingOnUI;
  since: number | null;
  nextStep?: string;
  dropped?: { layer: number; reason: string } | null;
  productGuessed?: boolean;
  archivedAt?: number | null;
  pendingApprovals?: number;
}

function ProofDots({ linkId, currentLayer, dropped }: { linkId: string; currentLayer: number; dropped?: BoardRow["dropped"] }) {
  const [proofs, setProofs] = React.useState<Proof[] | null>(null);
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/agent/steps-proof?factoryProductId=${encodeURIComponent(linkId)}`);
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && Array.isArray(data.proofs)) setProofs(data.proofs);
      } catch {
        // Proofs stay layer-derived; dots still render.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [linkId]);

  const proofByStep = new Map((proofs || []).map((p) => [p.step, p]));
  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((step) => {
        if (dropped && step === currentLayer) {
          return (
            <span
              key={step}
              title={`Dropped at layer ${step}: ${dropped.reason || ""}`}
              className="flex h-3 w-3 items-center justify-center rounded-full bg-red-500 text-[8px] leading-none text-white"
            >
              ×
            </span>
          );
        }
        const done = step < currentLayer;
        if (!done) {
          const inProgress = step === currentLayer;
          return (
            <span
              key={step}
              title={inProgress ? `Step ${step} in progress` : `Step ${step} not started`}
              className={
                "h-3 w-3 rounded-full border " +
                (inProgress ? "border-primary bg-primary/40" : "border-muted-foreground/30 bg-transparent")
              }
            />
          );
        }
        const proof = proofByStep.get(step);
        const title = proof?.text
          ? `${proof.text}${proof.translation ? `\n— ${proof.translation}` : ""}${proof.sentAt ? `\n${new Date(proof.sentAt).toLocaleString()}` : ""}`
          : `Step ${step} done${proof === undefined ? " (proof loading…)" : " (no proof message)"}`;
        const dot = (
          <span key={step} title={title} className="h-3 w-3 rounded-full border border-primary bg-primary" />
        );
        return proof?.messageId ? (
          <a
            key={step}
            href={`/dashboard/messages?message=${encodeURIComponent(proof.messageId)}`}
            onClick={(e) => e.stopPropagation()}
            title={title}
            aria-label={`Step ${step} proof`}
          >
            {dot}
          </a>
        ) : (
          dot
        );
      })}
    </div>
  );
}

function WaitingBadge({ waitingOn }: { waitingOn: WaitingOnUI }) {
  if (!waitingOn || waitingOn === "none") return <span className="text-muted-foreground">—</span>;
  const rank = waitingRank(waitingOn);
  return <Badge variant={rank === 0 ? "destructive" : rank === 1 ? "secondary" : "outline"}>{waitingOn}</Badge>;
}

function SkeletonRows() {
  return (
    <>
      {[0, 1, 2].map((i) => (
        <TableRow key={i}>
          <TableCell colSpan={8}>
            <div className="h-5 w-full animate-pulse rounded bg-muted" />
          </TableCell>
        </TableRow>
      ))}
    </>
  );
}

export default function FactoriesPage() {
  const router = useRouter();
  const [rows, setRows] = React.useState<BoardRow[]>([]);
  const [products, setProducts] = React.useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [errored, setErrored] = React.useState(false);
  const [productFilter, setProductFilter] = React.useState<string>("all");
  const [showArchived, setShowArchived] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [r1, r2] = await Promise.all([fetch("/api/factory-products"), fetch("/api/products")]);
        if (!r1.ok) throw new Error("bad response");
        const links = await r1.json();
        const prods = r2.ok ? await r2.json() : [];
        if (!cancelled) {
          setRows(Array.isArray(links) ? links : []);
          setProducts(Array.isArray(prods) ? prods : []);
        }
      } catch {
        if (!cancelled) {
          setRows([]);
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

  const visible = sortBoardRows(
    rows.filter((r) => {
      if (!showArchived && r.archivedAt) return false;
      if (productFilter !== "all" && r.productId !== productFilter) return false;
      return true;
    }),
  );

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-3xl tracking-tight">Factories</h2>
        <p className="text-muted-foreground">One row per factory and product, filled in from the chats.</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label className="text-sm text-muted-foreground" htmlFor="product-filter">
          Product
        </label>
        <select
          id="product-filter"
          className="rounded-md border bg-background px-2 py-1 text-sm"
          value={productFilter}
          onChange={(e) => setProductFilter(e.target.value)}
        >
          <option value="all">All products</option>
          {products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <Button size="sm" variant={showArchived ? "default" : "outline"} onClick={() => setShowArchived((v) => !v)}>
          {showArchived ? "Hide archived" : "Show archived"}
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            Board · {visible.length}
            {errored && <span className="ml-2 text-xs font-normal text-muted-foreground">(offline)</span>}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Factory</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead>Steps</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Waiting on</TableHead>
                  <TableHead>Since</TableHead>
                  <TableHead>Next step</TableHead>
                  <TableHead>To approve</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <SkeletonRows />
              </TableBody>
            </Table>
          )}
          {!loading && visible.length === 0 && (
            <p className="text-sm text-muted-foreground">
              {errored
                ? "Could not load factory rows."
                : rows.length === 0
                  ? "No factories yet. When Donna is added to a factory chat, rows appear here automatically."
                  : "No factory rows match this filter."}
            </p>
          )}
          {!loading && visible.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Factory</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead>Steps</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Waiting on</TableHead>
                  <TableHead>Since</TableHead>
                  <TableHead>Next step</TableHead>
                  <TableHead>To approve</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((l) => {
                  const hrs = hoursSince(l.since);
                  return (
                    <TableRow
                      key={l.id}
                      className="cursor-pointer"
                      onClick={() => router.push(`/dashboard/factories/${encodeURIComponent(l.companyId)}`)}
                    >
                      <TableCell className="font-medium">
                        {l.companyName}
                        {l.archivedAt && (
                          <Badge variant="outline" className="ml-2">
                            archived
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        {l.productName}
                        {l.productGuessed && (
                          <Badge variant="outline" className="ml-2" title="Linked by the organizer's best guess">
                            guessed
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <ProofDots linkId={l.id} currentLayer={l.currentLayer} dropped={l.dropped} />
                      </TableCell>
                      <TableCell className="max-w-[220px] truncate text-sm text-muted-foreground">
                        {l.statusLine || "—"}
                      </TableCell>
                      <TableCell>
                        <WaitingBadge waitingOn={l.waitingOn ?? null} />
                      </TableCell>
                      <TableCell className={sinceColorClass(hrs)}>{formatSince(hrs)}</TableCell>
                      <TableCell className="max-w-[200px] truncate text-sm">{l.nextStep || "—"}</TableCell>
                      <TableCell className="text-sm">{l.pendingApprovals ? l.pendingApprovals : "—"}</TableCell>
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
