"use client";

import Link from "next/link";
import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface Row {
  id: string; name: string; role: string; company: string;
  wechat: string; whatsapp: string; email: string;
  factory: string; product: string; source: "contact" | "factory";
}

export default function ContactsPage() {
  const [rows, setRows] = React.useState<Row[]>([]);
  const [open, setOpen] = React.useState(false);
  const [f, setF] = React.useState({ name: "", role: "", company: "", wechat: "", whatsapp: "", email: "" });
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(async () => {
    const r = await fetch("/api/contacts");
    if (r.ok) setRows(await r.json());
  }, []);
  React.useEffect(() => {
    load();
  }, [load]);

  async function add() {
    if (!f.name.trim()) return;
    setBusy(true);
    try {
      await fetch("/api/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(f),
      });
      setF({ name: "", role: "", company: "", wechat: "", whatsapp: "", email: "" });
      setOpen(false);
      load();
    } finally {
      setBusy(false);
    }
  }

  async function del(id: string) {
    if (!confirm("Remove this contact?")) return;
    await fetch(`/api/contacts/${id}`, { method: "DELETE" });
    load();
  }

  const sorted = [...rows].sort((a, b) => a.company.localeCompare(b.company) || a.name.localeCompare(b.name));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl tracking-tight">Contacts</h2>
          <p className="text-muted-foreground">
            Everyone Donna talks to — factories, Yuki, you, anyone — via WhatsApp and email.
          </p>
        </div>
        <Button onClick={() => setOpen((o) => !o)}>{open ? "Cancel" : "+ Contact"}</Button>
      </div>

      {open && (
        <Card>
          <CardHeader>
            <CardTitle>New contact</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-2">
            <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Name *" />
            <Input value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })} placeholder="Role (e.g. Sourcing agent, Owner)" />
            <Input value={f.company} onChange={(e) => setF({ ...f, company: e.target.value })} placeholder="Company (e.g. Everlasting Ice Rx, Shenzhen ABC)" className="col-span-2" />
            <Input value={f.wechat} onChange={(e) => setF({ ...f, wechat: e.target.value })} placeholder="WeChat" />
            <Input value={f.whatsapp} onChange={(e) => setF({ ...f, whatsapp: e.target.value })} placeholder="WhatsApp" />
            <Input value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder="Email" className="col-span-2" />
            <Button onClick={add} disabled={busy || !f.name.trim()} className="col-span-2 w-fit">
              {busy ? "…" : "Save contact"}
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{rows.length} people · {new Set(rows.map((r) => r.company).filter(Boolean)).size} companies</CardTitle>
        </CardHeader>
        <CardContent>
          {sorted.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No contacts yet. Add one above, or open a factory under a product and add people there.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Company</TableHead>
                  <TableHead>WeChat</TableHead>
                  <TableHead>WhatsApp</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead className="w-10"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.name}</TableCell>
                    <TableCell className="text-muted-foreground">{r.role || "—"}</TableCell>
                    <TableCell>
                      {r.source === "factory" ? (
                        <Link href={`/dashboard/products/${(r as any).productId || ""}`} className="hover:underline">
                          <Badge variant="outline">{r.company}</Badge>
                        </Link>
                      ) : r.company ? (
                        <Badge variant="secondary">{r.company}</Badge>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{r.wechat || "—"}</TableCell>
                    <TableCell className="font-mono text-xs">{r.whatsapp || "—"}</TableCell>
                    <TableCell className="text-xs">{r.email || "—"}</TableCell>
                    <TableCell>
                      {r.source === "contact" && (
                        <button className="text-muted-foreground hover:text-destructive" onClick={() => del(r.id)}>
                          ✕
                        </button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
