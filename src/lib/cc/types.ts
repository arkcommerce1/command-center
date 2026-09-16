// Core domain types for the product command center.
export type Stage = "idea" | "spec" | "sourcing" | "outreach" | "sampling" | "quotation" | "live" | "dead";
export type SampleStatus = "none" | "requested" | "shipped" | "received" | "qc";
export type QuoteStatus = "none" | "waiting_factory" | "waiting_me" | "received";
export type FStage = "intro" | "contacted" | "sample_requested" | "sample_yiwu" | "sample_ny" | "sample_confirmed" | "quoted" | "negotiating" | "ordered";

export interface Reminder { id: string; date: string; text: string; done: boolean }
export interface Comment { ts: number; text: string }
export interface FactoryFile { name: string; url: string; ts: number }
export interface Quote { unitPrice: number; qty: number; notes: string; ts: number }

export type FactoryStage = "spec_agreed" | "sample_committed" | "passed_china" | "arrived_ny" | "sample_approved";

export interface Factory {
  id: string; productId: string; name: string; contact: string;
  channel: string; active: boolean;
  fstage: FStage;
  factoryStage: FactoryStage; // 5-step factory-level ladder (steps 4-8)
  canShareVolumes?: boolean; // SPEC §1.2: volumes named only when true (P4)
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
  approach: ProductApproach;
  amazonSnapshot: AmazonSnapshot | null;
  productStatus: "queue" | "active" | "completed";
  estimatedMonthlySales: number; // monthly unit volume
  averagePricePerUnit: number; // average selling price in USD
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

export const FACTORY_STAGES: FactoryStage[] = ["spec_agreed", "sample_committed", "passed_china", "arrived_ny", "sample_approved"];
export const FACTORY_STAGE_LABELS: Record<FactoryStage, string> = {
  spec_agreed: "Spec agreed",
  sample_committed: "Sample committed",
  passed_china: "Passed China check",
  arrived_ny: "Arrived in New York",
  sample_approved: "Sample approved",
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
  // Infer factoryStage from existing fstage if not set
  if (!(f as any).factoryStage) {
    if (f.fstage === "sample_confirmed" || f.fstage === "quoted" || f.fstage === "negotiating" || f.fstage === "ordered") (f as any).factoryStage = "sample_approved";
    else if (f.sampleStatus === "received" || f.fstage === "sample_ny") (f as any).factoryStage = "arrived_ny";
    else if (f.sampleStatus === "shipped" || f.fstage === "sample_yiwu") (f as any).factoryStage = "passed_china";
    else if (f.sampleStatus === "requested" || f.fstage === "sample_requested") (f as any).factoryStage = "sample_committed";
    else (f as any).factoryStage = "spec_agreed";
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
  (p as any).approach = (p as any).approach === "fresh" ? "fresh" : "already_selling";
  const snap = (p as any).amazonSnapshot;
  (p as any).amazonSnapshot = snap && typeof snap === "object"
    ? {
      title: String(snap.title || ""),
      bullets: Array.isArray(snap.bullets) ? snap.bullets.map((b: any) => String(b)) : [],
      description: String(snap.description || ""),
      imageUrls: Array.isArray(snap.imageUrls) ? snap.imageUrls.map((u: any) => String(u)) : [],
      fetchedAt: typeof snap.fetchedAt === "number" ? snap.fetchedAt : Date.now(),
    } : null;
  (p as any).productStatus = ["queue", "active", "completed"].includes((p as any).productStatus)
    ? (p as any).productStatus : "queue";
  (p as any).estimatedMonthlySales = typeof (p as any).estimatedMonthlySales === "number"
    ? (p as any).estimatedMonthlySales : 0;
  (p as any).averagePricePerUnit = typeof (p as any).averagePricePerUnit === "number"
    ? (p as any).averagePricePerUnit : 0;
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

// --- Playbook / durable settings ---
export type SampleAskTiming = "after_layer_2" | "after_layer_3";

export interface PlaybookPerson { name: string; role: string; location: string }
export interface PlaybookHoliday { name: string; startDate: string; endDate: string }

export interface PlaybookSettings {
  sampleAskTiming: SampleAskTiming;
  nudgeLimit: number;
  sampleFeeRule: "always_ask" | string;
  boxScheduleDay: string;
  boxScheduleCutoffTime: string;
  yiwuAddress: string;
  ourBrands: string[];
  approachADisclosures: string;
  ourPeople: PlaybookPerson[];
  holidays: PlaybookHoliday[];
}

export const YIWU_ADDRESS_SEED = "浙江义乌稠城街道丹溪北路18号雪峰银座9楼912室 丁小姐 15067460724";
export const OUR_BRANDS_SEED = ["AllSett Health", "Refreshify", "Everlasting"];

export function defaultPlaybookSettings(): PlaybookSettings {
  return {
    sampleAskTiming: "after_layer_3",
    nudgeLimit: 2,
    sampleFeeRule: "always_ask",
    boxScheduleDay: "",
    boxScheduleCutoffTime: "",
    yiwuAddress: YIWU_ADDRESS_SEED,
    ourBrands: [...OUR_BRANDS_SEED],
    approachADisclosures: "We sell on Amazon and Retail.",
    ourPeople: [
      { name: "Yuki", role: "Factory relations / sourcing", location: "China" },
      { name: "Shene", role: "Employee", location: "New York" },
    ],
    holidays: [
      { name: "National Day Golden Week", startDate: "2026-10-01", endDate: "2026-10-07" },
    ],
  };
}

export function normSettings(s: any): PlaybookSettings {
  const d = defaultPlaybookSettings();
  if (!s || typeof s !== "object") return d;
  return {
    sampleAskTiming: s.sampleAskTiming === "after_layer_2" || s.sampleAskTiming === "after_layer_3" ? s.sampleAskTiming : d.sampleAskTiming,
    nudgeLimit: typeof s.nudgeLimit === "number" ? s.nudgeLimit : d.nudgeLimit,
    sampleFeeRule: typeof s.sampleFeeRule === "string" ? s.sampleFeeRule : d.sampleFeeRule,
    boxScheduleDay: typeof s.boxScheduleDay === "string" ? s.boxScheduleDay : d.boxScheduleDay,
    boxScheduleCutoffTime: typeof s.boxScheduleCutoffTime === "string" ? s.boxScheduleCutoffTime : d.boxScheduleCutoffTime,
    yiwuAddress: typeof s.yiwuAddress === "string" && s.yiwuAddress ? s.yiwuAddress : d.yiwuAddress,
    ourBrands: Array.isArray(s.ourBrands) && s.ourBrands.length > 0
      ? s.ourBrands.map((b: any) => String(b)).filter(Boolean)
      : [...d.ourBrands],
    approachADisclosures: typeof s.approachADisclosures === "string" ? s.approachADisclosures : d.approachADisclosures,
    ourPeople: Array.isArray(s.ourPeople)
      ? s.ourPeople.map((p: any) => ({ name: String(p?.name || ""), role: String(p?.role || ""), location: String(p?.location || "") }))
      : d.ourPeople,
    holidays: Array.isArray(s.holidays)
      ? s.holidays.map((h: any) => ({ name: String(h?.name || ""), startDate: String(h?.startDate || ""), endDate: String(h?.endDate || "") }))
      : d.holidays,
  };
}

// --- Draft / version / approval system (data model only; no live WhatsApp wiring) ---

export type DraftType = "opening" | "reply" | "nudge" | "thanks" | "relay";
export type DraftLayer = 1 | 2 | 3 | 4 | 5;
export type DraftStatus = "pending" | "sent" | "disapproved" | "closed";

export interface Draft {
  id: string;
  factoryProductId: string; // link to a FactoryProductLink (factory+product pair)
  type: DraftType;
  layer: DraftLayer;
  status: DraftStatus;
  trigger: string;
  createdAt: number;
}

export type DraftVersionCreatedBy = "agent" | "ai_suggestion" | "haim";
export type DraftVersionStatus = "pending" | "replaced" | "approved" | "disapproved";
export type ApprovalChannel = "dashboard" | "whatsapp";

export interface GuardrailResult {
  blocked: boolean;
  reason: string | null;
}

export interface DraftVersion {
  id: string;
  draftId: string;
  versionNumber: number;
  text: string;
  createdBy: DraftVersionCreatedBy;
  suggestionText: string | null;
  basedOnVersion: number | null;
  guardrailResult: GuardrailResult;
  status: DraftVersionStatus;
  approvalChannel: ApprovalChannel | null;
  approver: string | null;
  approvedAt: number | null;
  sentAt: number | null;
  disapproveReason: string | null;
  chatMovedOn: boolean;
  createdAt: number;
}

export interface LayerProof {
  id: string;
  factoryProductId: string;
  layer: DraftLayer;
  messageText: string;
  markedBy: string;
  markedAt: number;
}

export type DecisionType = "locked_change" | "fee" | "spec_gap" | "drop" | "quote";
export type DecisionStatus = "pending" | "resolved";

export interface Decision {
  id: string;
  factoryProductId: string;
  type: DecisionType;
  options: string[];
  status: DecisionStatus;
  chosenOption: string | null;
  resultingDraftId: string | null;
  createdAt: number;
}

export type TrackingStage = "none" | "in_yiwu_qc" | "in_box" | "to_new_york" | "decision";
export type WaitingOn = "haim" | "factory" | "yuki" | "china_office" | "carrier" | "donna";

export interface DroppedInfo {
  layer: number;
  reason: string;
  suggestedBy: string;
  confirmedBy: string | null;
  confirmedAt: number | null;
}

export interface FactoryProductLink {
  id: string;
  companyId: string;
  productId: string;
  currentLayer: DraftLayer;
  trackingStage: TrackingStage;
  statusLine: string;
  nextStep: string;
  waitingOn: WaitingOn | null;
  since: number;
  promisedShipDate: string | null;
  dropped: DroppedInfo | null;
}

// --- SPEC §1.2 Goal 1 additive tables (new collections; existing ones untouched) ---

export type ProductApproach = "already_selling" | "fresh";

export interface AmazonSnapshot {
  title: string;
  bullets: string[];
  description: string;
  imageUrls: string[];
  fetchedAt: number;
}

export interface SpecFieldV2 { key: string; label: string; value: string; tag: "locked" | "flexible"; status: "filled" | "needs_input" }

export interface SpecVersionRow {
  id: string;
  productId: string;
  version: number;
  fields: SpecFieldV2[];
  status: "draft" | "approved";
  createdBy: "ai" | "haim";
  createdAt: number;
}

export type StepKey = "step1" | "step2" | "step3" | "step4" | "step5";
export type WaitingOnV2 = "haim" | "factory" | "yuki" | "carrier" | "none";

export interface FactoryProduct {
  id: string;
  factoryId: string;
  productId: string;
  steps: Record<StepKey, { proofMessageId: string | null; doneAt: number | null }>;
  statusSentence: string;
  waitingOn: WaitingOnV2;
  waitingSince: number | null;
  nextStep: string;
  productGuessed: boolean;
  followupsUnanswered: number;
  archivedAt: number | null;
  createdAt: number;
}

export function blankSteps(): FactoryProduct["steps"] {
  const s = (proofMessageId: string | null = null, doneAt: number | null = null) => ({ proofMessageId, doneAt });
  return { step1: s(), step2: s(), step3: s(), step4: s(), step5: s() };
}

export interface Adjustment {
  id: string;
  factoryProductId: string;
  fieldKey: string;
  proposedValue: string;
  messageId: string | null;
  result: "accepted" | "declined" | "pending";
  createdAt: number;
}

export interface ContactChannel {
  id: string;
  contactId: string;
  kind: "whatsapp" | "email" | "wechat";
  value: string;
  createdAt: number;
}

export interface Chat {
  id: string;
  channel: "whatsapp" | "email";
  externalId: string;
  name: string;
  kind: "group" | "dm" | "email_thread";
  factoryId: string | null;
  createdAt: number;
}

export interface ChatMember { id: string; chatId: string; contactId: string }

export interface Message {
  id: string;
  chatId: string;
  contactId: string | null;
  direction: "in" | "out";
  externalId: string;
  text: string;
  translation: string | null;
  lang: string | null;
  media: unknown;
  sentAt: number;
  factoryProductId: string | null;
  fromOutboxId: string | null;
}

export type OutboxStatus = "queued" | "sending" | "sent" | "failed" | "uncertain";

export interface OutboxRow {
  id: string;
  draftVersionId: string;
  chatId: string;
  bubbles: string[];
  status: OutboxStatus;
  sendAfter: number | null;
  leaseToken: string | null;
  leaseExpiresAt: number | null;
  attempts: number;
  externalMessageIds: string[];
  error: string | null;
  createdAt: number;
}

export type QuestionKind = "question" | "fee" | "product_pick" | "sample_flag" | "sample_review" | "send_uncertain" | "guardrail_block";

export interface Question {
  id: string;
  factoryProductId: string | null;
  kind: QuestionKind;
  body: unknown;
  status: "open" | "answered";
  answer: unknown;
  importance: "high" | "medium" | "low";
  createdAt: number;
}

export interface QuoteRow { id: string; factoryProductId: string; messageId: string | null; text: string; createdAt: number }

export interface OpenItem {
  id: string;
  factoryProductId: string;
  direction: "we_owe" | "they_owe";
  kind: "question" | "sample_tracking";
  summary: string;
  openedMessageId: string | null;
  openedAt: number;
  followupsSent: number;
  resolvedAt: number | null;
}

export type SampleStage = "waiting_tracking" | "to_yiwu" | "in_yiwu" | "problem" | "ready_to_ship" | "to_ny" | "in_ny" | "approved" | "rejected" | "change_requested";

export interface Sample {
  id: string;
  factoryProductId: string;
  stage: SampleStage;
  qcResult: "pass" | "problem" | null;
  qcNotes: string;
  photos: string[];
  haimResult: "approved" | "rejected" | "change_requested" | null;
  createdAt: number;
}

export interface Shipment {
  id: string;
  leg: "china_to_yiwu" | "yiwu_to_ny";
  trackingNumber: string;
  carrier: string | null;
  status: string | null;
  lastEvent: string | null;
  eta: string | null;
  events: unknown[];
  createdAt: number;
}

export interface ShipmentItem { id: string; shipmentId: string; sampleId: string }

export interface Notification {
  id: string;
  contactId: string;
  chatId: string | null;
  text: string;
  attachments: unknown[];
  status: string;
  sentAt: number | null;
  createdAt: number;
}

export type ActivityActor = "agent" | "haim";

export interface ActivityLogEntry {
  id: string;
  actor: ActivityActor;
  action: string;
  entity: string;
  entityId: string;
  before: any;
  after: any;
  undoable: boolean;
  undoneAt: number | null;
  createdAt: number;
}

export type AgentJobStatus = "queued" | "running" | "done" | "failed";

export interface AgentJob {
  id: string;
  type: string;
  payload: unknown;
  status: AgentJobStatus;
  leaseToken: string | null;
  leaseExpiresAt: number | null;
  attempts: number;
  error: string | null;
  createdAt: number;
}

// Pure undo planner (unit-testable, no I/O): given an activity_log entry,
// describe how to restore the before-state. Returns null when not undoable.
export interface UndoPlan { collection: string; id: string; restore: any; remove: boolean }

export function planUndo(entry: ActivityLogEntry): UndoPlan | null {
  if (!entry.undoable || entry.undoneAt) return null;
  if (entry.before == null) return { collection: entry.entity, id: entry.entityId, restore: null, remove: true };
  return { collection: entry.entity, id: entry.entityId, restore: entry.before, remove: false };
}
