/** Parse the CC_ALLOWED_EMAILS allowlist: comma-separated, case-insensitive. */
export function parseAllowedEmails(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/** True when the sign-in email is on the allowlist. Deny (false) otherwise. */
export function isEmailAllowed(
  email: string | null | undefined,
  raw: string | undefined = process.env.CC_ALLOWED_EMAILS,
): boolean {
  if (!email) {
    return false;
  }
  return parseAllowedEmails(raw).includes(email.toLowerCase());
}
