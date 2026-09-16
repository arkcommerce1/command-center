// Sample stage transitions (SPEC §3.5) — unit tests with mocked data.
import { describe, expect, it } from "vitest";

import {
  onBoxConfirmed,
  onChinaDelivered,
  onHaimApprove,
  onHaimReject,
  onNYDelivered,
  onSuggestChange,
  onTrackingNumber,
  onYukiPass,
  onYukiProblem,
} from "@/lib/cc/sample-stages";

const baseSample = {
  id: "s1",
  stage: "waiting_tracking" as const,
  factoryProductId: "fp1",
};

describe("sample stage transitions (§3.5)", () => {
  it("factory tracking number → china_to_yiwu shipment created, sample → to_yiwu", () => {
    const result = onTrackingNumber(baseSample, "SF1234567890", "SF Express");
    expect(result.sample.stage).toBe("to_yiwu");
    expect(result.newShipment).toBeDefined();
    expect(result.newShipment!.leg).toBe("china_to_yiwu");
    expect(result.newShipment!.trackingNumber).toBe("SF1234567890");
    expect(result.newShipment!.carrier).toBe("SF Express");
    expect(result.newShipment!.status).toBe("in_transit");
  });

  it("delivered to Yiwu → Yuki notified, sample → in_yiwu", () => {
    const result = onChinaDelivered({ ...baseSample, stage: "to_yiwu" });
    expect(result.sample.stage).toBe("in_yiwu");
    expect(result.notification).toBeDefined();
    expect(result.notification!.text).toContain("Yiwu");
  });

  it("Yuki pass → ready_to_ship", () => {
    const result = onYukiPass({ ...baseSample, stage: "in_yiwu" });
    expect(result.sample.stage).toBe("ready_to_ship");
    expect(result.sample.qcResult).toBe("pass");
  });

  it("Yuki problem → flagged card on Actionables", () => {
    const result = onYukiProblem(
      { ...baseSample, stage: "in_yiwu" },
      "Color doesn't match spec",
      ["photo1.jpg", "photo2.jpg"],
    );
    expect(result.sample.stage).toBe("problem");
    expect(result.sample.qcResult).toBe("problem");
    expect(result.sample.qcNotes).toBe("Color doesn't match spec");
    expect(result.sample.photos).toEqual(["photo1.jpg", "photo2.jpg"]);
    expect(result.newQuestion).toBeDefined();
    expect(result.newQuestion!.kind).toBe("sample_flag");
    expect(result.newQuestion!.importance).toBe("high");
    expect(result.newQuestion!.status).toBe("open");
  });

  it("box confirmed → yiwu_to_ny shipment with items, each sample → to_ny", () => {
    const samples = [
      { ...baseSample, id: "s1", stage: "ready_to_ship" as const },
      { ...baseSample, id: "s2", stage: "ready_to_ship" as const },
      { ...baseSample, id: "s3", stage: "in_yiwu" as const }, // not ready — should be excluded
    ];
    const result = onBoxConfirmed(samples, "UPS123456", "UPS");
    expect(result.shipment.leg).toBe("yiwu_to_ny");
    expect(result.shipment.trackingNumber).toBe("UPS123456");
    expect(result.items).toHaveLength(2); // only the two ready samples
    expect(result.items.map((i) => i.sampleId)).toContain("s1");
    expect(result.items.map((i) => i.sampleId)).toContain("s2");
    expect(result.items.map((i) => i.sampleId)).not.toContain("s3");
    expect(result.sampleUpdates).toHaveLength(2);
    expect(result.sampleUpdates[0].patch.stage).toBe("to_ny");
  });

  it("NY delivered → each sample gets an in_ny card + sample_review question", () => {
    const samples = [
      { ...baseSample, id: "s1", stage: "to_ny" as const },
      { ...baseSample, id: "s2", stage: "to_ny" as const },
      { ...baseSample, id: "s3", stage: "ready_to_ship" as const }, // not in transit — excluded
    ];
    const result = onNYDelivered(samples);
    expect(result.updates).toHaveLength(2);
    expect(result.updates[0].patch.stage).toBe("in_ny");
    expect(result.questions).toHaveLength(2);
    expect(result.questions[0].kind).toBe("sample_review");
    expect(result.questions[0].importance).toBe("high");
    expect(result.questions.map((q) => (q.body as { sampleId: string }).sampleId)).toContain("s1");
    expect(result.questions.map((q) => (q.body as { sampleId: string }).sampleId)).not.toContain("s3");
  });

  it("suggest a change → creates a factory draft needing approval", () => {
    const result = onSuggestChange(
      { ...baseSample, id: "s1", stage: "in_ny" as const },
      "Make it 80% cotton",
    );
    expect(result.sample.stage).toBe("change_requested");
    expect(result.sample.haimResult).toBe("change_requested");
    expect(result.newDraft).toBeDefined();
    expect(result.newDraft!.kind).toBe("sample_change");
    expect(result.newDraft!.status).toBe("pending");
    expect(result.newDraft!.factory_product_id).toBe("fp1");
  });

  it("Haim approve → approved", () => {
    const result = onHaimApprove({ ...baseSample, id: "s1", stage: "in_ny" as const });
    expect(result.sample.stage).toBe("approved");
    expect(result.sample.haimResult).toBe("approved");
  });

  it("Haim reject → rejected", () => {
    const result = onHaimReject({ ...baseSample, id: "s1", stage: "in_ny" as const });
    expect(result.sample.stage).toBe("rejected");
    expect(result.sample.haimResult).toBe("rejected");
  });

  it("transitions are no-ops when the stage doesn't match (guardrails)", () => {
    // Can't pass QC on a sample that's still waiting for tracking
    expect(onYukiPass({ ...baseSample, stage: "waiting_tracking" }).sample.stage).toBeUndefined();
    // Can't confirm a box for a sample that's in Yiwu (not ready)
    const r = onBoxConfirmed([{ ...baseSample, id: "s1", stage: "in_yiwu" }], "UPS1");
    expect(r.items).toHaveLength(0);
    expect(r.sampleUpdates).toHaveLength(0);
    // Can't suggest a change on a sample that hasn't reached NY
    const sc = onSuggestChange({ ...baseSample, stage: "to_ny" }, "test");
    expect(sc.sample.stage).toBeUndefined();
  });
});
