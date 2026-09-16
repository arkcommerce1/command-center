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
    const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!r.ok) return null;
    const buf = new Uint8Array(await r.arrayBuffer());
    const ct = r.headers.get("content-type") || "";
    if (ct.includes("png") || url.toLowerCase().endsWith(".png")) return { bytes: buf, kind: "png" };
    if (ct.includes("webp")) {
      // WebP not supported by pdf-lib — would need conversion
      // For now skip WebP images
      return null;
    }
    return { bytes: buf, kind: "jpg" };
  } catch {
    return null;
  }
}

function wrapText(text: string, font: any, size: number, maxWidth: number): string[] {
  // Handle CJK characters: split on any character that overflows
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

  // Load CJK fonts (fallback to Helvetica if not available)
  let font: any;
  let bold: any;
  const regPath = "/tmp/NotoSansSC-Regular.ttf";
  const boldPath = "/tmp/NotoSansSC-Bold.ttf";

  try {
    if (existsSync(regPath) && existsSync(boldPath)) {
      const regBytes = await readFile(regPath);
      const boldBytes = await readFile(boldPath);
      font = await doc.embedFont(regBytes);
      bold = await doc.embedFont(boldBytes);
    } else {
      font = await doc.embedFont(StandardFonts.Helvetica);
      bold = await doc.embedFont(StandardFonts.HelveticaBold);
    }
  } catch {
    font = await doc.embedFont(StandardFonts.Helvetica);
    bold = await doc.embedFont(StandardFonts.HelveticaBold);
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
  const specVersionNum: number = (product as any).specVersion || 0;
  const notes = product.spec?.notes || "";

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
      // placeholder
      page.drawRectangle({ x: MARGIN, y: y - 80, width: 80, height: 80, borderColor: rgb(0.7, 0.7, 0.7), borderWidth: 1 });
      page.drawText("No image", { x: MARGIN + 10, y: y - 50, size: 9, font, color: rgb(0.6, 0.6, 0.6) });
      imgHeight = 90;
    }
  } else {
    page.drawRectangle({ x: MARGIN, y: y - 80, width: 80, height: 80, borderColor: rgb(0.7, 0.7, 0.7), borderWidth: 1 });
    page.drawText("No image", { x: MARGIN + 10, y: y - 50, size: 9, font, color: rgb(0.6, 0.6, 0.6) });
    imgHeight = 90;
  }

  // Product name (right of image)
  const nameX = MARGIN + 110;
  const nameMaxW = PAGE_W - MARGIN - nameX;
  const nameLines = wrapText(product.name || "Untitled product", bold, 20, nameMaxW);
  for (const line of nameLines.slice(0, 2)) {
    page.drawText(line, { x: nameX, y, size: 20, font: bold, color: rgb(0.05, 0.05, 0.05) });
    y -= 24;
  }
  // Master SKU
  page.drawText(`Master SKU: ${masterSku}`, { x: nameX, y, size: 11, font: bold, color: rgb(0.3, 0.3, 0.3) });
  y -= 16;
  // Version + date
  const approvedDate = latestApproved ? new Date(latestApproved.createdAt).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }) : "—";
  page.drawText(`Spec v${specVersionNum} · approved ${approvedDate}`, { x: nameX, y, size: 9, font, color: rgb(0.5, 0.5, 0.5) });
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
    page.drawText("Specification", { x: MARGIN, y, size: 13, font: bold, color: rgb(0.2, 0.2, 0.2) });
    y -= 18;

    const labelColW = 160;
    const valueColW = CONTENT_W - labelColW;
    const rowH = 18;

    for (const f of specFields) {
      // Check page break
      if (y < MARGIN + rowH + 20) {
        page = doc.addPage([PAGE_W, PAGE_H]);
        pageNum++;
        y = PAGE_H - MARGIN;
        page.drawText("Specification (continued)", { x: MARGIN, y, size: 11, font: bold, color: rgb(0.2, 0.2, 0.2) });
        y -= 20;
      }

      const label = f.label || "—";
      const value = f.value || "—";
      const tag = f.tag || "locked";

      // Label (bold, left column, wraps)
      const labelLines = wrapText(label, bold, 9.5, labelColW - 8);
      const valueLines = wrapText(value, font, 9.5, valueColW - 8);
      const maxLines = Math.max(labelLines.length, valueLines.length);
      const thisRowH = maxLines * 12 + 6;

      // Row background (alternating)
      if (specFields.indexOf(f) % 2 === 0) {
        page.drawRectangle({ x: MARGIN, y: y - thisRowH, width: CONTENT_W, height: thisRowH, color: rgb(0.96, 0.96, 0.96) });
      }

      // Label
      let ly = y - 4;
      for (const ll of labelLines) {
        page.drawText(ll, { x: MARGIN + 4, y: ly, size: 9.5, font: bold, color: rgb(0.25, 0.25, 0.25) });
        ly -= 12;
      }

      // Value
      let vy = y - 4;
      for (const vl of valueLines) {
        page.drawText(vl, { x: MARGIN + labelColW + 4, y: vy, size: 9.5, font, color: rgb(0.1, 0.1, 0.1) });
        vy -= 12;
      }

      // Tag badge (small, right)
      if (tag && tag !== "locked") {
        page.drawText(`[${tag}]`, { x: PAGE_W - MARGIN - 40, y: y - 4, size: 7, font, color: rgb(0.5, 0.5, 0.5) });
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
    // Check page break
    if (y < MARGIN + 60) {
      page = doc.addPage([PAGE_W, PAGE_H]);
      pageNum++;
      y = PAGE_H - MARGIN;
    }

    page.drawText("SKU Breakdown", { x: MARGIN, y, size: 13, font: bold, color: rgb(0.2, 0.2, 0.2) });
    y -= 18;

    const hasOrderCol = includeOrderQty;
    const cols = hasOrderCol
      ? [{ header: "SKU", w: 0.3 }, { header: "Size", w: 0.2 }, { header: "Pack sizes", w: 0.25 }, { header: "Order quantity", w: 0.25 }]
      : [{ header: "SKU", w: 0.35 }, { header: "Size", w: 0.25 }, { header: "Pack sizes", w: 0.4 }];
    const colWs = cols.map((c) => c.w * CONTENT_W);
    const rowH = 20;

    for (let i = 0; i < skus.length; i++) {
      const r = skus[i];

      // Page break: check if we need a new page (but don't cut a row)
      if (y < MARGIN + rowH + 20) {
        // Add footer to current page
        drawFooter(page, pageNum, doc.getPageCount());
        page = doc.addPage([PAGE_W, PAGE_H]);
        pageNum++;
        y = PAGE_H - MARGIN;
        // Repeat table header
        page.drawText("SKU Breakdown (continued)", { x: MARGIN, y, size: 11, font: bold, color: rgb(0.2, 0.2, 0.2) });
        y -= 18;
        // Column headers
        drawTableHeader(page, cols, colWs, MARGIN, y, bold, font);
        y -= rowH;
      }

      // First row: draw header
      if (i === 0) {
        drawTableHeader(page, cols, colWs, MARGIN, y, bold, font);
        y -= rowH;
      }

      // Alternating row background
      if (i % 2 === 0) {
        page.drawRectangle({ x: MARGIN, y: y - rowH + 2, width: CONTENT_W, height: rowH - 2, color: rgb(0.96, 0.96, 0.96) });
      }

      // Cell values
      const vals = hasOrderCol
        ? [r.sku || "—", r.size || "—", r.pack || "—", r.order || "—"]
        : [r.sku || "—", r.size || "—", r.pack || "—"];

      vals.forEach((v, ci) => {
        const valLines = wrapText(String(v), font, 9, colWs[ci] - 8);
        let vy2 = y - 14;
        for (const vl of valLines.slice(0, 2)) {
          page.drawText(vl, { x: MARGIN + colWs.slice(0, ci).reduce((a, b) => a + b, 0) + 4, y: vy2, size: 9, font, color: rgb(0.1, 0.1, 0.1) });
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
  if (notes) {
    if (y < MARGIN + 40) {
      page = doc.addPage([PAGE_W, PAGE_H]);
      pageNum++;
      y = PAGE_H - MARGIN;
    }
    page.drawText("Notes", { x: MARGIN, y, size: 13, font: bold, color: rgb(0.2, 0.2, 0.2) });
    y -= 18;
    const noteLines = wrapText(notes, font, 10, CONTENT_W);
    for (const line of noteLines) {
      if (y < MARGIN + 20) {
        drawFooter(page, pageNum, doc.getPageCount());
        page = doc.addPage([PAGE_W, PAGE_H]);
        pageNum++;
        y = PAGE_H - MARGIN;
      }
      page.drawText(line, { x: MARGIN, y, size: 10, font, color: rgb(0.1, 0.1, 0.1) });
      y -= 14;
    }
  }

  // ---- FOOTER on every page ----
  const totalPages = doc.getPageCount();
  for (let i = 0; i < doc.getPageCount(); i++) {
    const pg = doc.getPage(i);
    drawFooterOnPage(pg, i + 1, totalPages, font, masterSku, specVersionNum);
  }

  return await doc.save();
}

function drawTableHeader(page: any, cols: any[], colWs: number[], margin: number, y: number, bold: any, font: any) {
  // Header background
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

function drawFooter(page: any, pageNum: number, totalPages: number) {
  drawFooterOnPage(page, pageNum, totalPages, null, "", 0);
}

function drawFooterOnPage(page: any, pageNum: number, totalPages: number, font: any, sku: string, version: number) {
  if (!font) return;
  const y = 24;
  const text = `Spec v${version} · ${sku} · Page ${pageNum} of ${totalPages}`;
  page.drawText(text, { x: MARGIN, y, size: 7, font, color: rgb(0.6, 0.6, 0.6) });
}
