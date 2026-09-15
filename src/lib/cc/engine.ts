// FBA math + "Actionable Tonight" engine.
import { Costs, Factory, FNEXT, Product } from "@/lib/cc/types";

export interface FactoryNumbers {
  factoryId: string; factoryName: string; unitPrice: number;
  landed: number; profitUnit: number; marginPct: number; monthlyProfit: number;
  sampleStatus: string; best: boolean;
}

export function numbersFor(c: Costs, factories: Factory[]): FactoryNumbers[] {
  const rows: FactoryNumbers[] = factories
    .filter((f) => f.active && f.quotes.length > 0)
    .map((f) => {
      const q = f.quotes[f.quotes.length - 1];
      const landed = q.unitPrice * (1 + c.dutiesPct / 100) + c.shippingUnit;
      const fees = c.sellPrice * (c.referralFeePct / 100) + c.fbaFee + c.ppcUnit;
      const profitUnit = c.sellPrice - landed - fees;
      const marginPct = c.sellPrice > 0 ? (profitUnit / c.sellPrice) * 100 : 0;
      return {
        factoryId: f.id, factoryName: f.name, unitPrice: q.unitPrice,
        landed, profitUnit, marginPct, monthlyProfit: profitUnit * c.monthlySales,
        sampleStatus: f.sampleStatus, best: false,
      };
    })
    .sort((a, b) => b.profitUnit - a.profitUnit);
  if (rows.length > 0) rows[0].best = true;
  return rows;
}

export interface Actionable {
  kind: string; productId: string; productName: string;
  factoryId: string | null; factoryName: string | null;
  text: string; ts: number;
}

const DAY = 86400000;

export function computeActionables(products: Product[], allFactories: Factory[]): Actionable[] {
  const out: Actionable[] = [];
  const now = Date.now();
  const today = new Date().toISOString().slice(0, 10);
  for (const p of products) {
    if (!p.started || p.stage === "dead" || p.stage === "live") continue;
    if ((p as any).startDate && (p as any).startDate > today) continue;
    const fs = allFactories.filter((f) => f.productId === p.id && f.active);
    for (const f of fs) {
      if (f.lastContactAt && now - f.lastContactAt > 3 * DAY)
        out.push({ kind: "quiet", productId: p.id, productName: p.name, factoryId: f.id, factoryName: f.name, text: `${f.name} quiet ${Math.floor((now - f.lastContactAt) / DAY)}d — send follow up`, ts: f.lastContactAt });
      const next = FNEXT[(f as any).fstage || "intro"];
      if (next && (f as any).fstage === "sample_yiwu")
        out.push({ kind: "yiwu", productId: p.id, productName: p.name, factoryId: f.id, factoryName: f.name, text: `${f.name}: sample in Yiwu — ${next}`, ts: f.updatedAt });
      else if (next && now - f.updatedAt > 2 * DAY)
        out.push({ kind: "next", productId: p.id, productName: p.name, factoryId: f.id, factoryName: f.name, text: `${f.name}: ${next}`, ts: f.updatedAt });
      if (f.sampleStatus === "requested" && f.sampleRequestedAt && !f.sampleShippedAt && now - f.sampleRequestedAt > 3 * DAY)
        out.push({ kind: "sample", productId: p.id, productName: p.name, factoryId: f.id, factoryName: f.name, text: `${f.name} sample requested, not shipped — chase it`, ts: f.sampleRequestedAt });
      if (f.quoteStatus === "waiting_me")
        out.push({ kind: "quote", productId: p.id, productName: p.name, factoryId: f.id, factoryName: f.name, text: `${f.name} quote waiting on YOUR reply`, ts: f.updatedAt });
      for (const r of f.reminders.filter((x) => !x.done && new Date(x.date).getTime() <= now + DAY))
        out.push({ kind: "reminder", productId: p.id, productName: p.name, factoryId: f.id, factoryName: f.name, text: `Reminder: ${r.text}`, ts: new Date(r.date).getTime() });
    }
    if (now - p.stageUpdatedAt > 7 * DAY && p.stage !== "idea")
      out.push({ kind: "stuck", productId: p.id, productName: p.name, factoryId: null, factoryName: null, text: `${p.name} stuck at ${p.stage} 7d+ — push it`, ts: p.stageUpdatedAt });
  }
  return out.sort((a, b) => a.ts - b.ts);
}
