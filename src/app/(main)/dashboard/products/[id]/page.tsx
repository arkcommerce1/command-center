"use client";

import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";

const STAGES = ["spec", "sourcing", "outreach", "sampling", "quotation"] as const;
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
const FSTAGES = ["intro", "contacted", "sample_requested", "sample_yiwu", "sample_ny", "sample_confirmed", "quoted", "negotiating", "ordered"];
const FSTAGE_LABEL: Record<string, string> = {
  intro: "Intro",
  contacted: "Contacted",
  sample_requested: "Sample Req.",
  sample_yiwu: "Sample Yiwu",
  sample_ny: "Sample NY",
  sample_confirmed: "Sample OK",
  quoted: "Quoted",
  negotiating: "Negotiating",
  ordered: "Ordered",
};
const FNEXT: Record<string, string> = {
  intro: "Complete intro, start communication",
  contacted: "Request samples",
  sample_requested: "Chase sample shipment",
  sample_yiwu: "Tell Yuki: ship sample to New York",
  sample_ny: "Confirm sample (QC)",
  sample_confirmed: "Get first quotation",
  quoted: "Compare quotes, negotiate",
  negotiating: "Push to order",
  ordered: "",
};

function PersonAdd({ onAdd }: { fid: string; onAdd: (b: any) => void }) {
  const [open, setOpen] = React.useState(false);
  const [f, setF] = React.useState({ name: "", role: "", wechat: "", whatsapp: "", email: "" });
  if (!open) return <Button size="sm" variant="outline" onClick={() => setOpen(true)}>+ Person</Button>;
  return (
    <div className="rounded-md border p-2">
      <div className="grid grid-cols-2 gap-1.5">
        <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Name *" />
        <Input value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })} placeholder="Role" />
        <Input value={f.wechat} onChange={(e) => setF({ ...f, wechat: e.target.value })} placeholder="WeChat" />
        <Input value={f.whatsapp} onChange={(e) => setF({ ...f, whatsapp: e.target.value })} placeholder="WhatsApp" />
        <Input value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder="Email" className="col-span-2" />
      </div>
      <div className="mt-1.5 flex gap-2">
        <Button size="sm" disabled={!f.name.trim()} onClick={() => { onAdd(f); setF({ name: "", role: "", wechat: "", whatsapp: "", email: "" }); setOpen(false); }}>Save</Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
      </div>
    </div>
  );
}

function StageBadge({ v, map }: { v: string; map?: Record<string, string> }) {
  const good = ["received", "quoted", "ordered", "sample_confirmed"].includes(v);
  const warn = ["requested", "waiting_factory", "sample_requested", "negotiating", "sample_yiwu"].includes(v);
  const bad = ["waiting_me"].includes(v);
  return (
    <Badge variant={good ? "default" : bad ? "destructive" : warn ? "secondary" : "outline"}>
      {(map && map[v]) || v.replace(/_/g, " ")}
    </Badge>
  );
}

export default function ProductDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = React.use(params);
  const [p, setP] = React.useState<any>(null);
  const [fs, setFs] = React.useState<any[]>([]);
  const [openId, setOpenId] = React.useState<string | null>(null);
  const [newF, setNewF] = React.useState("");
  const [note, setNote] = React.useState("");
  const [draft, setDraft] = React.useState("");
  const [draftAi, setDraftAi] = React.useState(false);
  const [upd, setUpd] = React.useState("");
  const [qprice, setQprice] = React.useState("");
  const [qqty, setQqty] = React.useState("");

  const load = React.useCallback(async () => {
    const r = await fetch(`/api/products/${id}`);
    if (!r.ok) return;
    const d = await r.json();
    setP(d.product);
    setFs(d.factories);
  }, [id]);
  React.useEffect(() => {
    load();
  }, [load]);

  async function patch(body: any) {
    await fetch(`/api/products/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    load();
  }
  async function fpatch(fid: string, body: any) {
    await fetch(`/api/factories/${fid}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    load();
  }

  if (!p) return <p className="text-muted-foreground">Loading…</p>;
  const df = openId ? fs.find((f) => f.id === openId) : null;
  const cur = STAGES.indexOf(p.stage);
  const steps = [
    { label: "Build spec sheet", done: cur > 0, go: () => patch({ stage: "spec" }) },
    { label: "FBA calculator (sheet)", done: !!p.fbaSheetUrl, go: () => document.getElementById("spec-card")?.scrollIntoView() },
    { label: "Source factories (Yuki)", done: cur > 1 || fs.length > 0, go: () => patch({ stage: "sourcing" }) },
  ];

  async function aiDraft() {
    let bullets: string[] = [];
    let at = "";
    if (p.asin) {
      try {
        const l = await (await fetch(`/api/lookup-asin?asin=${encodeURIComponent(p.asin)}`)).json();
        if (l.bullets) bullets = l.bullets;
        if (l.title) {
          at = l.title;
          await patch({ name: l.title });
        }
        if (l.imageUrl) await patch({ imageUrl: l.imageUrl });
      } catch {}
    }
    const r = await (
      await fetch("/api/spec-ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: p.name, amazonTitle: at, bullets, asin: p.asin }),
      })
    ).json();
    setDraft(r.draft || "");
    setDraftAi(!!r.ai);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-4">
        {p.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={p.imageUrl} alt="" className="h-16 w-16 rounded-lg border object-cover" />
        ) : (
          <div className="flex h-16 w-16 items-center justify-center rounded-lg bg-muted text-xl text-muted-foreground">◈</div>
        )}
        <div className="min-w-0 flex-1">
          <input
            value={p.name}
            onChange={(e) => setP({ ...p, name: e.target.value })}
            onBlur={(e) => {
              if (e.target.value !== p.name) patch({ name: e.target.value });
            }}
            className="w-full bg-transparent text-2xl font-semibold tracking-tight focus:outline-none"
          />
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            {p.asin && <span className="font-mono text-xs">{p.asin}</span>}
            <Badge variant="secondary">{STAGE_LABEL[p.stage] || p.stage}</Badge>
            <input
              type="date"
              value={p.startDate || ""}
              onChange={(e) => patch({ startDate: e.target.value })}
              title="Scheduled start — activates that morning"
              className="rounded-md border border-input bg-background px-2 py-1 text-xs"
            />
          </div>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Start</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-1">
          {steps.map((s, i) => (
            <button key={i} onClick={s.go} className="flex items-center gap-3 rounded-md px-2 py-2 text-left text-sm hover:bg-accent">
              <Checkbox checked={s.done} onCheckedChange={() => s.go()} />
              <span>{s.label}</span>
            </button>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Factories · {fs.filter((f) => f.active).length}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Stage</TableHead>
                <TableHead className="hidden sm:table-cell">Sample</TableHead>
                <TableHead className="hidden sm:table-cell">Quote</TableHead>
                <TableHead className="hidden md:table-cell">Contact</TableHead>
                <TableHead>Last note</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {fs.map((f) => (
                <TableRow key={f.id} className={`cursor-pointer ${f.active ? "" : "opacity-50"}`} onClick={() => setOpenId(f.id)}>
                  <TableCell className="font-medium">{f.name}</TableCell>
                  <TableCell>
                    <StageBadge v={f.fstage || "intro"} map={FSTAGE_LABEL} />
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">
                    <StageBadge v={f.sampleStatus} />
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">
                    <StageBadge v={f.quoteStatus} />
                  </TableCell>
                  <TableCell className="hidden text-xs text-muted-foreground md:table-cell">
                    {f.lastContactAt ? new Date(f.lastContactAt).toLocaleDateString("en-US", { month: "numeric", day: "numeric" }) : "—"}
                  </TableCell>
                  <TableCell className="max-w-[220px] truncate text-xs text-muted-foreground">
                    {f.comments[0]?.text.slice(0, 60) || "—"}
                  </TableCell>
                </TableRow>
              ))}
              {fs.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground">
                    No factories yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          <div className="p-2">
            <Input
              value={newF}
              onChange={(e) => setNewF(e.target.value)}
              placeholder="Add factory…"
              onKeyDown={async (e) => {
                if (e.key === "Enter" && newF.trim()) {
                  await fetch(`/api/products/${id}/factories`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ name: newF.trim() }),
                  });
                  setNewF("");
                  load();
                }
              }}
            />
          </div>
        </CardContent>
      </Card>

      <Card id="spec-card">
        <CardHeader>
          <CardTitle>Spec sheet</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex gap-2">
            <Button size="sm" onClick={aiDraft}>
              ✨ AI spec draft
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                const skuLine = ((p as any).skus || []).map((r: any) => `${r.sku || "?"} ${r.size || ""} pack ${r.pack || "?"}: ${r.order || "?"} units`).join("\n");
                const t = `Hi Yuki — new product to source:\n${p.name}${p.asin ? ` (ASIN ${p.asin})` : ""}\nMaster SKU: ${(p as any).masterSku || "TBD"}\n${skuLine || "SKU breakdown: TBD"}\nSheet: ${p.spec.sheetUrl || "in progress"}\nPlease find 5 factories. Thanks!`;
                navigator.clipboard?.writeText(t);
              }}
            >
              Copy Yuki brief
            </Button>
          </div>
          {draft && (
            <div className="rounded-lg border border-violet-200 bg-violet-50/50 p-3">
              <div className="mb-2 text-xs text-muted-foreground">{draftAi ? "🤖 AI draft" : "📝 Draft"} — edit, then approve:</div>
              <Textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={10} className="mb-2 bg-white" />
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={async () => {
                    const cur = p.spec.notes ? `${p.spec.notes}\n${draft}` : draft;
                    await patch({ spec: { notes: cur } });
                    setDraft("");
                  }}
                >
                  Approve → save to spec
                </Button>
                <Button size="sm" variant="outline" onClick={() => setDraft("")}>
                  Discard
                </Button>
              </div>
            </div>
          )}
          <div className="grid gap-1.5">
            <Label>Master SKU</Label>
            <Input value={(p as any).masterSku || ""} onChange={(e) => setP({ ...p, masterSku: e.target.value } as any)} onBlur={(e) => patch({ masterSku: e.target.value })} placeholder="e.g. MB-1800" className="font-mono" />
          </div>
          <div>
            <Label>Child SKUs</Label>
            <Table>
              <TableHeader><TableRow><TableHead>SKU</TableHead><TableHead>Size</TableHead><TableHead>Pack</TableHead><TableHead>Order units</TableHead><TableHead className="w-10"></TableHead></TableRow></TableHeader>
              <TableBody>
                {((p as any).skus || []).map((r: any, i: number) => (
                  <TableRow key={r.id || i}>
                    {(["sku", "size", "pack", "order"] as const).map((k) => (
                      <TableCell key={k} className="p-1">
                        <Input value={r[k] || ""} onChange={(e) => {
                          const skus = [...((p as any).skus || [])];
                          skus[i] = { ...skus[i], [k]: e.target.value };
                          setP({ ...p, skus } as any);
                        }} onBlur={() => patch({ skus: (p as any).skus })} className="h-8" />
                      </TableCell>
                    ))}
                    <TableCell className="p-1">
                      <button className="text-muted-foreground hover:text-destructive" onClick={() => {
                        const skus = ((p as any).skus || []).filter((_: any, j: number) => j !== i);
                        setP({ ...p, skus } as any); patch({ skus });
                      }}>✕</button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <Button size="sm" variant="outline" className="mt-1.5" onClick={() => {
              const skus = [...((p as any).skus || []), { id: Math.random().toString(36).slice(2, 9), sku: "", size: "", pack: "", order: "" }];
              setP({ ...p, skus } as any); patch({ skus });
            }}>+ SKU row</Button>
          </div>
          {(
            [
              ["Notes", "notes"],
              ["Google sheet URL", "sheetUrl"],
              ["FBA sheet URL", "fbaSheetUrl"],
            ] as const
          ).map(([label, k]) => (
            <div key={k} className="grid gap-1.5">
              <Label>{label}</Label>
              {k === "fbaSheetUrl" ? (
                <div className="flex gap-2">
                  <Input value={p.fbaSheetUrl || ""} onChange={(e) => setP({ ...p, fbaSheetUrl: e.target.value })} onBlur={(e) => patch({ fbaSheetUrl: e.target.value })} />
                  {p.fbaSheetUrl && (
                    <Button size="sm" variant="outline" asChild>
                      <a href={p.fbaSheetUrl} target="_blank" rel="noreferrer">
                        Open ↗
                      </a>
                    </Button>
                  )}
                </div>
              ) : (
                <Input value={p.spec[k] || ""} onChange={(e) => setP({ ...p, spec: { ...p.spec, [k]: e.target.value } })} onBlur={(e) => patch({ spec: { [k]: e.target.value } })} />
              )}
              {k === "sheetUrl" && p.spec.sheetUrl && (
                <Button size="sm" variant="outline" className="w-fit" asChild>
                  <a href={p.spec.sheetUrl} target="_blank" rel="noreferrer">
                    Open sheet ↗
                  </a>
                </Button>
              )}
            </div>
          ))}
          <div className="text-xs text-muted-foreground">Last update{p.spec.lastUpdate ? `: ${p.spec.lastUpdate}` : " — none yet"}</div>
          <Input
            value={upd}
            onChange={(e) => setUpd(e.target.value)}
            placeholder="Note today's spec update… (auto-dated)"
            onKeyDown={(e) => {
              if (e.key === "Enter" && upd.trim()) {
                patch({ spec: { lastUpdate: `${new Date().toLocaleDateString("en-US", { month: "numeric", day: "numeric" })} ${upd.trim()}` } });
                setUpd("");
              }
            }}
          />
          <div className="grid grid-cols-2 gap-2">
            <Input value={p.asin || ""} onChange={(e) => setP({ ...p, asin: e.target.value.toUpperCase() })} onBlur={(e) => patch({ asin: e.target.value.toUpperCase() })} placeholder="ASIN" maxLength={10} className="font-mono uppercase" />
            <Input value={p.imageUrl || ""} onChange={(e) => setP({ ...p, imageUrl: e.target.value })} onBlur={(e) => patch({ imageUrl: e.target.value })} placeholder="Photo URL" />
          </div>
          <Button
            variant="destructive"
            className="w-fit"
            onClick={async () => {
              if (!confirm(`Delete ${p.name} and all its factories?`)) return;
              await fetch(`/api/products/${id}`, { method: "DELETE" });
              window.location.href = "/dashboard/products";
            }}
          >
            Delete product
          </Button>
        </CardContent>
      </Card>

      <Sheet open={!!df} onOpenChange={(o) => !o && setOpenId(null)}>
        <SheetContent className="w-[480px] overflow-y-auto sm:max-w-[480px]">
          {df && (
            <>
              <SheetHeader>
                <SheetTitle>{df.name}</SheetTitle>
              </SheetHeader>
              <div className="mt-4 flex flex-col gap-4">
                <div className="flex flex-wrap gap-1.5">
                  {FSTAGES.map((s) => (
                    <Badge
                      key={s}
                      variant={s === df.fstage ? "default" : "outline"}
                      className="cursor-pointer"
                      onClick={() => fpatch(df.id, { fstage: s, lastContactAt: Date.now() })}
                    >
                      {FSTAGE_LABEL[s]}
                    </Badge>
                  ))}
                </div>
                {FNEXT[df.fstage || "intro"] && <p className="text-sm text-amber-700">Next: {FNEXT[df.fstage || "intro"]}</p>}
                <div className="grid grid-cols-2 gap-2">
                  <div className="grid gap-1.5">
                    <Label>Sample</Label>
                    <Select
                      value={df.sampleStatus}
                      onValueChange={(v) =>
                        fpatch(df.id, {
                          sampleStatus: v,
                          sampleRequestedAt: v === "requested" && !df.sampleRequestedAt ? Date.now() : df.sampleRequestedAt,
                          sampleShippedAt: v === "shipped" ? Date.now() : df.sampleShippedAt,
                        })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">—</SelectItem>
                        <SelectItem value="requested">Requested</SelectItem>
                        <SelectItem value="shipped">Shipped</SelectItem>
                        <SelectItem value="received">Received</SelectItem>
                        <SelectItem value="qc">QC ✓</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-1.5">
                    <Label>Quote</Label>
                    <Select value={df.quoteStatus} onValueChange={(v) => fpatch(df.id, { quoteStatus: v })}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">—</SelectItem>
                        <SelectItem value="waiting_factory">w/ factory</SelectItem>
                        <SelectItem value="waiting_me">MY reply</SelectItem>
                        <SelectItem value="received">Received</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Input
                    value={df.contact || ""}
                    onChange={(e) => setFs(fs.map((x) => (x.id === df.id ? { ...x, contact: e.target.value } : x)))}
                    onBlur={(e) => fpatch(df.id, { contact: e.target.value })}
                    placeholder="contact / wechat / phone"
                  />
                  <Button size="sm" variant="outline" onClick={() => fpatch(df.id, { lastContactAt: Date.now() })}>
                    Ping
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => fpatch(df.id, { active: !df.active })}>
                    {df.active ? "Active" : "Off"}
                  </Button>
                </div>
                <div>
                  <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    People · {(df.people || []).length}
                  </div>
                  {(df.people || []).map((pe: any) => (
                    <div key={pe.id} className="mb-1 rounded-md border p-2 text-sm">
                      <div className="flex items-center justify-between">
                        <span className="font-medium">{pe.name}{pe.role ? ` · ${pe.role}` : ""}</span>
                        <button className="text-muted-foreground hover:text-destructive" onClick={() => fpatch(df.id, { delPerson: pe.id })}>✕</button>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {[pe.wechat && `WeChat: ${pe.wechat}`, pe.whatsapp && `WA: ${pe.whatsapp}`, pe.email && pe.email].filter(Boolean).join(" · ") || "no channels yet"}
                      </div>
                    </div>
                  ))}
                  <PersonAdd fid={df.id} onAdd={(b: any) => fpatch(df.id, { addPerson: b })} />
                </div>
                <div className="flex gap-2">
                  <Input value={qprice} onChange={(e) => setQprice(e.target.value)} placeholder="unit $: 4.20" />
                  <Input value={qqty} onChange={(e) => setQqty(e.target.value)} placeholder="qty" />
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      fpatch(df.id, { addQuote: { unitPrice: qprice, qty: qqty } });
                      setQprice("");
                      setQqty("");
                    }}
                  >
                    Log
                  </Button>
                </div>
                {df.quotes.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    last: ${df.quotes[df.quotes.length - 1].unitPrice} x {df.quotes[df.quotes.length - 1].qty}
                  </p>
                )}
                <div>
                  <Input
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Add note… (auto-timestamped)"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && note.trim()) {
                        fpatch(df.id, { addComment: note.trim(), lastContactAt: Date.now() });
                        setNote("");
                      }
                    }}
                  />
                  <div className="mt-2 flex flex-col gap-2">
                    {df.comments.map((c: any, i: number) => (
                      <div key={i} className="rounded-md border p-2 text-sm">
                        {c.text}
                        <div className="text-xs text-muted-foreground">{new Date(c.ts).toLocaleString()}</div>
                      </div>
                    ))}
                    {df.comments.length === 0 && <p className="text-sm text-muted-foreground">No notes yet.</p>}
                  </div>
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
