"use client";

import * as React from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

interface Product {
  id: string; name: string; stage: string;
  productStatus: "queue" | "active" | "completed";
  estimatedMonthlySales: number;
  createdAt: number;
}

export default function DashboardPage() {
  const [products, setProducts] = React.useState<Product[] | null>(null);
  const [loading, setLoading] = React.useState(true);

  const load = React.useCallback(async () => {
    try {
      setLoading(true);
      const r = await fetch("/api/products");
      if (!r.ok) { setProducts([]); return; }
      const d = await r.json();
      setProducts((d || []).map((p: any) => ({
        id: p.id,
        name: p.name,
        stage: p.stage,
        productStatus: p.productStatus || "queue",
        estimatedMonthlySales: p.estimatedMonthlySales || 0,
        createdAt: p.createdAt || 0,
      })));
    } catch { setProducts([]); }
    finally { setLoading(false); }
  }, []);

  React.useEffect(() => { load(); }, [load]);

  const all = products || [];
  const active = all.filter((p) => p.productStatus === "active");
  const queue = all.filter((p) => p.productStatus === "queue");
  const completed = all.filter((p) => p.productStatus === "completed");
  const activeSales = active.reduce((s, p) => s + (p.estimatedMonthlySales || 0) * (p.averagePricePerUnit || 0), 0);

  // Count open actionables (drafts with status pending)
  const [actionableCount, setActionableCount] = React.useState(0);
  React.useEffect(() => {
    fetch("/api/drafts?status=pending").then(r => r.json()).then(d => {
      setActionableCount(Array.isArray(d) ? d.length : 0);
    }).catch(() => setActionableCount(0));
  }, []);

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="text-sm text-muted-foreground">Command Center overview</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Products Active</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{loading ? <Skeleton className="h-9 w-12" /> : active.length}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Products in Queue</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{loading ? <Skeleton className="h-9 w-12" /> : queue.length}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Products Completed</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{loading ? <Skeleton className="h-9 w-12" /> : completed.length}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Actionables</CardTitle>
          </CardHeader>
          <CardContent className="flex items-center justify-between">
            <p className="text-3xl font-bold">{actionableCount}</p>
            <Link href="/dashboard/actionables">
              <Button size="sm" variant="outline">Open</Button>
            </Link>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Est. Monthly Revenue (Active)</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">${activeSales.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
            <p className="text-xs text-muted-foreground mt-1">Active products only (price x volume)</p>
          </CardContent>
        </Card>
      </div>

      <div>
        <h2 className="text-lg font-semibold mb-3">Products</h2>
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
                  <Badge variant="outline">{p.stage}</Badge>
                  <Badge variant={p.productStatus === "active" ? "default" : p.productStatus === "completed" ? "secondary" : "outline"}>
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
