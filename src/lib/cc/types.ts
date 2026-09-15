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

export interface Costs {
  sellPrice: number; referralFeePct: number; fbaFee: number;
  dutiesPct: number; shippingUnit: number; ppcUnit: number; monthlySales: number;
}

export interface SkuRow { id: string; sku: string; size: string; pack: string; order: string }

export interface Contact { id: string; name: string; role: string; company: string; wechat: string; whatsapp: string; email: string; notes: string; createdAt: number }

export interface Person { id: string; name: string; role: string; wechat: string; whatsapp: string; email: string }

export interface Product {
  id: string; name: string; started: boolean; stage: Stage;
  stageUpdatedAt: number; createdAt: number;
  asin: string; imageUrl: string; fbaSheetUrl: string;
  startDate: string; masterSku: string; skus: SkuRow[];
  specDone: boolean; sourcingStarted: boolean;
  spec: Spec; costs: Costs;
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
  return p;
}

export function blankSpec(): Spec {
  return { skus: "", sizes: "", packSizes: "", materials: "", orderUnits: "", photos: "", notes: "", sheetUrl: "", lastUpdate: "" };
}

export function blankCosts(): Costs {
  return { sellPrice: 0, referralFeePct: 15, fbaFee: 0, dutiesPct: 0, shippingUnit: 0, ppcUnit: 0, monthlySales: 0 };
}
