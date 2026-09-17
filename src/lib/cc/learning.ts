// Goals 3-5: Lesson records + learned rules + draft examples.
// Called from approve/disapprove/suggest flows.
// All data lives in the agent store (agent_kv JSON blob).

import { dbFind, dbInsert, dbUpdate, dbById } from "@/lib/cc/agent-store";
import { uid } from "@/lib/cc/types";

// ---------------------------------------------------------------------------
// Goal 3: Save a lesson record every time Haim acts on a draft.
// ---------------------------------------------------------------------------

export interface Lesson {
  id: string;
  action: "approved" | "suggested" | "disapproved";
  draftId: string;
  versionId: string;
  factoryProductId: string | null;
  factoryName: string | null;
  productName: string | null;
  incomingMessage: string | null; // the original factory message that triggered the draft
  aiDraft: string | null; // the AI's original draft text (first version)
  feedbackText: string | null; // Haim's suggestion text or disapprove reason
  finalSentText: string | null; // the text that was actually sent (if approved)
  step: number | null;
  createdAt: number;
}

export async function saveLesson(
  input: Omit<Lesson, "id" | "createdAt">,
): Promise<Lesson> {
  const lesson: Lesson = {
    ...input,
    id: uid(),
    createdAt: Date.now(),
  };
  await dbInsert("lessons", lesson);
  return lesson;
}

// ---------------------------------------------------------------------------
// Goal 4: Turn feedback into rules. Rules are either ALL factories or
// scoped to one factory. Duplicates strengthen; contradictions replace.
// ---------------------------------------------------------------------------

export interface LearnedRule {
  id: string;
  ruleText: string;
  scope: "all" | "factory";
  factoryId: string | null; // when scope=factory
  factoryName: string | null;
  sourceFeedback: string; // the feedback it was extracted from
  sourceLessonId: string | null;
  usageCount: number; // how many drafts used it
  createdAt: number;
  updatedAt: number;
  supersededById: string | null; // when a newer rule replaces this
  status: "active" | "superseded" | "deleted";
}

// Extract a short, plain rule from Haim's feedback text.
// This is deterministic heuristic extraction — no LLM call.
// It looks for common patterns in Haim's feedback and turns them into rules.
export function extractRule(feedback: string, factoryName: string | null): string | null {
  const f = feedback.trim();
  if (!f || f.length < 2) return null;

  // Common patterns Haim tends to use:
  // "no exclamation marks" → "Never use exclamation marks."
  // "shorter" → "Keep replies short."
  // "call her Shene" → "Address the contact as Shene."
  // "don't mention price" → "Never mention price."

  // If it starts with "no " or "don't ", normalize to "Never ..."
  const lower = f.toLowerCase();
  if (lower.startsWith("no ") || lower.startsWith("don't ") || lower.startsWith("dont ")) {
    // "no exclamation marks" → "Never use exclamation marks."
    const rest = f.replace(/^(no|don't|dont)\s+/i, "").trim();
    if (rest) {
      // If it already says "exclamation marks" → "Never use exclamation marks."
      const noun = rest.replace(/^(use|include|mention|say)\s+/i, "").trim();
      return `Never ${verbFor(noun)}${noun}.`;
    }
  }

  // "shorter" or "keep it short" → "Keep replies short."
  if (/^shorter$|^keep.*(short|brief|concise)/i.test(f)) {
    return "Keep replies short and concise.";
  }

  // "call her/him X" → "Address the contact as X."
  const callMatch = f.match(/^(?:call|refer to|address)\s+(?:her|him|them)\s+(\w+)/i);
  if (callMatch) {
    return `Address the contact as ${callMatch[1]}.`;
  }

  // If the feedback is a full sentence, use it as-is (strip leading "make it" etc).
  const cleaned = f.replace(/^(make it|make|change it to|change to|say)\s+/i, "").trim();
  if (cleaned.length >= 3 && cleaned.length <= 200) {
    // Capitalize first letter
    return cleaned.charAt(0).toUpperCase() + cleaned.slice(1) + (/[.!]$/.test(cleaned) ? "" : ".");
  }

  return null;
}

function verbFor(noun: string): string {
  // Heuristic: if the noun is a category of thing, use "use"
  const categories = ["exclamation", "emoji", "slang", "abbreviat"];
  for (const cat of categories) {
    if (noun.toLowerCase().includes(cat)) return "use ";
  }
  return "use ";
}

// Save or strengthen a learned rule.
export async function saveLearnedRule(
  ruleText: string,
  scope: "all" | "factory",
  factoryId: string | null,
  factoryName: string | null,
  sourceFeedback: string,
  sourceLessonId: string | null,
): Promise<LearnedRule | null> {
  // Check for an existing active rule with the same text + scope
  const existing = await dbFind("learnedRules", (r: any) =>
    r.status === "active" &&
    r.ruleText.toLowerCase() === ruleText.toLowerCase() &&
    r.scope === scope &&
    (scope === "all" || r.factoryId === factoryId),
  );

  if (existing.length > 0) {
    // Strengthen: update the source and increment nothing extra, but record
    // the new feedback as additional source material.
    const existingRule = existing[0];
    await dbUpdate("learnedRules", existingRule.id, {
      sourceFeedback: `${existingRule.sourceFeedback} | ${sourceFeedback}`,
      updatedAt: Date.now(),
    });
    return existingRule;
  }

  // Check for a contradicting rule (same topic but different text).
  // We detect "contradiction" loosely: if the new rule text starts with
  // "Never use X" and an existing rule says "Always use X" (or vice versa),
  // the newer one replaces the older.
  const topic = extractTopic(ruleText);
  if (topic) {
    const contradicting = await dbFind("learnedRules", (r: any) =>
      r.status === "active" &&
      r.scope === scope &&
      (scope === "all" || r.factoryId === factoryId) &&
      extractTopic(r.ruleText) === topic,
    );
    for (const old of contradicting) {
      await dbUpdate("learnedRules", old.id, {
        status: "superseded",
        supersededById: "pending",
        updatedAt: Date.now(),
      });
    }
  }

  const rule: LearnedRule = {
    id: uid(),
    ruleText,
    scope,
    factoryId,
    factoryName,
    sourceFeedback,
    sourceLessonId,
    usageCount: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    supersededById: null,
    status: "active",
  };
  await dbInsert("learnedRules", rule);

  // If we superseded old rules, update their supersededById to point to the new rule.
  if (topic) {
    const oldRules = await dbFind("learnedRules", (r: any) =>
      r.status === "superseded" && r.supersededById === "pending",
    );
    for (const old of oldRules) {
      await dbUpdate("learnedRules", old.id, { supersededById: rule.id });
    }
  }

  return rule;
}

// Extract a "topic" from a rule text for contradiction detection.
// "Never use exclamation marks." → "exclamation marks"
// "Keep replies short." → "replies short"
// Returns null if no topic can be extracted.
function extractTopic(ruleText: string): string | null {
  const t = ruleText.toLowerCase().trim();
  // Strip leading "never " or "always "
  const stripped = t.replace(/^(never|always)\s+/, "");
  if (stripped.length < 3) return null;
  return stripped.slice(0, 40); // first 40 chars as topic key
}

// ---------------------------------------------------------------------------
// Goal 5: Get rules + examples for a draft context.
// ---------------------------------------------------------------------------

export interface DraftContext {
  rules: { all: LearnedRule[]; factory: LearnedRule[] };
  examples: any[];
  ruleIds: string[];
}

export async function getDraftContext(
  factoryProductId: string | null,
  factoryName: string | null,
  limit = 5,
): Promise<DraftContext> {
  // Get all active rules (all-factory scope)
  const allRules = await dbFind("learnedRules", (r: any) =>
    r.status === "active" && r.scope === "all",
  );

  // Get factory-specific rules
  let factoryRules: any[] = [];
  if (factoryProductId) {
    factoryRules = await dbFind("learnedRules", (r: any) =>
      r.status === "active" &&
      r.scope === "factory" &&
      (r.factoryId === factoryProductId || r.factoryName === factoryName),
    );
  }

  // Get up to `limit` past examples, preferring same factory first, then same step.
  const allExamples = await dbFind("draftExamples", () => true);
  const sortedExamples = allExamples
    .sort((a: any, b: any) => {
      const aFactory = a.factoryProductId === factoryProductId ? 0 : 1;
      const bFactory = b.factoryProductId === factoryProductId ? 0 : 1;
      if (aFactory !== bFactory) return aFactory - bFactory;
      return (b.createdAt || 0) - (a.createdAt || 0);
    })
    .slice(0, limit);

  return {
    rules: {
      all: allRules as LearnedRule[],
      factory: factoryRules as LearnedRule[],
    },
    examples: sortedExamples,
    ruleIds: [...allRules.map((r: any) => r.id), ...factoryRules.map((r: any) => r.id)],
  };
}

// Save a draft example for future drafts to learn from.
export async function saveDraftExample(
  draftId: string,
  factoryProductId: string | null,
  factoryName: string | null,
  incomingMessage: string,
  finalText: string,
  action: "approved" | "suggested",
  step: number | null,
): Promise<void> {
  await dbInsert("draftExamples", {
    draftId,
    factoryProductId,
    factoryName,
    incomingMessage: String(incomingMessage || "").slice(0, 1000),
    finalText: String(finalText || "").slice(0, 2000),
    action,
    step,
  });
}

// Increment usage count on rules used for a draft.
export async function incrementRuleUsage(ruleIds: string[]): Promise<void> {
  for (const id of ruleIds) {
    const rule = (await dbById("learnedRules", id)) as any;
    if (rule) {
      await dbUpdate("learnedRules", id, {
        usageCount: (rule.usageCount || 0) + 1,
        updatedAt: Date.now(),
      });
    }
  }
}

// Get the approval percentage stat for the "What Donna learned" page.
export async function getApprovalStats(): Promise<{
  thisWeek: number;
  lastWeek: number;
  approvedNoChanges: number;
  totalThisWeek: number;
  totalLastWeek: number;
}> {
  const lessons = await dbFind("lessons", () => true);
  const now = Date.now();
  const weekMs = 7 * 24 * 60 * 60 * 1000;

  const thisWeekLessons = lessons.filter((l: any) => (l.createdAt || 0) > now - weekMs);
  const lastWeekLessons = lessons.filter((l: any) => {
    const t = l.createdAt || 0;
    return t > now - 2 * weekMs && t <= now - weekMs;
  });

  const approvedNoChangesThis = thisWeekLessons.filter((l: any) => l.action === "approved").length;
  const approvedNoChangesLast = lastWeekLessons.filter((l: any) => l.action === "approved").length;

  return {
    thisWeek: thisWeekLessons.length > 0 ? Math.round((approvedNoChangesThis / thisWeekLessons.length) * 100) : 0,
    lastWeek: lastWeekLessons.length > 0 ? Math.round((approvedNoChangesLast / lastWeekLessons.length) * 100) : 0,
    approvedNoChanges: approvedNoChangesThis,
    totalThisWeek: thisWeekLessons.length,
    totalLastWeek: lastWeekLessons.length,
  };
}
