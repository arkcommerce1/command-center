import { type NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";

import { PDFDocument, rgb, StandardFonts } from "pdf-lib";

import { getProduct } from "@/lib/cc/store";

async function fetchImageBytes(url: string): Promise<{ bytes: Uint8Array; kind: "jpg" | "png" } | null> {
  if (!url) return null;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!r.ok) return null;
    const buf = new Uint8Array(await r.arrayBuffer());
    const ct = r.headers.get("content-type") || "";
    const kind = ct.includes("png") || url.toLowerCase().endsWith(".png") ? "png" : "jpg";
    return { bytes: buf, kind };
  } catch {
    return null;
  }
}

function wrapText(text: string, font: any, size: number, maxWidth: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const test = cur ? `${cur} ${w}` : w;
    if (font.widthOfTextAtSize(test, size) > maxWidth && cur) {
      lines.push(cur);
      cur = w;
    } else cur = test;
  }
  if (cur) lines.push(cur);
  return lines;
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const p = await getProduct(id);
  if (!p) return NextResponse.json({ error: "not found" }, { status: 404 });

  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]); // US Letter
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const margin = 48;
  const width = 612 - margin * 2;
  let y = 792 - margin;

  // Product image (top right, small)
  const img = await fetchImageBytes(p.imageUrl);
  let imgBottom = y;
  if (img) {
    try {
      const embedded = img.kind === "png" ? await doc.embedPng(img.bytes) : await doc.embedJpg(img.bytes);
      const maxDim = 120;
      const scale = Math.min(maxDim / embedded.width, maxDim / embedded.height);
      const w = embedded.width * scale,
        h = embedded.height * scale;
      page.drawImage(embedded, { x: 612 - margin - w, y: y - h, width: w, height: h });
      imgBottom = y - h - 10;
    } catch {
      /* skip broken image */
    }
  }

  // Title (wraps, avoids the image column)
  const titleMaxWidth = img ? width - 140 : width;
  const titleLines = wrapText(p.name || "Untitled product", bold, 18, titleMaxWidth);
  for (const line of titleLines) {
    page.drawText(line, { x: margin, y, size: 18, font: bold, color: rgb(0.1, 0.1, 0.1) });
    y -= 22;
  }
  y = Math.min(y, imgBottom) - 6;

  // Master SKU
  const masterSku = (p as any).masterSku || "";
  page.drawText(`Master SKU: ${masterSku || "—"}`, { x: margin, y, size: 12, font: bold, color: rgb(0.3, 0.3, 0.3) });
  y -= 24;

  // ASIN
  if (p.asin) {
    page.drawText(`ASIN: ${p.asin}`, { x: margin, y, size: 12, font: bold, color: rgb(0.3, 0.3, 0.3) });
    y -= 20;
  }

  function section(title: string) {
    y -= 6;
    page.drawText(title.toUpperCase(), { x: margin, y, size: 11, font: bold, color: rgb(0.55, 0.25, 0.05) });
    y -= 4;
    page.drawLine({
      start: { x: margin, y },
      end: { x: margin + width, y },
      thickness: 0.75,
      color: rgb(0.85, 0.85, 0.85),
    });
    y -= 16;
  }
  function bodyText(text: string, size = 10.5) {
    for (const raw of text.split("\n")) {
      const lines = wrapText(raw, font, size, width);
      for (const line of lines) {
        if (y < margin + 30) {
          y = 792 - margin;
          doc.addPage([612, 792]);
        }
        page.drawText(line, { x: margin, y, size, font, color: rgb(0.15, 0.15, 0.15) });
        y -= size + 4;
      }
      if (!raw) y -= size + 4;
    }
  }

  // Get the latest approved spec version fields
  const specVersions: any[] = (p as any).specVersions || [];
  const approvedVersions = specVersions
    .filter((v: any) => v.version > 0)
    .sort((a: any, b: any) => b.version - a.version);
  const latestApproved = approvedVersions[0];

  // Structured spec fields (from the latest approved version, or current fields if no version)
  const specFields: any[] = latestApproved?.fields || (p as any).specFields || [];
  if (specFields.length > 0) {
    section("Specification fields");
    for (const f of specFields) {
      const label = f.label || "—";
      const value = f.value || "Needs input";
      const tag = f.tag || "locked";
      const lineText = `${label}: ${value}  [${tag}]`;
      bodyText(lineText, 10.5);
      y -= 2;
    }
    y -= 8;
  }

  // Spec notes (the AI-generated / approved factory spec lives here)
  if (p.spec?.notes) {
    section("Specification notes");
    bodyText(p.spec.notes);
  }

  // Child SKUs table
  const skus: any[] = (p as any).skus || [];
  if (skus.length) {
    section("SKU Breakdown");
    const cols = ["SKU", "Size", "Pack", "Order Units"];
    const colW = width / cols.length;
    cols.forEach((c, i) =>
      page.drawText(c, { x: margin + i * colW, y, size: 10, font: bold, color: rgb(0.3, 0.3, 0.3) }),
    );
    y -= 16;
    for (const r of skus) {
      const vals = [r.sku || "—", r.size || "—", r.pack || "—", r.order || "—"];
      vals.forEach((v, i) =>
        page.drawText(String(v), { x: margin + i * colW, y, size: 10, font, color: rgb(0.15, 0.15, 0.15) }),
      );
      y -= 15;
    }
    y -= 8;
  }

  const bytes = await doc.save();
  return new NextResponse(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${(masterSku || p.name || "spec").replace(/[^a-z0-9-_]+/gi, "_")}_spec.pdf"`,
    },
  });
}
