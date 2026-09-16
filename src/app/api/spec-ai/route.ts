import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";

// POST /api/spec-ai { name, amazonTitle?, bullets?[], asin?, amazonSnapshot? }
// Uses the Nous Portal (NOUS_API_KEY) for the draft — no Anthropic key, per Haim's instruction.
// Falls back to a deterministic parser if the key is missing or the call fails.
// Returns structured fields per §3.9 spec template in template order:
//   Product name, Dimensions, Material composition, Construction, Features,
//   Compatibility, Packaging, Certificate (only if required).
// Fields the model is unsure about show as value "Needs input".
// Each field includes a tag suggestion: "locked" (default) or "flexible".

// §3.9 template field order — the model must output fields in this exact order.
const TEMPLATE_FIELDS = [
  { label: "Product name", key: "product_name" },
  { label: "Dimensions", key: "dimensions" },
  { label: "Material composition", key: "material_composition" },
  { label: "Construction", key: "construction" },
  { label: "Features", key: "features" },
  { label: "Compatibility", key: "compatibility" },
  { label: "Packaging", key: "packaging" },
  { label: "Certificate", key: "certificate" },
];

const SYSTEM = `You write a factory/supplier-facing product specification sheet — the kind you'd send to a Chinese manufacturer to source or quote a product.

You receive the Amazon listing data (title, bullets, description) and optionally the product name.
You output a JSON object with a "fields" array. Each field has: id, label, value, source, tag.
- "source" is one of: "listing" (from the Amazon listing), "image" (from a product photo), "inferred" (guessed/derived).
- "tag" is one of: "locked" (must not change without explicit approval — the DEFAULT), "flexible" (factory/negotiation may vary it).
- If you are unsure about a field's value, leave it OUT entirely. Do not write "Needs input" — simply skip that field.

Output ALL fields in this exact order:
1. Product name
2. Dimensions
3. Material composition
4. Construction
5. Features
6. Compatibility
7. Packaging
8. Certificate — include this field ONLY if the listing mentions a certification requirement (e.g. ANSI, CE, CPSIA, OEKO-TEX). If none is mentioned, omit it entirely.

Rules:
- No marketing adjectives ("premium", "amazing") — factory specs are functional and terse.
- Never include "Country of origin" — the factory IS the origin; this is nonsensical in a doc sent TO them.
- Never include buyer-side info (our pricing, our SKUs, our branding, Amazon listing details).
- Missing info: leave the field OUT rather than guessing wildly. But if you can reasonably infer from the listing, do so and mark source "inferred".
- Default tag is "locked". Use "flexible" only for fields where factory variation is normally acceptable (e.g. packaging details, color options).
- Return ONLY the JSON object, no prose, no markdown fences.

Example output:
{"fields":[
  {"id":"1","label":"Product name","value":"Replacement Mop Head","source":"listing","tag":"locked"},
  {"id":"2","label":"Dimensions","value":"10 x 8 x 6 cm ; 14.08 ounces","source":"listing","tag":"locked"},
  {"id":"3","label":"Material composition","value":"75% Recycled Cotton 25% Recycled Blend Fiber","source":"listing","tag":"locked"},
  {"id":"4","label":"Construction","value":"4-Ply Twist Yarn, Double stitched tailband","source":"listing","tag":"locked"},
  {"id":"5","label":"Features","value":"Reusable; Machine washable","source":"listing","tag":"locked"},
  {"id":"6","label":"Compatibility","value":"Clamp style handles; Side loading handles; Universal fit headband","source":"listing","tag":"flexible"},
  {"id":"7","label":"Packaging","value":"Needs input","source":"inferred","tag":"locked"}
]}`;

export async function POST(req: NextRequest) {
  const b = await req.json();
  const lines: string[] = Array.isArray(b.bullets) ? b.bullets.map(String) : [];
  const key = process.env.NOUS_API_KEY;

  // Build the Amazon context from the snapshot or the passed-in fields.
  const snapshot = b.amazonSnapshot;
  const amazonContext = snapshot
    ? `Amazon title: ${snapshot.title || b.amazonTitle || ""}\nAmazon bullets:\n${(snapshot.bullets || []).map((l: string) => `- ${l}`).join("\n")}\nAmazon description:\n${(snapshot.description || "").slice(0, 2000)}\nImage URLs: ${(snapshot.imageUrls || []).join(", ")}`
    : `Amazon title: ${b.amazonTitle || ""}\nAmazon bullets:\n${lines.map((l) => `- ${l}`).join("\n")}`;

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
          messages: [
            { role: "system", content: SYSTEM },
            {
              role: "user",
              content: `Product name: ${b.name || ""}${b.asin ? `\n(ASIN ${b.asin} — for reference only, do NOT include ASIN in the spec output)` : ""}\n\n${amazonContext}`,
            },
          ],
        }),
        signal: AbortSignal.timeout(45000),
      });
      const j = await r.json();
      const text = j.choices?.[0]?.message?.content?.trim();
      if (text) {
        const fields = parseFields(text);
        if (fields && fields.length > 0) {
          return NextResponse.json({ fields, ai: true });
        }
        console.error("spec-ai: failed to parse structured fields from response:", text.slice(0, 500));
      }
      console.error("spec-ai nous non-text response, status", r.status, JSON.stringify(j).slice(0, 500));
    } catch (e: any) {
      console.error("spec-ai call failed:", e?.message || e);
      /* fall through to parser */
    }
  } else {
    console.error("spec-ai: NOUS_API_KEY not set in this env");
  }
  return NextResponse.json({ fields: heuristicFields(b.name || "", lines), ai: false });
}

/** Parse the model's JSON response into SpecField[] in template order. */
function parseFields(text: string): SpecFieldOut[] | null {
  try {
    const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
    const parsed = JSON.parse(cleaned);
    const raw: any[] = Array.isArray(parsed.fields) ? parsed.fields : Array.isArray(parsed) ? parsed : [];
    return raw.map((f: any, i: number) => ({
      id: String(f.id || `f${i + 1}`),
      label: String(f.label || "").slice(0, 200),
      value: String(f.value || "Needs input").slice(0, 2000),
      source: f.source === "image" || f.source === "listing" ? f.source : "inferred",
      tag: f.tag === "flexible" || f.tag === "open" ? f.tag : "locked",
    }));
  } catch {
    return null;
  }
}

interface SpecFieldOut {
  id: string;
  label: string;
  value: string;
  source: "listing" | "image" | "inferred";
  tag: "locked" | "flexible" | "open";
}

/** Deterministic fallback: extract what we can from the name + bullets in template order. */
function heuristicFields(name: string, lines: string[]): SpecFieldOut[] {
  // Drop Amazon return/shipping boilerplate.
  const junk = /go to your orders|select your preferred|drop off and leave|return policy|free shipping option/i;
  const clean = lines.filter((l) => !junk.test(l));
  const src = `${name} ${clean.join(" ")}`;
  const fields: SpecFieldOut[] = [];

  // 1. Product name
  fields.push({ id: "f1", label: "Product name", value: name || "Needs input", source: name ? "listing" : "inferred", tag: "locked" });

  // 2. Dimensions
  const dim = src.match(/(\d+(?:\.\d+)?)\s?(inch|in|"|cm|mm|x\s?\d+)/i);
  const weight = src.match(/(\d+(?:\.\d+)?)\s?(oz|ounce|g|gram|kg|lb|pound)\b/i);
  let dimVal = "Needs input";
  let dimSource: SpecFieldOut["source"] = "inferred";
  if (dim) { dimVal = dim[0]; dimSource = "listing"; }
  if (weight) { dimVal = `${dimVal === "Needs input" ? "" : dimVal + " ; "}${weight[0]}`; dimSource = "listing"; }
  fields.push({ id: "f2", label: "Dimensions", value: dimVal, source: dimSource, tag: "locked" });

  // 3. Material composition
  const mats: string[] = [];
  for (const [re, label] of [
    [/cotton/i, "Cotton"], [/polyester/i, "Polyester"], [/silica/i, "Silica gel"],
    [/tyvek/i, "Tyvek"], [/non[ -]?woven/i, "Non-woven"], [/silicone/i, "Silicone"],
    [/plastic/i, "Plastic"], [/steel|metal/i, "Metal"], [/paper/i, "Paper"],
    [/nylon/i, "Nylon"], [/\bPU\b|polyurethane/i, "PU"], [/\bfoam\b/i, "Foam"],
    [/(\d+)\s*%\s*(\w+)/, "$1% $2"],
  ] as const) {
    const m = src.match(re);
    if (m) mats.push(m[0]);
  }
  fields.push({
    id: "f3",
    label: "Material composition",
    value: mats.length ? [...new Set(mats)].join(", ") : "Needs input",
    source: mats.length ? "listing" : "inferred",
    tag: "locked",
  });

  // 4. Construction
  const constr = clean.find((l) => /stitch|seam|ply|twist|woven|knit|construct/i.test(l));
  fields.push({ id: "f4", label: "Construction", value: constr || "Needs input", source: constr ? "listing" : "inferred", tag: "locked" });

  // 5. Features
  const feats = clean.filter((l) => /reusable|washable|waterproof|adjustable|ergonomic|durable|lightweight/i.test(l));
  fields.push({
    id: "f5",
    label: "Features",
    value: feats.length ? feats.slice(0, 4).join("; ") : "Needs input",
    source: feats.length ? "listing" : "inferred",
    tag: "locked",
  });

  // 6. Compatibility
  const compat = clean.find((l) => /compatib|fits|universal|clamp|side load/i.test(l));
  fields.push({ id: "f6", label: "Compatibility", value: compat || "Needs input", source: compat ? "listing" : "inferred", tag: "flexible" });

  // 7. Packaging
  const pk = src.match(/(\d+)\s?(-|x)?\s?(pack|count|pcs|pieces)\b/i);
  fields.push({ id: "f7", label: "Packaging", value: pk ? pk[0] : "Needs input", source: pk ? "listing" : "inferred", tag: "flexible" });

  // 8. Certificate — only if mentioned
  const cert = src.match(/ANSI|CE\b|CPSIA|OEKO-TEX|ISO\s?\d|FDA\b|UL\b|RoHS|REACH/i);
  if (cert) {
    fields.push({ id: "f8", label: "Certificate", value: cert[0], source: "listing", tag: "locked" });
  }

  return fields;
}
