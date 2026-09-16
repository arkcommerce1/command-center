"use client";

import { signIn } from "next-auth/react";

export function LoginButton({ next }: { next: string }) {
  return (
    <button
      type="button"
      onClick={() => signIn("google", { callbackUrl: next })}
      className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-primary px-6 font-medium text-primary-foreground text-sm transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      Sign in with Google
    </button>
  );
}
