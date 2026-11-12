import { account, readActivity, SOL, type Transaction } from './ledger.ts';
import { DAY, HOUR, postSalePeak } from './peak.ts';
import { candles, mapTwo, rpc, walkHistory } from './providers.ts';

type TokenMetadata = { name?: string; symbol?: string; image?: string };
type Asset = { id: string; content?: { metadata?: TokenMetadata; links?: { image?: string } } };
function assetMetadata(asset: Asset): TokenMetadata {
  const name = asset.content?.metadata?.name;
  const symbol = asset.content?.metadata?.symbol;
  const image = asset.content?.links?.image;
  return {
    name: typeof name === 'string' ? name.slice(0, 120) : undefined,
    symbol: typeof symbol === 'string' ? symbol.slice(0, 24) : undefined,
    image: typeof image === 'string' && image.startsWith('https://') && image.length < 1000 ? image : undefined,
  };
}
export type Progress = { stage: 'history' | 'pricing'; count: number };

export async function scanWallet(address: string, url: string, onProgress: (progress: Progress) => void) {
  const started = Date.now();
  const now = Math.floor(started / 1000);
  const deadline = started + 45_000;
  const history = await walkHistory(cursor => rpc(url, 'getTransactionsForAddress', [
    address,
    {
      transactionDetails: 'full', encoding: 'jsonParsed', sortOrder: 'desc', commitment: 'finalized',
      maxSupportedTransactionVersion: 1, limit: 100, filters: { tokenAccounts: 'balanceChanged', status: 'succeeded' },
      ...(cursor ? { paginationToken: cursor } : {}),
    },
  ], started + 24_000), 25, count => onProgress({ stage: 'history', count }));
  const { activity, skipped, balanceGaps } = readActivity(history.transactions as Transaction[], address);
  const complete = history.complete && skipped === 0 && balanceGaps === 0;
  onProgress({ stage: 'pricing', count: history.transactions.length });
  const market = new Map<string, number>();
  const windows = new Map<string, { mint: string; day: number }>();
  for (const entry of activity.slice().reverse()) {
    if (!entry.swap || entry.time == null) continue;
    const day = Math.floor(entry.time / DAY) * DAY;
    const mints = entry.grossSol !== 0 ? [SOL] : [SOL, ...entry.inputs.map(leg => leg.mint), ...entry.outputs.map(leg => leg.mint)];
    for (const mint of mints) windows.set(mint + ':' + day, { mint, day });
  }

  const currentHour = Math.floor(now / HOUR) * HOUR;
  await mapTwo([...windows.values()].slice(0, 8), async ({ mint, day }) => {
    try {
      const rows = await candles(mint, day - HOUR, Math.min(day + DAY, currentHour), deadline - 12_000);
      for (const row of rows) {
        if (Number.isSafeInteger(row.unixTime) && row.unixTime % HOUR === 0 && row.unixTime + HOUR <= currentHour
          && row.unixTime >= day - HOUR && row.unixTime < day + DAY && Number.isFinite(row.c) && row.c > 0 && row.vUsd > 0) {
          market.set(mint + ':' + (row.unixTime + HOUR), row.c);
        }
      }
    } catch { /* SOL accounting survives unavailable historical pricing. */ }
  });

  const { trades, positions, unclassifiedExchanges } = account(activity, complete, (mint, time) =>
    time == null ? null : market.get(mint + ':' + Math.floor(time / HOUR) * HOUR) ?? null);
  const mints = [...new Set([...trades.map(t => t.mint), ...positions.map(p => p.mint)])].slice(0, 100);
  const metadata = mints.length ? rpc<Asset[]>(url, 'getAssetBatch', { ids: mints }, deadline)
    .then(assets => new Map(assets.filter(Boolean).map(asset => [asset.id, assetMetadata(asset)])))
    .catch(() => new Map<string, TokenMetadata>()) : Promise.resolve(new Map<string, TokenMetadata>());

  const peakCandidates = trades.filter(t => t.sellTime != null && t.sellUsd != null && t.sellUsd > 0).slice(0, 8);
  await mapTwo(peakCandidates, async trade => {
    const sale = trade.sellTime!;
    const from = Math.floor(sale / HOUR) * HOUR + HOUR;
    const to = Math.min(currentHour, Math.floor((sale + 30 * DAY) / HOUR) * HOUR);
    try {
      const peak = postSalePeak(trade, await candles(trade.mint, from, to, deadline), now);
      if (peak) Object.assign(trade, peak);
    } catch { /* A missing market window cannot produce a trophy. */ }
  });
  const marked = new Map<string, { unrealizedUsd: number; markTime: number }>();
  const markable = positions.filter(p => p.quantity != null && p.quantity > 0 && p.remainingCostUsd != null).slice(0, 3);
  await mapTwo(markable, async position => {
    try {
      const rows = await candles(position.mint, currentHour - HOUR, currentHour, deadline);
      const last = rows.find(row => row.unixTime === currentHour - HOUR && Number.isFinite(row.c) && row.c > 0
        && row.vUsd >= Math.max(1000, row.c * position.quantity! * 10));
      if (last) marked.set(position.mint, {
        unrealizedUsd: last.c * position.quantity! - position.remainingCostUsd!, markTime: currentHour,
      });
    } catch { /* An unavailable or illiquid mark stays unavailable. */ }
  });
  const names = await metadata;
  const warnings = [
    !process.env.BIRDEYE_API_KEY && 'Historical USD pricing, unrealized P&L and post-sale comparisons are unavailable.',
    !complete && ('Partial wallet history. ' + (history.reason ?? (balanceGaps ? 'Token balances contain gaps.' : 'Some transaction balances could not be read.')) + ' Cost basis and holdings are unavailable.'),
    unclassifiedExchanges > 0 && (unclassifiedExchanges + ' ambiguous exchange-like transactions were excluded from trade totals.'),
  ].filter((warning): warning is string => Boolean(warning));
  console.info(JSON.stringify({ event: 'wallet_scan', ms: Date.now() - started, scanned: history.transactions.length, exits: trades.length, complete, skipped, balanceGaps, unclassifiedExchanges }));
  return {
    address, mode: 'live' as const, scanned: history.transactions.length,
    complete, warnings, trades: trades.map(trade => ({ ...trade, ...names.get(trade.mint) })),
    positions: positions.map(position => ({ ...position, ...names.get(position.mint), unrealizedUsd: null as number | null, markTime: null as number | null, ...marked.get(position.mint) })),
  };
}

export type ScanResult = Awaited<ReturnType<typeof scanWallet>>;
