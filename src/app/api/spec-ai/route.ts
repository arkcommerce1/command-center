import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";

// POST /api/spec-ai { name, amazonTitle?, bullets?[], asin? }
// Claude (Anthropic) builds a spec in Haim's format when ANTHROPIC_API_KEY
// is set; otherwise falls back to the deterministic parser.
// Returns a DRAFT — the UI previews it and Haim approves/applies/edits.
const FORMAT = `Build a product spec sheet as short key-value lines, like:
Material: <material>
Size: <dimensions>
Feature: <feature, one per line>
Pairs / Pack info, compliance marks, weights — one fact per line.
Keep it terse, no marketing fluff. Missing info: write your best inference prefixed with "~".`;

export async function POST(req: NextRequest) {
  const b = await req.json();
  const lines: string[] = Array.isArray(b.bullets) ? b.bullets.map(String) : [];
  const key = process.env.ANTHROPIC_API_KEY;
  if (key) {
    try {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": key,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 600,
          messages: [{
            role: "user",
            content: `${FORMAT}\n\nProduct: ${b.name || ""}${b.asin ? ` (ASIN ${b.asin})` : ""}\nAmazon title: ${b.amazonTitle || ""}\nBullets:\n${lines.map((l) => `- ${l}`).join("\n")}`,
          }],
        }),
        signal: AbortSignal.timeout(45000),
      });
      const j = await r.json();
      const text = j.content?.map((c: any) => c.text || "").join("\n").trim();
      if (text) return NextResponse.json({ draft: text, ai: true });
    } catch { /* fall through to parser */ }
  }
  return NextResponse.json({ draft: heuristic(b.name || "", lines), ai: false });
}

function heuristic(name: string, lines: string[]): string {
  const src = `${name} ${lines.join(" ")}`;
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
  for (const l of lines.slice(0, 8)) {
    const kv = l.match(/^([^:]{2,30}):\s*(.{2,120})$/);
    out.push(kv ? `${kv[1].trim()}: ${kv[2].trim()}` : `Feature: ${l.slice(0, 120)}`);
  }
  out.push("~ Verify all lines before sending to Yuki.");
  return out.join("\n");
}
