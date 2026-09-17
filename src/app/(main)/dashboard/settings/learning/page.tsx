"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";

interface LearnedRule {
  id: string;
  ruleText: string;
  scope: "all" | "factory";
  factoryName: string | null;
  sourceFeedback: string;
  usageCount: number;
  status: string;
  createdAt: number;
  updatedAt: number;
}

interface ApprovalStats {
  thisWeek: number;
  lastWeek: number;
  approvedNoChanges: number;
  totalThisWeek: number;
  totalLastWeek: number;
}

export default function LearningPage() {
  const [rules, setRules] = React.useState<LearnedRule[]>([]);
  const [stats, setStats] = React.useState<ApprovalStats | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [editText, setEditText] = React.useState("");
  const [newRule, setNewRule] = React.useState("");
  const [newScope, setNewScope] = React.useState<"all" | "factory">("all");
  const [newFactory, setNewFactory] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/learned-rules");
      if (r.ok) {
        const d = await r.json();
        setRules(d.rules || []);
        setStats(d.stats || null);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    load();
  }, [load]);

  async function deleteRule(id: string) {
    setBusy(true);
    try {
      await fetch(`/api/learned-rules/${id}`, { method: "DELETE" });
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function saveEdit(id: string) {
    if (!editText.trim()) return;
    setBusy(true);
    try {
      await fetch(`/api/learned-rules/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ruleText: editText.trim() }),
      });
      setEditingId(null);
      setEditText("");
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function addRule() {
    if (!newRule.trim()) return;
    setBusy(true);
    try {
      await fetch("/api/learned-rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ruleText: newRule.trim(),
          scope: newScope,
          factoryName: newScope === "factory" ? newFactory.trim() : undefined,
        }),
      });
      setNewRule("");
      setNewFactory("");
      await load();
    } finally {
      setBusy(false);
    }
  }

  const activeRules = rules.filter((r) => r.status === "active");
  const supersededRules = rules.filter((r) => r.status === "superseded");

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-3xl tracking-tight">What Donna learned</h2>
        <p className="text-muted-foreground">
          Rules Donna follows when drafting replies. Edit, delete, or add your own.
        </p>
      </div>

      {stats && (
        <Card>
          <CardHeader>
            <CardTitle>Improvement</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex gap-8">
              <div>
                <div className="text-2xl font-bold">{stats.thisWeek}%</div>
                <div className="text-xs text-muted-foreground">approved without changes this week</div>
                <div className="text-xs text-muted-foreground">
                  ({stats.approvedNoChanges}/{stats.totalThisWeek} drafts)
                </div>
              </div>
              <div>
                <div className="text-2xl font-bold text-muted-foreground">{stats.lastWeek}%</div>
                <div className="text-xs text-muted-foreground">last week</div>
                <div className="text-xs text-muted-foreground">({stats.totalLastWeek} drafts)</div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Add a rule</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <div className="flex gap-2">
            <Input
              value={newRule}
              onChange={(e) => setNewRule(e.target.value)}
              placeholder="e.g. Never use exclamation marks."
              onKeyDown={(e) => e.key === "Enter" && !busy && addRule()}
            />
            <NativeSelect
              value={newScope}
              onChange={(e) => setNewScope(e.target.value as "all" | "factory")}
              className="w-40"
            >
              <NativeSelectOption value="all">All factories</NativeSelectOption>
              <NativeSelectOption value="factory">One factory</NativeSelectOption>
            </NativeSelect>
            {newScope === "factory" && (
              <Input
                value={newFactory}
                onChange={(e) => setNewFactory(e.target.value)}
                placeholder="Factory name"
                className="w-40"
              />
            )}
            <Button size="sm" disabled={busy || !newRule.trim()} onClick={addRule}>
              Add
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Active rules ({activeRules.length})</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {!loading && activeRules.length === 0 && (
            <p className="text-sm text-muted-foreground">No rules yet. Donna learns from your feedback on drafts.</p>
          )}
          {activeRules.map((r) => (
            <div key={r.id} className="flex items-center gap-2 rounded-md border p-2">
              {editingId === r.id ? (
                <>
                  <Input
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                    className="flex-1"
                    onKeyDown={(e) => e.key === "Enter" && saveEdit(r.id)}
                  />
                  <Button size="sm" disabled={busy || !editText.trim()} onClick={() => saveEdit(r.id)}>
                    Save
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setEditingId(null);
                      setEditText("");
                    }}
                  >
                    Cancel
                  </Button>
                </>
              ) : (
                <>
                  <div className="flex-1">
                    <span className="text-sm">{r.ruleText}</span>
                    <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                      <Badge variant="outline">{r.scope === "all" ? "All factories" : r.factoryName || "factory"}</Badge>
                      <span>Used in {r.usageCount} drafts</span>
                      <span>· {new Date(r.createdAt).toLocaleDateString()}</span>
                      {r.sourceFeedback !== "manual" && (
                        <span className="truncate">from &ldquo;{r.sourceFeedback}&rdquo;</span>
                      )}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setEditingId(r.id);
                      setEditText(r.ruleText);
                    }}
                  >
                    Edit
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => deleteRule(r.id)} disabled={busy}>
                    Delete
                  </Button>
                </>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      {supersededRules.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Replaced rules ({supersededRules.length})</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {supersededRules.map((r) => (
              <div key={r.id} className="flex items-center gap-2 rounded-md border p-2 opacity-60">
                <div className="flex-1">
                  <span className="text-sm line-through">{r.ruleText}</span>
                  <div className="text-xs text-muted-foreground">Replaced on {new Date(r.updatedAt).toLocaleDateString()}</div>
                </div>
                <Badge variant="secondary">superseded</Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
