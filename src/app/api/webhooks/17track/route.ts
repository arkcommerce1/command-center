import { NextRequest, NextResponse } from "next/server";
import { dbFind, dbUpdate } from "@/lib/cc/agent-store";

export const dynamic = "force-dynamic";

/**
 * 17TRACK webhook (SPEC §1.1, Goal 10).
 * POST /api/webhooks/17track
 *
 * 17TRACK sends tracking updates as signed webhooks. The signature is
 * verified against CC_17TRACK_KEY. On match, the shipment's status,
 * last_event, eta, and events are updated.
 *
 * No login gate (proxy.ts skips /api/webhooks/*). Auth is the signature.
 */
export async function POST(req: NextRequest) {
  const key = process.env.CC_17TRACK_KEY;
  if (!key) {
    return NextResponse.json({ error: "tracking_not_configured" }, { status: 503 });
  }

  const rawBody = await req.text();

  // 17TRACK signature: HMAC-SHA256 of the raw body using CC_17TRACK_KEY.
  // The signature is sent in the `x-17track-signature` header (or a similar
  // convention). We verify it server-side.
  const signatureHeader = req.headers.get("x-17track-signature") || req.headers.get("x-webhook-signature") || "";
  const crypto = await import("node:crypto");
  const expected = crypto
    .createHmac("sha256", key)
    .update(rawBody)
    .digest("hex");

  if (!signatureHeader || signatureHeader !== expected) {
    return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
  }

  let payload: any;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  // 17TRACK sends one or more tracking updates. Each has a tracking number.
  // Find the matching shipment and update its status, last_event, eta, events.
  const updates = Array.isArray(payload) ? payload : [payload];
  const results: { tracking: string; updated: boolean }[] = [];

  for (const update of updates) {
    const trackingNumber = update.tracking_number || update.trackingNumber || "";
    if (!trackingNumber) continue;

    const shipments = await dbFind("shipments", (s) => s.trackingNumber === trackingNumber || s.tracking_number === trackingNumber);
    for (const shipment of shipments) {
      await dbUpdate("shipments", shipment.id, {
        status: update.status || shipment.status,
        lastEvent: update.last_event || update.lastEvent || shipment.lastEvent,
        eta: update.eta || shipment.eta,
        events: update.events || shipment.events,
        carrier: update.carrier || shipment.carrier,
      });
      results.push({ tracking: trackingNumber, updated: true });
    }
  }

  return NextResponse.json({ ok: true, updated: results.length, results });
}
