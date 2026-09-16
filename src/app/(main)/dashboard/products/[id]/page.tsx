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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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

function FactoryLadder({ factoryId, factoryStage, onStageChange, onSamplesChina, onSamplesNY, hasSamples }: {
  factoryId: string;
  factoryStage: string;
  onStageChange: (s: string) => void;
  onSamplesChina: () => void;
  onSamplesNY: () => void;
  hasSamples: boolean;
}) {
  const steps = [
    { n: 1, key: "spec_agreed", label: "Spec agreed", sub: "Factory confirmed the spec" },
    { n: 2, key: "sample_committed", label: "Sample committed", sub: "Factory agreed to send a sample" },
    { n: 3, key: "passed_china", label: "Passed China check", sub: "Yuki approved the sample in Yiwu" },
    { n: 4, key: "arrived_ny", label: "Arrived in New York", sub: "Sample shipped to NY office" },
    { n: 5, key: "sample_approved", label: "Sample approved", sub: "Haim approved the sample" },
  ];
  const currentIdx = steps.findIndex((s) => s.key === factoryStage);
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Factory pipeline</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-1">
          {steps.map((s, i) => {
            const state = i < currentIdx ? "done" : i === currentIdx ? "current" : "not-started";
            return (
              <div key={s.n} className="flex items-stretch gap-2">
                <div className="flex flex-col items-center pt-1">
                  <div className={`flex h-6 w-6 items-center justify-center rounded-full border-2 text-xs font-medium ${
                    state === "done" ? "border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/30" :
                    state === "current" ? "border-blue-300 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/30" :
                    "border-border bg-card"
                  }`}>
                    {state === "done" ? "✓" : s.n}
                  </div>
                  {i < steps.length - 1 && <div className={`mt-0.5 w-px flex-1 ${state === "done" ? "bg-emerald-200" : "bg-border"}`} />}
                </div>
                <div className="flex flex-1 flex-wrap items-center gap-2 pb-2">
                  <div className="flex-1">
                    <div className="text-sm font-medium">{s.label}</div>
                    <p className="text-xs text-muted-foreground">{s.sub}</p>
                  </div>
                  {i === currentIdx && i < steps.length - 1 && (
                    <Button size="sm" variant="outline" onClick={() => onStageChange(steps[i + 1].key)}>
                      Advance →
                    </Button>
                  )}
                  {i === currentIdx && i === 2 && (
                    <Button size="sm" variant="ghost" onClick={onSamplesChina}>Samples, China tab</Button>
                  )}
                  {i === currentIdx && i === 3 && (
                    <Button size="sm" variant="ghost" onClick={onSamplesNY}>Samples, NY tab</Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        {hasSamples && currentIdx >= 1 && (
          <div className="mt-2 flex gap-2">
            <Button size="sm" variant="ghost" onClick={onSamplesChina}>Samples, China tab</Button>
            <Button size="sm" variant="ghost" onClick={onSamplesNY}>Samples, New York tab</Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function AddContactRow({ factoryId, onAdded }: { factoryId: string; onAdded: () => void }) {
  const [name, setName] = React.useState("");
  const [whatsapp, setWhatsapp] = React.useState("");
  return (
    <div className="mt-2 flex gap-1">
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Contact name…"
        className="h-8 text-xs"
      />
      <Input
        value={whatsapp}
        onChange={(e) => setWhatsapp(e.target.value)}
        placeholder="WhatsApp #…"
        className="h-8 text-xs w-32"
      />
      <Button
        size="sm"
        variant="outline"
        disabled={!name.trim()}
        onClick={async () => {
          await fetch(`/api/factories/${factoryId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ addPerson: { name: name.trim(), whatsapp: whatsapp.trim(), role: "" } }),
          });
          setName("");
          setWhatsapp("");
          onAdded();
        }}
      >
        + Add
      </Button>
    </div>
  );
}

export default function ProductDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = React.use(params);
  const [p, setP] = React.useState<any>(null);
  const [fs, setFs] = React.useState<any[]>([]);
  const [openId, setOpenId] = React.useState<string | null>(null);
  const [newF, setNewF] = React.useState("");
  const [draftFields, setDraftFields] = React.useState<any[]>([]);
  const [draftLoading, setDraftLoading] = React.useState(false);
  const [editMode, setEditMode] = React.useState(false);
  const [editRequest, setEditRequest] = React.useState("");
  const [editLoading, setEditLoading] = React.useState(false);
  const [showManual, setShowManual] = React.useState(false);
  const [viewVersion, setViewVersion] = React.useState<string>("current");
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
    setDraftLoading(true);
    setEditMode(false);
    setEditRequest("");
    try {
      const r = await (
        await fetch("/api/spec-ai", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: p.name, amazonTitle: at, bullets, asin: p.asin }),
        })
      ).json();
      setDraftFields(r.fields || []);
    } catch {
      setDraftFields([]);
    } finally {
      setDraftLoading(false);
    }
  }

  async function aiEdit() {
    if (!editRequest.trim()) return;
    setEditLoading(true);
    try {
      const r = await (
        await fetch("/api/spec-ai-edit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fields: draftFields, request: editRequest.trim() }),
        })
      ).json();
      if (r.after) {
        setDraftFields(r.after);
      }
      setEditRequest("");
      setEditMode(false);
    } catch {
      // keep current fields
    } finally {
      setEditLoading(false);
    }
  }

  async function approveDraft() {
    await patch({ specFields: draftFields, approveSpecVersion: true });
    setDraftFields([]);
    setEditMode(false);
    setEditRequest("");
    setViewVersion("current");
  }

  // --- Stage ladder computations ---
  const specApproved = !!(p as any)?.specVersion && (p as any).specVersion > 0;
  const specFields: any[] = (p as any)?.specFields || [];
  const specNeedsInput = 0; // no longer shown
  const specVersionNum: number = (p as any)?.specVersion || 0;
  const specVersionsList: any[] = ((p as any)?.specVersions || []).slice().sort((a: any, b: any) => b.version - a.version);
  const viewingVer = viewVersion !== "current" ? specVersionsList.find((v: any) => String(v.version) === viewVersion) : null;
  const displayVerFields: any[] = (viewingVer ? (viewingVer as any).fields : specVersionsList[0]?.fields || []).filter((f: any) => f.value && f.value !== "Needs input");
  const fbaSheetUrl = (p as any)?.fbaSheetUrl || null;
  const factoryCount = fs.length;

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
            <select
              value={(p as any).productStatus || "queue"}
              onChange={(e) => patch({ productStatus: e.target.value })}
              className="rounded-md border border-input bg-background px-2 py-1 text-xs"
            >
              <option value="queue">Queue</option>
              <option value="active">Active</option>
              <option value="completed">Completed</option>
            </select>
          </div>
          <div className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
            <span>Avg price/unit:</span>
            <span>$</span>
            <input
              type="number"
              step="0.01"
              value={(p as any).averagePricePerUnit || 0}
              onChange={(e) => setP({ ...p, averagePricePerUnit: Number(e.target.value) } as any)}
              onBlur={(e) => patch({ averagePricePerUnit: Number(e.target.value) })}
              className="w-20 rounded-md border border-input bg-background px-2 py-1 text-xs"
            />
            <span className="ml-3">Est. monthly volume:</span>
            <input
              type="number"
              value={(p as any).estimatedMonthlySales || 0}
              onChange={(e) => setP({ ...p, estimatedMonthlySales: Number(e.target.value) } as any)}
              onBlur={(e) => patch({ estimatedMonthlySales: Number(e.target.value) })}
              className="w-24 rounded-md border border-input bg-background px-2 py-1 text-xs"
            />
            <span>units</span>
            {((p as any).averagePricePerUnit || 0) > 0 && ((p as any).estimatedMonthlySales || 0) > 0 && (
              <span className="ml-3 text-xs font-medium text-foreground">
                = ${(((p as any).averagePricePerUnit || 0) * ((p as any).estimatedMonthlySales || 0)).toLocaleString(undefined, { maximumFractionDigits: 0 })}/mo
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Stage ladder — product-level steps 1-3 only */}
      <StageLadder
        specApproved={specApproved}
        fbaSheetUrl={fbaSheetUrl}
        factoryCount={factoryCount}
        onStage1Action={() => document.getElementById("spec-card")?.scrollIntoView({ behavior: "smooth" })}
        onStage2Action={() => {
          if (p.fbaSheetUrl) window.open(p.fbaSheetUrl, "_blank", "noopener,noreferrer");
          else document.getElementById("spec-card")?.scrollIntoView({ behavior: "smooth" });
        }}
        onStage3Action={() => document.getElementById("factories-card")?.scrollIntoView({ behavior: "smooth" })}
      />

      {/* Factory progress summary (replaces steps 4-8) */}
      {fs.length > 0 && (
        <Card>
          <CardContent className="py-3">
            <a
              href="#factories-card"
              onClick={(e) => { e.preventDefault(); document.getElementById("factories-card")?.scrollIntoView({ behavior: "smooth" }); }}
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              {fs.length} factor{fs.length === 1 ? "y" : "ies"} ·{" "}
              {fs.filter((f) => (f as any).factoryStage === "spec_agreed").length} spec agreed ·{" "}
              {fs.filter((f) => (f as any).factoryStage === "sample_committed").length} sample committed ·{" "}
              {fs.filter((f) => (f as any).factoryStage === "passed_china").length} passed China ·{" "}
              {fs.filter((f) => (f as any).factoryStage === "arrived_ny").length} arrived NY ·{" "}
              {fs.filter((f) => (f as any).factoryStage === "sample_approved").length} approved
            </a>
          </CardContent>
        </Card>
      )}

      {/* Factories section — lists factory rows with inline editing */}
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
                  <TableCell className="font-medium p-1">
                    <input
                      defaultValue={f.name}
                      onBlur={(e) => { if (e.target.value !== f.name) fpatch(f.id, { name: e.target.value }); }}
                      onClick={(e) => { e.stopPropagation(); setOpenId(f.id); }}
                      className="w-full rounded border-transparent bg-transparent hover:border-border focus:border-border px-1 py-0.5 text-sm"
                    />
                  </TableCell>
                  <TableCell className="p-1">
                    <select
                      defaultValue={(f as any).factoryStage || "spec_agreed"}
                      onChange={(e) => fpatch(f.id, { factoryStage: e.target.value })}
                      onClick={(e) => e.stopPropagation()}
                      className="rounded-md border border-input bg-background px-1 py-1 text-xs"
                    >
                      <option value="spec_agreed">Spec agreed</option>
                      <option value="sample_committed">Sample committed</option>
                      <option value="passed_china">Passed China</option>
                      <option value="arrived_ny">Arrived NY</option>
                      <option value="sample_approved">Approved</option>
                    </select>
                  </TableCell>
                  <TableCell className="hidden sm:table-cell p-1">
                    <select
                      defaultValue={f.sampleStatus || "none"}
                      onChange={(e) => fpatch(f.id, { sampleStatus: e.target.value })}
                      onClick={(e) => e.stopPropagation()}
                      className="rounded-md border border-input bg-background px-1 py-1 text-xs"
                    >
                      <option value="none">None</option>
                      <option value="requested">Requested</option>
                      <option value="shipped">Shipped</option>
                      <option value="received">Received</option>
                      <option value="qc">QC</option>
                    </select>
                  </TableCell>
                  <TableCell className="hidden sm:table-cell p-1">
                    <input
                      type="text"
                      defaultValue={(f.quotes && f.quotes.length > 0) ? `$${f.quotes[f.quotes.length-1].unitPrice}/u × ${f.quotes[f.quotes.length-1].qty}` : ""}
                      onBlur={(e) => {
                        if (e.target.value.trim() && e.target.value.startsWith("$")) {
                          const m = e.target.value.match(/\$(\d+(?:\.\d+)?).*?(\d+)/);
                          if (m) fpatch(f.id, { addQuote: { unitPrice: Number(m[1]), qty: Number(m[2]), notes: "" } });
                        }
                      }}
                      onClick={(e) => e.stopPropagation()}
                      placeholder="Quote"
                      className="w-28 rounded border border-transparent bg-transparent hover:border-border focus:border-border px-1 py-0.5 text-xs"
                    />
                  </TableCell>
                  <TableCell className="hidden md:table-cell p-1">
                    <div className="flex flex-col gap-0.5">
                      {((f as any).people || []).map((person: any) => (
                        <span key={person.id} className="text-xs text-muted-foreground">
                          {person.name}{person.whatsapp ? ` (${person.whatsapp})` : ""}
                        </span>
                      ))}
                      <button
                        className="text-xs text-blue-600 hover:underline"
                        onClick={(e) => { e.stopPropagation(); setOpenId(f.id); }}
                      >
                        + contact
                      </button>
                    </div>
                  </TableCell>
                  <TableCell className="max-w-[220px] p-1">
                    <input
                      defaultValue={f.comments && f.comments.length > 0 ? f.comments[0].text : ""}
                      onBlur={(e) => {
                        if (e.target.value.trim()) fpatch(f.id, { addComment: e.target.value.trim() });
                      }}
                      onClick={(e) => e.stopPropagation()}
                      placeholder="Add note…"
                      className="w-full rounded border border-transparent bg-transparent hover:border-border focus:border-border px-1 py-0.5 text-xs text-muted-foreground"
                    />
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
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={aiDraft} disabled={draftLoading}>
              {draftLoading ? "Reading Amazon listing…" : "✨ AI spec draft"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!specApproved}
              title={!specApproved ? "Approve a spec first." : undefined}
              asChild={specApproved}
            >
              {specApproved ? (
                <a href={`/api/products/${id}/spec-pdf`} target="_blank" rel="noreferrer">
                  ⬇ Download spec PDF
                </a>
              ) : (
                <span>⬇ Download spec PDF</span>
              )}
            </Button>
            {!specApproved && (
              <span className="self-center text-xs text-muted-foreground">Approve a spec first.</span>
            )}
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

          {/* AI draft review box - single box with Approve + Suggest an edit */}
          {draftFields.length > 0 && (
            <div className="rounded-lg border border-violet-200 bg-violet-50/50 p-3">
              <div className="mb-2 text-xs text-muted-foreground">🤖 AI spec draft — review:</div>
              <div className="flex flex-col divide-y rounded-md border bg-white">
                {draftFields.filter((f: any) => f.value && f.value !== "Needs input").map((f: any, i: number) => (
                  <div key={f.id || i} className="flex items-start gap-2 p-2">
                    <div className="w-32 shrink-0 text-xs font-medium text-muted-foreground">{f.label}</div>
                    <div className="flex-1 text-sm">{f.value}</div>
                    {f.tag && (
                      <Badge variant={f.tag === "locked" ? "default" : f.tag === "flexible" ? "secondary" : "outline"} className="text-[10px]">
                        {f.tag}
                      </Badge>
                    )}
                  </div>
                ))}
              </div>
              {editMode ? (
                <div className="mt-2 flex flex-col gap-2">
                  <Textarea
                    value={editRequest}
                    onChange={(e) => setEditRequest(e.target.value)}
                    placeholder="Describe what to change in plain English…"
                    rows={2}
                    className="bg-white"
                    autoFocus
                  />
                  <div className="flex gap-2">
                    <Button size="sm" onClick={aiEdit} disabled={editLoading || !editRequest.trim()}>
                      {editLoading ? "Rewriting…" : "Rewrite spec"}
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => { setEditMode(false); setEditRequest(""); }}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="mt-2 flex gap-2">
                  <Button size="sm" onClick={approveDraft}>
                    Approve → v{specVersionNum + 1}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setEditMode(true)}>
                    Suggest an edit
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => { setDraftFields([]); setEditMode(false); setEditRequest(""); }}>
                    Discard
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* Approved spec display with version dropdown */}
          {specApproved && draftFields.length === 0 && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">Current (v{specVersionNum})</span>
                {specVersionsList.length > 0 && (
                  <Select value={viewVersion} onValueChange={setViewVersion}>
                    <SelectTrigger size="sm" className="w-[200px]">
                      <SelectValue placeholder="Version" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="current">Current (v{specVersionNum})</SelectItem>
                      {specVersionsList.map((v: any) => (
                        <SelectItem key={v.version} value={String(v.version)}>
                          v{v.version} — {new Date(v.createdAt).toLocaleDateString()}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
              <div className="flex flex-col divide-y rounded-lg border">
                {displayVerFields.length === 0 ? (
                  <div className="p-3 text-sm text-muted-foreground">No fields in this version.</div>
                ) : (
                  displayVerFields.map((f: any, i: number) => (
                    <div key={f.id || i} className="flex items-start gap-2 p-2">
                      <div className="min-w-[120px] text-sm font-medium">{f.label || "—"}</div>
                      <div className="flex-1 text-sm">{f.value}</div>
                      {f.tag && (
                        <Badge variant={f.tag === "locked" ? "default" : f.tag === "flexible" ? "secondary" : "outline"} className="text-[10px]">
                          {f.tag}
                        </Badge>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* Collapsed manual edit - backup only */}
          <div>
            <button
              className="text-xs text-muted-foreground underline hover:text-foreground"
              onClick={() => setShowManual(!showManual)}
            >
              {showManual ? "Hide manual edit" : "Edit manually"}
            </button>
            {showManual && (
              <div className="mt-2 rounded-lg border p-3">
                <div className="mb-2 text-sm font-semibold">Structured spec fields</div>
                <SpecFieldsSection
                  productId={id}
                  specFields={(p as any).specFields || []}
                  specVersion={(p as any).specVersion || 0}
                  specVersions={(p as any).specVersions || []}
                  onSaved={load}
                />
              </div>
            )}
          </div>

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
        <SheetContent className="w-[520px] overflow-y-auto sm:max-w-[520px]">
          {df && (
            <>
              <SheetHeader>
                <SheetTitle>{df.name}</SheetTitle>
              </SheetHeader>
              <div className="mt-4 flex flex-col gap-4">
                {/* Factory-level 5-step ladder */}
                <FactoryLadder factoryId={df.id} factoryStage={(df as any).factoryStage || "spec_agreed"} onStageChange={(stage) => fpatch(df.id, { factoryStage: stage })} onSamplesChina={() => { window.location.href = "/dashboard/samples?tab=china"; }} onSamplesNY={() => { window.location.href = "/dashboard/samples?tab=ny"; }} hasSamples={!!df.sampleRequestedAt || !!df.sampleShippedAt} />

                {/* Factory details */}
                <div className="flex flex-col gap-2">
                  <div className="flex flex-wrap gap-2">
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

                  {/* Contacts */}
                  <div className="mt-2">
                    <div className="text-sm font-medium mb-1">Contacts</div>
                    {((df as any).people || []).length === 0 && <p className="text-xs text-muted-foreground">No contacts yet.</p>}
                    {((df as any).people || []).map((person: any) => (
                      <div key={person.id} className="flex items-center gap-2 text-sm py-1">
                        <span className="flex-1">{person.name}{person.role ? ` — ${person.role}` : ""}</span>
                        {person.whatsapp && <span className="text-xs text-muted-foreground">{person.whatsapp}</span>}
                        <button className="text-xs text-muted-foreground hover:text-destructive" onClick={() => {
                          const f2 = { ...df, people: df.people.filter((p: any) => p.id !== person.id) };
                          fpatch(df.id, { people: f2.people });
                        }}>✕</button>
                      </div>
                    ))}
                    <AddContactRow factoryId={df.id} onAdded={load} />
                  </div>

                  {/* Quote */}
                  <div className="mt-2">
                    <div className="text-sm font-medium mb-1">Quote</div>
                    {(df.quotes || []).length > 0 ? (
                      df.quotes.map((q: any, i: number) => (
                        <div key={i} className="text-sm py-1">
                          ${q.unitPrice}/unit × {q.qty} units — {q.notes || "no notes"}
                        </div>
                      ))
                    ) : (
                      <p className="text-xs text-muted-foreground">No quote yet.</p>
                    )}
                  </div>

                  {/* Last note / comments */}
                  <div className="mt-2">
                    <div className="text-sm font-medium mb-1">Notes</div>
                    {(df.comments || []).length > 0 ? (
                      df.comments.slice(0, 5).map((c: any, i: number) => (
                        <div key={i} className="text-xs text-muted-foreground py-1">{c.text}</div>
                      ))
                    ) : (
                      <p className="text-xs text-muted-foreground">No notes yet.</p>
                    )}
                    <Input
                      className="mt-2"
                      placeholder="Add a note…"
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && (e.target as HTMLInputElement).value.trim()) {
                          fpatch(df.id, { addComment: (e.target as HTMLInputElement).value });
                          (e.target as HTMLInputElement).value = "";
                        }
                      }}
                    />
                  </div>
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
