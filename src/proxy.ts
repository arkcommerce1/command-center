import { NextResponse } from "next/server";

// Login gate disabled for now — all routes open.
// Re-enable with Auth.js when ready (see git history for the auth proxy).
export default function proxy() {
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\\\..*).*)"],
};
