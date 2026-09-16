// Step-proof validation per SPEC §3.3 + §1.3 server guarantee.
// REJECT proofs that are not inbound-from-factory-contact, or that only acknowledge.
// Pure function (no I/O) so it is unit-testable.

const ACK_PHRASES = new Set([
  "ok",
  "okay",
  "okay thanks",
  "noted",
  "noted thanks",
  "received",
  "thanks",
  "thank you",
  "got it",
  "please wait",
  "one moment",
  "好的",
  "收到",
  "稍等",
]);

function stripPunct(s: string): string {
  return s
    .toLowerCase()
    .replace(/[.!…。,，、！？?~\-–—_()\[\]{}'\"“”‘’、\s]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** True when the text is a single emoji / thumbs-up with no other content. */
export function isEmojiOnly(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  // Contains no letters, numbers, or CJK characters -> symbol/emoji only.
  return !/[a-z0-9\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/i.test(t);
}

export interface StepProofInput {
  /** "in" = factory wrote to us, "out" = we wrote. */
  direction: string;
  /** "factory" | "ours" — sender contact type. */
  senderType: string;
  text: string;
}

export function validateStepProof(p: StepProofInput): { ok: true } | { ok: false; reason: string } {
  if (p.direction !== "in") {
    return { ok: false, reason: "proof must be an inbound message (direction=in)" };
  }
  if (p.senderType !== "factory") {
    return { ok: false, reason: "proof must come from a factory contact" };
  }
  const text = (p.text || "").trim();
  if (!text) {
    return { ok: false, reason: "proof message is empty" };
  }
  if (isEmojiOnly(text)) {
    return { ok: false, reason: "proof only acknowledges (emoji/thumbs-up)" };
  }
  if (ACK_PHRASES.has(stripPunct(text))) {
    return { ok: false, reason: "proof only acknowledges" };
  }
  return { ok: true };
}
