// AI helpers behind the Actionables "Suggest changes" and "Disapprove"
// buttons. Uses the Nous Portal (NOUS_API_KEY) — the same infra already used
// by /api/spec-ai and /api/spec-ai-edit, per the existing "stay on Nous"
// decision in docs/STACK.md. Falls back to a deterministic rewrite when no
// key is configured or the call fails, so the buttons always do *something*.
//
// Note: CLAUDE.md's "Environment warning" section also mentions
// ANTHROPIC_API_KEY "for drafting". That's ambiguous against the recorded
// Nous decision, so this deliberately does NOT introduce a new paid API
// without asking Haim first — see docs/STACK.md Decisions.
import { stubRewrite } from "@/lib/cc/decision-bridge";

const HARD_RULES = `You are Donna, a sourcing assistant messaging a Chinese factory on WhatsApp on behalf of Haim (Everlasting Ice Rx). Hard rules, never break them:
- English only.
- Never negotiate: no prices, counteroffers, discounts, minimum orders, or payment terms.
- Never state order volumes or quantities.
- Never say a file is attached unless you were told one is attached.
- Never be pushy.
- Keep it short and warm — 1 to 3 short WhatsApp-style lines.
- You may mention our brands: AllSett Health, Refreshify, Everlasting.
Output ONLY the message text, nothing else. Put a blank line between separate WhatsApp bubbles (max 4 bubbles). No prose, no explanation, no quotes around the text.`;

async function callNous(system: string, user: string): Promise<string | null> {
  const key = process.env.NOUS_API_KEY;
  if (!key) return null;
  try {
    const r = await fetch("https://inference-api.nousresearch.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: "z-ai/glm-5.3-flash",
        max_tokens: 400,
        reasoning_effort: "low",
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
      signal: AbortSignal.timeout(30000),
    });
    const j = await r.json();
    const text = j?.choices?.[0]?.message?.content?.trim();
    return text || null;
  } catch (e: any) {
    console.error("reply-ai call failed:", e?.message || e);
    return null;
  }
}

function toBubbles(text: string): string[] {
  return String(text || "")
    .split(/\n\s*\n/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 4);
}

/** "Suggest changes": rewrite the current draft to apply Haim's instruction. */
export async function rewriteReply(currentBubbles: string[], instruction: string): Promise<string[]> {
  const current = currentBubbles.join("\n\n");
  const out = await callNous(
    HARD_RULES,
    `Current draft:\n${current || "(empty — nothing drafted yet)"}\n\nHaim's requested change: ${instruction}\n\nRewrite the draft to apply Haim's change. Keep everything else the same unless the change requires otherwise.`,
  );
  if (out) return toBubbles(out);
  return toBubbles(stubRewrite(current, instruction));
}

/** "Disapprove": write a completely fresh reply, ignoring the old wording. */
export async function freshReply(input: { lastMessageText: string; reason: string | null }): Promise<string[]> {
  const out = await callNous(
    HARD_RULES,
    `The factory's last message: "${input.lastMessageText || ""}"\n${
      input.reason ? `Haim disapproved the previous draft because: ${input.reason}\n` : ""
    }Write a brand-new reply from scratch — don't reuse the old wording.`,
  );
  if (out) return toBubbles(out);
  return ["Thanks for the message — let me check and get back to you shortly."];
}
