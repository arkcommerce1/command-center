"use client";

import * as React from "react";
import { useParams } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { composeWhereWeStand, formatSince, hoursSince, sinceColorClass } from "@/lib/cc/factory-board";

interface Proof {
  step: number;
  done: boolean;
  messageId: string | null;
  text: string | null;
  translation: string | null;
  sentAt: number | null;
}

interface ProductItem {
  link: {
    id: string;
    currentLayer: number;
    statusLine: string;
    waitingOn: string | null;
    since: number | null;
    nextStep: string;
    dropped: { layer: number; reason: string } | null;
  };
  product: { id: string; name: string };
  productGuessed: boolean;
  archivedAt: number | null;
  proofs: Proof[];
  openItems: { id: string; summary: string; direction: string; kind: string; openedAt: number | null }[];
  adjustments: { id: string; fieldKey: string; proposedValue: string; result: string }[];
  quotes: { id: string; text: string; createdAt: number | null }[];
  samples: { id: string; stage: string; qcResult: string | null; haimResult: string | null }[];
  pendingApprovals: number;
}

interface Summary {
  companyId: string;
  companyName: string;
  factoryRowIds: string[];
  canShareVolumes: boolean;
  items: ProductItem[];
  outbound: { id: string; text: string; translation: string; sender: string; chatName: string; sentAt: number | null; factoryProductId: string | null }[];
  timeline: { id: string; text: string; translation: string; direction: string; sender: string; chatName: string; sentAt: number | null; factoryProductId: string | null }[];
  contacts: { id: string; name: string; role: string; channels: string[] }[];
}

function StepDots({ proofs, currentLayer }: { proofs: Proof[]; currentLayer: number }) {
  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((step) => {
        const proof = proofs.find((p) => p.step === step);
        const done = proof?.done ?? step < currentLayer;
        if (!done) {
          return (
            <span
              key={step}
              title={step === currentLayer ? `Step ${step} in progress` : `Step ${step} not started`}
              className={
                "h-3 w-3 rounded-full border " +
                (step === currentLayer ? "border-primary bg-primary/40" : "border-muted-foreground/30 bg-transparent")
              }
            />
          );
        }
        const title = proof?.text
          ? `${proof.text}${proof.translation ? `\n— ${proof.translation}` : ""}${proof.sentAt ? `\n${new Date(proof.sentAt).toLocaleString()}` : ""}`
          : `Step ${step} done (no proof message)`;
        const dot = <span key={step} title={title} className="h-3 w-3 rounded-full border border-primary bg-primary" />;
        return proof?.messageId ? (
          <a key={step} href={`/dashboard/messages?message=${encodeURIComponent(proof.messageId)}`} title={title} aria-label={`Step ${step} proof`}>
            {dot}
          </a>
        ) : (
          dot
        );
      })}
    </div>
  );
}

function SkeletonBlock() {
  return (
    <Card>
      <CardHeader>
        <div className="h-6 w-48 animate-pulse rounded bg-muted" />
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <div className="h-4 w-full animate-pulse rounded bg-muted" />
        <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
        <div className="h-4 w-1/3 animate-pulse rounded bg-muted" />
      </CardContent>
    </Card>
  );
}

export default function FactorySummaryPage() {
  const params = useParams<{ id: string }>();
  const id = decodeURIComponent(params.id || "");
  const [data, setData] = React.useState<Summary | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [missing, setMissing] = React.useState(false);
  const [toggling, setToggling] = React.useState(false);

  const load = React.useCallback(async () => {
    try {
      const res = await fetch(`/api/factories/${encodeURIComponent(id)}/summary`);
      if (res.status === 404) {
        setMissing(true);
        return;
      }
      if (!res.ok) throw new Error("bad response");
      setData(await res.json());
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [id]);

  React.useEffect(() => {
    load();
  }, [load]);

  async function toggleVolumes() {
    if (!data || toggling) return;
    setToggling(true);
    const next = !data.canShareVolumes;
    const targets = data.factoryRowIds.length > 0 ? data.factoryRowIds : [data.companyId];
    try {
      await Promise.all(
        targets.map((fid) =>
          fetch(`/api/factories/${encodeURIComponent(fid)}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ canShareVolumes: next }),
          }),
        ),
      );
      setData({ ...data, canShareVolumes: next });
    } finally {
      setToggling(false);
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col gap-4">
        <h2 className="text-3xl tracking-tight">Factory</h2>
        <SkeletonBlock />
        <SkeletonBlock />
      </div>
    );
  }

  if (missing || !data) {
    return (
      <div className="flex flex-col gap-4">
        <h2 className="text-3xl tracking-tight">Factory</h2>
        <p className="text-sm text-muted-foreground">
          {missing ? "No factory rows found for this factory." : "Could not load this factory."}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-3xl tracking-tight">{data.companyName}</h2>
        <p className="text-muted-foreground">
          {data.items.length} product{data.items.length === 1 ? "" : "s"} · Can share volumes:{" "}
          {data.canShareVolumes ? "on" : "off"}
        </p>
      </div>

      {data.items.length === 0 && (
        <p className="text-sm text-muted-foreground">No products linked to this factory yet.</p>
      )}

      {data.items.map((item) => {
        const l = item.link;
        const hrs = hoursSince(l.since);
        const sinceText = formatSince(hrs);
        const doneSteps = item.proofs.filter((p) => p.done).length;
        return (
          <Card key={l.id}>
            <CardHeader>
              <CardTitle>
                Where we stand · {item.product.name}
                {item.productGuessed && (
                  <Badge variant="outline" className="ml-2" title="Linked by the organizer's best guess">
                    guessed product
                  </Badge>
                )}
                {item.archivedAt && <Badge variant="outline" className="ml-2">archived</Badge>}
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <p className="text-sm">
                {composeWhereWeStand({
                  factoryName: data.companyName,
                  productName: item.product.name,
                  doneSteps,
                  statusSentence: l.statusLine,
                  waitingOn: (l.waitingOn as "haim" | "factory" | "yuki" | "carrier" | "none" | null) ?? null,
                  sinceText,
                  nextStep: l.nextStep,
                  openItems: item.openItems.length,
                })}
              </p>
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
                <span className="flex items-center gap-2">
                  <span className="text-muted-foreground">Steps</span>
                  <StepDots proofs={item.proofs} currentLayer={l.currentLayer} />
                </span>
                <span>
                  <span className="text-muted-foreground">Waiting on </span>
                  {l.waitingOn ? <Badge variant={l.waitingOn === "haim" ? "destructive" : "outline"}>{l.waitingOn}</Badge> : "—"}
                  {l.waitingOn && l.waitingOn !== "none" && <span className={sinceColorClass(hrs)}> · {sinceText}</span>}
                </span>
                <span>
                  <span className="text-muted-foreground">Next </span>
                  {l.nextStep || "—"}
                </span>
                {item.pendingApprovals > 0 && <Badge variant="secondary">{item.pendingApprovals} to approve</Badge>}
              </div>
              <div>
                <p className="text-sm font-medium">Open items · {item.openItems.length}</p>
                {item.openItems.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nothing open.</p>
                ) : (
                  <ul className="list-disc pl-5 text-sm text-muted-foreground">
                    {item.openItems.map((o) => (
                      <li key={o.id}>
                        {o.summary || o.kind} ({o.direction || "open"})
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </CardContent>
          </Card>
        );
      })}

      <Card>
        <CardHeader>
          <CardTitle>Proposed changes</CardTitle>
        </CardHeader>
        <CardContent>
          {data.items.every((i) => i.adjustments.length === 0) ? (
            <p className="text-sm text-muted-foreground">No proposed spec changes recorded.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead>Field</TableHead>
                  <TableHead>Proposed</TableHead>
                  <TableHead>Result</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.flatMap((i) =>
                  i.adjustments.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell>{i.product.name}</TableCell>
                      <TableCell>{a.fieldKey}</TableCell>
                      <TableCell className="max-w-[260px] truncate">{a.proposedValue}</TableCell>
                      <TableCell>{a.result}</TableCell>
                    </TableRow>
                  )),
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>What we have told this factory</CardTitle>
        </CardHeader>
        <CardContent>
          {data.outbound.length === 0 ? (
            <p className="text-sm text-muted-foreground">No outbound messages recorded yet.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {data.outbound.slice(-20).map((m) => (
                <li key={m.id} className="text-sm">
                  <span className="text-muted-foreground">{m.chatName ? `${m.chatName} · ` : ""}{m.sentAt ? new Date(m.sentAt).toLocaleString() : ""}</span>
                  <p>{m.text}</p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Quotes · Haim only</CardTitle>
        </CardHeader>
        <CardContent>
          {data.items.every((i) => i.quotes.length === 0) ? (
            <p className="text-sm text-muted-foreground">No quotes recorded.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {data.items.flatMap((i) =>
                i.quotes.map((q) => (
                  <li key={q.id} className="text-sm">
                    <span className="text-muted-foreground">{i.product.name} · {q.createdAt ? new Date(q.createdAt).toLocaleString() : ""}</span>
                    <p>{q.text}</p>
                  </li>
                )),
              )}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Samples</CardTitle>
        </CardHeader>
        <CardContent>
          {data.items.every((i) => i.samples.length === 0) ? (
            <p className="text-sm text-muted-foreground">No samples yet. Tracking tabs land in Goal 10 — this list is the placeholder.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead>Stage</TableHead>
                  <TableHead>QC</TableHead>
                  <TableHead>Haim</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.flatMap((i) =>
                  i.samples.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell>{i.product.name}</TableCell>
                      <TableCell>{s.stage}</TableCell>
                      <TableCell>{s.qcResult || "—"}</TableCell>
                      <TableCell>{s.haimResult || "—"}</TableCell>
                    </TableRow>
                  )),
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Contacts</CardTitle>
        </CardHeader>
        <CardContent>
          {data.contacts.length === 0 ? (
            <p className="text-sm text-muted-foreground">No contacts for this factory yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Channels</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.contacts.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">{c.name}</TableCell>
                    <TableCell>{c.role || "—"}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{c.channels.join(" · ") || "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Messages · translated timeline</CardTitle>
        </CardHeader>
        <CardContent>
          {data.timeline.length === 0 ? (
            <p className="text-sm text-muted-foreground">No messages yet.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {data.timeline.slice(-50).map((m) => (
                <li key={m.id} className="text-sm">
                  <span className="text-muted-foreground">
                    {m.sentAt ? new Date(m.sentAt).toLocaleString() : ""} · {m.direction === "out" ? "Us" : m.sender || "Factory"}
                    {m.chatName ? ` · ${m.chatName}` : ""}
                  </span>
                  <p>{m.translation || m.text}</p>
                  {m.translation && m.text !== m.translation && <p className="text-muted-foreground">{m.text}</p>}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Settings</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center gap-3">
          <Button size="sm" variant={data.canShareVolumes ? "default" : "outline"} onClick={toggleVolumes} disabled={toggling}>
            Can share volumes: {data.canShareVolumes ? "on" : "off"}
          </Button>
          <span className="text-sm text-muted-foreground">Volumes are named only when this is on (P4).</span>
        </CardContent>
      </Card>
    </div>
  );
}
