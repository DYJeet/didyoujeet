import { NextResponse } from 'next/server';
import bs58 from 'bs58';
import { ed25519 } from '@noble/curves/ed25519.js';
import { newScanHistory } from '../../../lib/history';
import { scanWallet, type Progress, type ScanResult } from '../../../lib/scan';

export const maxDuration = 60;
const cache = new Map<string, { result: ScanResult; expires: number }>();
const active = new Map<string, {
  promise: Promise<ScanResult>; listeners: Set<(progress: Progress) => void>; controller: AbortController; clients: number;
}>();
const checkpoints = new Map<string, ReturnType<typeof newScanHistory>>();
const maxCachedRecords = 24_000;
function trimCheckpoints() {
  let count = [...checkpoints.values()].reduce((total, state) => total + state.pagination.transactions.size, 0);
  for (const [wallet, state] of checkpoints) {
    if (active.has(wallet)) continue;
    if (state.expires > Date.now() && count <= maxCachedRecords && checkpoints.size <= 8) continue;
    checkpoints.delete(wallet);
    count -= state.pagination.transactions.size;
  }
}
const scanStarts: number[] = [];
const providerError = 'Wallet history is temporarily unavailable. Try again shortly.';

export async function POST(request: Request) {
  let address: string;
  let resume = false;
  try {
    const body = await request.json();
    if (typeof body?.address !== 'string') throw new Error();
    resume = body.resume === true;
    const input = body.address.trim();
    if (input.length < 32 || input.length > 44) throw new Error();
    const bytes = bs58.decode(input);
    if (bytes.length !== 32 || bs58.encode(bytes) !== input) throw new Error();
    ed25519.Point.fromBytes(bytes, true);
    address = input;
  } catch {
    return NextResponse.json({ error: 'Enter a valid Solana wallet address.' }, { status: 400 });
  }

  const url = process.env.HELIUS_RPC_URL;
  if (!url) return NextResponse.json({ error: providerError }, { status: 503 });
  trimCheckpoints();
  const cached = resume ? undefined : cache.get(address);
  let job = active.get(address);
  if (job?.controller.signal.aborted) {
    await job.promise.catch(() => {});
    job = active.get(address);
  }
  if (!job && (!cached || cached.expires <= Date.now())) {
    const now = Date.now();
    while (scanStarts.length && scanStarts[0] <= now - 60_000) scanStarts.shift();
    if (active.size >= 3 || scanStarts.length >= 12) {
      return NextResponse.json({ error: 'Scans are busy. Try again in a few seconds.' }, {
        status: 429, headers: { 'Retry-After': '10' },
      });
    }
    scanStarts.push(now);
    const listeners = new Set<(progress: Progress) => void>();
    const controller = new AbortController();
    const previous = checkpoints.get(address);
    if (resume && (!previous || previous.expires <= now)) {
      scanStarts.pop();
      return NextResponse.json({ error: 'Saved history expired or moved to another server. Start a new scan.' }, { status: 409 });
    }
    const checkpoint = resume && previous ? previous : newScanHistory();
    checkpoint.expires = now + 10 * 60_000;
    checkpoints.delete(address);
    checkpoints.set(address, checkpoint);
    const promise = scanWallet(address, url, progress => listeners.forEach(listener => listener(progress)), checkpoint, controller.signal)
      .then(result => {
        if (cache.size >= 32) cache.delete(cache.keys().next().value!);
        cache.set(address, { result, expires: Date.now() + (result.complete ? 60_000 : 10_000) });
        return result;
      }).finally(() => {
        active.delete(address);
        trimCheckpoints();
      });
    job = { promise, listeners, controller, clients: 0 };
    active.set(address, job);
  }
  const attached = job;
  let released = false;
  if (attached) attached.clients++;
  function release() {
    if (released || !attached) return;
    released = true;
    request.signal.removeEventListener('abort', release);
    if (--attached.clients === 0 && active.get(address) === attached) attached.controller.abort();
  }
  if (attached) {
    request.signal.addEventListener('abort', release, { once: true });
    if (request.signal.aborted) release();
  }
  const result = job?.promise ?? Promise.resolve(cached!.result);
  if (!request.headers.get('accept')?.includes('application/x-ndjson')) {
    try {
      return NextResponse.json(await result, { headers: { 'Cache-Control': 'no-store' } });
    } catch {
      return NextResponse.json({ error: providerError }, { status: 503 });
    } finally {
      release();
    }
  }

  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | undefined;
  return new Response(new ReadableStream({
    start(controller) {
      let closed = false;
      const send = (event: object) => {
        if (!closed) controller.enqueue(encoder.encode(JSON.stringify(event) + '\n'));
      };
      const progress = (value: Progress) => send({ progress: value });
      job?.listeners.add(progress);
      unsubscribe = () => {
        closed = true;
        job?.listeners.delete(progress);
        release();
      };
      void result.then(value => send({ result: value }), () => send({ error: providerError })).finally(() => {
        if (!closed) controller.close();
        unsubscribe?.();
      });
    },
    cancel() { unsubscribe?.(); },
  }), { headers: { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store, no-transform' } });
}
