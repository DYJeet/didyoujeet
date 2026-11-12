import { NextResponse } from 'next/server';
import bs58 from 'bs58';
import { ed25519 } from '@noble/curves/ed25519.js';
import { scanWallet, type Progress, type ScanResult } from '../../../lib/scan';

export const maxDuration = 60;
const cache = new Map<string, { result: ScanResult; expires: number }>();
const active = new Map<string, { promise: Promise<ScanResult>; listeners: Set<(progress: Progress) => void> }>();
const scanStarts: number[] = [];
const providerError = 'Wallet history is temporarily unavailable. Try again shortly.';

export async function POST(request: Request) {
  let address: string;
  try {
    const body = await request.json();
    if (typeof body?.address !== 'string') throw new Error();
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
  const cached = cache.get(address);
  let job = active.get(address);
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
    const promise = scanWallet(address, url, progress => listeners.forEach(listener => listener(progress)))
      .then(result => {
        if (cache.size >= 32) cache.delete(cache.keys().next().value!);
        cache.set(address, { result, expires: Date.now() + (result.complete ? 60_000 : 10_000) });
        return result;
      }).finally(() => active.delete(address));
    job = { promise, listeners };
    active.set(address, job);
  }
  const result = job?.promise ?? Promise.resolve(cached!.result);
  if (!request.headers.get('accept')?.includes('application/x-ndjson')) {
    try {
      return NextResponse.json(await result, { headers: { 'Cache-Control': 'no-store' } });
    } catch {
      return NextResponse.json({ error: providerError }, { status: 503 });
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
      };
      void result.then(value => send({ result: value }), () => send({ error: providerError })).finally(() => {
        if (!closed) controller.close();
        unsubscribe?.();
      });
    },
    cancel() { unsubscribe?.(); },
  }), { headers: { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store, no-transform' } });
}
