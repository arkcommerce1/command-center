import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { readFile } from "fs/promises";
import { existsSync } from "fs";

export interface SpecPdfOptions {
  includeOrderQty?: boolean;
}

interface Product {
  name: string;
  imageUrl?: string;
  masterSku?: string;
  specVersion?: number;
  specVersions?: any[];
  specFields?: any[];
  skus?: any[];
  spec?: { notes?: string; [k: string]: any };
  [k: string]: any;
}

async function fetchImageBytes(url: string): Promise<{ bytes: Uint8Array; kind: "jpg" | "png" } | null> {
  if (!url) return null;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(15000), redirect: "follow" });
    if (!r.ok) return null;
    const buf = new Uint8Array(await r.arrayBuffer());
    const ct = r.headers.get("content-type") || "";
    if (ct.includes("png") || url.toLowerCase().endsWith(".png")) return { bytes: buf, kind: "png" };
    if (ct.includes("webp")) return null;
    return { bytes: buf, kind: "jpg" };
  } catch {
    try {
      const { execSync } = await import("child_process");
      const tmpPath = `/tmp/spec-img-${Date.now()}.jpg`;
      execSync(`curl -s -m 15 -o ${tmpPath} "${url.replace(/"/g, "")}"`);
      const fs = await import("fs/promises");
      const buf = await fs.readFile(tmpPath);
      await fs.unlink(tmpPath).catch(() => {});
      if (buf.length > 100) return { bytes: new Uint8Array(buf), kind: "jpg" };
      return null;
    } catch {
      return null;
    }
  }
}

// Check if text contains CJK characters
function hasCJK(text: string): boolean {
  return /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff\u{20000}-\u{2a6df}\u{2a700}-\u{2b73f}\u{2b740}-\u{2b81f}\u{2b820}-\u{2ceaf}]/u.test(text);
}

// Pick the right font for the text: CJK font for Chinese, Latin font for everything else
function pickFont(text: string, latinFont: any, cjkFont: any, boldLatin: any, boldCjkFont: any, bold: boolean): any {
  if (hasCJK(text) && cjkFont) return bold ? boldCjkFont : cjkFont;
  return bold ? boldLatin : latinFont;
}

// Wrap text into lines that fit within maxWidth, using the correct font per segment
function wrapText(text: string, font: any, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  let cur = "";
  for (const ch of text) {
    if (ch === "\n") {
      if (cur) lines.push(cur);
      lines.push("");
      cur = "";
      continue;
    }
    const test = cur + ch;
    if (font.widthOfTextAtSize(test, size) > maxWidth && cur) {
      lines.push(cur);
      cur = ch;
    } else {
      cur = test;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

// Page dimensions: A4
const PAGE_W = 595;
const PAGE_H = 842;
const MARGIN = 48;
const CONTENT_W = PAGE_W - MARGIN * 2;

export async function generateSpecPdf(product: Product, options: SpecPdfOptions = {}): Promise<Uint8Array> {
  const { includeOrderQty = false } = options;

  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);

  // Latin fonts (always available — built into pdf-lib)
  const latinFont = await doc.embedFont(StandardFonts.Helvetica);
  const latinBold = await doc.embedFont(StandardFonts.HelveticaBold);

  // CJK fonts (loaded from disk if available)
  let cjkFont: any = null;
  let cjkBold: any = null;
  const regPath = "/tmp/NotoSansSC-Regular.ttf";
  const boldPath = "/tmp/NotoSansSC-Bold.ttf";
  try {
    if (existsSync(regPath) && existsSync(boldPath)) {
      cjkFont = await doc.embedFont(await readFile(regPath));
      cjkBold = await doc.embedFont(await readFile(boldPath));
    }
  } catch {
    // CJK not available — Latin only
  }

  // Helper: draw text using the right font for the content
  function drawText(text: string, opts: { x: number; y: number; size: number; bold?: boolean; color?: any; maxWidth?: number }) {
    const f = pickFont(text, latinFont, cjkFont, latinBold, cjkBold, opts.bold || false);
    const color = opts.color || rgb(0.1, 0.1, 0.1);
    if (opts.maxWidth) {
      const lines = wrapText(text, f, opts.size, opts.maxWidth);
      let ty = opts.y;
      for (const line of lines) {
        // For mixed CJK/Latin lines, still use the CJK font if any CJK present,
        // otherwise Latin. This is per-line since the whole line is one drawText call.
        const lineFont = pickFont(line, latinFont, cjkFont, latinBold, cjkBold, opts.bold || false);
        page.drawText(line, { x: opts.x, y: ty, size: opts.size, font: lineFont, color });
        ty -= opts.size + 2;
      }
    } else {
      page.drawText(text, { x: opts.x, y: opts.y, size: opts.size, font: f, color });
    }
  }

  // Get spec data
  const specVersions: any[] = (product as any).specVersions || [];
  const latestApproved = specVersions
    .filter((v) => v.version > 0)
    .sort((a, b) => b.version - a.version)[0];
  const specFields: any[] = (latestApproved?.fields || (product as any).specFields || [])
    .filter((f: any) => f.value && f.value !== "Needs input");
  const skus: any[] = (product as any).skus || [];
  const masterSku = (product as any).masterSku || "—";

  let page = doc.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN;
  let pageNum = 1;

  // ---- HEADER: image left, name right ----
  let imgHeight = 0;
  const img = await fetchImageBytes(product.imageUrl || "");
  if (img) {
    try {
      const embedded = img.kind === "png" ? await doc.embedPng(img.bytes) : await doc.embedJpg(img.bytes);
      const maxDim = 100;
      const scale = Math.min(maxDim / embedded.width, maxDim / embedded.height);
      const w = embedded.width * scale;
      const h = embedded.height * scale;
      page.drawImage(embedded, { x: MARGIN, y: y - h, width: w, height: h });
      imgHeight = h + 10;
    } catch {
      page.drawRectangle({ x: MARGIN, y: y - 80, width: 80, height: 80, borderColor: rgb(0.7, 0.7, 0.7), borderWidth: 1 });
      drawText("No image", { x: MARGIN + 10, y: y - 50, size: 9, color: rgb(0.6, 0.6, 0.6) });
      imgHeight = 90;
    }
  } else {
    page.drawRectangle({ x: MARGIN, y: y - 80, width: 80, height: 80, borderColor: rgb(0.7, 0.7, 0.7), borderWidth: 1 });
    drawText("No image", { x: MARGIN + 10, y: y - 50, size: 9, color: rgb(0.6, 0.6, 0.6) });
    imgHeight = 90;
  }

  // Product name (right of image) — no version line (Goal 7)
  const nameX = MARGIN + 110;
  const nameMaxW = PAGE_W - MARGIN - nameX;
  const nameLines = wrapText(product.name || "Untitled product", latinBold, 20, nameMaxW);
  for (const line of nameLines.slice(0, 2)) {
    const f = pickFont(line, latinFont, cjkFont, latinBold, cjkBold, true);
    page.drawText(line, { x: nameX, y, size: 20, font: f, color: rgb(0.05, 0.05, 0.05) });
    y -= 24;
  }
  // Master SKU (no version/date line — removed per Goal 7)
  page.drawText(`Master SKU: ${masterSku}`, { x: nameX, y, size: 11, font: latinBold, color: rgb(0.3, 0.3, 0.3) });
  y -= 20;

  // Move y below the image if it's lower
  y = Math.min(y, PAGE_H - MARGIN - imgHeight) - 10;

  // Draw header separator line
  page.drawLine({
    start: { x: MARGIN, y },
    end: { x: PAGE_W - MARGIN, y },
    thickness: 1,
    color: rgb(0.8, 0.8, 0.8),
  });
  y -= 20;

  // ---- SPEC FIELDS: two-column table ----
  if (specFields.length > 0) {
    drawText("Specification", { x: MARGIN, y, size: 13, bold: true, color: rgb(0.2, 0.2, 0.2) });
    y -= 18;

    const labelColW = 160;
    const valueColW = CONTENT_W - labelColW;

    for (const f of specFields) {
      const label = f.label || "—";
      const value = f.value || "—";
      const tag = f.tag || "locked";

      // Use Latin font for width calculations (most fields are English)
      const labelFont = pickFont(label, latinFont, cjkFont, latinBold, cjkBold, true);
      const valueFont = pickFont(value, latinFont, cjkFont, cjkFont, cjkBold, false);
      const labelLines = wrapText(label, labelFont, 9.5, labelColW - 8);
      const valueLines = wrapText(value, valueFont, 9.5, valueColW - 8);
      const maxLines = Math.max(labelLines.length, valueLines.length);
      const thisRowH = maxLines * 12 + 6;

      // Check page break
      if (y < MARGIN + thisRowH + 20) {
        page = doc.addPage([PAGE_W, PAGE_H]);
        pageNum++;
        y = PAGE_H - MARGIN;
        drawText("Specification (continued)", { x: MARGIN, y, size: 11, bold: true, color: rgb(0.2, 0.2, 0.2) });
        y -= 20;
      }

      // Row background (alternating) — drawn BEFORE text, aligned to the row
      if (specFields.indexOf(f) % 2 === 0) {
        page.drawRectangle({ x: MARGIN, y: y - thisRowH, width: CONTENT_W, height: thisRowH, color: rgb(0.96, 0.96, 0.96) });
      }

      // Label (bold, left column)
      let ly = y - 4;
      for (const ll of labelLines) {
        const lf = pickFont(ll, latinFont, cjkFont, latinBold, cjkBold, true);
        page.drawText(ll, { x: MARGIN + 4, y: ly, size: 9.5, font: lf, color: rgb(0.25, 0.25, 0.25) });
        ly -= 12;
      }

      // Value (right column)
      let vy = y - 4;
      for (const vl of valueLines) {
        const vf = pickFont(vl, latinFont, cjkFont, latinBold, cjkBold, false);
        page.drawText(vl, { x: MARGIN + labelColW + 4, y: vy, size: 9.5, font: vf, color: rgb(0.1, 0.1, 0.1) });
        vy -= 12;
      }

      // Tag badge (only for non-locked)
      if (tag && tag !== "locked") {
        page.drawText(`[${tag}]`, { x: PAGE_W - MARGIN - 40, y: y - 4, size: 7, font: latinFont, color: rgb(0.5, 0.5, 0.5) });
      }

      // Row separator
      y -= thisRowH;
      page.drawLine({
        start: { x: MARGIN, y },
        end: { x: PAGE_W - MARGIN, y },
        thickness: 0.5,
        color: rgb(0.9, 0.9, 0.9),
      });
      y -= 4;
    }
    y -= 12;
  }

  // ---- SKU BREAKDOWN: real table ----
  if (skus.length > 0) {
    if (y < MARGIN + 60) {
      page = doc.addPage([PAGE_W, PAGE_H]);
      pageNum++;
      y = PAGE_H - MARGIN;
    }

    drawText("SKU Breakdown", { x: MARGIN, y, size: 13, bold: true, color: rgb(0.2, 0.2, 0.2) });
    y -= 18;

    const hasOrderCol = includeOrderQty;
    const cols = hasOrderCol
      ? [{ header: "SKU", w: 0.3 }, { header: "Size", w: 0.2 }, { header: "Pack sizes", w: 0.25 }, { header: "Order quantity", w: 0.25 }]
      : [{ header: "SKU", w: 0.35 }, { header: "Size", w: 0.25 }, { header: "Pack sizes", w: 0.4 }];
    const colWs = cols.map((c) => c.w * CONTENT_W);
    const rowH = 20;

    for (let i = 0; i < skus.length; i++) {
      const r = skus[i];

      // Page break
      if (y < MARGIN + rowH + 20) {
        page = doc.addPage([PAGE_W, PAGE_H]);
        pageNum++;
        y = PAGE_H - MARGIN;
        drawText("SKU Breakdown (continued)", { x: MARGIN, y, size: 11, bold: true, color: rgb(0.2, 0.2, 0.2) });
        y -= 18;
        drawTableHeader(page, cols, colWs, MARGIN, y, latinBold);
        y -= rowH;
      }

      // First row: draw header
      if (i === 0) {
        drawTableHeader(page, cols, colWs, MARGIN, y, latinBold);
        y -= rowH;
      }

      // Alternating row background — aligned to the row
      if (i % 2 === 0) {
        page.drawRectangle({ x: MARGIN, y: y - rowH, width: CONTENT_W, height: rowH, color: rgb(0.96, 0.96, 0.96) });
      }

      // Cell values
      const vals = hasOrderCol
        ? [r.sku || "—", r.size || "—", r.pack || "—", r.order || "—"]
        : [r.sku || "—", r.size || "—", r.pack || "—"];

      vals.forEach((v, ci) => {
        const valStr = String(v);
        const vf = pickFont(valStr, latinFont, cjkFont, latinBold, cjkBold, false);
        const valLines = wrapText(valStr, vf, 9, colWs[ci] - 8);
        let vy2 = y - 14;
        for (const vl of valLines.slice(0, 2)) {
          const lineFont = pickFont(vl, latinFont, cjkFont, latinBold, cjkBold, false);
          page.drawText(vl, { x: MARGIN + colWs.slice(0, ci).reduce((a, b) => a + b, 0) + 4, y: vy2, size: 9, font: lineFont, color: rgb(0.1, 0.1, 0.1) });
          vy2 -= 11;
        }
      });

      // Row line
      y -= rowH;
      page.drawLine({
        start: { x: MARGIN, y },
        end: { x: PAGE_W - MARGIN, y },
        thickness: 0.5,
        color: rgb(0.88, 0.88, 0.88),
      });
    }
    y -= 16;
  }

  // ---- NOTES ----
  if (product.spec?.notes) {
    const notes = product.spec.notes;
    if (y < MARGIN + 40) {
      page = doc.addPage([PAGE_W, PAGE_H]);
      pageNum++;
      y = PAGE_H - MARGIN;
    }
    drawText("Notes", { x: MARGIN, y, size: 13, bold: true, color: rgb(0.2, 0.2, 0.2) });
    y -= 18;
    const notesFont = pickFont(notes, latinFont, cjkFont, latinBold, cjkBold, false);
    const noteLines = wrapText(notes, notesFont, 10, CONTENT_W);
    for (const line of noteLines) {
      if (y < MARGIN + 20) {
        page = doc.addPage([PAGE_W, PAGE_H]);
        pageNum++;
        y = PAGE_H - MARGIN;
      }
      const lineFont = pickFont(line, latinFont, cjkFont, latinBold, cjkBold, false);
      page.drawText(line, { x: MARGIN, y, size: 10, font: lineFont, color: rgb(0.1, 0.1, 0.1) });
      y -= 14;
    }
  }

  // ---- FOOTER on every page — page number only (Goal 7: no version) ----
  const totalPages = doc.getPageCount();
  for (let i = 0; i < totalPages; i++) {
    const pg = doc.getPage(i);
    pg.drawText(`Page ${i + 1} of ${totalPages}`, { x: MARGIN, y: 24, size: 7, font: latinFont, color: rgb(0.6, 0.6, 0.6) });
  }

  return await doc.save();
}

function drawTableHeader(page: any, cols: any[], colWs: number[], margin: number, y: number, bold: any) {
  page.drawRectangle({ x: margin, y: y - 18, width: colWs.reduce((a, b) => a + b, 0), height: 18, color: rgb(0.9, 0.9, 0.9) });
  cols.forEach((c, i) => {
    const x = margin + colWs.slice(0, i).reduce((a, b) => a + b, 0) + 4;
    page.drawText(c.header, { x, y: y - 13, size: 9, font: bold, color: rgb(0.2, 0.2, 0.2) });
  });
  page.drawLine({
    start: { x: margin, y: y - 18 },
    end: { x: margin + colWs.reduce((a, b) => a + b, 0), y: y - 18 },
    thickness: 0.5, color: rgb(0.7, 0.7, 0.7),
  });
}
