"use client";

import * as React from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";

import { SpecFieldsSection } from "./_components/spec-fields-section";
import { StageLadder } from "./_components/stage-ladder";

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
  const [draft, setDraft] = React.useState("");
  const [draftAi, setDraftAi] = React.useState(false);
  const [upd, setUpd] = React.useState("");
  const [yukiPreviewOpen, setYukiPreviewOpen] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const r = await fetch(`/api/products/${id}`);
      if (!r.ok) throw new Error("bad response");
      const d = await r.json();
      setP(d.product);
      setFs(d.factories);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [id]);
  React.useEffect(() => {
    load();
  }, [load]);

  async function patch(body: any) {
    await fetch(`/api/products/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    load();
  }
  async function fpatch(fid: string, body: any) {
    await fetch(`/api/factories/${fid}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    load();
  }

  const yukiBriefs: any[] = (p as any)?.yukiBriefs || [];
  const lastBrief = yukiBriefs.length ? yukiBriefs[yukiBriefs.length - 1] : null;
  const specDone = !!(p as any)?.specDone;
  const specUpdatedAt = (p as any)?.specUpdatedAt as number | null;
  const isOutdated = !!lastBrief && !!specUpdatedAt && specUpdatedAt > lastBrief.sentAt;
  const canSendBrief = specDone && !!(p?.spec?.notes && p.spec.notes.trim());

  function buildYukiBriefContent() {
    const skuLine = ((p as any).skus || [])
      .map((r: any) => `${r.sku || "?"} ${r.size || ""} pack ${r.pack || "?"}: ${r.order || "?"} units`)
      .join("\n");
    const factoryLines = fs
      .filter((f) => f.active)
      .map((f) => `- ${f.name}${f.contact ? ` (${f.contact})` : ""}`)
      .join("\n");
    return [
      `Hi Yuki — brief for: ${p.name}${p.asin ? ` (ASIN ${p.asin})` : ""}`,
      `Master SKU: ${(p as any).masterSku || "TBD"}`,
      skuLine || "SKU breakdown: TBD",
      "",
      "Spec notes:",
      p.spec.notes || "(none)",
      "",
      "Factories / contacts:",
      factoryLines || "(none active yet)",
    ].join("\n");
  }

  async function sendYukiBrief() {
    const content = buildYukiBriefContent();
    const nextVersion = (lastBrief?.version || 0) + 1;
    const brief = { version: nextVersion, sentAt: Date.now(), content };
    await patch({ yukiBriefs: [...yukiBriefs, brief] });
    setYukiPreviewOpen(false);
  }

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

  // --- Stage ladder computations ---
  const specApproved = !!(p as any)?.specVersion && (p as any).specVersion > 0;
  const specFields: any[] = (p as any)?.specFields || [];
  const specNeedsInput = specFields.filter((f: any) => !f.value || f.value.trim() === "").length;
  const fbaSheetUrl = (p as any)?.fbaSheetUrl || null;
  const factoryCount = fs.length;
  const factoriesWithStep1 = fs.filter((f) => f.fstage && f.fstage !== "intro").length;
  const factoriesWithStep3 = fs.filter((f) =>
    ["sample_requested", "sample_yiwu", "sample_ny", "sample_confirmed", "quoted", "negotiating", "ordered"].includes(
      f.fstage,
    ),
  ).length;
  const factoriesWithStep4 = fs.filter((f) =>
    ["sample_yiwu", "sample_ny", "sample_confirmed", "quoted", "negotiating", "ordered"].includes(f.fstage),
  ).length;
  const samplesPassedChina = 0; // Goal 10 will populate
  const samplesArrivedNY = 0;
  const samplesApproved = 0;

  function openFactory(fid: string) {
    setOpenId(fid);
  }

  function gotoSamplesChina() {
    window.location.href = "/dashboard/samples?tab=china";
  }
  function gotoSamplesNY() {
    window.location.href = "/dashboard/samples?tab=ny";
  }

  // --- Loading state ---
  if (loading) {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-4">
          <Skeleton className="h-16 w-16 rounded-lg" />
          <div className="flex-1 gap-2">
            <Skeleton className="h-7 w-48" />
            <Skeleton className="mt-2 h-4 w-32" />
          </div>
        </div>
        <Skeleton className="h-64 w-full rounded-lg" />
        <Skeleton className="h-48 w-full rounded-lg" />
        <Skeleton className="h-96 w-full rounded-lg" />
      </div>
    );
  }

  // --- Error state ---
  if (error || !p) {
    return (
      <div className="flex flex-col items-center gap-4 py-16">
        <p className="text-muted-foreground" data-testid="product-error">
          Could not load this product.
        </p>
        <Button variant="outline" onClick={load} data-testid="retry-btn">
          Retry
        </Button>
      </div>
    );
  }

  const df = openId ? fs.find((f) => f.id === openId) : null;

  return (
    <div className="flex flex-col gap-4">
      {/* Header with image, name, stage badge, start date — Star stays */}
      <div className="flex items-center gap-4">
        {p.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={p.imageUrl} alt="" className="h-16 w-16 rounded-lg border object-cover" />
        ) : (
          <div className="flex h-16 w-16 items-center justify-center rounded-lg bg-muted text-xl text-muted-foreground">
            ◈
          </div>
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

      {/* Stage ladder — replaces the loose Start checklist */}
      <StageLadder
        specApproved={specApproved}
        specNeedsInput={specNeedsInput}
        fbaSheetUrl={fbaSheetUrl}
        factoryCount={factoryCount}
        factoriesWithStep1={factoriesWithStep1}
        factoriesWithStep3={factoriesWithStep3}
        factoriesWithStep4={factoriesWithStep4}
        samplesPassedChina={samplesPassedChina}
        samplesArrivedNY={samplesArrivedNY}
        samplesApproved={samplesApproved}
        onStage1Action={() => document.getElementById("spec-card")?.scrollIntoView({ behavior: "smooth" })}
        onStage2Action={() => {
          if (p.fbaSheetUrl) window.open(p.fbaSheetUrl, "_blank", "noopener,noreferrer");
          else document.getElementById("spec-card")?.scrollIntoView({ behavior: "smooth" });
        }}
        onStage3Action={() => document.getElementById("factories-card")?.scrollIntoView({ behavior: "smooth" })}
        onStage4Action={openFactory}
        onStage5Action={openFactory}
        onStage6Action={gotoSamplesChina}
        onStage7Action={gotoSamplesNY}
        onStage8Action={gotoSamplesNY}
        factories={fs.map((f) => ({ id: f.id, name: f.name, fstage: f.fstage || "intro" }))}
      />

      {/* Factories section — lists factory rows */}
      <Card id="factories-card" data-testid="factories-section">
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
                <TableRow
                  key={f.id}
                  className={`cursor-pointer ${f.active ? "" : "opacity-50"}`}
                  onClick={() => setOpenId(f.id)}
                  data-testid={`factory-row-${f.id}`}
                >
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
                    {f.lastContactAt
                      ? new Date(f.lastContactAt).toLocaleDateString("en-US", { month: "numeric", day: "numeric" })
                      : "—"}
                  </TableCell>
                  <TableCell className="max-w-[220px] truncate text-xs text-muted-foreground">
                    {f.comments[0]?.text.slice(0, 60) || "—"}
                  </TableCell>
                </TableRow>
              ))}
              {fs.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground" data-testid="factories-empty">
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

      {/* Spec sheet section */}
      <Card id="spec-card">
        <CardHeader>
          <CardTitle>Spec sheet</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex gap-2">
            <Button size="sm" onClick={aiDraft}>
              ✨ AI spec draft
            </Button>
            <Button size="sm" variant="outline" asChild>
              <a href={`/api/products/${id}/spec-pdf`} target="_blank" rel="noreferrer">
                ⬇ Download spec PDF
              </a>
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!canSendBrief}
              title={!canSendBrief ? "Approve the spec (Build spec sheet + notes) before sending to Yuki" : undefined}
              onClick={() => setYukiPreviewOpen(true)}
              data-testid="send-yuki-btn"
            >
              {lastBrief ? "Resend Yuki Brief" : "Send Yuki Brief"}
            </Button>
            {isOutdated && (
              <Badge variant="destructive" className="self-center">
                Outdated — Yuki has v{lastBrief.version}
              </Badge>
            )}
          </div>
          {lastBrief && (
            <div className="text-xs text-muted-foreground" data-testid="yuki-brief-sent">
              Brief v{lastBrief.version} sent to Yuki, {new Date(lastBrief.sentAt).toLocaleString()}
            </div>
          )}
          {draft && (
            <div className="rounded-lg border border-violet-200 bg-violet-50/50 p-3">
              <div className="mb-2 text-xs text-muted-foreground">
                {draftAi ? "🤖 AI draft" : "📝 Draft"} — edit, then approve:
              </div>
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
            <Input
              value={(p as any).masterSku || ""}
              onChange={(e) => setP({ ...p, masterSku: e.target.value } as any)}
              onBlur={(e) => patch({ masterSku: e.target.value })}
              placeholder="e.g. MB-1800"
              className="font-mono"
            />
          </div>
          <div>
            <Label>Child SKUs</Label>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>SKU</TableHead>
                  <TableHead>Size</TableHead>
                  <TableHead>Pack</TableHead>
                  <TableHead>Order units</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {((p as any).skus || []).map((r: any, i: number) => (
                  <TableRow key={r.id || i}>
                    {(["sku", "size", "pack", "order"] as const).map((k) => (
                      <TableCell key={k} className="p-1">
                        <Input
                          value={r[k] || ""}
                          onChange={(e) => {
                            const skus = [...((p as any).skus || [])];
                            skus[i] = { ...skus[i], [k]: e.target.value };
                            setP({ ...p, skus } as any);
                          }}
                          onBlur={() => patch({ skus: (p as any).skus })}
                          className="h-8"
                        />
                      </TableCell>
                    ))}
                    <TableCell className="p-1">
                      <button
                        className="text-muted-foreground hover:text-destructive"
                        onClick={() => {
                          const skus = ((p as any).skus || []).filter((_: any, j: number) => j !== i);
                          setP({ ...p, skus } as any);
                          patch({ skus });
                        }}
                      >
                        ✕
                      </button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <Button
              size="sm"
              variant="outline"
              className="mt-1.5"
              onClick={() => {
                const skus = [
                  ...((p as any).skus || []),
                  { id: Math.random().toString(36).slice(2, 9), sku: "", size: "", pack: "", order: "" },
                ];
                setP({ ...p, skus } as any);
                patch({ skus });
              }}
            >
              + SKU row
            </Button>
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
                  <Input
                    value={p.fbaSheetUrl || ""}
                    onChange={(e) => setP({ ...p, fbaSheetUrl: e.target.value })}
                    onBlur={(e) => patch({ fbaSheetUrl: e.target.value })}
                  />
                  {p.fbaSheetUrl && (
                    <Button size="sm" variant="outline" asChild>
                      <a href={p.fbaSheetUrl} target="_blank" rel="noreferrer">
                        Open ↗
                      </a>
                    </Button>
                  )}
                </div>
              ) : (
                <Input
                  value={p.spec[k] || ""}
                  onChange={(e) => setP({ ...p, spec: { ...p.spec, [k]: e.target.value } })}
                  onBlur={(e) => patch({ spec: { [k]: e.target.value } })}
                />
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
          <div className="text-xs text-muted-foreground">
            Last update{p.spec.lastUpdate ? `: ${p.spec.lastUpdate}` : " — none yet"}
          </div>

          <div className="rounded-lg border p-3">
            <div className="mb-2 text-sm font-semibold">Structured spec fields</div>
            <SpecFieldsSection
              productId={id}
              specFields={(p as any).specFields || []}
              specVersion={(p as any).specVersion || 0}
              specVersions={(p as any).specVersions || []}
              onSaved={load}
            />
          </div>

          <Input
            value={upd}
            onChange={(e) => setUpd(e.target.value)}
            placeholder="Note today's spec update… (auto-dated)"
            onKeyDown={(e) => {
              if (e.key === "Enter" && upd.trim()) {
                patch({
                  spec: {
                    lastUpdate: `${new Date().toLocaleDateString("en-US", { month: "numeric", day: "numeric" })} ${upd.trim()}`,
                  },
                });
                setUpd("");
              }
            }}
          />
          <div className="grid grid-cols-2 gap-2">
            <Input
              value={p.asin || ""}
              onChange={(e) => setP({ ...p, asin: e.target.value.toUpperCase() })}
              onBlur={(e) => patch({ asin: e.target.value.toUpperCase() })}
              placeholder="ASIN"
              maxLength={10}
              className="font-mono uppercase"
            />
            <Input
              value={p.imageUrl || ""}
              onChange={(e) => setP({ ...p, imageUrl: e.target.value })}
              onBlur={(e) => patch({ imageUrl: e.target.value })}
              placeholder="Photo URL"
            />
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
                <p className="text-sm text-muted-foreground">
                  Factory detail panel is being rebuilt — removed for now per Haim.
                </p>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => fpatch(df.id, { active: !df.active })}>
                    {df.active ? "Active" : "Off"}
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={async () => {
                      if (!confirm(`Remove ${df.name}?`)) return;
                      await fetch(`/api/factories/${df.id}`, { method: "DELETE" });
                      setOpenId(null);
                      load();
                    }}
                  >
                    Remove factory
                  </Button>
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      <Dialog open={yukiPreviewOpen} onOpenChange={setYukiPreviewOpen}>
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Preview Yuki brief {lastBrief ? `(v${(lastBrief.version || 0) + 1})` : "(v1)"}</DialogTitle>
          </DialogHeader>
          <pre className="whitespace-pre-wrap rounded-md border bg-muted/40 p-3 font-mono text-xs">
            {buildYukiBriefContent()}
          </pre>
          <DialogFooter>
            <Button variant="outline" onClick={() => setYukiPreviewOpen(false)}>
              Cancel
            </Button>
            <Button onClick={sendYukiBrief}>Confirm &amp; send to Yuki</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
