// Core domain types for the product command center.
export type Stage = "idea" | "spec" | "sourcing" | "outreach" | "sampling" | "quotation" | "live" | "dead";
export type SampleStatus = "none" | "requested" | "shipped" | "received" | "qc";
export type QuoteStatus = "none" | "waiting_factory" | "waiting_me" | "received";
export type FStage = "intro" | "contacted" | "sample_requested" | "sample_yiwu" | "sample_ny" | "sample_confirmed" | "quoted" | "negotiating" | "ordered";

export interface Reminder { id: string; date: string; text: string; done: boolean }
export interface Comment { ts: number; text: string }
export interface FactoryFile { name: string; url: string; ts: number }
export interface Quote { unitPrice: number; qty: number; notes: string; ts: number }

export interface Factory {
  id: string; productId: string; name: string; contact: string;
  channel: string; active: boolean;
  fstage: FStage;
  people: Person[];
  sampleStatus: SampleStatus; quoteStatus: QuoteStatus;
  lastContactAt: number | null;
  sampleRequestedAt: number | null; sampleShippedAt: number | null;
  reminders: Reminder[]; comments: Comment[]; files: FactoryFile[];
  quotes: Quote[]; updatedAt: number;
}

export interface Spec {
  skus: string; sizes: string; packSizes: string;
  materials: string; orderUnits: string; photos: string; notes: string;
  sheetUrl: string; lastUpdate: string;
}

// --- Structured spec fields (versioned) ---
export type SpecFieldSource = "listing" | "image" | "inferred";
export type SpecFieldTag = "locked" | "flexible" | "open";

export interface SpecField {
  id: string;
  label: string;
  value: string;
  source: SpecFieldSource;
  tag: SpecFieldTag; // hard safety default is "locked" — never silently default elsewhere
}

export interface SpecVersion {
  version: number;
  fields: SpecField[];
  createdAt: number;
}

export interface Costs {
  sellPrice: number; referralFeePct: number; fbaFee: number;
  dutiesPct: number; shippingUnit: number; ppcUnit: number; monthlySales: number;
}

export interface SkuRow { id: string; sku: string; size: string; pack: string; order: string }

export interface YukiChecklist {
  items: string; variants: string; quantities: string;
  deliveryAddress: string; fee: string; dates: string;
}

export interface YukiBrief { version: number; sentAt: number; content: string }

export interface Contact { id: string; name: string; role: string; company: string; wechat: string; whatsapp: string; email: string; notes: string; createdAt: number }

export interface Person { id: string; name: string; role: string; wechat: string; whatsapp: string; email: string }

export interface Product {
  id: string; name: string; started: boolean; stage: Stage;
  stageUpdatedAt: number; createdAt: number;
  asin: string; imageUrl: string; fbaSheetUrl: string;
  startDate: string; masterSku: string; skus: SkuRow[];
  specDone: boolean; sourcingStarted: boolean;
  spec: Spec; costs: Costs;
  // New structured spec format. spec.notes remains as legacy fallback/text blob.
  specFields: SpecField[];
  specVersion: number; // 0 = no approved version yet
  specVersions: SpecVersion[];
  specUpdatedAt: number | null;
  yukiChecklist: YukiChecklist; boxCutoffDate: string;
  yukiBriefs: YukiBrief[];
}

export const STAGES: Stage[] = ["spec", "sourcing", "outreach", "sampling", "quotation"];
export const STAGE_LABEL: Record<string, string> = {
  idea: "Idea", spec: "Spec Sheet", sourcing: "Sourcing (Yuki)",
  outreach: "Outreach", sampling: "Sampling", quotation: "Quotation",
  live: "Live", dead: "Dead",
};

export const FSTAGES: FStage[] = ["intro", "contacted", "sample_requested", "sample_yiwu", "sample_ny", "sample_confirmed", "quoted", "negotiating", "ordered"];
export const FSTAGE_LABEL: Record<string, string> = {
  intro: "Intro", contacted: "Contacted", sample_requested: "Sample Req.",
  sample_yiwu: "Sample Yiwu", sample_ny: "Sample NY",
  sample_confirmed: "Sample OK", quoted: "Quoted",
  negotiating: "Negotiating", ordered: "Ordered",
};

export function normF(f: Factory): Factory {
  if (!f.fstage) {
    if ((f.quotes && f.quotes.length > 0) || f.quoteStatus === "received") f.fstage = "quoted";
    else if (f.sampleStatus === "qc") f.fstage = "sample_confirmed";
    else if (f.sampleStatus === "received") f.fstage = "sample_ny";
    else if (f.sampleStatus === "shipped") f.fstage = "sample_yiwu";
    else if (f.sampleStatus === "requested") f.fstage = "sample_requested";
    else if (f.lastContactAt) f.fstage = "contacted";
    else f.fstage = "intro";
  }
  f.comments = f.comments || []; f.reminders = f.reminders || [];
  f.quotes = f.quotes || []; f.files = f.files || [];
  (f as any).people = Array.isArray((f as any).people) ? (f as any).people : [];
  return f;
}

export const FNEXT: Record<string, string> = {
  intro: "Complete intro, start communication",
  contacted: "Request samples",
  sample_requested: "Chase sample shipment",
  sample_yiwu: "Tell Yuki: ship sample to New York",
  sample_ny: "Confirm sample (QC)",
  sample_confirmed: "Get first quotation",
  quoted: "Compare FBA, negotiate",
  negotiating: "Push to order",
  ordered: "",
};

export function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

export function normP(p: Product): Product {
  p.asin = p.asin || ""; p.imageUrl = p.imageUrl || ""; p.fbaSheetUrl = (p as any).fbaSheetUrl || "";
  (p as any).startDate = (p as any).startDate || "";
  (p as any).masterSku = (p as any).masterSku || "";
  (p as any).skus = Array.isArray((p as any).skus) ? (p as any).skus : [];
  (p as any).specDone = !!(p as any).specDone;
  (p as any).sourcingStarted = !!(p as any).sourcingStarted;
  p.spec = { ...blankSpec(), ...(p.spec || {}) };
  p.costs = { ...blankCosts(), ...(p.costs || {}) };
  (p as any).specFields = Array.isArray((p as any).specFields)
    ? (p as any).specFields.map((f: any) => normSpecField(f))
    : [];
  (p as any).specVersion = typeof (p as any).specVersion === "number" ? (p as any).specVersion : 0;
  (p as any).specVersions = Array.isArray((p as any).specVersions) ? (p as any).specVersions : [];
  p.specUpdatedAt = (p as any).specUpdatedAt ?? null;
  p.yukiChecklist = { ...blankYukiChecklist(), ...((p as any).yukiChecklist || {}) };
  p.boxCutoffDate = (p as any).boxCutoffDate || "";
  p.yukiBriefs = Array.isArray((p as any).yukiBriefs) ? (p as any).yukiBriefs : [];
  return p;
}

// Hard safety default: any field missing/invalid tag data becomes "locked", never
// silently anything else (e.g. "flexible" or "open").
export function normSpecField(f: any): SpecField {
  const tag: SpecFieldTag = f && (f.tag === "flexible" || f.tag === "open" || f.tag === "locked") ? f.tag : "locked";
  const source: SpecFieldSource = f && (f.source === "image" || f.source === "inferred" || f.source === "listing") ? f.source : "inferred";
  return {
    id: String((f && f.id) || uid()),
    label: String((f && f.label) || ""),
    value: String((f && f.value) || ""),
    source,
    tag,
  };
}

export function blankSpec(): Spec {
  return { skus: "", sizes: "", packSizes: "", materials: "", orderUnits: "", photos: "", notes: "", sheetUrl: "", lastUpdate: "" };
}

export function blankYukiChecklist(): YukiChecklist {
  return { items: "", variants: "", quantities: "", deliveryAddress: "", fee: "", dates: "" };
}

export function blankCosts(): Costs {
  return { sellPrice: 0, referralFeePct: 15, fbaFee: 0, dutiesPct: 0, shippingUnit: 0, ppcUnit: 0, monthlySales: 0 };
}
