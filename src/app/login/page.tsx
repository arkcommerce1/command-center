import { redirect } from "next/navigation";

import { auth } from "@/auth";

import { LoginButton } from "./_components/login-button";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const session = await auth();
  const params = await searchParams;
  const next = params.next ?? "/dashboard/actionables";
  if (session?.user) {
    redirect(next);
  }
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      <div className="flex flex-col items-center gap-2 text-center">
        <h1 className="font-semibold text-2xl tracking-tight">Command Center</h1>
        <p className="text-muted-foreground text-sm">Sign in to continue.</p>
      </div>
      {params.error === "AccessDenied" && (
        <p role="alert" className="text-destructive text-sm">
          That Google account is not on the allowlist. Contact Haim for access.
        </p>
      )}
      <LoginButton next={next} />
    </main>
  );
}
