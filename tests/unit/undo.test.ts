import { describe, expect, it } from "vitest";

import {
  deleteActivityEntry,
  deleteContact,
  deleteFactoryProduct,
  getActivityEntry,
  getContact,
  getFactoryProduct,
  logActivity,
  saveContact,
  saveFactoryProduct,
  undoActivityEntry,
} from "@/lib/cc/store";
import { blankSteps, uid, type Contact, type FactoryProduct } from "@/lib/cc/types";

function testContact(): Contact {
  return {
    id: `t-${uid()}`,
    name: "Undo Test Contact",
    role: "sales_agent",
    company: "Undo Factory",
    wechat: "",
    whatsapp: "",
    email: "",
    notes: "",
    createdAt: Date.now(),
  };
}

function testFactoryProduct(): FactoryProduct {
  return {
    id: `t-${uid()}`,
    factoryId: "f1",
    productId: "p1",
    steps: blankSteps(),
    statusSentence: "",
    waitingOn: "none",
    waitingSince: null,
    nextStep: "",
    productGuessed: false,
    followupsUnanswered: 0,
    archivedAt: null,
    createdAt: Date.now(),
  };
}

describe("undoActivityEntry", () => {
  it("undo restores before-state for a contact creation (removes the contact)", async () => {
    const c = testContact();
    await saveContact(c);
    const entry = await logActivity("agent", "contact.create", "contacts", c.id, null, c, true);
    try {
      expect(await getContact(c.id)).toEqual(c);
      const result = await undoActivityEntry(entry.id);
      expect("entry" in result).toBe(true);
      if (!("entry" in result)) return;
      expect(result.entry.undoneAt).not.toBeNull();
      // before-state was null: the created contact is gone.
      expect(await getContact(c.id)).toBeNull();
      // Entry is marked undone: a second undo is refused.
      expect(await undoActivityEntry(entry.id)).toEqual({ error: "not_undoable" });
      expect((await getActivityEntry(entry.id))?.undoneAt).not.toBeNull();
    } finally {
      await deleteContact(c.id);
      await deleteActivityEntry(entry.id);
    }
  });

  it("undo restores before-state for a step mark", async () => {
    const before = testFactoryProduct();
    await saveFactoryProduct(before);
    const after: FactoryProduct = {
      ...before,
      steps: { ...before.steps, step1: { proofMessageId: "m1", doneAt: Date.now() } },
    };
    await saveFactoryProduct(after);
    const entry = await logActivity("agent", "step.mark", "factory_products", after.id, before, after, true);
    try {
      expect((await getFactoryProduct(after.id))?.steps.step1.doneAt).not.toBeNull();
      const result = await undoActivityEntry(entry.id);
      expect("entry" in result).toBe(true);
      if (!("entry" in result)) return;
      // before-state restored: step1 is unmarked again.
      const restored = await getFactoryProduct(after.id);
      expect(restored?.steps.step1).toEqual({ proofMessageId: null, doneAt: null });
      expect(result.entry.undoneAt).not.toBeNull();
    } finally {
      await deleteFactoryProduct(after.id);
      await deleteActivityEntry(entry.id);
    }
  });

  it("refuses non-undoable and missing entries", async () => {
    expect(await undoActivityEntry("does-not-exist")).toEqual({ error: "not_found" });
    const c = testContact();
    await saveContact(c);
    const entry = await logActivity("agent", "contact.create", "contacts", c.id, null, c, false);
    try {
      expect(await undoActivityEntry(entry.id)).toEqual({ error: "not_undoable" });
    } finally {
      await deleteContact(c.id);
      await deleteActivityEntry(entry.id);
    }
  });
});
