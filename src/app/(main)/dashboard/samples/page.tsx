"use client";

import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

// --- Types matching the API responses ---

interface Shipment {
  id: string;
  leg: "china_to_yiwu" | "yiwu_to_ny";
  trackingNumber?: string;
  tracking_number?: string;
  carrier?: string | null;
  status?: string | null;
  lastEvent?: string | null;
  last_event?: string | null;
  eta?: string | null;
  events?: unknown[];
}

interface Sample {
  id: string;
  factoryProductId: string;
  factory_product_id?: string;
  stage: string;
  qcResult?: "pass" | "problem" | null;
  qc_result?: "pass" | "problem" | null;
  qcNotes?: string;
  qc_notes?: string;
  photos?: string[];
  haimResult?: "approved" | "rejected" | "change_requested" | null;
  haim_result?: string | null;
  shipments?: Shipment[];
  createdAt?: number;
}

interface SamplesResponse {
  samples: Sample[];
}

interface ShipmentsResponse {
  shipments: Shipment[];
}

// --- Stage labels ---

const STAGE_LABELS: Record<string, string> = {
  waiting_tracking: "Waiting for tracking",
  to_yiwu: "On the way to Yiwu",
  in_yiwu: "In Yiwu, waiting for Yuki",
  problem: "Problem flagged",
  ready_to_ship: "Ready to ship",
  to_ny: "On the way to New York",
  in_ny: "In New York, waiting for Haim",
  approved: "Approved",
  rejected: "Rejected",
  change_requested: "Change requested",
};

function stageLabel(stage: string): string {
  return STAGE_LABELS[stage] || stage;
}

function qcBadge(qc: "pass" | "problem" | null | undefined): React.ReactNode {
  if (qc === "pass") return <Badge variant="default">Pass</Badge>;
  if (qc === "problem") return <Badge variant="destructive">Problem</Badge>;
  return <Badge variant="outline">Waiting</Badge>;
}

function haimBadge(result: string | null | undefined): React.ReactNode {
  if (result === "approved") return <Badge variant="default">Approved</Badge>;
  if (result === "rejected") return <Badge variant="destructive">Rejected</Badge>;
  if (result === "change_requested") return <Badge variant="secondary">Change requested</Badge>;
  return <Badge variant="outline">Pending</Badge>;
}

// --- China tab ---

function ChinaTab({ samples, loading, error, retry }: {
  samples: Sample[];
  loading: boolean;
  error: boolean;
  retry: () => void;
}) {
  if (loading) {
    return (
      <div className="flex flex-col gap-2" aria-label="Loading samples">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }
  if (error) {
    return (
      <div className="flex items-center gap-3">
        <p className="text-sm text-destructive">Could not load samples.</p>
        <Button size="sm" variant="outline" onClick={retry}>Retry</Button>
      </div>
    );
  }
  if (samples.length === 0) {
    return <p className="text-sm text-muted-foreground">No samples yet. When a factory sends a tracking number, samples appear here.</p>;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Factory · Product</TableHead>
          <TableHead>Tracking</TableHead>
          <TableHead>Carrier status</TableHead>
          <TableHead>Arrival date</TableHead>
          <TableHead>Yuki check</TableHead>
          <TableHead>Photos</TableHead>
          <TableHead>Stage</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {samples.map((s) => {
          const chinaShipment = s.shipments?.find((sh) => sh.leg === "china_to_yiwu");
          const tracking = chinaShipment?.trackingNumber || chinaShipment?.tracking_number || "—";
          const carrierStatus = chinaShipment?.status || "—";
          const eta = chinaShipment?.eta || "—";
          const photos = s.photos ?? [];
          return (
            <TableRow key={s.id}>
              <TableCell className="font-medium text-sm">
                {s.factoryProductId || s.factory_product_id || "—"}
              </TableCell>
              <TableCell className="font-mono text-xs">{tracking}</TableCell>
              <TableCell className="text-sm text-muted-foreground">{carrierStatus}</TableCell>
              <TableCell className="text-sm text-muted-foreground">{eta}</TableCell>
              <TableCell>{qcBadge(s.qcResult ?? s.qc_result)}</TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {photos.length > 0 ? `${photos.length} photo${photos.length === 1 ? "" : "s"}` : "—"}
              </TableCell>
              <TableCell>
                <Badge variant="outline">{stageLabel(s.stage)}</Badge>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

// --- New York tab ---

function NewYorkTab({ samples, shipments, loading, error, retry }: {
  samples: Sample[];
  shipments: Shipment[];
  loading: boolean;
  error: boolean;
  retry: () => void;
}) {
  if (loading) {
    return (
      <div className="flex flex-col gap-2" aria-label="Loading samples">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }
  if (error) {
    return (
      <div className="flex items-center gap-3">
        <p className="text-sm text-destructive">Could not load samples.</p>
        <Button size="sm" variant="outline" onClick={retry}>Retry</Button>
      </div>
    );
  }

  // Partition samples by stage
  const readyToShip = samples.filter((s) => s.stage === "ready_to_ship");
  const inTransit = samples.filter((s) => s.stage === "to_ny");
  const received = samples.filter((s) => s.stage === "in_ny" || s.stage === "approved" || s.stage === "rejected" || s.stage === "change_requested");
  const nyShipments = shipments.filter((sh) => sh.leg === "yiwu_to_ny");

  function Section({ title, rows, emptyText }: { title: string; rows: Sample[]; emptyText: string }) {
    if (rows.length === 0) return null;
    return (
      <div className="mb-4">
        <h3 className="mb-2 text-sm font-medium text-muted-foreground">{title} · {rows.length}</h3>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Factory · Product</TableHead>
              <TableHead>Box tracking</TableHead>
              <TableHead>Carrier</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>ETA</TableHead>
              <TableHead>Yuki check</TableHead>
              <TableHead>Decision</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((s) => {
              const nyShipment = s.shipments?.find((sh) => sh.leg === "yiwu_to_ny");
              const boxTracking = nyShipment?.trackingNumber || nyShipment?.tracking_number || "—";
              const carrier = nyShipment?.carrier || "—";
              const status = nyShipment?.status || "—";
              const eta = nyShipment?.eta || "—";
              return (
                <TableRow key={s.id}>
                  <TableCell className="font-medium text-sm">{s.factoryProductId || s.factory_product_id || "—"}</TableCell>
                  <TableCell className="font-mono text-xs">{boxTracking}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{carrier}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{status}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{eta}</TableCell>
                  <TableCell>{qcBadge(s.qcResult ?? s.qc_result)}</TableCell>
                  <TableCell>{haimBadge(s.haimResult ?? s.haim_result)}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    );
  }

  function BoxesSection() {
    if (nyShipments.length === 0) return null;
    return (
      <div className="mb-4">
        <h3 className="mb-2 text-sm font-medium text-muted-foreground">Boxes in transit · {nyShipments.length}</h3>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Tracking</TableHead>
              <TableHead>Carrier</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>ETA</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {nyShipments.map((sh) => (
              <TableRow key={sh.id}>
                <TableCell className="font-mono text-xs">{sh.trackingNumber || sh.tracking_number || "—"}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{sh.carrier || "—"}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{sh.status || "—"}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{sh.eta || "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    );
  }

  if (samples.length === 0 && nyShipments.length === 0) {
    return <p className="text-sm text-muted-foreground">No samples have reached the New York stage yet.</p>;
  }

  return (
    <div>
      <Section title="Ready to ship from Yiwu" rows={readyToShip} emptyText="No samples ready to ship yet." />
      <BoxesSection />
      <Section title="In transit to New York" rows={inTransit} emptyText="No samples in transit." />
      <Section title="Received in New York" rows={received} emptyText="No samples received yet." />
      {readyToShip.length === 0 && inTransit.length === 0 && received.length === 0 && nyShipments.length === 0 && (
        <p className="text-sm text-muted-foreground">No samples have reached the New York stage yet.</p>
      )}
    </div>
  );
}

// --- Main page ---

export default function SamplesPage() {
  const [samples, setSamples] = React.useState<Sample[]>([]);
  const [shipments, setShipments] = React.useState<Shipment[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState(false);

  const load = React.useCallback(async () => {
    setError(false);
    try {
      const [r1, r2] = await Promise.all([fetch("/api/agent/samples"), fetch("/api/agent/shipments")]);
      if (!r1.ok) throw new Error(`samples ${r1.status}`);
      const sData: SamplesResponse = await r1.json();
      let sList: Sample[] = sData.samples ?? [];
      if (r2.ok) {
        const shData: ShipmentsResponse = await r2.json();
        setShipments(shData.shipments ?? []);
        // Attach shipments to samples by looking up shipment items
        // (API already enriches samples with shipments, but if not, use the flat list)
        if (sList.length > 0 && (!sList[0].shipments || sList[0].shipments.length === 0)) {
          // Fallback: no enrichment from API, samples don't have shipments attached
        }
      } else {
        setShipments([]);
      }
      setSamples(sList);
    } catch {
      setError(true);
      setSamples([]);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-3xl tracking-tight">Samples</h2>
        <p className="text-muted-foreground">
          Every sample from the factory to Yiwu, through Yuki&apos;s check, to New York and Haim&apos;s decision.
        </p>
      </div>

      <Tabs defaultValue="china">
        <TabsList>
          <TabsTrigger value="china">China</TabsTrigger>
          <TabsTrigger value="ny">New York</TabsTrigger>
        </TabsList>
        <TabsContent value="china">
          <Card>
            <CardHeader>
              <CardTitle>China · {samples.length} sample{samples.length === 1 ? "" : "s"}</CardTitle>
            </CardHeader>
            <CardContent>
              <ChinaTab samples={samples} loading={loading} error={error} retry={load} />
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="ny">
          <Card>
            <CardHeader>
              <CardTitle>New York</CardTitle>
            </CardHeader>
            <CardContent>
              <NewYorkTab
                samples={samples}
                shipments={shipments}
                loading={loading}
                error={error}
                retry={load}
              />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
