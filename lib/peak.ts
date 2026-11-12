import type { Trade } from './ledger';

export const HOUR = 3600;
export const DAY = HOUR * 24;
export type Candle = { unixTime: number; c: number; vUsd: number; address: string };

export function postSalePeak(trade: Trade, candles: Candle[], now: number) {
  if (trade.sellTime == null || trade.sellUsd == null || trade.sellUsd <= 0 || trade.quantity <= 0) return null;
  const cutoff = Math.min(now, trade.sellTime + 30 * DAY);
  const eligible = new Map<number, Candle>();
  for (const candle of candles) {
    if (candle.address !== trade.mint || !Number.isSafeInteger(candle.unixTime)
      || candle.unixTime % HOUR !== 0 || candle.unixTime <= trade.sellTime || candle.unixTime + HOUR > cutoff
      || !Number.isFinite(candle.c) || candle.c <= 0 || !Number.isFinite(candle.vUsd)
      || candle.vUsd < Math.max(1000, trade.quantity * candle.c * 10)) continue;
    eligible.set(candle.unixTime, candle);
  }
  let peak: Candle | undefined;
  for (const candle of eligible.values()) {
    // An adjacent, independently traded hour must support at least half of the candidate price.
    const previous = eligible.get(candle.unixTime - HOUR);
    const next = eligible.get(candle.unixTime + HOUR);
    if (Math.max(previous?.c ?? 0, next?.c ?? 0) < candle.c / 2) continue;
    if (!peak || candle.c > peak.c || (candle.c === peak.c && candle.unixTime < peak.unixTime)) peak = candle;
  }
  if (!peak) return null;
  const hypothetical = trade.quantity * peak.c;
  return {
    peakPriceAfterSell: peak.c, peakTime: peak.unixTime + HOUR,
    postSellMultiple: hypothetical / trade.sellUsd,
    missedUpsideUsd: Math.max(0, hypothetical - trade.sellUsd),
  };
}
