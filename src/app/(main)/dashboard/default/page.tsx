"use client";

import * as React from "react";

import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

interface Product {
  id: string;
  name: string;
  stage: string;
  productStatus: "queue" | "active" | "completed";
  estimatedMonthlySales: number;
  averagePricePerUnit: number;
  createdAt: number;
}

export default function DashboardPage() {
  const [products, setProducts] = React.useState<Product[] | null>(null);
  const [loading, setLoading] = React.useState(true);

  const load = React.useCallback(async () => {
    try {
      setLoading(true);
      const r = await fetch("/api/products");
      if (!r.ok) {
        setProducts([]);
        return;
      }
      const d = await r.json();
      setProducts(
        (d || []).map((p: any) => ({
          id: p.id,
          name: p.name,
          stage: p.stage,
          productStatus: p.productStatus || "queue",
          estimatedMonthlySales: p.estimatedMonthlySales || 0,
          averagePricePerUnit: p.averagePricePerUnit || 0,
          createdAt: p.createdAt || 0,
        })),
      );
    } catch {
      setProducts([]);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const all = products ?? [];
  const active = all.filter((p) => p.productStatus === "active");
  const queue = all.filter((p) => p.productStatus === "queue");
  const completed = all.filter((p) => p.productStatus === "completed");
  const activeSales = active.reduce((s, p) => s + (p.estimatedMonthlySales || 0) * (p.averagePricePerUnit || 0), 0);

  const [actionableCount, setActionableCount] = React.useState(0);
  React.useEffect(() => {
    // Same source as /dashboard/actionables, so the two counts can never drift apart.
    fetch("/api/decisions")
      .then((r) => r.json())
      .then((d) => {
        setActionableCount(typeof d?.count === "number" ? d.count : 0);
      })
      .catch(() => setActionableCount(0));
  }, []);

  // "Donna connected · last message received [time]" — derived from the most
  // recent inbound WhatsApp message the dashboard has seen. Red if nothing
  // has come in for a while, since there's no direct bridge-health check
  // exposed to the dashboard.
  const [lastMessageAt, setLastMessageAt] = React.useState<number | null | undefined>(undefined);
  React.useEffect(() => {
    fetch("/api/messages?limit=1")
      .then((r) => r.json())
      .then((rows) => {
        setLastMessageAt(Array.isArray(rows) && rows[0]?.sent_at ? Number(rows[0].sent_at) : null);
      })
      .catch(() => setLastMessageAt(null));
  }, []);
  const STALE_MS = 24 * 60 * 60 * 1000;
  const donnaHealthy = typeof lastMessageAt === "number" && Date.now() - lastMessageAt < STALE_MS;

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="font-semibold text-2xl">Dashboard</h1>
        <p className="text-muted-foreground text-sm">Command Center overview</p>
        {lastMessageAt !== undefined && (
          <p className={`mt-1 text-sm ${donnaHealthy ? "text-muted-foreground" : "text-destructive"}`}>
            {donnaHealthy ? "Donna connected" : "Donna may be disconnected"} · last message received{" "}
            {lastMessageAt
              ? new Date(lastMessageAt).toLocaleString("en-US", {
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })
              : "never"}
          </p>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="font-medium text-muted-foreground text-sm">Products Active</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="font-bold text-3xl">{loading ? <Skeleton className="h-9 w-12" /> : active.length}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="font-medium text-muted-foreground text-sm">Products in Queue</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="font-bold text-3xl">{loading ? <Skeleton className="h-9 w-12" /> : queue.length}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="font-medium text-muted-foreground text-sm">Products Completed</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="font-bold text-3xl">{loading ? <Skeleton className="h-9 w-12" /> : completed.length}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="font-medium text-muted-foreground text-sm">Actionables</CardTitle>
          </CardHeader>
          <CardContent className="flex items-center justify-between">
            <p className="font-bold text-3xl">{actionableCount}</p>
            <Link href="/dashboard/actionables">
              <Button size="sm" variant="outline">
                Open
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="font-medium text-muted-foreground text-sm">Est. Monthly Sales (Active)</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="font-bold text-3xl">${activeSales.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
            <p className="mt-1 text-muted-foreground text-xs">Active products only (price x volume)</p>
          </CardContent>
        </Card>
      </div>

      <div>
        <h2 className="mb-3 font-semibold text-lg">Products</h2>
        {loading ? (
          <div className="flex flex-col gap-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : all.length === 0 ? (
          <p className="text-muted-foreground">No products yet.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {all.map((p) => (
              <Link
                key={p.id}
                href={`/dashboard/products/${p.id}`}
                className="flex items-center justify-between rounded-lg border p-3 hover:bg-accent"
              >
                <span className="font-medium">{p.name}</span>
                <div className="flex items-center gap-2">
                  <Badge
                    variant={
                      p.productStatus === "active"
                        ? "default"
                        : p.productStatus === "completed"
                          ? "secondary"
                          : "outline"
                    }
                  >
                    {p.productStatus}
                  </Badge>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
