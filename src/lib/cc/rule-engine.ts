// Apply learned rules to draft bubbles.
// This is a post-processing step on the deterministic drafter output.
// It applies simple text transformations based on active rules.

export function applyRules(bubbles: string[], allRules: string[], factoryRules: string[]): string[] {
  let result = [...bubbles];

  // Apply all-factory rules first, then factory-specific rules.
  const allRuleTexts = [...allRules, ...factoryRules];

  for (const rule of allRuleTexts) {
    result = applyRule(result, rule);
  }

  return result;
}

function applyRule(bubbles: string[], rule: string): string[] {
  const lower = rule.toLowerCase();

  // "Never use exclamation marks." → strip all "!"
  if (lower.includes("exclamation") || (lower.includes("no ") && lower.includes("!"))) {
    return bubbles.map((b) => b.replace(/!/g, "."));
  }

  // "Never use emoji." → strip emoji
  if (lower.includes("emoji")) {
    return bubbles.map((b) => b.replace(/[\u{1F000}-\u{1F9FF}\u{2600}-\u{27BF}]/gu, "").trim());
  }

  // "Keep replies short." → truncate each bubble to 120 chars
  if (lower.includes("short") || lower.includes("concise") || lower.includes("brief")) {
    return bubbles.map((b) => (b.length > 120 ? b.slice(0, 117) + "..." : b));
  }

  // "Address the contact as X." → replace "Hi" with "Hi X," if first bubble starts with "Hi"
  const callMatch = rule.match(/address the contact as (\w+)/i);
  if (callMatch) {
    const name = callMatch[1];
    return bubbles.map((b, i) => {
      if (i === 0 && /^hi[,!\s]/i.test(b)) {
        return b.replace(/^hi[,!]?\s*/i, `Hi ${name}, `);
      }
      return b;
    });
  }

  // "Never mention price/volume/quantity." → remove sentences containing those words
  if (lower.includes("price") || lower.includes("volume") || lower.includes("quantity")) {
    if (lower.startsWith("never") || lower.startsWith("don't") || lower.startsWith("dont")) {
      const keywords = ["price", "volume", "quantity", "\\$", "USD", "RMB", "MOQ"];
      const kwRegex = new RegExp(keywords.join("|"), "i");
      return bubbles.map((b) => {
        const sentences = b.split(/(?<=[.!?])\s+/);
        const filtered = sentences.filter((s) => !kwRegex.test(s));
        return filtered.length > 0 ? filtered.join(" ") : b;
      });
    }
  }

  return bubbles;
}

// Build the system instructions text for an LLM drafter.
// (Not currently used — the drafter is deterministic — but available for
// when we switch to LLM-based drafting.)
export function buildDraftInstructions(
  hardRules: string[],
  learnedAll: string[],
  learnedFactory: string[],
  examples: { incoming: string; reply: string }[],
): string {
  const parts: string[] = [];

  parts.push("HARD RULES (always follow these, they override everything):");
  for (const r of hardRules) parts.push(`- ${r}`);

  if (learnedAll.length > 0) {
    parts.push("\nLEARNED RULES (all factories):");
    for (const r of learnedAll) parts.push(`- ${r}`);
  }

  if (learnedFactory.length > 0) {
    parts.push("\nLEARNED RULES (this factory only):");
    for (const r of learnedFactory) parts.push(`- ${r}`);
  }

  if (examples.length > 0) {
    parts.push("\nPAST EXAMPLES (most similar situations first):");
    for (const ex of examples) {
      parts.push(`  Factory said: "${ex.incoming}"`);
      parts.push(`  We replied: "${ex.reply}"`);
    }
  }

  return parts.join("\n");
}
