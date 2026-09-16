import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";

// POST /api/spec-ai-edit { fields: SpecField[], request: string }
// Uses the Nous Portal (NOUS_API_KEY) to propose a diff to the structured spec
// fields based on a free-text change request (e.g. "add OEKO-TEX, make color
// flexible"). Returns a PROPOSAL only — the caller (UI) must show a before/after
// diff and apply it only on the user's explicit Accept click. Never auto-applied.
// No Anthropic key — Nous Portal only, per Haim's instruction.

interface SpecFieldIn {
  id?: string;
  label: string;
  value: string;
  source?: "listing" | "image" | "inferred";
  tag?: "locked" | "flexible" | "open";
}

const SYSTEM = `You edit a structured product sourcing spec made of fields (label, value, source, tag).
tag is one of: locked (must not change without explicit approval), flexible (factory/negotiation may vary it), open (no constraint / factory's choice).
source is one of: listing (from the Amazon listing), image (read off a product photo), inferred (guessed/derived).

You will be given the CURRENT fields as JSON and a natural-language EDIT REQUEST from the product owner.
Return ONLY a JSON object (no prose, no markdown fences) of this exact shape:
{
  "fields": [ { "id": "string (reuse existing id if you're editing that field, or omit/blank for a brand new field)", "label": "string", "value": "string", "source": "listing|image|inferred", "tag": "locked|flexible|open" }, ... ]
}
This "fields" array is the FULL proposed new field list (existing fields you didn't touch should be repeated unchanged; fields the user asked to remove should be omitted; new fields should be appended).
Rules:
- Never invent a tag change the user didn't ask for. If a field isn't mentioned, keep its existing tag.
- New fields you add because the user asked for them should default to tag "locked" unless the user explicitly says otherwise (e.g. "make it flexible").
- Keep values terse and factual, no marketing language.
- If the request is ambiguous, make the most conservative reasonable interpretation (prefer "locked" and preserve existing data).`;

export async function POST(req: NextRequest) {
  const b = await req.json();
  const before: SpecFieldIn[] = Array.isArray(b.fields) ? b.fields : [];
  const editRequest: string = String(b.request || "").slice(0, 2000);
  if (!editRequest.trim()) {
    return NextResponse.json({ error: "empty request" }, { status: 400 });
  }
  const key = process.env.NOUS_API_KEY;
  if (!key) {
    return NextResponse.json({ error: "NOUS_API_KEY not set" }, { status: 500 });
  }
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
        messages: [
          { role: "system", content: SYSTEM },
          {
            role: "user",
            content: `CURRENT FIELDS:\n${JSON.stringify(before, null, 2)}\n\nEDIT REQUEST:\n${editRequest}`,
          },
        ],
      }),
      signal: AbortSignal.timeout(45000),
    });
    const j = await r.json();
    const text = j.choices?.[0]?.message?.content?.trim();
    if (!text) {
      console.error("spec-ai-edit: no text response", r.status, JSON.stringify(j).slice(0, 500));
      return NextResponse.json({ error: "no response from model" }, { status: 502 });
    }
    let parsed: any;
    try {
      const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
      parsed = JSON.parse(cleaned);
    } catch {
      console.error("spec-ai-edit: failed to parse model JSON:", text.slice(0, 500));
      return NextResponse.json({ error: "model returned invalid JSON" }, { status: 502 });
    }
    const rawAfter: any[] = Array.isArray(parsed.fields) ? parsed.fields : [];
    const after = rawAfter.map((f: any) => ({
      id: String(f.id || Math.random().toString(36).slice(2, 10)),
      label: String(f.label || "").slice(0, 200),
      value: String(f.value || "").slice(0, 2000),
      source: f.source === "image" || f.source === "listing" ? f.source : "inferred",
      // Hard safety default: any missing/invalid tag becomes "locked".
      tag: f.tag === "flexible" || f.tag === "open" ? f.tag : "locked",
    }));
    return NextResponse.json({ before, after, ai: true });
  } catch (e: any) {
    console.error("spec-ai-edit call failed:", e?.message || e);
    return NextResponse.json({ error: "AI call failed" }, { status: 502 });
  }
}
