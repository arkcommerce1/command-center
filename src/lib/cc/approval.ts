// Approval engine (Goal 1): pure, dependency-free logic used by both the
// Agent API and the dashboard. No DB imports here — callers persist the
// returned objects. All validation happens BEFORE any write, so a refused
// approval leaves the store untouched (one logical transaction).
//
// SPEC §1.3 server guarantees implemented here:
// - Approve: version must be latest, draft must be pending, content hash must
//   match. Only then is exactly one outbox row created.
// - One pending draft per factory_product.
// - Outbox claim uses a lease: exactly one winner; uncertain rows are never
//   re-claimed (never auto-resent).
// - Human reply (outbound from Ours, NOT via outbox) closes the pending draft
//   with closed_reason human_replied.
// - New factory message while pending -> new version marked update.

export type DraftStatus = "pending" | "approved" | "disapproved" | "closed";
export type DraftClosedReason = "human_replied" | null;
export type VersionSource = "ai" | "suggestion" | "update";
export type OutboxStatus = "queued" | "sending" | "sent" | "failed" | "uncertain";
export type DraftKind = "reply" | "opener" | "followup" | "fee_pay" | "sample_change" | "decline";

export interface Draft {
  id: string;
  factoryProductId: string;
  chatId: string;
  kind: DraftKind;
  status: DraftStatus;
  closedReason: DraftClosedReason;
  disapproveReason: string | null;
  currentVersion: number;
  createdAt: number;
}

export interface DraftVersion {
  id: string;
  draftId: string;
  version: number;
  bubbles: string[];
  contentHash: string;
  source: VersionSource;
  suggestionText: string | null;
  createdAt: number;
}

export interface OutboxRow {
  id: string;
  draftVersionId: string;
  chatId: string;
  bubbles: string[];
  status: OutboxStatus;
  leaseToken: string | null;
  leaseExpiresAt: number | null;
  attempts: number;
  externalMessageIds: string[];
  error: string | null;
}

export const OUTBOX_LEASE_TTL_MS = 5 * 60 * 1000;

export class ApprovalError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "ApprovalError";
    this.code = code;
  }
}

/** Deterministic content hash over the bubbles (FNV-1a, hex). No deps. */
export function contentHash(bubbles: string[]): string {
  const s = JSON.stringify(bubbles);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

export interface ApprovalStore {
  drafts: Map<string, Draft>;
  versions: Map<string, DraftVersion>;
  outbox: Map<string, OutboxRow>;
  seq: number;
}

export function createApprovalStore(): ApprovalStore {
  return { drafts: new Map(), versions: new Map(), outbox: new Map(), seq: 0 };
}

function nextId(store: ApprovalStore, prefix: string): string {
  store.seq += 1;
  return `${prefix}_${store.seq}`;
}

export function pendingDraftFor(store: ApprovalStore, factoryProductId: string): Draft | null {
  for (const d of store.drafts.values()) {
    if (d.factoryProductId === factoryProductId && d.status === "pending") return d;
  }
  return null;
}

export function pendingDraftForChat(store: ApprovalStore, chatId: string): Draft | null {
  for (const d of store.drafts.values()) {
    if (d.chatId === chatId && d.status === "pending") return d;
  }
  return null;
}

export function versionsFor(store: ApprovalStore, draftId: string): DraftVersion[] {
  return [...store.versions.values()].filter((v) => v.draftId === draftId).sort((a, b) => a.version - b.version);
}

export function latestVersion(store: ApprovalStore, draftId: string): DraftVersion | null {
  const vs = versionsFor(store, draftId);
  return vs.length > 0 ? vs[vs.length - 1] : null;
}

function getDraft(store: ApprovalStore, draftId: string): Draft {
  const d = store.drafts.get(draftId);
  if (!d) throw new ApprovalError("draft_not_found", `Draft ${draftId} not found`);
  return d;
}

function getVersion(store: ApprovalStore, versionId: string): DraftVersion {
  const v = store.versions.get(versionId);
  if (!v) throw new ApprovalError("version_not_found", `Version ${versionId} not found`);
  return v;
}

/** Create a draft with its v1. Refused when a pending draft already exists. */
export function createDraft(
  store: ApprovalStore,
  input: { factoryProductId: string; chatId: string; kind: DraftKind; bubbles: string[] },
): { draft: Draft; version: DraftVersion } {
  if (pendingDraftFor(store, input.factoryProductId)) {
    throw new ApprovalError("pending_exists", `A pending draft already exists for ${input.factoryProductId}`);
  }
  const draft: Draft = {
    id: nextId(store, "draft"),
    factoryProductId: input.factoryProductId,
    chatId: input.chatId,
    kind: input.kind,
    status: "pending",
    closedReason: null,
    disapproveReason: null,
    currentVersion: 1,
    createdAt: Date.now(),
  };
  const version: DraftVersion = {
    id: nextId(store, "ver"),
    draftId: draft.id,
    version: 1,
    bubbles: [...input.bubbles],
    contentHash: contentHash(input.bubbles),
    source: "ai",
    suggestionText: null,
    createdAt: Date.now(),
  };
  store.drafts.set(draft.id, draft);
  store.versions.set(version.id, version);
  return { draft, version };
}

function addVersion(
  store: ApprovalStore,
  draft: Draft,
  bubbles: string[],
  source: VersionSource,
  suggestionText: string | null,
): DraftVersion {
  if (draft.status !== "pending") {
    throw new ApprovalError("draft_not_pending", `Draft ${draft.id} is ${draft.status}, not pending`);
  }
  const version: DraftVersion = {
    id: nextId(store, "ver"),
    draftId: draft.id,
    version: draft.currentVersion + 1,
    bubbles: [...bubbles],
    contentHash: contentHash(bubbles),
    source,
    suggestionText,
    createdAt: Date.now(),
  };
  draft.currentVersion = version.version;
  store.versions.set(version.id, version);
  return version;
}

/** Haim's "Suggest changes": a new version carrying his suggestion text. */
export function suggest(
  store: ApprovalStore,
  draftId: string,
  suggestionText: string,
  newBubbles: string[],
): DraftVersion {
  return addVersion(store, getDraft(store, draftId), newBubbles, "suggestion", suggestionText);
}

/** New factory message arrived while a draft is pending: version marked update. */
export function updateOnNewMessage(store: ApprovalStore, draftId: string, bubbles: string[]): DraftVersion {
  return addVersion(store, getDraft(store, draftId), bubbles, "update", null);
}

/**
 * Approve a version. Validates EVERYTHING before writing anything:
 * version exists, draft is pending, version is the latest, stored content
 * hash matches the bubbles, caller-supplied hash (if any) matches. Then —
 * and only then — marks the draft approved and creates exactly one outbox row.
 */
export function approve(
  store: ApprovalStore,
  versionId: string,
  opts?: { expectedHash?: string },
): { draft: Draft; version: DraftVersion; outbox: OutboxRow } {
  // ---- validate phase (no writes) ----
  const version = getVersion(store, versionId);
  const draft = getDraft(store, version.draftId);
  if (draft.status !== "pending") {
    throw new ApprovalError("draft_not_pending", `Draft ${draft.id} is ${draft.status}, not pending`);
  }
  const latest = latestVersion(store, draft.id);
  if (!latest || latest.id !== version.id) {
    throw new ApprovalError(
      "not_latest",
      `Version ${version.version} is not the latest (v${draft.currentVersion}). Check the dashboard.`,
    );
  }
  if (contentHash(version.bubbles) !== version.contentHash) {
    throw new ApprovalError("hash_mismatch", `Content hash mismatch for version ${version.id}`);
  }
  if (opts?.expectedHash && opts.expectedHash !== version.contentHash) {
    throw new ApprovalError("hash_mismatch", `Caller hash does not match version ${version.id}`);
  }
  for (const row of store.outbox.values()) {
    if (row.draftVersionId === version.id) {
      throw new ApprovalError("already_queued", `Version ${version.id} already has an outbox row`);
    }
  }
  // ---- write phase ----
  draft.status = "approved";
  const outbox: OutboxRow = {
    id: nextId(store, "outbox"),
    draftVersionId: version.id,
    chatId: draft.chatId,
    bubbles: [...version.bubbles],
    status: "queued",
    leaseToken: null,
    leaseExpiresAt: null,
    attempts: 0,
    externalMessageIds: [],
    error: null,
  };
  store.outbox.set(outbox.id, outbox);
  return { draft, version, outbox };
}

/** Disapprove a pending draft. Reason is optional and one line. */
export function disapprove(store: ApprovalStore, draftId: string, reason?: string): Draft {
  const draft = getDraft(store, draftId);
  if (draft.status !== "pending") {
    throw new ApprovalError("draft_not_pending", `Draft ${draft.id} is ${draft.status}, not pending`);
  }
  draft.status = "disapproved";
  draft.disapproveReason = reason ?? null;
  return draft;
}

/**
 * An outbound message from an Ours contact that did NOT come from the outbox
 * (Haim/Yuki typed it directly) closes that chat's pending draft.
 * Returns the closed draft, or null when nothing applies.
 */
export function closeOnHumanReply(
  store: ApprovalStore,
  input: { chatId: string; senderType: "ours" | "factory"; fromOutbox: boolean },
): Draft | null {
  if (input.senderType !== "ours" || input.fromOutbox) return null;
  const draft = pendingDraftForChat(store, input.chatId);
  if (!draft) return null;
  draft.status = "closed";
  draft.closedReason = "human_replied";
  return draft;
}

/**
 * Claim an outbox row for sending. Exactly one winner: returns true only when
 * no live lease is held. Queued, sending-with-expired-lease, and failed rows
 * are claimable. Sent rows (exactly-once) and uncertain rows (Haim resolves
 * by hand — never auto-resent) are never claimable.
 */
export function claimOutbox(
  store: ApprovalStore,
  rowId: string,
  leaseToken: string,
  nowMs: number,
  ttlMs: number = OUTBOX_LEASE_TTL_MS,
): boolean {
  const row = store.outbox.get(rowId);
  if (!row || (row.status !== "queued" && row.status !== "sending" && row.status !== "failed")) return false;
  if (row.leaseToken && row.leaseExpiresAt !== null && row.leaseExpiresAt > nowMs) return false;
  row.leaseToken = leaseToken;
  row.leaseExpiresAt = nowMs + ttlMs;
  row.status = "sending";
  row.attempts += 1;
  return true;
}

function leasedRow(store: ApprovalStore, rowId: string, leaseToken: string): OutboxRow {
  const row = store.outbox.get(rowId);
  if (!row) throw new ApprovalError("outbox_not_found", `Outbox row ${rowId} not found`);
  if (row.leaseToken !== leaseToken) {
    throw new ApprovalError("lease_mismatch", `Lease token does not hold row ${rowId}`);
  }
  return row;
}

/** Report a successful send. Only the lease holder can complete it. */
export function markOutboxSent(
  store: ApprovalStore,
  rowId: string,
  leaseToken: string,
  externalMessageIds: string[],
): OutboxRow {
  const row = leasedRow(store, rowId, leaseToken);
  if (row.status === "sent") throw new ApprovalError("already_sent", `Row ${rowId} already sent`);
  row.status = "sent";
  row.externalMessageIds = [...externalMessageIds];
  row.leaseToken = null;
  row.leaseExpiresAt = null;
  return row;
}

/** Report a clean failure (retryable by a new claim). */
export function markOutboxFailed(store: ApprovalStore, rowId: string, leaseToken: string, error: string): OutboxRow {
  const row = leasedRow(store, rowId, leaseToken);
  row.status = "failed";
  row.error = error;
  row.leaseToken = null;
  row.leaseExpiresAt = null;
  return row;
}

/**
 * Send started but the result is unknown (e.g. gateway restarted mid-send):
 * the row becomes uncertain and is NEVER auto-resent. A card asks Haim to
 * check the chat; he marks it sent or re-queues by hand.
 */
export function markOutboxUncertain(store: ApprovalStore, rowId: string, error?: string): OutboxRow {
  const row = store.outbox.get(rowId);
  if (!row) throw new ApprovalError("outbox_not_found", `Outbox row ${rowId} not found`);
  row.status = "uncertain";
  row.error = error ?? "Send result unknown";
  row.leaseToken = null;
  row.leaseExpiresAt = null;
  return row;
}
