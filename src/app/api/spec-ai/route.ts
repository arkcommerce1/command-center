import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";

// POST /api/spec-ai { name, amazonTitle?, bullets?[], asin? }
// Uses the Nous Portal (NOUS_API_KEY) for the draft — no Anthropic key, per Haim's instruction.
// Falls back to a deterministic parser if the key is missing or the call fails.
// Returns a DRAFT — the UI previews it and Haim approves/applies/edits.
const FORMAT = `Build a product spec sheet as short key-value lines, like:
Material: <material>
Size: <dimensions>
Feature: <feature, one per line>
Pairs / Pack info, compliance marks, weights — one fact per line.
Keep it terse, no marketing fluff. Drop shipping/return-policy boilerplate entirely — only real product facts.
Missing info: write your best inference prefixed with "~".`;

export async function POST(req: NextRequest) {
  const b = await req.json();
  const lines: string[] = Array.isArray(b.bullets) ? b.bullets.map(String) : [];
  const key = process.env.NOUS_API_KEY;
  if (key) {
    try {
      const r = await fetch("https://inference-api.nousresearch.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          model: "z-ai/glm-5.3-flash",
          max_tokens: 3000,
          reasoning_effort: "low",
          messages: [{
            role: "user",
            content: `${FORMAT}\n\nProduct: ${b.name || ""}${b.asin ? ` (ASIN ${b.asin})` : ""}\nAmazon title: ${b.amazonTitle || ""}\nBullets:\n${lines.map((l) => `- ${l}`).join("\n")}`,
          }],
        }),
        signal: AbortSignal.timeout(45000),
      });
      const j = await r.json();
      const text = j.choices?.[0]?.message?.content?.trim();
      if (text) return NextResponse.json({ draft: text, ai: true });
      console.error("spec-ai nous non-text response, status", r.status, JSON.stringify(j).slice(0, 500));
    } catch (e: any) { console.error("spec-ai call failed:", e?.message || e); /* fall through to parser */ }
  } else {
    console.error("spec-ai: NOUS_API_KEY not set in this env");
  }
  return NextResponse.json({ draft: heuristic(b.name || "", lines), ai: false });
}

function heuristic(name: string, lines: string[]): string {
  // Drop Amazon return/shipping boilerplate before falling back to the parser.
  const junk = /go to your orders|select your preferred|drop off and leave|return policy|free shipping option/i;
  const clean = lines.filter((l) => !junk.test(l));
  const src = `${name} ${clean.join(" ")}`;
  const out: string[] = [];
  const m = src.match(/(\d+(?:\.\d+)?)\s?(g|gram|kg|ml|oz|inch|"|cm|mm)\b/i);
  const pk = src.match(/(\d+)\s?(-|x)?\s?(pack|count|pcs|pieces)\b/i);
  const mats: string[] = [];
  for (const [re, label] of [
    [/silica/i, "Silica gel"], [/tyvek/i, "Tyvek"], [/non[ -]?woven/i, "Non-woven"],
    [/cotton/i, "Cotton"], [/plastic/i, "Plastic"], [/silicone/i, "Silicone"],
    [/steel|metal/i, "Metal"], [/paper/i, "Paper"], [/nylon/i, "Nylon"],
    [/\bPU\b|polyurethane/i, "PU"], [/\bfoam\b/i, "Foam"],
  ] as const) if (re.test(src)) mats.push(label);
  if (mats.length) out.push(`Material: ${[...new Set(mats)].join(", ")}`);
  if (m) out.push(`Size: ${m[0]}`);
  if (pk) out.push(`Pack: ${pk[0]}`);
  for (const l of clean.slice(0, 8)) {
    const kv = l.match(/^([^:]{2,30}):\s*(.{2,120})$/);
    out.push(kv ? `${kv[1].trim()}: ${kv[2].trim()}` : `Feature: ${l.slice(0, 120)}`);
  }
  out.push("~ Verify all lines before sending to Yuki.");
  return out.join("\n");
}
