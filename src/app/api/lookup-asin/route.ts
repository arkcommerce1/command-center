import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";

// GET /api/lookup-asin?asin=XXXX — best-effort Amazon title + image.
// Amazon bot-walls datacenter IPs, so this tries a light fetch and falls
// back cleanly; the UI always allows manual title/photo.
export async function GET(req: NextRequest) {
  const asin = (new URL(req.url).searchParams.get("asin") || "").trim().toUpperCase();
  if (!/^[A-Z0-9]{10}$/.test(asin))
    return NextResponse.json({ error: "bad asin" }, { status: 400 });
  try {
    const r = await fetch(`https://www.amazon.com/dp/${asin}`, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: AbortSignal.timeout(12000),
    });
    const html = await r.text();
    const t = html.match(/<span id="productTitle"[^>]*>([^<]+)<\/span>/)?.[1]?.trim()
      || html.match(/<title>([^<]+)<\/title>/)?.[1]?.replace(/Amazon\.com.*$/, "").trim() || "";
    const img = html.match(/"hiRes":"([^"]+)"/)?.[1]
      || html.match(/"large":"([^"]+)"/)?.[1]
      || html.match(/id="landingImage"[^>]*src="([^"]+)"/)?.[1] || "";
    const bullets = [...html.matchAll(/<span class="a-list-item">\s*([^<]{10,400}?)\s*<\/span>/g)]
      .map((m) => m[1].replace(/&#39;|&quot;|&amp;|&lt;|&gt;/g, "").trim())
      .filter((s, i, a) => s && a.indexOf(s) === i).slice(0, 12);
    if (t || img) return NextResponse.json({ asin, title: cleanTitle(t), imageUrl: img, bullets });
  } catch { /* fall through */ }
  return NextResponse.json({ asin, title: "", imageUrl: "", manual: true });
}

function cleanTitle(t: string): string {
  const unesc = t.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
  // Factory-style short title: drop leading ALL-CAPS brand, cut stuffing, drop audience tail.
  const noBrand = unesc.replace(/^[A-Z]{2,}(?:[&'][A-Z]+)?\s+(?=[A-Z0-9])/, "");
  const cut = (noBrand.split(/[,|;]|\s+-\s+/)[0] || noBrand).trim();
  const noAud = cut.replace(/\s+for\s+(men|women|men\s*&\s*women|adults|kids|men \/ women).*$/i, "").trim();
  return noAud.slice(0, 90);
}
