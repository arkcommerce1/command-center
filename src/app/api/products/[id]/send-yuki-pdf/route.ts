import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { getProduct } from "@/lib/cc/store";
import { logActivity } from "@/lib/cc/store";
import { generateSpecPdf } from "@/lib/cc/spec-pdf-generator";

const YUKI_JID = process.env.YUKI_TEST_JID || "8618069936600@s.whatsapp.net";
const BRIDGE_URL = process.env.WA_BRIDGE_URL || "http://127.0.0.1:3001";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const includeOrderQty: boolean = body.includeOrderQty === true;
  const message: string = body.message || "";

  const p = await getProduct(id);
  if (!p) return NextResponse.json({ error: "product not found" }, { status: 404 });

  const specVersion: number = (p as any).specVersion || 0;
  if (!specVersion || specVersion < 1) {
    return NextResponse.json({ error: "Approve a spec first." }, { status: 400 });
  }

  const masterSku = (p as any).masterSku || "—";

  // Generate the PDF using shared generator
  const pdfBytes = await generateSpecPdf(p, { includeOrderQty });
  const fileName = `spec-${masterSku.replace(/[^a-zA-Z0-9]/g, "-")}.pdf`;
  const filePath = `/tmp/${fileName}-${Date.now()}.pdf`;
  const fs = await import("fs/promises");
  await fs.writeFile(filePath, pdfBytes);

  // Send via WhatsApp bridge: message text + PDF
  try {
    // Send the text message first (if provided)
    if (message.trim()) {
      const textRes = await fetch(`${BRIDGE_URL}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatId: YUKI_JID, message: message.trim() }),
      });
      const textData = await textRes.json();
      if (!textRes.ok || textData.error) {
        await fs.unlink(filePath).catch(() => {});
        return NextResponse.json({ error: textData.error || "WhatsApp text send failed" }, { status: 502 });
      }
    }

    // Send the PDF
    const sendRes = await fetch(`${BRIDGE_URL}/send-media`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chatId: YUKI_JID,
        filePath,
        mediaType: "document",
        caption: `Spec sheet for ${p.name} (Master SKU: ${masterSku})`,
        fileName: `spec-${masterSku}.pdf`,
      }),
    });
    const sendData = await sendRes.json();
    if (!sendRes.ok || sendData.error) {
      await fs.unlink(filePath).catch(() => {});
      return NextResponse.json({ error: sendData.error || "WhatsApp send failed" }, { status: 502 });
    }

    await logActivity("agent", "yuki_brief_sent", "product", id, null, {
      version: specVersion, includeOrderQty, messageId: sendData.messageId || sendData.id,
      message: message.trim(), pdfFileName: fileName,
    }, false);

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
