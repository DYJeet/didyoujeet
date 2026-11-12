import { type Transaction, signatureOf } from './ledger.ts';
import type { Candle } from './peak.ts';

class ProviderError extends Error {
  constructor(readonly provider: string, readonly status: number, readonly retryAfter = 0) {
    super('Provider request failed');
  }
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const queues = {
  helius: { next: 0, interval: 125 },
  birdeye: { next: 0, interval: 1100 },
};

async function providerFetch(provider: keyof typeof queues, url: string, init: RequestInit, deadline: number, signal?: AbortSignal) {
  for (let attempt = 0; ; attempt++) {
    signal?.throwIfAborted();
    const queue = queues[provider];
    const now = Date.now();
    const start = Math.max(now, queue.next);
    if (deadline - start < 500) throw new ProviderError(provider, 408);
    queue.next = start + queue.interval;
    if (start > now) await sleep(start - now);
    try {
      const response = await fetch(url, {
        ...init, cache: 'no-store',
        signal: AbortSignal.any([AbortSignal.timeout(Math.max(1, Math.min(5000, deadline - Date.now()))), ...(signal ? [signal] : [])]),
      });
      if (!response.ok) {
        const header = response.headers.get('Retry-After');
        const retryAfter = header ? (/^\d+$/.test(header) ? Number(header) * 1000 : Date.parse(header) - Date.now()) : 0;
        throw new ProviderError(provider, response.status, Number.isFinite(retryAfter) ? retryAfter : 0);
      }
      const body = await response.json();
      if (provider === 'helius' && [-32005, -32429].includes(body?.error?.code)) {
        throw new ProviderError(provider, body.error.code === -32429 ? 429 : 503);
      }
      return body;
    } catch (error) {
      signal?.throwIfAborted();
      const failure = error instanceof ProviderError ? error : new ProviderError(provider, 503);
      const transient = [408, 425, 429, 500, 502, 503, 504].includes(failure.status);
      const delay = Math.max(failure.retryAfter, 350 * 2 ** attempt + Math.random() * 200);
      if (failure.status === 429) queue.next = Math.max(queue.next, Date.now() + Math.min(delay, 60000));
      if (attempt >= 2 || !transient || Date.now() + delay + 500 > deadline) {
        console.warn(JSON.stringify({ event: 'provider_failure', provider, status: failure.status, attempts: attempt + 1 }));
        throw failure;
      }
      await sleep(delay);
    }
  }
}

export async function rpc<T>(url: string, method: string, params: unknown, deadline: number, signal?: AbortSignal): Promise<T> {
  const result = await providerFetch('helius', url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  }, deadline, signal);
  if (result?.error || result?.result == null) {
    console.warn(JSON.stringify({ event: 'rpc_failure', method, code: Number(result?.error?.code) || null }));
    throw new ProviderError('helius', 502);
  }
  return result.result;
}

type Page = { data: Transaction[]; paginationToken?: string | null };
export function newHistory() {
  return {
    transactions: new Map<string, Transaction>(), seenCursors: new Set<string>(),
    cursor: undefined as string | undefined, missing: 0, pages: 0,
    exhausted: false, stalled: false,
  };
}

export async function walkHistory(fetchPage: (cursor?: string) => Promise<Page>, maxPages = 25,
  progress: (count: number) => void = () => {}, state = newHistory(), maxTotalPages = Infinity) {
  let reason: string | null = null;
  for (let page = 0; page < maxPages && state.pages < maxTotalPages && !state.exhausted && !state.stalled; page++) {
    try {
      const response = await fetchPage(state.cursor);
      if (!Array.isArray(response.data) || (response.paginationToken != null && typeof response.paginationToken !== 'string')) {
        throw new Error('Invalid history response');
      }
      state.pages++;
      for (const tx of response.data) {
        const signature = tx && signatureOf(tx);
        if (!signature) state.missing++;
        else if (!state.transactions.has(signature)) state.transactions.set(signature, tx);
      }
      progress(state.transactions.size);
      const next = response.paginationToken;
      if (!next) state.exhausted = true;
      else if (state.seenCursors.has(next)) state.stalled = true;
      else {
        state.seenCursors.add(next);
        state.cursor = next;
      }
    } catch (error) {
      if (!state.pages) throw error;
      reason = 'history provider interrupted the scan';
      break;
    }
  }
  const complete = state.exhausted && !state.missing;
  if (!reason && !complete) {
    reason = state.exhausted ? 'missing records' : state.stalled ? 'repeated provider cursor'
      : state.pages >= maxTotalPages ? 'maximum history budget reached' : 'scan page limit reached';
  }
  return {
    transactions: [...state.transactions.values()], complete, reason,
    canResume: !!state.cursor && !state.exhausted && !state.stalled && state.pages < maxTotalPages,
  };
}

const candleCache = new Map<string, { expires: number; candles: Candle[] }>();
const pendingCandles = new Map<string, Promise<Candle[]>>();

export async function candles(mint: string, from: number, to: number, deadline: number) {
  const apiKey = process.env.BIRDEYE_API_KEY;
  if (!apiKey || from >= to) return [];
  const key = [mint, from, to].join(':');
  const cached = candleCache.get(key);
  if (cached && cached.expires > Date.now()) return cached.candles;
  const pending = pendingCandles.get(key);
  if (pending) return pending;
  const query = new URLSearchParams({
    address: mint, type: '1H', currency: 'usd', mode: 'range', padding: 'false', outlier: 'true', time_from: String(from), time_to: String(to),
  });
  const request = providerFetch('birdeye', 'https://public-api.birdeye.so/defi/v3/ohlcv?' + query, {
    headers: { 'X-API-KEY': apiKey, 'x-chain': 'solana' },
  }, deadline).then(result => {
    if (!result?.success || !Array.isArray(result.data?.items) || result.data.has_more) throw new ProviderError('birdeye', 502);
    const rows: Candle[] = result.data.items.flatMap((row: {
      address?: string; unix_time?: number; c?: number; v_usd?: number; currency?: string; type?: string;
    } | null) => row?.address === mint && row.currency === 'usd' && row.type === '1H'
      && typeof row.unix_time === 'number' && typeof row.c === 'number' && typeof row.v_usd === 'number'
      ? [{ address: mint, unixTime: row.unix_time, c: row.c, vUsd: row.v_usd }] : []);
    if (candleCache.size >= 96) candleCache.delete(candleCache.keys().next().value!);
    candleCache.set(key, { expires: Date.now() + 15 * 60000, candles: rows });
    return rows;
  }).finally(() => pendingCandles.delete(key));
  pendingCandles.set(key, request);
  return request;
}

export async function mapTwo<T>(items: T[], fn: (item: T) => Promise<void>, signal?: AbortSignal) {
  let index = 0;
  async function worker() {
    while (index < items.length) {
      signal?.throwIfAborted();
      await fn(items[index++]);
    }
  }
  await Promise.all([worker(), worker()]);
}
