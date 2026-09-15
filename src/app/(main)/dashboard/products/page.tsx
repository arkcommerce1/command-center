"use client";

import Link from "next/link";
import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface Product {
  id: string;
  name: string;
  asin: string;
  imageUrl: string;
  started: boolean;
  stage: string;
  startDate: string;
}

const STAGE_LABEL: Record<string, string> = {
  idea: "Idea", spec: "Spec Sheet", sourcing: "Sourcing (Yuki)",
  outreach: "Outreach", sampling: "Sampling", quotation: "Quotation",
  live: "Live", dead: "Dead",
};

export default function ProductsPage() {
  const [products, setProducts] = React.useState<Product[]>([]);
  const [name, setName] = React.useState("");
  const [asin, setAsin] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(async () => {
    const r = await fetch("/api/products");
    if (r.ok) setProducts(await r.json());
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

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-3xl tracking-tight">Products</h2>
        <p className="text-muted-foreground">Every product, every stage. ASIN pulls title + photo.</p>
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
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Product name (optional if ASIN)…" className="flex-1" />
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
                <TableHead>Start date</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {products.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>
                    <Link href={`/dashboard/products/${p.id}`} className="flex items-center gap-3">
                      {p.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={p.imageUrl} alt="" className="h-9 w-9 rounded-md border object-cover" />
                      ) : (
                        <div className="flex h-9 w-9 items-center justify-center rounded-md bg-muted text-muted-foreground">◈</div>
                      )}
                      <span>
                        <span className="block font-medium">{p.name}</span>
                        {p.asin && <span className="font-mono text-xs text-muted-foreground">{p.asin}</span>}
                      </span>
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Badge variant={p.started ? "default" : "outline"}>{p.started ? (STAGE_LABEL[p.stage] || p.stage) : "Idea"}</Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{p.startDate || "—"}</TableCell>
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
              {products.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground">
                    No products yet.
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
