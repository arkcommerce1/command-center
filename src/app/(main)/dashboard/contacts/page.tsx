"use client";

import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";

interface Row {
  id: string; name: string; role: string; company: string;
  wechat: string; whatsapp: string; email: string; notes: string;
  factory: string; product: string; source: "contact" | "factory" | "agent-contact";
  store: "dashboard" | "factory-person" | "agent";
  kind: "ours" | "factory";
  role_note?: string; role_source?: string;
  description: string;
  channels: { kind: string; value: string }[];
  channelsText: string;
  groups: string[];
  lastMessage: { text: string; sent_at: number } | null;
  unmatched: boolean;
  created_by?: string;
}

// Inline-editable cell reusing the blur + Enter PATCH pattern.
function Cell({
  value, placeholder, onSave, className, mono,
}: {
  value: string; placeholder?: string; onSave: (v: string) => void; className?: string; mono?: boolean;
}) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(value);
  React.useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);
  function commit() {
    setEditing(false);
    if (draft !== value) onSave(draft);
  }
  if (!editing) {
    return (
      <button
        className={`block w-full truncate text-left hover:bg-muted/60 rounded px-1 -mx-1 py-0.5 ${mono ? "font-mono text-xs" : "text-sm"} ${className || ""}`}
        title={value || placeholder}
        onClick={(e) => {
          e.stopPropagation();
          setDraft(value);
          setEditing(true);
        }}
      >
        {value || <span className="text-muted-foreground/60">{placeholder || "—"}</span>}
      </button>
    );
  }
  return (
    <Input
      autoFocus
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        }
        if (e.key === "Escape") {
          e.preventDefault();
          setEditing(false);
          setDraft(value);
        }
      }}
      className={`h-7 text-xs ${mono ? "font-mono" : ""}`}
    />
  );
}

export default function ContactsPage() {
  const [rows, setRows] = React.useState<Row[]>([]);
  const [loaded, setLoaded] = React.useState(false);
  const [error, setError] = React.useState("");
  const [open, setOpen] = React.useState(false);
  const [f, setF] = React.useState({ name: "", role: "", company: "", wechat: "", whatsapp: "", email: "", notes: "" });
  const [busy, setBusy] = React.useState(false);
  const [expanded, setExpanded] = React.useState<string | null>(null);
  const [noteDraft, setNoteDraft] = React.useState("");
  const [whoIsThisId, setWhoIsThisId] = React.useState<string | null>(null);
  const [companyDraft, setCompanyDraft] = React.useState("");

  const load = React.useCallback(async () => {
    setError("");
    try {
      const r = await fetch("/api/contacts");
      if (!r.ok) throw new Error(`contacts ${r.status}`);
      setRows(await r.json());
      setLoaded(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "load failed");
      setLoaded(true);
    }
  }, []);
  React.useEffect(() => {
    load();
  }, [load]);

  async function patch(id: string, body: Record<string, unknown>) {
    await fetch(`/api/contacts/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body }),
    });
    load();
  }

  async function add() {
    if (!f.name.trim()) return;
    setBusy(true);
    try {
      await fetch("/api/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(f),
      });
      setF({ name: "", role: "", company: "", wechat: "", whatsapp: "", email: "", notes: "" });
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

  async function saveNote(id: string, store: Row["store"]) {
    if (store === "agent") await patch(id, { description: noteDraft });
    else await patch(id, { notes: noteDraft });
    setExpanded(null);
  }

  // Confirm-company control for the Unmatched section, reusing the
  // Who-is-this chip inline pattern (blur + Enter PATCH).
  async function saveCompany(id: string) {
    const company = companyDraft.trim();
    setWhoIsThisId(null);
    if (!company) return;
    await patch(id, { company });
  }

  function whoIsThisChip(r: Row) {
    if (whoIsThisId === r.id) {
      return (
        <Input
          autoFocus
          value={companyDraft}
          onChange={(e) => setCompanyDraft(e.target.value)}
          onClick={(e) => e.stopPropagation()}
          onBlur={() => saveCompany(r.id)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              saveCompany(r.id);
            }
            if (e.key === "Escape") {
              e.preventDefault();
              setWhoIsThisId(null);
            }
          }}
          placeholder="Company…"
          className="h-6 w-36 text-xs"
        />
      );
    }
    return (
      <button
        className="rounded-full border px-2 py-0.5 text-[10px] font-normal text-muted-foreground hover:bg-muted"
        onClick={(e) => {
          e.stopPropagation();
          setWhoIsThisId(r.id);
          setCompanyDraft("");
        }}
      >
        Who is this?
      </button>
    );
  }

  function toggleExpand(r: Row) {
    if (expanded === r.id) {
      setExpanded(null);
    } else {
      setExpanded(r.id);
      setNoteDraft(r.store === "agent" ? r.description || "" : r.notes || "");
    }
  }

  const matched = [...rows]
    .filter((r) => !r.unmatched)
    .sort((a, b) => (a.company || "").localeCompare(b.company || "") || a.name.localeCompare(b.name));
  const unmatched = [...rows].filter((r) => r.unmatched).sort((a, b) => a.name.localeCompare(b.name));
  const companyCount = new Set(rows.map((r) => (r.company || "").trim().toLowerCase()).filter(Boolean)).size;

  function body(r: Row) {
    return (
      <React.Fragment key={r.id}>
        <TableRow className="cursor-pointer" onClick={() => toggleExpand(r)}>
          <TableCell className="font-medium" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <Cell value={r.name} placeholder="Name…" onSave={(v) => patch(r.id, { name: v })} />
              </div>
              {(r.company === "Unknown" || (!r.company && r.store !== "agent") || r.unmatched) && whoIsThisChip(r)}
            </div>
          </TableCell>
          <TableCell onClick={(e) => e.stopPropagation()}>
            <Cell value={r.company} placeholder="Company…" onSave={(v) => patch(r.id, { company: v })} />
          </TableCell>
          <TableCell onClick={(e) => e.stopPropagation()}>
            <select
              value={r.kind}
              onChange={(e) => patch(r.id, { kind: e.target.value })}
              onClick={(e) => e.stopPropagation()}
              className="h-7 rounded-md border border-input bg-background px-1 text-xs"
              aria-label="Ours or factory"
            >
              <option value="ours">Ours</option>
              <option value="factory">Factory</option>
            </select>
          </TableCell>
          <TableCell onClick={(e) => e.stopPropagation()}>
            <Cell
              value={r.role}
              placeholder="Role…"
              onSave={(v) => patch(r.id, { role: v })}
              className="text-muted-foreground"
            />
          </TableCell>
          <TableCell className="max-w-[220px]" onClick={(e) => e.stopPropagation()}>
            <Cell
              value={r.description}
              placeholder="Description…"
              onSave={(v) => patch(r.id, { description: v })}
              className="text-xs text-muted-foreground"
            />
          </TableCell>
          <TableCell className="max-w-[200px]" onClick={(e) => e.stopPropagation()}>
            <Cell
              value={r.channelsText}
              placeholder="kind:value, …"
              onSave={(v) => patch(r.id, { channelsText: v })}
              mono
            />
          </TableCell>
          <TableCell className="max-w-[160px] truncate text-xs text-muted-foreground" title={(r.groups || []).join(", ")}>
            {(r.groups || []).length > 0 ? r.groups.join(", ") : "—"}
          </TableCell>
          <TableCell className="max-w-[200px] truncate text-xs text-muted-foreground" title={r.lastMessage?.text || ""}>
            {r.lastMessage ? r.lastMessage.text : "—"}
          </TableCell>
          <TableCell className="w-16 text-xs text-muted-foreground" onClick={(e) => e.stopPropagation()}>
            {r.store === "dashboard" ? (
              <button className="hover:text-destructive" onClick={() => del(r.id)} aria-label="Remove contact">
                ✕
              </button>
            ) : (
              <span title="Notes / rules — click the row">{r.store === "agent" && r.created_by === "haim" ? "✎" : ""}</span>
            )}
          </TableCell>
        </TableRow>
        {expanded === r.id && (
          <TableRow>
            <TableCell colSpan={9} className="bg-muted/30">
              {r.store === "factory-person" ? (
                <p className="text-sm text-muted-foreground">
                  Factory-linked people don&apos;t have notes here yet — edit them from the product&apos;s factory panel.
                </p>
              ) : (
                <div className="flex flex-col gap-2 py-1">
                  <p className="text-xs font-medium text-muted-foreground">Notes / rules for Donna</p>
                  <Textarea
                    value={noteDraft}
                    onChange={(e) => setNoteDraft(e.target.value)}
                    placeholder="Notes / rules for Donna — context, preferences, how to handle this person..."
                    rows={3}
                    onClick={(e) => e.stopPropagation()}
                  />
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => saveNote(r.id, r.store)}>
                      Save note
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setExpanded(null)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </TableCell>
          </TableRow>
        )}
      </React.Fragment>
    );
  }

  const heads = (
    <TableRow>
      <TableHead>Name</TableHead>
      <TableHead>Company</TableHead>
      <TableHead>Ours/Factory</TableHead>
      <TableHead>Role</TableHead>
      <TableHead>Description</TableHead>
      <TableHead>Channels</TableHead>
      <TableHead>Groups</TableHead>
      <TableHead>Last message</TableHead>
      <TableHead className="w-16"></TableHead>
    </TableRow>
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl tracking-tight">Contacts</h2>
          <p className="text-muted-foreground">
            Everyone Donna talks to — factories, Yuki, you, anyone — via WhatsApp and email. Click a cell to edit it
            inline, a row for notes/rules.
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
            <Textarea
              value={f.notes}
              onChange={(e) => setF({ ...f, notes: e.target.value })}
              placeholder="Notes / rules for Donna — e.g. 'always CC Yuki', 'prefers Chinese', 'never discuss pricing directly, route through Oliver'..."
              className="col-span-2"
              rows={3}
            />
            <Button onClick={add} disabled={busy || !f.name.trim()} className="col-span-2 w-fit">
              {busy ? "…" : "Save contact"}
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>
            {rows.length} people · {companyCount} companies
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!loaded ? (
            <div className="flex flex-col gap-2" aria-label="Loading contacts">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : error ? (
            <div className="flex items-center gap-3">
              <p className="text-sm text-destructive">Couldn&apos;t load contacts ({error}).</p>
              <Button size="sm" variant="outline" onClick={load}>
                Retry
              </Button>
            </div>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No contacts yet. Add one above, or open a factory under a product and add people there.
            </p>
          ) : (
            <Table>
              <TableHeader>{heads}</TableHeader>
              <TableBody>{matched.map(body)}</TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {loaded && !error && unmatched.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>
              Unmatched · {unmatched.length} sender{unmatched.length === 1 ? "" : "s"} with no company match
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-3 text-sm text-muted-foreground">
              Donna couldn&apos;t match these senders to a factory. Confirm a company to link them — no drafts go out
              for unmatched senders.
            </p>
            <Table>
              <TableHeader>{heads}</TableHeader>
              <TableBody>{unmatched.map(body)}</TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
