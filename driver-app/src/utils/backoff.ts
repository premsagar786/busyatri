export function nextDelay(attempt: number, base = 2000, cap = 60000, jitter = 0.3): number {
  const exp = Math.min(cap, base * 2 ** attempt);
  const spread = exp * jitter;
  return Math.round(exp - spread + Math.random() * 2 * spread);
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
