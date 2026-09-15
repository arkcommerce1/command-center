import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { listFactories, listProducts } from "@/lib/cc/store";
import { normF, normP } from "@/lib/cc/types";

export const dynamic = "force-dynamic";

export default async function ContactsPage() {
  const products = (await listProducts()).map(normP);
  const rows: { name: string; role: string; wechat: string; whatsapp: string; email: string; factory: string; factoryId: string; productId: string }[] = [];
  for (const p of products) {
    const facs = (await listFactories(p.id)).map(normF);
    for (const f of facs) {
      for (const pe of (f as any).people || []) {
        rows.push({
          name: pe.name, role: pe.role || "", wechat: pe.wechat || "",
          whatsapp: pe.whatsapp || "", email: pe.email || "",
          factory: f.name, factoryId: f.id, productId: p.id,
        });
      }
    }
  }
  rows.sort((a, b) => a.factory.localeCompare(b.factory) || a.name.localeCompare(b.name));

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-3xl tracking-tight">Contacts</h2>
        <p className="text-muted-foreground">
          Every person Donna talks to, across WeChat, WhatsApp and email — mapped to their factory.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{rows.length} people · {new Set(rows.map((r) => r.factory)).size} factories</CardTitle>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No contacts yet. Open a factory under a product and add people there — name, WeChat, WhatsApp, email.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Factory</TableHead>
                  <TableHead>WeChat</TableHead>
                  <TableHead>WhatsApp</TableHead>
                  <TableHead>Email</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r, i) => (
                  <TableRow key={i}>
                    <TableCell className="font-medium">{r.name}</TableCell>
                    <TableCell className="text-muted-foreground">{r.role || "—"}</TableCell>
                    <TableCell>
                      <Link href={`/dashboard/products/${r.productId}`} className="hover:underline">
                        <Badge variant="outline">{r.factory}</Badge>
                      </Link>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{r.wechat || "—"}</TableCell>
                    <TableCell className="font-mono text-xs">{r.whatsapp || "—"}</TableCell>
                    <TableCell className="text-xs">{r.email || "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
