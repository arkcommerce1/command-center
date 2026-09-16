"use client";

import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export type SpecFieldSource = "listing" | "image" | "inferred";
export type SpecFieldTag = "locked" | "flexible" | "open";

export interface SpecField {
  id: string;
  label: string;
  value: string;
  source: SpecFieldSource;
  tag: SpecFieldTag;
}

export interface SpecVersion {
  version: number;
  fields: SpecField[];
  createdAt: number;
}

const SOURCE_LABEL: Record<SpecFieldSource, string> = {
  listing: "listing",
  image: "image",
  inferred: "inferred",
};

const TAG_LABEL: Record<SpecFieldTag, string> = {
  locked: "Locked",
  flexible: "Flexible",
  open: "Open",
};

function SourceBadge({ source }: { source: SpecFieldSource }) {
  const variant = source === "listing" ? "default" : source === "image" ? "secondary" : "outline";
  return (
    <Badge variant={variant as any} className="text-[10px] uppercase tracking-wide">
      {SOURCE_LABEL[source]}
    </Badge>
  );
}

function normField(f: Partial<SpecField> | undefined | null): SpecField {
  const tag: SpecFieldTag = f && (f.tag === "flexible" || f.tag === "open" || f.tag === "locked") ? f.tag : "locked";
  const source: SpecFieldSource = f && (f.source === "image" || f.source === "inferred" || f.source === "listing") ? f.source : "inferred";
  return {
    id: (f && f.id) || Math.random().toString(36).slice(2, 10),
    label: (f && f.label) || "",
    value: (f && f.value) || "",
    source,
    tag,
  };
}

export function SpecFieldsSection({
  productId,
  specFields,
  specVersion,
  specVersions,
  onSaved,
}: {
  productId: string;
  specFields: SpecField[];
  specVersion: number;
  specVersions: SpecVersion[];
  onSaved: () => void;
}) {
  const [fields, setFields] = React.useState<SpecField[]>(() => (specFields || []).map(normField));
  const [dirty, setDirty] = React.useState(false);
  const [viewVersion, setViewVersion] = React.useState<number | null>(null); // null = current (editable)
  const [newLabel, setNewLabel] = React.useState("");
  const [newValue, setNewValue] = React.useState("");
  const [editRequest, setEditRequest] = React.useState("");
  const [proposal, setProposal] = React.useState<{ before: SpecField[]; after: SpecField[] } | null>(null);
  const [aiBusy, setAiBusy] = React.useState(false);
  const [aiError, setAiError] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (viewVersion === null) {
      setFields((specFields || []).map(normField));
      setDirty(false);
    }
  }, [specFields, viewVersion]);

  const versionsDesc = [...(specVersions || [])].sort((a, b) => b.version - a.version);
  const viewing = viewVersion !== null ? versionsDesc.find((v) => v.version === viewVersion) : null;
  const displayFields = viewing ? viewing.fields.map(normField) : fields;
  const readOnly = !!viewing;

  function updateField(id: string, patch: Partial<SpecField>) {
    if (readOnly) return;
    setFields((prev) => prev.map((f) => (f.id === id ? { ...f, ...patch } : f)));
    setDirty(true);
  }

  function removeField(id: string) {
    if (readOnly) return;
    setFields((prev) => prev.filter((f) => f.id !== id));
    setDirty(true);
  }

  function addField() {
    if (readOnly || !newLabel.trim()) return;
    setFields((prev) => [
      ...prev,
      { id: Math.random().toString(36).slice(2, 10), label: newLabel.trim(), value: newValue.trim(), source: "inferred", tag: "locked" },
    ]);
    setNewLabel("");
    setNewValue("");
    setDirty(true);
  }

  async function saveDraft() {
    setSaving(true);
    try {
      await fetch(`/api/products/${productId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ specFields: fields }),
      });
      setDirty(false);
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  async function approveVersion() {
    setSaving(true);
    try {
      await fetch(`/api/products/${productId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ specFields: fields, approveSpecVersion: true }),
      });
      setDirty(false);
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  async function requestAiEdit() {
    if (!editRequest.trim()) return;
    setAiBusy(true);
    setAiError("");
    setProposal(null);
    try {
      const r = await fetch("/api/spec-ai-edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fields, request: editRequest.trim() }),
      });
      const j = await r.json();
      if (!r.ok) {
        setAiError(j.error || "AI edit failed");
        return;
      }
      setProposal({ before: (j.before || []).map(normField), after: (j.after || []).map(normField) });
    } catch (e: any) {
      setAiError(e?.message || "AI edit failed");
    } finally {
      setAiBusy(false);
    }
  }

  function acceptProposal() {
    if (!proposal) return;
    setFields(proposal.after);
    setDirty(true);
    setProposal(null);
    setEditRequest("");
  }

  function rejectProposal() {
    setProposal(null);
  }

  // Simple diff view: fields present in after but different/missing in before.
  const beforeById = new Map((proposal?.before || []).map((f) => [f.id, f]));
  const afterIds = new Set((proposal?.after || []).map((f) => f.id));
  const diffRows = proposal
    ? [
        ...proposal.after.map((f) => {
          const prior = beforeById.get(f.id);
          const changed = !prior || prior.value !== f.value || prior.tag !== f.tag || prior.label !== f.label;
          return { field: f, prior: prior || null, kind: prior ? (changed ? "changed" : "unchanged") : "added" as const };
        }),
        ...proposal.before.filter((f) => !afterIds.has(f.id)).map((f) => ({ field: f, prior: f, kind: "removed" as const })),
      ]
    : [];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">
            {viewing ? `Viewing v${viewing.version} (read-only)` : `Current (v${specVersion || 0}${dirty ? " · unsaved" : ""})`}
          </span>
          {versionsDesc.length > 0 && (
            <Select
              value={viewVersion === null ? "current" : String(viewVersion)}
              onValueChange={(v) => setViewVersion(v === "current" ? null : Number(v))}
            >
              <SelectTrigger size="sm">
                <SelectValue placeholder="Version" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="current">Current (editable)</SelectItem>
                {versionsDesc.map((v) => (
                  <SelectItem key={v.version} value={String(v.version)}>
                    v{v.version} — {new Date(v.createdAt).toLocaleString()}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
        {!readOnly && (
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={saveDraft} disabled={!dirty || saving}>
              Save draft
            </Button>
            <Button size="sm" onClick={approveVersion} disabled={saving || fields.length === 0}>
              Approve → v{(specVersion || 0) + 1}
            </Button>
          </div>
        )}
      </div>

      <div className="flex flex-col divide-y rounded-lg border">
        {displayFields.length === 0 && (
          <div className="p-3 text-sm text-muted-foreground">No structured fields yet. Add one below, or use the AI edit bar.</div>
        )}
        {displayFields.map((f) => (
          <div key={f.id} className="flex flex-wrap items-center gap-2 p-2">
            <div className="min-w-[110px] text-sm font-medium">{f.label || "—"}</div>
            <SourceBadge source={f.source} />
            {readOnly ? (
              <span className="flex-1 text-sm">{f.value}</span>
            ) : (
              <Input
                value={f.value}
                onChange={(e) => updateField(f.id, { value: e.target.value })}
                className="h-8 flex-1 min-w-[140px]"
              />
            )}
            {readOnly ? (
              <Badge variant={f.tag === "locked" ? "default" : f.tag === "flexible" ? "secondary" : "outline"}>
                {TAG_LABEL[f.tag]}
              </Badge>
            ) : (
              <Select value={f.tag} onValueChange={(v) => updateField(f.id, { tag: v as SpecFieldTag })}>
                <SelectTrigger size="sm" className="w-[110px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="locked">Locked</SelectItem>
                  <SelectItem value="flexible">Flexible</SelectItem>
                  <SelectItem value="open">Open</SelectItem>
                </SelectContent>
              </Select>
            )}
            {!readOnly && (
              <button className="text-muted-foreground hover:text-destructive" onClick={() => removeField(f.id)} title="Remove field">
                ✕
              </button>
            )}
          </div>
        ))}
      </div>

      {!readOnly && (
        <div className="flex flex-wrap items-center gap-2">
          <Input value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="Field label (e.g. Color)" className="h-8 w-[160px]" />
          <Input value={newValue} onChange={(e) => setNewValue(e.target.value)} placeholder="Value" className="h-8 flex-1 min-w-[140px]" />
          <Button size="sm" variant="outline" onClick={addField} disabled={!newLabel.trim()}>
            + Field
          </Button>
        </div>
      )}

      {proposal && (
        <div className="rounded-lg border border-violet-200 bg-violet-50/50 p-3">
          <div className="mb-2 text-xs text-muted-foreground">🤖 AI proposed change — review before/after, then Accept or Reject:</div>
          <div className="flex flex-col gap-1.5">
            {diffRows.map((row, i) => (
              <div key={i} className="rounded-md border bg-white p-2 text-xs">
                <div className="mb-1 font-medium">
                  {row.field.label}{" "}
                  <span
                    className={
                      row.kind === "added" ? "text-emerald-600" : row.kind === "removed" ? "text-red-600" : row.kind === "changed" ? "text-amber-600" : "text-muted-foreground"
                    }
                  >
                    ({row.kind})
                  </span>
                </div>
                {row.kind === "removed" ? (
                  <div className="line-through text-muted-foreground">{row.prior?.value} · {row.prior && TAG_LABEL[row.prior.tag]}</div>
                ) : row.kind === "changed" && row.prior ? (
                  <div className="flex flex-col gap-0.5">
                    <div className="text-muted-foreground line-through">{row.prior.value} · {TAG_LABEL[row.prior.tag]}</div>
                    <div>{row.field.value} · {TAG_LABEL[row.field.tag]}</div>
                  </div>
                ) : (
                  <div>{row.field.value} · {TAG_LABEL[row.field.tag]}</div>
                )}
              </div>
            ))}
          </div>
          <div className="mt-2 flex gap-2">
            <Button size="sm" onClick={acceptProposal}>
              Accept
            </Button>
            <Button size="sm" variant="outline" onClick={rejectProposal}>
              Reject
            </Button>
          </div>
        </div>
      )}

      {aiError && <div className="text-xs text-destructive">{aiError}</div>}

      {!readOnly && (
        <div className="sticky bottom-0 flex gap-2 border-t bg-background pt-2">
          <Input
            value={editRequest}
            onChange={(e) => setEditRequest(e.target.value)}
            placeholder="AI edit: e.g. 'add OEKO-TEX, make color flexible'"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !aiBusy) requestAiEdit();
            }}
          />
          <Button size="sm" onClick={requestAiEdit} disabled={aiBusy || !editRequest.trim()}>
            {aiBusy ? "Thinking…" : "Propose"}
          </Button>
        </div>
      )}
    </div>
  );
}
