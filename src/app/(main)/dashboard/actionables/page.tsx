import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { computeActionables } from "@/lib/cc/engine";
import { listFactories, listProducts } from "@/lib/cc/store";
import { normP } from "@/lib/cc/types";
import { MessagesToApprove } from "./_components/messages-to-approve";

export const dynamic = "force-dynamic";

const KIND_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  quiet: "secondary",
  quote: "destructive",
  reminder: "outline",
  sample: "default",
  yiwu: "default",
  next: "outline",
  stuck: "secondary",
};

export default async function ActionablesPage() {
  const products = (await listProducts()).map(normP);
  const allf = (await Promise.all(products.map((p) => listFactories(p.id)))).flat();
  const acts = computeActionables(products, allf);
  const active = products.filter((p) => p.started);
  const ideas = products.filter((p) => !p.started);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-3xl tracking-tight">Actionables</h2>
        <p className="text-muted-foreground">
          {acts.length ? `${acts.length} thing${acts.length > 1 ? "s" : ""} need you.` : "Nothing needs you. Pipeline is moving."}
        </p>
      </div>

      <MessagesToApprove />

      {acts.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Actionable now</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {acts.map((a, i) => (
              <Link
                key={i}
                href={`/dashboard/products/${a.productId}`}
                className="flex items-center gap-3 rounded-lg border p-3 transition hover:bg-accent"
              >
                <Badge variant={KIND_VARIANT[a.kind] || "outline"}>{a.kind}</Badge>
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{a.factoryName || a.productName}</div>
                  <div className="truncate text-sm text-muted-foreground">{a.text}</div>
                </div>
              </Link>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Pipeline · {active.length}</CardTitle>
          <Button asChild size="sm">
            <Link href="/dashboard/products">All products</Link>
          </Button>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {active.map((p) => (
            <Link
              key={p.id}
              href={`/dashboard/products/${p.id}`}
              className="flex items-center gap-3 rounded-lg border p-3 transition hover:bg-accent"
            >
              {p.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.imageUrl} alt="" className="h-11 w-11 rounded-md border object-cover" />
              ) : (
                <div className="flex h-11 w-11 items-center justify-center rounded-md bg-muted text-muted-foreground">◈</div>
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{p.name}</div>
                {p.asin && <div className="font-mono text-xs text-muted-foreground">{p.asin}</div>}
              </div>
              <Badge variant="secondary">{p.stage}</Badge>
            </Link>
          ))}
          {active.length === 0 && <p className="text-sm text-muted-foreground">No active products.</p>}
        </CardContent>
      </Card>

      {ideas.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Ideas · {ideas.length}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {ideas.map((p) => (
              <div key={p.id} className="flex items-center gap-3 rounded-lg border p-3">
                <Link href={`/dashboard/products/${p.id}`} className="min-w-0 flex-1 truncate font-medium">
                  {p.name}
                </Link>
                <Badge variant="outline">idea</Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
