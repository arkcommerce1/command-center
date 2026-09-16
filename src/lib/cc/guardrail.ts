// Guardrail (SPEC §3.4): deterministic, regex-based, no AI call — must stay
// fast and synchronous so it can run inline on every draft version write.
// Matching is case-insensitive. Server-side only: never trust a
// client-supplied result.
//
// Block categories: Currency, Pricing, Orders, Payment, Volume (volume only
// when can_share_volumes is false for that factory).
// Always allowed (stripped before matching): numbers from the approved spec,
// dates, tracking numbers, the Yiwu address, phone numbers, the exact fee
// card message.
import type { GuardrailResult } from "@/lib/cc/types";

export interface GuardrailOptions {
  canShareVolumes?: boolean;
  specNumbers?: (string | number)[];
  feeMessage?: string;
}

const CURRENCY: RegExp[] = [
  /\d\s?US\$|US\$\s?\d/i, // US$5 / 5 US$
  /\$\s?\d|\d\s?\$/, // $5
  /\b\d[\d,.]*\s?USD\b|\bUSD\s?\d/i, // 5 USD
  /¥\s?\d|\d\s?¥/, // ¥500
  /\b\d[\d,.]*\s?(RMB|CNY)\b|\b(RMB|CNY)\s?\d/i, // 500 RMB
  /\b\d[\d,.]*\s?(yuan|dollars?)\b|\b(yuan|dollars?)\s?\d/i, // 500 yuan / 5 dollars
  /€\s?\d|\d\s?€/, // €5
];

const PRICING: RegExp[] = [
  /\btarget\s+price\b/i,
  /\bunit\s+price\b/i,
  /\bper\s+unit\b/i,
  /\bper\s+piece\b/i,
  /\/pcs?\b/i, // /pc, /pcs — leading slash, not a word char
  /\bpricing\b/i,
  /\bcounteroffers?\b/i,
  /\bcounter\b/i,
  /\bprice\b/i,
  /\bcost\b/i,
  /\bcheaper\b/i,
  /\bdiscount\b/i,
  /\bbudget\b/i,
  /\bEXW\b/i,
  /\bFOB\b/i,
  /\bCIF\b/i,
  /\bDDP\b/i,
];

const ORDERS: RegExp[] = [
  /\bMOQ\b/i,
  /\bminimum\s+order\b/i,
  /\border\s+quantity\b/i,
  /\bbulk\s+order\b/i,
  /\bfirst\s+order\b/i,
  /\btrial\s+order\b/i,
  /\bcontainers?\b/i,
  /\b20GP\b/i,
  /\b40HQ\b/i,
];

const PAYMENT: RegExp[] = [
  /\bpayment\s+terms\b/i,
  /\bTT\s+payment\b/i,
  /\bbalance\s+payment\b/i,
  /\bwire\s+transfer\b/i,
  /\bT\/T\b/,
  /\bL\/C\b/,
  /\bdeposit\b/i,
  /\binvoice\b/i,
  /\bPayPal\b/i,
  /\bAlipay\b/i,
];

const VOLUME: RegExp[] = [
  /\bper\s+month\b/i,
  /\bmonthly\b/i,
  /\bper\s+year\b/i,
  /\bannually\b/i,
  /\bkg\s*\/\s*month\b/i,
  /\bpcs\s*\/\s*month\b/i,
  /\bunits\s*\/\s*month\b/i,
  /\btons?\b/i,
];

const MONTHS =
  "Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?";

/** Remove everything the spec always allows, so it can never block. */
function stripAllowed(text: string, opts: GuardrailOptions): string {
  let t = String(text || "");
  // 1. The exact fee card message.
  if (opts.feeMessage) t = t.split(opts.feeMessage).join(" ");
  // 2. The Yiwu address: any CJK run (Chinese address lines) plus Yiwu itself.
  t = t.replace(/[\u4e00-\u9fff]+/g, " ");
  t = t.replace(/\byiwu\b/gi, " ");
  // 3. Phone numbers: CN mobile, intl +, dashed groups.
  t = t.replace(/\+\d[\d\s\-()]{6,}\d/g, " ");
  t = t.replace(/\b1\d{10}\b/g, " ");
  t = t.replace(/\b\d{3}[-.\s]\d{3,4}[-.\s]\d{4}\b/g, " ");
  // 4. Dates: 2026-10-01, 10/01/2026, Oct 1 / 1 Oct (with optional year).
  t = t.replace(/\b\d{4}-\d{2}-\d{2}\b/g, " ");
  t = t.replace(/\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g, " ");
  t = t.replace(new RegExp(`\\b(?:${MONTHS})\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s+\\d{4})?\\b`, "gi"), " ");
  t = t.replace(new RegExp(`\\b\\d{1,2}\\s+(?:${MONTHS})\\b`, "gi"), " ");
  // 5. Tracking numbers: carrier-style alphanumerics + long digit runs.
  t = t.replace(/\b1Z[A-Z0-9]{10,}\b/i, " ");
  t = t.replace(/\b[A-Z]{1,4}\d{6,}[A-Z0-9]*\b/i, " ");
  t = t.replace(/\b\d{10,}\b/g, " ");
  // 6. Numbers appearing in the approved spec.
  for (const n of opts.specNumbers ?? []) {
    const s = String(n).trim();
    if (s) t = t.split(s).join(" ");
  }
  return t;
}

export function checkGuardrail(text: string, opts: GuardrailOptions = {}): GuardrailResult {
  const t = stripAllowed(text, opts);
  for (const pattern of CURRENCY) {
    if (pattern.test(t)) return { blocked: true, reason: "Currency amount" };
  }
  for (const pattern of PRICING) {
    if (pattern.test(t)) return { blocked: true, reason: "Pricing language" };
  }
  for (const pattern of ORDERS) {
    if (pattern.test(t)) return { blocked: true, reason: "Order language" };
  }
  for (const pattern of PAYMENT) {
    if (pattern.test(t)) return { blocked: true, reason: "Payment language" };
  }
  if (!opts.canShareVolumes) {
    for (const pattern of VOLUME) {
      if (pattern.test(t)) return { blocked: true, reason: "Volume language" };
    }
  }
  return { blocked: false, reason: null };
}
