import { NextResponse } from "next/server";

import { auth } from "@/auth";

// Next 16 convention: `src/proxy.ts` (see 16-proxy.md — "Middleware is now
// called Proxy"). Replaces the inert src/proxy.disabled.ts stub.
// Login gate (SPEC §1.1): every page and every non-agent API requires login.
// The Agent API (/api/agent/*, Bearer CC_AGENT_TOKEN) and webhooks
// (/api/webhooks/*) keep their own auth and are never login-gated.
export default auth((req) => {
  const { pathname } = req.nextUrl;
  const loggedIn = Boolean(req.auth);

  if (
    pathname === "/api/agent" ||
    pathname.startsWith("/api/agent/") ||
    pathname.startsWith("/api/auth/") ||
    pathname === "/api/webhooks" ||
    pathname.startsWith("/api/webhooks/")
  ) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    if (!loggedIn) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    return NextResponse.next();
  }

  if (pathname === "/login" || pathname.startsWith("/login/")) {
    return NextResponse.next();
  }

  if (!loggedIn) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
