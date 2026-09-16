import type { DiffToken } from "@/lib/cc/decision-bridge";

/** Client-side mirror of decision-bridge.wordDiff (same LCS algorithm). */
export function wordDiffTokens(oldText: string, newText: string): DiffToken[] {
  const split = (s: string) => String(s || "").split(/(\s+)/).filter((w) => w.length > 0);
  const a = split(oldText);
  const b = split(newText);
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out: DiffToken[] = [];
  let i = 0;
  let j = 0;
  const push = (t: DiffToken["t"], text: string) => {
    const last = out[out.length - 1];
    if (last && last.t === t) last.text += text;
    else out.push({ t, text });
  };
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      push("same", a[i]);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      push("del", a[i++]);
    } else {
      push("ins", b[j++]);
    }
  }
  while (i < n) push("del", a[i++]);
  while (j < m) push("ins", b[j++]);
  return out;
}

export function WordDiff({ oldText, newText }: { oldText: string; newText: string }) {
  const tokens = wordDiffTokens(oldText, newText);
  return (
    <span data-testid="word-diff">
      {tokens.map((t, k) =>
        t.t === "same" ? (
          <span key={k}>{t.text}</span>
        ) : t.t === "del" ? (
          <del key={k} data-testid="diff-del" className="rounded bg-red-500/15 text-red-700 no-underline line-through dark:text-red-400">
            {t.text}
          </del>
        ) : (
          <ins key={k} data-testid="diff-ins" className="rounded bg-green-500/15 text-green-700 no-underline dark:text-green-400">
            {t.text}
          </ins>
        ),
      )}
    </span>
  );
}
