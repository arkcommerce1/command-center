// Sample stage transitions (SPEC §3.5).
// Pure functions that compute the next state given the current state + an event.
// No I/O — testable in isolation. The Agent API routes call these after
// persisting the triggering event (tracking number, QC result, box confirmation,
// delivery, Haim's decision).

import type { Sample, Shipment, ShipmentItem, Question } from "./types";
import { uid } from "./types";

export type TransitionResult = {
  sample: Partial<Sample>;
  newShipment?: Omit<Shipment, "createdAt">;
  newShipmentItems?: Omit<ShipmentItem, "id">[];
  newQuestion?: Omit<Question, "id" | "createdAt">;
  newDraft?: {
    factory_product_id: string;
    kind: string;
    reason: string;
    status: "pending";
  };
  notification?: { text: string };
};

export type SampleStage = Sample["stage"];

// §3.5 stages in order:
// 1. waiting_tracking — Factory committed. Next: a tracking number in chat
// 2. to_yiwu — 17TRACK in transit. Next: delivered
// 3. in_yiwu — Donna asked Yuki. Next: Yuki replies pass or problem
// 4. problem — Haim's card. Next: Ship anyway (to 5), Reject (ends), or a message (→ 1)
// 5. ready_to_ship — Yuki passed it. Next: included in a confirmed box
// 6. to_ny — 17TRACK in transit. Next: delivered
// 7. in_ny — Card on Actionables. Next: Haim's decision
// 8. approved / rejected / change_requested — Final

/**
 * Factory sends a tracking number → create china_to_yiwu shipment,
 * sample moves to `to_yiwu`.
 */
export function onTrackingNumber(
  sample: Pick<Sample, "id" | "stage" | "factoryProductId">,
  trackingNumber: string,
  carrier = "",
): TransitionResult {
  if (sample.stage !== "waiting_tracking") {
    return { sample: {} };
  }
  return {
    sample: { stage: "to_yiwu" },
    newShipment: {
      id: uid(),
      leg: "china_to_yiwu",
      trackingNumber,
      carrier,
      status: "in_transit",
      lastEvent: null,
      eta: null,
      events: [],
    },
  };
}

/**
 * Shipment delivered to Yiwu → sample moves to `in_yiwu`, notify Yuki.
 */
export function onChinaDelivered(
  sample: Pick<Sample, "id" | "stage">,
): TransitionResult {
  if (sample.stage !== "to_yiwu") return { sample: {} };
  return {
    sample: { stage: "in_yiwu" },
    notification: { text: "Sample arrived in Yiwu — please check and reply pass or problem." },
  };
}

/**
 * Yuki QC pass → sample moves to `ready_to_ship`.
 */
export function onYukiPass(
  sample: Pick<Sample, "id" | "stage">,
): TransitionResult {
  if (sample.stage !== "in_yiwu") return { sample: {} };
  return {
    sample: { stage: "ready_to_ship", qcResult: "pass" },
  };
}

/**
 * Yuki QC problem → sample moves to `problem`, create a flagged question card
 * for Haim on Actionables.
 */
export function onYukiProblem(
  sample: Pick<Sample, "id" | "stage" | "factoryProductId">,
  notes: string,
  photos: string[],
): TransitionResult {
  if (sample.stage !== "in_yiwu") return { sample: {} };
  return {
    sample: { stage: "problem", qcResult: "problem", qcNotes: notes, photos },
    newQuestion: {
      factoryProductId: sample.factoryProductId,
      kind: "sample_flag",
      body: { sampleId: sample.id, notes, photos, action: "review" },
      status: "open",
      answer: null,
      importance: "high",
    },
  };
}

/**
 * Box confirmed → create yiwu_to_ny shipment + shipment items for each sample,
 * each sample moves to `to_ny`.
 */
export function onBoxConfirmed(
  samples: Array<Pick<Sample, "id" | "stage" | "factoryProductId">>,
  trackingNumber: string,
  carrier = "",
): { shipment: Omit<Shipment, "createdAt">; items: Omit<ShipmentItem, "id">[]; sampleUpdates: { id: string; patch: Partial<Sample> }[] } {
  const readySamples = samples.filter((s) => s.stage === "ready_to_ship");
  const shipmentId = uid();
  return {
    shipment: {
      id: shipmentId,
      leg: "yiwu_to_ny",
      trackingNumber,
      carrier,
      status: "in_transit",
      lastEvent: null,
      eta: null,
      events: [],
    },
    items: readySamples.map((s) => ({ shipmentId, sampleId: s.id })),
    sampleUpdates: readySamples.map((s) => ({ id: s.id, patch: { stage: "to_ny" as const } })),
  };
}

/**
 * NY shipment delivered → each sample in it moves to `in_ny`, create a
 * sample_review question card per sample for Haim on Actionables.
 */
export function onNYDelivered(
  samples: Array<Pick<Sample, "id" | "stage" | "factoryProductId">>,
): { updates: { id: string; patch: Partial<Sample> }[]; questions: Omit<Question, "id" | "createdAt">[] } {
  const nySamples = samples.filter((s) => s.stage === "to_ny");
  return {
    updates: nySamples.map((s) => ({ id: s.id, patch: { stage: "in_ny" as const } })),
    questions: nySamples.map((s) => ({
      factoryProductId: s.factoryProductId,
      kind: "sample_review" as const,
      body: { sampleId: s.id, action: "decision" },
      status: "open" as const,
      answer: null,
      importance: "high" as const,
    })),
  };
}

/**
 * Haim suggests a change → sample moves to `change_requested`, create a draft
 * to the factory that needs approval.
 */
export function onSuggestChange(
  sample: Pick<Sample, "id" | "stage" | "factoryProductId">,
  suggestionText: string,
): TransitionResult {
  if (sample.stage !== "in_ny") return { sample: {} };
  return {
    sample: { stage: "change_requested", haimResult: "change_requested" },
    newDraft: {
      factory_product_id: sample.factoryProductId,
      kind: "sample_change",
      reason: `Suggest a change: ${suggestionText}`,
      status: "pending",
    },
  };
}

/**
 * Haim approves → sample moves to `approved`.
 */
export function onHaimApprove(
  sample: Pick<Sample, "id" | "stage">,
): TransitionResult {
  if (sample.stage !== "in_ny") return { sample: {} };
  return { sample: { stage: "approved", haimResult: "approved" } };
}

/**
 * Haim rejects → sample moves to `rejected`.
 */
export function onHaimReject(
  sample: Pick<Sample, "id" | "stage">,
): TransitionResult {
  if (sample.stage !== "in_ny") return { sample: {} };
  return { sample: { stage: "rejected", haimResult: "rejected" } };
}
