import { checkGuardrail } from "@/lib/cc/guardrail";

export interface DrafterMsg {
  text: string;
  lang?: string;
}
export interface DrafterCtx {
  step1Done: boolean;
  step2Done: boolean;
  step3Done: boolean;
  step4Done: boolean;
  specAnswers: string[];
  openChanges: number;
  approach: string;
}
export type DrafterAction = "none" | "draft" | "question" | "fee";
export interface DrafterResult {
  action: DrafterAction;
  draftBubbles?: string[];
  attachPdf?: boolean;
  questionKind?: string;
  note?: string;
}

const ACK = /^(ok|okay|noted|received|thanks|thank you|got it|please wait|one moment|稍等|收到|好的)\W*$/i;
const EMOJI_ONLY = /^[\p{Emoji}\p{So}\s👍👎🙏👌🤝]+$/u;
const GREETING = /^(hi|hello|hey|good morning|good afternoon|good evening|dear)\b[\s,!.\u4e00-\u9fff]*$/i;
const THANKS_LEAD = /^(thanks|thank you)\b/i;
const CN_GREET = /^[你好您好早安晚安]+[啊吗吧呢!！\s.,]*$/;
const TRACKING = /\b(1Z[0-9A-Z]{12,}|SF\d{10,}|\d{12,}|[A-Z]{2}\d{9}[A-Z]{2}|YT\d{10,}|YTN\d+)\b/i;
const FEE = /\bsample\s+(fee|charge|cost)|fee\s+for\s+the?\s*sample|sample.{0,20}\$\s?\d|\$\s?\d.{0,20}sample/i;
const QUOTE = /\$\s?\d|USD|RMB|CNY|¥\s?\d|\bprice\b|\bquote\b|\bquotation\b|FOB|EXW|CIF|DDP/i;
const MOQ_PAY =
  /\bMOQ\b|minimum order|payment|T\/T|L\/C|deposit|wire transfer|invoice|paypal|alipay|volume|per month|per year/i;
const CAN_MAKE =
  /we can make|yes.{0,20}can (make|do|produce)|we (make|produce|manufacture)|no problem.{0,20}(make|produce)|can be (made|produced|done)/i;
const SPEC_CONFIRM =
  /confirm.{0,20}spec|spec.{0,20}(confirmed|ok|okay|correct|no problem|looks good)|agree.{0,20}spec|we will follow.{0,20}spec|make.{0,20}to spec/i;
const SAMPLE_COMMIT =
  /will send.{0,20}sample|send.{0,20}sample.{0,20}(tomorrow|soon|this week|next week)|sample.{0,20}(on the way|shipped|ready)|samples ready/i;
const CHANGE_LOCKED = /change|instead of|propose|different|replace/i;
const FLEX_WORDS = /carton|packing|packaging|color shade|label|bag/i;

function englishOnly(bubbles: string[]): boolean {
  // The Yiwu delivery address is Chinese by necessity (SPEC seeds it in
  // Chinese and factories need it verbatim) — exempt it, nothing else.
  return bubbles.every((b) => !/[\u4e00-\u9fff]/.test(b.replace(/浙江义乌[\s\S]*?15067460724/g, "")));
}

export function decideAction(msg: DrafterMsg, ctx: DrafterCtx): DrafterResult {
  const t = (msg.text || "").trim();
  if (!t || ACK.test(t) || EMOJI_ONLY.test(t) || GREETING.test(t) || CN_GREET.test(t)) {
    return { action: "none", note: "ack-or-greeting" };
  }
  const finish = (r: DrafterResult): DrafterResult => {
    if (r.action === "draft" && r.draftBubbles) {
      if (!englishOnly(r.draftBubbles)) {
        return { action: "question", questionKind: "spec_gap", note: "non-english-draft-refused" };
      }
      for (const b of r.draftBubbles) {
        if (checkGuardrail(b).blocked) {
          return { action: "question", questionKind: "guardrail_block", note: "draft-blocked" };
        }
        // P6: no FORMAL sample request (address, checklist, tracking demand)
        // before step 3. Steering-to-sample language is allowed per §3.8.
        if (!ctx.step3Done && /义乌|checklist|sample request|tracking number/i.test(b)) {
          return { action: "question", questionKind: "spec_gap", note: "pre-step3-sample-refused" };
        }
      }
    }
    return r;
  };

  if (FEE.test(t)) return { action: "fee", note: "sample-fee" };
  if (QUOTE.test(t)) {
    return finish({
      action: "draft",
      draftBubbles: [
        "Thanks for sharing this.",
        "What matters most to us right now is quality — could you send samples so we can review them against the spec?",
      ],
      note: "record-quote",
    });
  }
  if (MOQ_PAY.test(t)) return { action: "question", questionKind: "negotiation", note: "moq-payment-volume" };

  const m = TRACKING.exec(t);
  if (m) {
    return finish({
      action: "draft",
      draftBubbles: ["Great, thanks for sending this over.", "We will watch for it and confirm once it arrives."],
      note: `tracking:${m[1]}`,
    });
  }
  if (SAMPLE_COMMIT.test(t)) {
    return finish({
      action: "draft",
      draftBubbles: ["Thanks for confirming.", "Please share the tracking number once it ships so we can follow it."],
      note: "step4-sample-tracking-item",
    });
  }
  if (SPEC_CONFIRM.test(t) && ctx.openChanges === 0) {
    if (!ctx.step3Done) return { action: "question", questionKind: "spec_gap", note: "step3-proof-needs-check" };
    return finish({
      action: "draft",
      draftBubbles: [
        "Great — glad the spec works.",
        "Please send the sample to 浙江义乌稠城街道丹溪北路18号雪峰银座9楼912室 丁小姐 15067460724. Our box to New York leaves soon, so sooner is better.",
      ],
      note: "step3-sample-request",
    });
  }
  if (CAN_MAKE.test(t)) {
    return finish({
      action: "draft",
      draftBubbles:
        ctx.openChanges > 0
          ? [
              "Good to hear you can make it.",
              "There are still a couple of open spec points — can you confirm those match too?",
            ]
          : ["Good to hear you can make it.", "Can you confirm the spec matches exactly as attached?"],
      note: "step2-next",
    });
  }
  if (CHANGE_LOCKED.test(t)) {
    if (FLEX_WORDS.test(t)) {
      return finish({
        action: "draft",
        draftBubbles: ["That works for us — close enough on this one.", "Please include it in the sample."],
        note: "flexible-accepted",
      });
    }
    return finish({
      action: "draft",
      draftBubbles: [
        "Thanks for checking.",
        "We need to keep this one exactly to spec — can you make the sample as specified?",
      ],
      note: "locked-decline",
    });
  }
  if (/\?/.test(t)) {
    const joined = ctx.specAnswers.join("\n").toLowerCase();
    const hit = ctx.specAnswers.find((a) => a && t.toLowerCase().includes(a.split(":")[0].toLowerCase()));
    if (hit && joined) {
      return finish({ action: "draft", draftBubbles: [hit], note: "spec-answer" });
    }
    return { action: "question", questionKind: "spec_gap", note: "spec-unanswered" };
  }
  // Polite acknowledgment carrying no actionable content.
  if (THANKS_LEAD.test(t) && !/\?/.test(t)) {
    return { action: "none", note: "thanks-no-content" };
  }
  // New-group opener fallback.
  return finish({
    action: "draft",
    draftBubbles:
      ctx.approach === "fresh"
        ? [
            "Hi, we are interested in this product.",
            "Can you make it to the attached spec?",
            "If so, please send samples to our China office.",
          ]
        : [
            "Hi, we import and sell this kind of product under AllSett Health, Refreshify, and Everlasting.",
            "We are adding another factory — can you make it to the attached spec?",
            "If so, please send samples to our China office.",
          ],
    attachPdf: true,
    note: "opener",
  });
}
