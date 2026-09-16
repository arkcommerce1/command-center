import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { getProduct } from "@/lib/cc/store";
import { logActivity } from "@/lib/cc/store";

// Yuki's WhatsApp JID — for production sends.
// During testing, set YUKI_TEST_JID env var to redirect to a test target.
const YUKI_JID = process.env.YUKI_TEST_JID || "8618069936600@s.whatsapp.net";
const BRIDGE_URL = process.env.WA_BRIDGE_URL || "http://127.0.0.1:3001";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const includeOrderQty: boolean = body.includeOrderQty === true;

  const p = await getProduct(id);
  if (!p) return NextResponse.json({ error: "product not found" }, { status: 404 });

  // Check for approved spec
  const specVersion: number = (p as any).specVersion || 0;
  if (!specVersion || specVersion < 1) {
    return NextResponse.json({ error: "Approve a spec first." }, { status: 400 });
  }

  // Get the latest approved spec fields
  const specVersions: any[] = (p as any).specVersions || [];
  const latestApproved = specVersions.slice().sort((a: any, b: any) => b.version - a.version)[0];
  const specFields: any[] = latestApproved?.fields || (p as any).specFields || [];
  const masterSku: string = (p as any).masterSku || "—";

  // Build the PDF
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([595, 842]);
  const margin = 50;
  let y = page.getHeight() - margin;

  page.drawText(p.name, { x: margin, y, size: 18, font: bold, color: rgb(0, 0, 0) });
  y -= 28;
  page.drawText(`Master SKU: ${masterSku}`, { x: margin, y, size: 12, font: bold, color: rgb(0.3, 0.3, 0.3) });
  y -= 24;

  const filteredFields = specFields.filter((f: any) => f.value && f.value !== "Needs input");
  for (const f of filteredFields) {
    page.drawText(`${f.label || "—"}: `, { x: margin, y, size: 10, font: bold, color: rgb(0.3, 0.3, 0.3) });
    const labelW = font.widthOfTextAtSize(`${f.label || "—"}: `, 10);
    const valText = (f.value || "").length > 70 ? (f.value || "").slice(0, 67) + "..." : (f.value || "");
    page.drawText(valText, { x: margin + labelW, y, size: 10, font, color: rgb(0.1, 0.1, 0.1) });
    y -= 16;
  }
  y -= 10;

  // SKU table
  if ((p as any).skus && (p as any).skus.length > 0) {
    page.drawText("SKU Breakdown", { x: margin, y, size: 11, font: bold, color: rgb(0.2, 0.2, 0.2) });
    y -= 18;
    for (const r of (p as any).skus) {
      let rowText = `${r.sku || "—"} | ${r.size || "—"} | pack: ${r.pack || "—"}`;
      if (includeOrderQty) {
        rowText += ` | order: ${r.order || "—"} units`;
      }
      page.drawText(rowText, { x: margin, y, size: 10, font, color: rgb(0.1, 0.1, 0.1) });
      y -= 16;
    }
  }

  // Notes
  if (p.spec?.notes) {
    y -= 6;
    page.drawText("Notes", { x: margin, y, size: 11, font: bold, color: rgb(0.2, 0.2, 0.2) });
    y -= 18;
    page.drawText(p.spec.notes.slice(0, 500), { x: margin, y, size: 10, font, color: rgb(0.1, 0.1, 0.1) });
  }

  const pdfBytes = await doc.save();
  const fileName = `spec-${masterSku.replace(/[^a-zA-Z0-9]/g, "-")}-${Date.now()}.pdf`;
  const filePath = `/tmp/${fileName}`;
  const fs = await import("fs/promises");
  await fs.writeFile(filePath, pdfBytes);

  // Send via WhatsApp bridge
  const caption = `Spec sheet for ${p.name} (Master SKU: ${masterSku})${includeOrderQty ? " — includes order quantities" : ""}`;
  try {
    const sendRes = await fetch(`${BRIDGE_URL}/send-media`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chatId: YUKI_JID,
        filePath,
        mediaType: "document",
        caption,
        fileName: `spec-${masterSku}.pdf`,
      }),
    });
    const sendData = await sendRes.json();
    if (!sendRes.ok || sendData.error) {
      await fs.unlink(filePath).catch(() => {});
      return NextResponse.json({ error: sendData.error || "WhatsApp send failed" }, { status: 502 });
    }

    await logActivity("agent", "yuki_brief_sent", "product", id, null, { version: specVersion, includeOrderQty, messageId: sendData.messageId || sendData.id }, false);

    await fs.unlink(filePath).catch(() => {});

    return NextResponse.json({
      success: true,
      messageId: sendData.messageId || sendData.id,
      sentAt: Date.now(),
      version: specVersion,
    });
  } catch (err: any) {
    await fs.unlink(filePath).catch(() => {});
    return NextResponse.json({ error: err?.message || "Failed to send" }, { status: 502 });
  }
}
