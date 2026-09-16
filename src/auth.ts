import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

import { isEmailAllowed } from "@/lib/auth-allowlist";

// Auth.js v5. Google credentials and the allowlist come from env only:
// GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, CC_ALLOWED_EMAILS (comma-separated).
// AUTH_SECRET must also be set (Auth.js session signing).
export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    }),
  ],
  pages: {
    signIn: "/login",
    // No custom error page: denied sign-ins land on the standard
    // /api/auth/error?error=AccessDenied page.
  },
  callbacks: {
    async signIn({ user }) {
      return isEmailAllowed(user?.email);
    },
  },
});
