// Email via Resend. No key (local dev) -> console log only.
export async function sendEmail(subject: string, html: string) {
  const to = "haim@everlastingicerx.com";
  if (!process.env.RESEND_API_KEY) {
    console.log(`[email:dev] to=${to} subject=${subject}`);
    return { dev: true };
  }
  const { Resend } = await import("resend");
  const resend = new Resend(process.env.RESEND_API_KEY);
  return resend.emails.send({ from: "Command Center <ops@everlastingicerx.com>", to, subject, html });
}

export function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
