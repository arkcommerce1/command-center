// Deterministic, regex/keyword-based negotiation guardrail.
// No AI call — must stay fast and synchronous so it can run inline on every
// draft version write. Server-side only: never trust a client-supplied result.
import { GuardrailResult } from "@/lib/cc/types";

interface Rule {
  reason: string;
  pattern: RegExp;
}

const RULES: Rule[] = [
  {
    reason: "Currency amount or price mentioned",
    pattern: /(\$\s?\d|USD\b|RMB\b|CNY\b|¥\s?\d|\d+(\.\d+)?\s?(usd|rmb|cny|dollars?|yuan))/i,
  },
  {
    reason: "Minimum order / MOQ language",
    pattern: /\b(MOQ|minimum\s+order|min\.?\s*order|minimum\s+quantity)\b/i,
  },
  {
    reason: "Payment terms language",
    pattern: /\b(deposit|down\s*payment|net\s?30|net\s?60|net\s?90|T\/T|telegraphic\s+transfer|L\/C|letter\s+of\s+credit|advance\s+payment|wire\s+transfer|full\s+payment)\b/i,
  },
  {
    reason: "Discount or counteroffer phrasing",
    pattern: /\b(discount|counter[\s-]?offer|lower\s+the\s+price|reduce\s+the\s+price|can\s+you\s+do|best\s+price|final\s+price|price\s+break|meet\s+in\s+the\s+middle|split\s+the\s+difference)\b/i,
  },
];

export function checkGuardrail(text: string): GuardrailResult {
  const t = String(text || "");
  for (const rule of RULES) {
    if (rule.pattern.test(t)) {
      return { blocked: true, reason: rule.reason };
    }
  }
  return { blocked: false, reason: null };
}
