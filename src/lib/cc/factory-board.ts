// Pure helpers for the Goal 6 Factories board + factory summary page.
// No I/O here so every rule below is unit-testable (SPEC B4).
// Model: 5 steps (§3.3), status sentence, waiting_on, since, next step.

export type WaitingOnUI = "haim" | "factory" | "yuki" | "carrier" | "china_office" | "donna" | "none" | null;

// Badge order: Haim first, then factory, then everyone else, then none.
// Returns a rank (lower = shows first).
export function waitingRank(w: WaitingOnUI): number {
  if (w === "haim") return 0;
  if (w === "factory") return 1;
  if (w === "yuki" || w === "carrier" || w === "china_office" || w === "donna") return 2;
  return 3;
}

export interface BoardRowLike {
  waitingOn?: WaitingOnUI;
  since: number | null; // ms epoch; null = unknown (sorts last)
}

// Sort: Haim-waiting first, then by waiting_on rank, then longest-waiting first.
export function sortBoardRows<T extends BoardRowLike>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const ha = a.waitingOn === "haim" ? 0 : 1;
    const hb = b.waitingOn === "haim" ? 0 : 1;
    if (ha !== hb) return ha - hb;
    const ra = waitingRank(a.waitingOn ?? null);
    const rb = waitingRank(b.waitingOn ?? null);
    if (ra !== rb) return ra - rb;
    const sa = typeof a.since === "number" ? a.since : Number.POSITIVE_INFINITY;
    const sb = typeof b.since === "number" ? b.since : Number.POSITIVE_INFINITY;
    return sa - sb; // oldest timestamp = longest waiting first
  });
}

export function hoursSince(since: number | null, now = Date.now()): number | null {
  if (typeof since !== "number" || Number.isNaN(since)) return null;
  return Math.max(0, (now - since) / (1000 * 60 * 60));
}

// "5m", "7h", "3d" — SPEC wants hours or days.
export function formatSince(hours: number | null): string {
  if (hours == null) return "—";
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))}m`;
  if (hours < 24) return `${Math.round(hours)}h`;
  return `${Math.round(hours / 24)}d`;
}

// Layer-timer colors: red past 48h, amber past 24h (matches existing board).
export function sinceColorClass(hours: number | null): string {
  if (hours == null) return "text-muted-foreground";
  if (hours > 48) return "text-red-600 dark:text-red-400 font-medium";
  if (hours > 24) return "text-amber-600 dark:text-amber-400 font-medium";
  return "text-muted-foreground";
}

// One-paragraph "Where we stand" summary composed from status fields only.
export function composeWhereWeStand(input: {
  factoryName: string;
  productName: string;
  doneSteps: number;
  statusSentence: string;
  waitingOn: WaitingOnUI;
  sinceText: string;
  nextStep: string;
  openItems: number;
}): string {
  const parts: string[] = [];
  parts.push(`${input.factoryName} × ${input.productName}: ${input.doneSteps} of 5 steps done.`);
  if (input.statusSentence) parts.push(input.statusSentence);
  if (input.waitingOn && input.waitingOn !== "none") {
    const who = input.waitingOn === "haim" ? "Haim" : input.waitingOn.replace("_", " ");
    parts.push(`Waiting on ${who} (${input.sinceText}).`);
  }
  if (input.nextStep) parts.push(`Next: ${input.nextStep}`);
  if (input.openItems > 0) parts.push(`${input.openItems} open item${input.openItems === 1 ? "" : "s"}.`);
  return parts.join(" ");
}
