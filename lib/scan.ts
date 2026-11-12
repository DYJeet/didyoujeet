import { account, compactTransaction, readActivity, reconcileOpening, SOL, type Transaction } from './ledger.ts';
import { DAY, HOUR, postSalePeak } from './peak.ts';
import { newScanHistory, snapshotHoldings } from './history.ts';
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
export type Progress = { stage: 'history' | 'accounting' | 'pricing' | 'peaks'; count: number };

export async function scanWallet(address: string, url: string, onProgress: (progress: Progress) => void,
  checkpoint?: ReturnType<typeof newScanHistory>, signal?: AbortSignal) {
  const started = Date.now();
  const now = Math.floor(started / 1000);
  const deadline = started + 45_000;
  const state = checkpoint ?? newScanHistory();
  if (checkpoint && !state.started) {
    state.snapshot = await snapshotHoldings(url, address, started + 4500, signal);
    state.started = true;
  }
  const history = await walkHistory(async cursor => {
    signal?.throwIfAborted();
    const page = await rpc<{ data: Transaction[]; paginationToken?: string | null }>(url, 'getTransactionsForAddress', [
      address,
      {
        transactionDetails: 'full', encoding: 'jsonParsed', sortOrder: 'desc', commitment: 'finalized',
        maxSupportedTransactionVersion: 1, limit: 100,
        filters: { tokenAccounts: 'balanceChanged', status: 'succeeded', ...(state.snapshot ? { slot: { lte: state.snapshot.slot } } : {}) },
        ...(cursor ? { paginationToken: cursor } : {}),
      },
    ], started + 24_000, signal);
    return { ...page, data: Array.isArray(page.data) ? page.data.map(tx => tx ? compactTransaction(tx, address) : tx) : page.data };
  }, 25, count => onProgress({ stage: 'history', count }), state.pagination, 200);
  signal?.throwIfAborted();
  const count = history.transactions.length;
  if (checkpoint) onProgress({ stage: 'accounting', count });
  const ledger = readActivity(history.transactions, address);
  const { activity, skipped, balanceGaps } = ledger;
  const opening = reconcileOpening(ledger, history.complete, state.pagination.missing ? undefined : state.snapshot?.holdings);
  const balanceMismatch = !!state.snapshot && [...ledger.seen.values(), ...state.snapshot.holdings].some(row => !opening.has(row.mint));
  const complete = history.complete && skipped === 0 && balanceGaps === 0 && !balanceMismatch;
  onProgress({ stage: 'pricing', count });
  const market = new Map<string, number>();
  const sales = new Map<string, { mint: string; day: number }>();
  const buys = new Map<string, { mint: string; day: number }>();
  for (const entry of activity.slice().reverse()) {
    if (!entry.swap || entry.time == null) continue;
    const day = Math.floor(entry.time / DAY) * DAY;
    const mints = entry.grossSol !== 0 ? [SOL] : [SOL, ...entry.inputs.map(leg => leg.mint), ...entry.outputs.map(leg => leg.mint)];
    const dates = entry.inputs.length ? sales : buys;
    for (const mint of mints) dates.set(mint + ':' + day, { mint, day });
  }
  // Reserve budget for both historical proceeds and purchases when their dates differ.
  const windows = new Map([...sales].slice(0, 4));
  for (const [key, value] of [...buys].filter(([key]) => !windows.has(key)).slice(0, 4)) windows.set(key, value);
  for (const [key, value] of [...sales, ...buys]) {
    if (windows.size === 8) break;
    windows.set(key, value);
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
  }, signal);

  const { trades, positions, unclassifiedExchanges } = account(activity, complete, (mint, time) =>
    time == null ? null : market.get(mint + ':' + Math.floor(time / HOUR) * HOUR) ?? null, opening);
  const mints = [...new Set([...trades.map(t => t.mint), ...positions.map(p => p.mint)])].slice(0, 100);
  const metadata = mints.length ? rpc<Asset[]>(url, 'getAssetBatch', { ids: mints }, deadline, signal)
    .then(assets => new Map(assets.filter(Boolean).map(asset => [asset.id, assetMetadata(asset)])))
    .catch(() => new Map<string, TokenMetadata>()) : Promise.resolve(new Map<string, TokenMetadata>());

  if (checkpoint) onProgress({ stage: 'peaks', count });
  const peakCoverage = { eligible: 0, checked: 0, withCandles: 0, failed: 0, tooRecent: 0 };
  const peakWindows = new Map<string, { mint: string; from: number; to: number; trades: typeof trades }>();
  for (const trade of trades) {
    const sale = trade.sellTime;
    if (sale == null || trade.sellUsd == null || trade.sellUsd <= 0) continue;
    peakCoverage.eligible++;
    const from = Math.floor(sale / HOUR) * HOUR + HOUR;
    const to = Math.min(currentHour, Math.floor((sale + 30 * DAY) / HOUR) * HOUR);
    if (from + 2 * HOUR > to) {
      peakCoverage.tooRecent++;
      continue;
    }
    const key = trade.mint + ':' + from + ':' + to;
    const window = peakWindows.get(key);
    if (window) window.trades.push(trade);
    else if (peakWindows.size < 8) peakWindows.set(key, { mint: trade.mint, from, to, trades: [trade] });
  }
  await mapTwo([...peakWindows.values()], async window => {
    peakCoverage.checked++;
    try {
      const rows = await candles(window.mint, window.from, window.to, deadline);
      if (rows.length) peakCoverage.withCandles++;
      for (const trade of window.trades) {
        const peak = postSalePeak(trade, rows, now);
        if (peak) Object.assign(trade, peak);
      }
    } catch { peakCoverage.failed++; }
  }, signal);
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
  }, signal);
  const names = await metadata;
  const warnings = [
    !process.env.BIRDEYE_API_KEY && 'Historical USD pricing, unrealized P&L and post-sale comparisons are unavailable.',
    !complete && ('Partial wallet history. ' + (history.reason ?? ((balanceGaps || balanceMismatch) ? 'Token balances could not all be reconciled.' : 'Some transaction balances could not be read.')) + ' Results include only reconciled cost basis and holdings.'),
    unclassifiedExchanges > 0 && (unclassifiedExchanges + ' ambiguous exchange-like transactions were excluded from trade totals.'),
  ].filter((warning): warning is string => Boolean(warning));
  console.info(JSON.stringify({ event: 'wallet_scan', ms: Date.now() - started, scanned: history.transactions.length, exits: trades.length, complete, skipped, balanceGaps, balanceMismatch, snapshotAnchored: !!state.snapshot, unclassifiedExchanges, pages: state.pagination.pages,
    knownBasis: trades.filter(t => t.buySolSpent != null).length, peakCoverage }));
  return {
    address, mode: 'live' as const, scanned: history.transactions.length,
    complete, canResume: history.canResume, peakCoverage, warnings, trades: trades.map(trade => ({ ...trade, ...names.get(trade.mint) })),
    positions: positions.map(position => ({ ...position, ...names.get(position.mint), unrealizedUsd: null as number | null, markTime: null as number | null, ...marked.get(position.mint) })),
  };
}

export type ScanResult = Awaited<ReturnType<typeof scanWallet>>;
