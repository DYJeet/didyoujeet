import assert from 'node:assert/strict';
import test from 'node:test';
import { account, readActivity, reconcileOpening, SOL } from '../lib/ledger.ts';
import { DAY, HOUR, postSalePeak } from '../lib/peak.ts';
import { candles, newHistory, walkHistory } from '../lib/providers.ts';
import { newScanHistory, snapshotHoldings } from '../lib/history.ts';
import { scanWallet } from '../lib/scan.ts';

const wallet = 'wallet';
const mint = 'token';
const pump = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
const time = 20_000 * DAY;
const fee = 5000;
const price = token => token === SOL ? 100 : token === 'other' ? 2 : null;
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, actual + ' ≈ ' + expected);
const row = (accountIndex, amount, token = mint) => ({
  accountIndex, owner: wallet, mint: token, uiTokenAmount: { amount: String(amount), decimals: 0 },
});
function tx(slot, before, after, sol, options = {}) {
  const beforeLamports = options.pre ?? [10e9, 2e6, 0];
  const afterLamports = options.post ?? [10e9 + sol * 1e9 - fee, 2e6, 0];
  return {
    slot, blockTime: time + slot * HOUR, transaction: {
      signatures: ['signature-' + slot], message: { accountKeys: [{ pubkey: wallet, signer: true }] },
    },
    meta: {
      err: options.failed ? { error: true } : null, fee, preBalances: beforeLamports, postBalances: afterLamports,
      preTokenBalances: before, postTokenBalances: after,
      logMessages: options.transfer ? [] : ['Program ' + pump + ' invoke [1]', 'Program log: Instruction: ' + (sol > 0 ? 'Sell' : 'Buy')],
    },
  };
}
const ledger = (transactions, complete = true, oracle = price) =>
  account(readActivity(transactions.slice().reverse(), wallet).activity, complete, oracle);

test('empty and failed transactions leave inventory and trades empty', () => {
  const failed = tx(1, [], [row(1, 100)], -1, { failed: true });
  assert.deepEqual(ledger([failed]), { trades: [], positions: [], unclassifiedExchanges: 0 });
});

test('multiple lots and partial exits use FIFO, exact quantities and historical USD', () => {
  const result = ledger([
    tx(1, [row(1, 0)], [row(1, 100)], -1),
    tx(2, [row(1, 100)], [row(1, 150)], -2),
    tx(3, [row(1, 150)], [row(1, 90)], 3),
    tx(4, [row(1, 90)], [row(1, 30)], 4),
  ], true, (token, at) => token === SOL ? 100 + (at - time) / HOUR * 10 : null);
  const [second, first] = result.trades;
  near(first.buySolSpent, 0.6 * 1.000005);
  near(second.buySolSpent, 0.4 * 1.000005 + 0.4 * 2.000005);
  near(first.sellSolReceived, 2.999995);
  near(first.buyUsd, 0.6 * 1.000005 * 110);
  near(first.sellUsd, 2.999995 * 130);
  near(result.positions[0].investedSol, 3.00001);
  assert.equal(result.positions[0].quantity, 30);
});

test('an outgoing transfer consumes basis, and an airdrop never becomes zero-cost trading profit', () => {
  const result = ledger([
    tx(1, [row(1, 0)], [row(1, 30)], -1),
    tx(2, [row(1, 30)], [row(1, 0)], 0, { transfer: true }),
    tx(3, [row(1, 0)], [row(1, 50)], 0, { transfer: true }),
    tx(4, [row(1, 50)], [row(1, 0)], 2),
  ]);
  assert.equal(result.trades.length, 1);
  assert.equal(result.trades[0].solProfit, null);
  assert.equal(result.trades[0].profitUsd, null);
  assert.equal(result.trades[0].quantity, 50);
});

test('wrapped SOL and token-account rent cancel correctly in wallet lamport flows', () => {
  const result = ledger([
    tx(1, [row(2, 1e9, SOL)], [row(1, 10), row(2, 0, SOL)], 0, {
      pre: [8e9, 0, 1.002e9], post: [8e9 - 2e6 - fee, 2e6, 2e6],
    }),
    tx(2, [row(1, 10), row(2, 0, SOL)], [row(1, 0), row(2, 2e9, SOL)], 1, {
      pre: [8e9, 2e6, 2e6], post: [8e9 - fee, 2e6, 2.002e9],
    }),
  ]);
  near(result.trades[0].buySolSpent, 1.000005);
  near(result.trades[0].sellSolReceived, 1.999995);
});

test('token-to-token swaps allocate the network fee once and preserve the outgoing token basis', () => {
  const result = ledger([
    tx(1, [row(1, 0, 'other')], [row(1, 100, 'other')], -1),
    tx(2, [row(1, 100, 'other'), row(2, 0)], [row(1, 0, 'other'), row(2, 50)], 0),
  ]);
  near(result.trades[0].sellUsd, 200);
  near(result.positions.find(p => p.mint === mint).investedUsd, 200.0005);
  near(result.trades[0].buyUsd, 100.0005);
});

test('capped history suppresses cost basis and missing prices preserve known SOL results', () => {
  const rows = [tx(1, [row(1, 0)], [row(1, 100)], -1), tx(2, [row(1, 100)], [row(1, 25)], 3)];
  assert.equal(ledger(rows, false).trades[0].solProfit, null);
  assert.equal(ledger(rows, false).positions[0].quantity, null);
  const result = ledger(rows, true, () => null);
  assert.equal(result.trades[0].profitUsd, null);
  assert.ok(result.trades[0].solProfit > 0);
});

test('same-slot order follows the provider rather than comparing timestamps or signatures', () => {
  const buy = tx(1, [row(1, 0)], [row(1, 10)], -1);
  const sell = tx(2, [row(1, 10)], [row(1, 0)], 2);
  sell.slot = buy.slot;
  sell.blockTime = buy.blockTime;
  assert.ok(ledger([buy, sell]).trades[0].solProfit > 0);
});

test('unknown transfer-shaped activity never receives realized P&L', () => {
  const result = ledger([tx(1, [row(1, 0)], [row(1, 100)], -1, { transfer: true })]);
  assert.equal(result.trades.length, 0);
  assert.equal(result.unclassifiedExchanges, 1);
  assert.equal(result.positions[0].investedSol, null);
});

test('paginates, deduplicates overlapping pages and reports real counts', async () => {
  const progress = [];
  const all = Array.from({ length: 200 }, (_, index) => tx(index, [], [], 0));
  const result = await walkHistory(async cursor => cursor ? { data: all.slice(99) } :
    { data: all.slice(0, 100), paginationToken: 'next' }, 25, count => progress.push(count));
  assert.equal(result.complete, true);
  assert.equal(result.transactions.length, 200);
  assert.deepEqual(progress, [100, 200]);
});

test('repeated cursors, caps, malformed records and provider interruptions are partial', async () => {
  const first = { data: [tx(1, [], [], 0)], paginationToken: 'next' };
  assert.equal((await walkHistory(async () => first, 1)).reason, 'scan page limit reached');
  assert.equal((await walkHistory(async () => first)).reason, 'repeated provider cursor');
  assert.equal((await walkHistory(async () => ({ data: [{}] }))).reason, 'missing records');
  assert.equal((await walkHistory(async cursor => {
    if (cursor) throw new Error();
    return first;
  })).reason, 'history provider interrupted the scan');
  await assert.rejects(walkHistory(async () => { throw new Error('outage'); }), /outage/);
});

test('peak compares the exact exit quantity and historical proceeds, excluding stale, thin and isolated prices', () => {
  const sale = time + 15;
  const trade = { sellTime: sale, sellUsd: 200, quantity: 50, mint };
  const candle = (hour, c, vUsd = 25000, address = mint) => ({ unixTime: time + hour * HOUR, c, vUsd, address });
  const data = [
    candle(0, 9000, 1e9), candle(1, 8), candle(2, 10), candle(3, 9),
    candle(7, 300, 1e9), candle(9, 20, 500), candle(10, 25, 100000, 'wrong'),
    candle(30 * 24 + 1, 900, 1e9),
  ];
  assert.deepEqual(postSalePeak(trade, data, time + 31 * DAY), {
    peakPriceAfterSell: 10, peakTime: time + 3 * HOUR, postSellMultiple: 2.5, missedUpsideUsd: 300,
  });
  assert.equal(postSalePeak({ ...trade, sellUsd: null }, data, time + DAY), null);
});

test('Birdeye V3 schema uses USD volume and candle-open timestamp; repeated reads are cached', async () => {
  const original = globalThis.fetch;
  const previous = process.env.BIRDEYE_API_KEY;
  let requests = 0;
  process.env.BIRDEYE_API_KEY = 'fixture-key';
  globalThis.fetch = async url => {
    requests++;
    assert.match(url, /\/defi\/v3\/ohlcv/);
    return Response.json({ success: true, data: { items: [
      { address: mint, unix_time: time, c: 3, v_usd: 2000, type: '1H', currency: 'usd' },
      { address: 'wrong-mint', unix_time: time, c: 50, v_usd: 2000, type: '1H', currency: 'usd' },
    ] } });
  };
  try {
    const deadline = Date.now() + 4000;
    const expected = [{ address: mint, unixTime: time, c: 3, vUsd: 2000 }];
    assert.deepEqual(await candles(mint, time, time + HOUR, deadline), expected);
    assert.deepEqual(await candles(mint, time, time + HOUR, deadline), expected);
    assert.equal(requests, 1);
  } finally {
    globalThis.fetch = original;
    if (previous == null) delete process.env.BIRDEYE_API_KEY;
    else process.env.BIRDEYE_API_KEY = previous;
  }
});

test('scan uses both history pages and degrades cleanly when metadata and USD pricing are unavailable', async () => {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (_url, request) => {
    const body = JSON.parse(request.body);
    calls.push(body.method);
    if (body.method === 'getAssetBatch') return new Response(null, { status: 403 });
    return Response.json({
      result: body.params[1].paginationToken
        ? { data: [tx(1, [row(1, 0)], [row(1, 100)], -1)] }
        : { data: [tx(2, [row(1, 100)], [row(1, 10)], 3)], paginationToken: 'second' },
    });
  };
  try {
    const events = [];
    const result = await scanWallet(wallet, 'https://fixture.invalid', event => events.push(event));
    assert.equal(result.scanned, 2);
    assert.equal(result.complete, true);
    assert.ok(result.trades[0].solProfit > 0);
    assert.equal(result.trades[0].profitUsd, null);
    assert.equal(result.trades[0].name, undefined);
    assert.deepEqual(calls, ['getTransactionsForAddress', 'getTransactionsForAddress', 'getAssetBatch']);
    assert.deepEqual(events, [{ stage: 'history', count: 1 }, { stage: 'history', count: 2 }, { stage: 'pricing', count: 2 }]);
  } finally {
    globalThis.fetch = original;
  }
});

test('finalized mainnet Pump V3 buy agrees with inner SOL transfer and token balance', async () => {
  const { readFile } = await import('node:fs/promises');
  const raw = JSON.parse(await readFile(new URL('./fixtures/pump-mainnet-buy.json', import.meta.url), 'utf8'));
  const payer = raw.transaction.message.accountKeys[0].pubkey;
  const { activity, skipped, balanceGaps } = readActivity([raw], payer);
  assert.equal(skipped + balanceGaps, 0);
  assert.equal(activity[0].swap, true);
  // Explorer: the Pump instruction transfers 0.6 SOL. Account creation locks 0.00203928 SOL in rent.
  near(activity[0].grossSol, -0.6);
  near(activity[0].fee, 0.001105);
  const { positions } = account(activity, true, () => null);
  assert.equal(positions[0].mint, '499dBXJjcxJ6dSQngRQp8AiHVXjewq4h99htjS9ypump');
  near(positions[0].quantity, 12947362.198806);
  near(positions[0].investedSol, 0.601105);
});

test('a missing opening token balance explicitly makes the ledger incomplete', () => {
  const raw = tx(3, [row(1, 100)], [row(1, 50)], 2);
  raw.transaction.message.accountKeys.push({ pubkey: 'token-account', signer: false });
  assert.equal(readActivity([raw], wallet).balanceGaps, 1);
});

test('a standalone wallet transfer bundled with a swap suppresses the ambiguous swap attribution', () => {
  const raw = tx(3, [], [row(1, 50)], -2);
  raw.transaction.message.instructions = [{ parsed: { type: 'transfer', info: { source: wallet, destination: 'tip' } } }];
  assert.equal(readActivity([raw], wallet).activity[0].swap, false);
});

test('finalized mainnet round trip separates tip, returned rent and network fees, and ignores a failed transaction', async () => {
  const { readFile } = await import('node:fs/promises');
  const [buy, sell, failed] = await Promise.all(['buy', 'sell', 'failed'].map(async kind =>
    JSON.parse(await readFile(new URL('./fixtures/pump-mainnet-' + kind + '.json', import.meta.url), 'utf8'))));
  const payer = buy.transaction.message.accountKeys[0].pubkey;
  const { activity, skipped, balanceGaps } = readActivity([failed, sell, buy], payer);
  assert.equal(skipped + balanceGaps, 0);
  assert.equal(activity.length, 2);
  assert.ok(activity.every(entry => entry.swap));
  const { trades, positions } = account(activity, true, () => null);
  assert.equal(trades.length, 1);
  assert.equal(trades[0].signature, sell.transaction.signatures[0]);
  near(trades[0].quantity, 12947362.198806);
  // Wallet rose by 0.580262075 SOL after a 0.0001 SOL standalone tip and 0.00203928 SOL rent refund.
  near(trades[0].sellSolReceived, 0.578322795);
  near(trades[0].solProfit, -0.022782205);
  assert.equal(positions[0].quantity, 0);
});

test('high-volume history stops at 2,500 unique records and returns partial coverage', async () => {
  let pages = 0;
  const result = await walkHistory(async cursor => {
    assert.equal(cursor, pages ? String(pages) : undefined);
    const start = pages++ * 100;
    return { data: Array.from({ length: 100 }, (_, index) => tx(start + index, [], [], 0)), paginationToken: String(pages) };
  });
  assert.equal(result.transactions.length, 2500);
  assert.equal(result.complete, false);
  assert.equal(result.reason, 'scan page limit reached');
});

test('wallet scan joins historical USD proceeds to the corresponding token’s post-sale candles', async () => {
  const original = globalThis.fetch;
  const previous = process.env.BIRDEYE_API_KEY;
  process.env.BIRDEYE_API_KEY = 'fixture-key';
  globalThis.fetch = async (url, request) => {
    if (url.startsWith('https://fixture.invalid')) {
      const body = JSON.parse(request.body);
      if (body.method === 'getAssetBatch') return Response.json({ result: [{ id: mint, content: { metadata: { symbol: 'TEST' } } }] });
      return Response.json({ result: { data: [tx(3, [row(1, 10)], [row(1, 0)], 2), tx(1, [row(1, 0)], [row(1, 10)], -1)] } });
    }
    const address = new URL(url).searchParams.get('address');
    const points = address === SOL ? [[0, 100], [2, 200]] : [[4, 50], [5, 60]];
    return Response.json({ success: true, data: { items: points.map(([hour, c]) =>
      ({ address, unix_time: time + hour * HOUR, c, v_usd: 20000, type: '1H', currency: 'usd' })) } });
  };
  try {
    const { trades } = await scanWallet(wallet, 'https://fixture.invalid', () => {});
    assert.equal(trades.length, 1);
    assert.equal(trades[0].symbol, 'TEST');
    near(trades[0].buyUsd, 100.0005);
    near(trades[0].sellUsd, 399.999);
    near(trades[0].profitUsd, 299.9985);
    near(trades[0].missedUpsideUsd, 200.001);
    assert.equal(trades[0].peakTime, time + 6 * HOUR);
  } finally {
    globalThis.fetch = original;
    if (previous == null) delete process.env.BIRDEYE_API_KEY;
    else process.env.BIRDEYE_API_KEY = previous;
  }
});

const identifyTokenAccounts = raw => {
  raw.transaction.message.accountKeys.push({ pubkey: 'primary', signer: false }, { pubkey: 'secondary', signer: false });
  return raw;
};

test('a truncated wallet recovers proven purchases after consuming unknown opening inventory', () => {
  const buy = identifyTokenAccounts(tx(10, [row(1, 10)], [row(1, 20)], -1));
  const first = identifyTokenAccounts(tx(11, [row(1, 20)], [row(1, 10)], 2));
  const second = identifyTokenAccounts(tx(12, [row(1, 10)], [row(1, 0)], 3));
  const entries = readActivity([second, first, buy], wallet);
  const opening = reconcileOpening(entries, false, []);
  assert.equal(opening.get(mint).raw, 10n);
  const [known, unknown] = account(entries.activity, false, price, opening).trades;
  assert.equal(unknown.buySolSpent, null);
  near(known.solProfit, 1.99999);
  assert.equal(account(entries.activity, false, price).trades[0].buySolSpent, null);
});

test('an untouched secondary account can have older inventory and prevents false FIFO basis', () => {
  const buy = identifyTokenAccounts(tx(1, [row(1, 0)], [row(1, 10)], -1));
  const sell = identifyTokenAccounts(tx(2, [row(1, 10)], [row(1, 0)], 2));
  const entries = readActivity([sell, buy], wallet);
  const opening = reconcileOpening(entries, false, [{ key: 'secondary:' + mint, mint, raw: 10n, decimals: 0 }]);
  const result = account(entries.activity, false, price, opening);
  assert.equal(result.trades[0].buySolSpent, null);
  assert.equal(result.positions[0].quantity, 10);
});

test('a gap or mismatched snapshot blocks only the affected mint', () => {
  const activity = [
    identifyTokenAccounts(tx(1, [row(1, 0)], [row(1, 10)], -1)),
    identifyTokenAccounts(tx(2, [row(2, 0, 'other')], [row(2, 10, 'other')], -1)),
    identifyTokenAccounts(tx(3, [row(1, 9)], [row(1, 0)], 2)),
    identifyTokenAccounts(tx(4, [row(2, 10, 'other')], [row(2, 0, 'other')], 3)),
  ].reverse();
  const entries = readActivity(activity, wallet);
  const opening = reconcileOpening(entries, false, []);
  assert.equal(opening.has(mint), false);
  assert.equal(opening.has('other'), true);
  const [other, broken] = account(entries.activity, false, price, opening).trades;
  near(other.solProfit, 1.99999);
  assert.equal(broken.solProfit, null);
  assert.equal(reconcileOpening(entries, false, [{ key: 'secondary:other', mint: 'other', raw: 1n, decimals: 0 }]).has('other'), false);
});

test('same-slot transaction indices override provider order when present', () => {
  const buy = identifyTokenAccounts(tx(1, [row(1, 0)], [row(1, 10)], -1));
  const sell = identifyTokenAccounts(tx(1, [row(1, 10)], [row(1, 0)], 2));
  buy.transactionIndex = 3;
  sell.transactionIndex = 8;
  sell.transaction.signatures = ['second-in-slot'];
  const entries = readActivity([buy, sell], wallet);
  assert.equal(entries.balanceGaps, 0);
  near(account(entries.activity, true, price).trades[0].solProfit, 0.99999);
});

test('a cancelled history batch can resume without refetching saved pages up to 20,000 records', async () => {
  const state = newHistory();
  let calls = 0;
  const page = async cursor => {
    const start = Number(cursor ?? 0);
    calls++;
    return {
      data: Array.from({ length: 100 }, (_, i) => ({ slot: start + i, signature: String(start + i) })),
      paginationToken: String(start + 100),
    };
  };
  const first = await walkHistory(page, 25, undefined, state, 200);
  assert.equal(first.canResume, true);
  assert.equal(first.transactions.length, 2500);
  const cancelled = await walkHistory(async () => { throw new DOMException('cancelled', 'AbortError'); }, 25, undefined, state, 200);
  assert.equal(cancelled.transactions.length, 2500);
  for (let i = 0; i < 7; i++) await walkHistory(page, 25, undefined, state, 200);
  const capped = await walkHistory(page, 25, undefined, state, 200);
  assert.equal(calls, 200);
  assert.equal(capped.transactions.length, 20_000);
  assert.equal(capped.reason, 'maximum history budget reached');
  assert.equal(capped.canResume, false);
});

test('an anchored incomplete scan recovers genuine finalized Pump.fun basis and forwards the slot bound', async () => {
  const original = globalThis.fetch;
  const { readFile } = await import('node:fs/promises');
  const [buy, sell] = await Promise.all(['buy','sell'].map(async name =>
    JSON.parse(await readFile(new URL('./fixtures/pump-mainnet-' + name + '.json', import.meta.url)))));
  const owner = buy.transaction.message.accountKeys[0].pubkey;
  let pageCalls = 0;
  globalThis.fetch = async (_url, request) => {
    const body = JSON.parse(request.body);
    if (body.method === 'getTokenAccountsByOwner') {
      return Response.json({ result: { context: { slot: sell.slot }, value: [] } });
    }
    if (body.method === 'getAssetBatch') return Response.json({ result: [] });
    pageCalls++;
    assert.equal(body.params[1].filters.slot.lte, sell.slot);
    if (pageCalls === 1) return Response.json({ result: { data: [sell, buy], paginationToken: 'older' } });
    return new Response(null, { status: 403 });
  };
  try {
    const checkpoint = newScanHistory();
    const result = await scanWallet(owner, 'https://fixture.invalid', () => {}, checkpoint);
    assert.equal(result.complete, false);
    assert.equal(result.canResume, true);
    assert.equal(result.scanned, 2);
    near(result.trades[0].solProfit, -0.022782205);
    assert.equal(checkpoint.pagination.cursor, 'older');
  } finally {
    globalThis.fetch = original;
  }
});

test('different finalized snapshot slots never prove opening inventory', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => Response.json({ result: { context: { slot: ++calls }, value: [] } });
  try {
    assert.equal(await snapshotHoldings('https://fixture.invalid', wallet, Date.now() + 5000), undefined);
    assert.equal(calls, 4);
  } finally {
    globalThis.fetch = original;
  }
});

test('Raydium CPMM sale is recognized while a liquidity withdrawal is excluded', () => {
  const swap = identifyTokenAccounts(tx(1, [row(1, 10)], [row(1, 0)], 2));
  swap.meta.logMessages = ['Program CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C invoke [1]', 'Program log: Instruction: SwapBaseInput'];
  assert.equal(readActivity([swap], wallet).activity[0].swap, true);
  swap.meta.logMessages[1] = 'Program log: Instruction: Withdraw';
  assert.equal(readActivity([swap], wallet).activity[0].swap, false);
});
