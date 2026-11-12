export const SOL = 'So11111111111111111111111111111111111111112';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const raydiumCpmm = 'CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C';
const swapPrograms = new Set([
  '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P',
  'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA',
  'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',
]);
const swapInstruction = /^Program log: Instruction: (Buy|BuyExactSolIn|BuyExactQuoteIn|BuyV2|BuyV3|BuyExactQuoteInV3|Sell|SellV2|SellV3|Route|SharedAccountsRoute|ExactOutRoute|SharedAccountsExactOutRoute|RouteV2|SharedAccountsRouteV2)$/;

type TokenBalance = {
  accountIndex: number;
  owner?: string;
  mint: string;
  uiTokenAmount: { amount: string; decimals: number };
};

export type Transaction = {
  signature?: string;
  decoded?: Activity | null | false;
  slot: number;
  transactionIndex?: number;
  blockTime?: number | null;
  transaction?: {
    signatures: string[];
    message: {
      accountKeys: { pubkey: string; signer: boolean }[];
      instructions?: { parsed?: { type?: string; info?: { source?: string; destination?: string; lamports?: number } } }[];
    };
  };
  meta?: {
    err: unknown;
    fee: number;
    preBalances: number[];
    postBalances: number[];
    preTokenBalances?: TokenBalance[];
    postTokenBalances?: TokenBalance[];
    logMessages?: string[] | null;
  } | null;
};

export type Holding = { key: string; mint: string; raw: bigint; decimals: number };
type Leg = { mint: string; raw: bigint; decimals: number };
type Lot = { raw: bigint; costSol: number | null; costUsd: number | null; time: number | null };
export type Trade = {
  id: string;
  signature: string;
  mint: string;
  name?: string | null;
  symbol?: string | null;
  image?: string | null;
  quantity: number;
  sellTime: number | null;
  buySolSpent: number | null;
  sellSolReceived: number | null;
  solProfit: number | null;
  buyUsd: number | null;
  sellUsd: number | null;
  profitUsd: number | null;
  returnPercent: number | null;
  feeSol: number;
  holdSeconds: number | null;
  peakPriceAfterSell?: number;
  peakTime?: number;
  postSellMultiple?: number;
  missedUpsideUsd?: number;
};
const units = (raw: bigint, decimals: number) => Number(raw) / 10 ** decimals;
export const signatureOf = (tx: Transaction) => tx.signature || tx.transaction?.signatures?.[0];

function recognizedSwap(logs: string[]) {
  const stack: string[] = [];
  let shallowest = Infinity;
  let count = 0;
  for (const line of logs) {
    const invoke = /^Program (\w+) invoke \[(\d+)\]$/.exec(line);
    if (invoke) {
      stack.length = Number(invoke[2]) - 1;
      stack.push(invoke[1]);
    }
    const end = /^Program (\w+) (?:success|failed:.*)$/.exec(line);
    if (end && stack.at(-1) === end[1]) stack.pop();
    const program = stack.at(-1) ?? '';
    if ((swapPrograms.has(program) && swapInstruction.test(line))
      || (program === raydiumCpmm && /^Program log: Instruction: SwapBase(Input|Output)$/.test(line))) {
      if (stack.length < shallowest) {
        shallowest = stack.length;
        count = 0;
      }
      if (stack.length === shallowest) count++;
    }
  }
  return count === 1;
}

function decode(tx: Transaction, wallet: string) {
  const meta = tx.meta;
  const keys = tx.transaction?.message.accountKeys;
  if (!meta || !keys || !Array.isArray(meta.preTokenBalances) || !Array.isArray(meta.postTokenBalances)) {
    throw new Error('Missing transaction balances');
  }

  const walletIndex = keys.findIndex(key => key.pubkey === wallet);
  const indices = new Set<number>(walletIndex >= 0 ? [walletIndex] : []);
  const legs = new Map<string, Leg>();
  const accounts: { key: string; mint: string; decimals: number; before: bigint; after: bigint }[] = [];
  const before = new Map(meta.preTokenBalances.map(row => [row.accountIndex, row]));
  const after = new Map(meta.postTokenBalances.map(row => [row.accountIndex, row]));
  for (const index of new Set([...before.keys(), ...after.keys()])) {
    const pre = before.get(index);
    const post = after.get(index);
    if (pre?.owner !== wallet && post?.owner !== wallet) {
      if (keys[walletIndex]?.signer && !pre?.owner && !post?.owner) throw new Error('Missing token owner');
      continue;
    }
    if ((!pre?.owner && pre) || (!post?.owner && post)) throw new Error('Missing token owner');
    indices.add(index);
    const mint = post?.mint ?? pre!.mint;
    if (mint !== SOL && keys[index]?.pubkey) accounts.push({
      key: keys[index].pubkey + ':' + mint, mint, decimals: (post ?? pre)!.uiTokenAmount.decimals,
      before: pre?.owner === wallet ? BigInt(pre.uiTokenAmount.amount) : 0n,
      after: post?.owner === wallet ? BigInt(post.uiTokenAmount.amount) : 0n,
    });
    for (const [row, direction] of [[pre, -1n], [post, 1n]] as const) {
      if (row?.owner !== wallet || row.mint === SOL) continue;
      const decimals = row.uiTokenAmount.decimals;
      const raw = BigInt(row.uiTokenAmount.amount) * direction;
      legs.set(row.mint, { mint: row.mint, decimals, raw: (legs.get(row.mint)?.raw ?? 0n) + raw });
    }
  }

  // Include lamports in owned token accounts once, including wrapped SOL and recoverable rent.
  let netLamports = 0;
  for (const index of indices) {
    const pre = meta.preBalances[index];
    const post = meta.postBalances[index];
    if (!Number.isSafeInteger(pre) || !Number.isSafeInteger(post)) throw new Error('Missing lamports');
    const beforeOwned = index === walletIndex || before.get(index)?.owner === wallet;
    const afterOwned = index === walletIndex || after.get(index)?.owner === wallet;
    netLamports += (afterOwned ? post : 0) - (beforeOwned ? pre : 0);
  }
  const fee = walletIndex === 0 ? meta.fee : 0;

  const tokens = [...legs.values()].filter(leg => leg.raw !== 0n);
  const inputs = tokens.filter(leg => leg.raw < 0n);
  const outputs = tokens.filter(leg => leg.raw > 0n);
  const owned = new Set<string | undefined>([...indices].map(index => keys[index]?.pubkey));
  const wrapped = new Set<string | undefined>([...indices].filter(index => before.get(index)?.mint === SOL || after.get(index)?.mint === SOL)
    .map(index => keys[index]?.pubkey));
  let separateTransfer = false;
  let unrelatedLamports = 0;
  for (const { parsed } of tx.transaction?.message.instructions ?? []) {
    if (!parsed?.info || !['transfer', 'transferChecked', 'transferCheckedWithFee'].includes(parsed.type ?? '')) continue;
    const { source, destination, lamports } = parsed.info;
    if (!owned.has(source) && !owned.has(destination)) continue;
    if (source === wallet && wrapped.has(destination)) continue;
    // Explicit native transfers outside the swap instruction are separable. Extra token transfers are ambiguous.
    if (typeof lamports === 'number' && Number.isSafeInteger(lamports) && lamports >= 0) {
      unrelatedLamports += ((destination === wallet ? 1 : 0) - (source === wallet ? 1 : 0)) * lamports;
    } else separateTransfer = true;
  }
  const grossLamports = netLamports + fee - unrelatedLamports;
  const simple = (inputs.length === 1 && outputs.length === 1 && grossLamports === 0)
    || (tokens.length === 1 && ((inputs.length === 1 && grossLamports > 0)
      || (outputs.length === 1 && grossLamports < 0)));
  const swap = simple && !!keys[walletIndex]?.signer && !separateTransfer && recognizedSwap(meta.logMessages ?? []);
  return { tokens, inputs, outputs, accounts, fee: fee / 1e9, grossSol: grossLamports / 1e9, swap };
}

export type Activity = ReturnType<typeof decode> & { signature: string; time: number | null };

export function compactTransaction(tx: Transaction, wallet: string): Transaction {
  const signature = signatureOf(tx);
  const decoded = decodeActivity(tx, wallet) ?? (tx.meta?.err ? false : null);
  return { signature, slot: tx.slot, transactionIndex: tx.transactionIndex, decoded };
}

function decodeActivity(tx: Transaction, wallet: string): Activity | null | undefined {
  if (tx.decoded === false) return undefined;
  if (tx.decoded !== undefined) return tx.decoded;
  if (tx.meta?.err) return undefined;
  try {
    const signature = signatureOf(tx);
    if (!signature) return null;
    return { ...decode(tx, wallet), signature, time: tx.blockTime ?? null };
  } catch {
    return null;
  }
}

export function readActivity(transactions: Transaction[], wallet: string) {
  const activity: Activity[] = [];
  let skipped = 0;
  let balanceGaps = 0;
  const discontinuous = new Set<string>();
  const seen = new Map<string, Holding & { opening: bigint }>();
  const bySlot = new Map<number, Transaction[]>();
  for (const tx of transactions) {
    const group = bySlot.get(tx.slot);
    if (group) group.push(tx);
    else bySlot.set(tx.slot, [tx]);
  }
  for (const slot of [...bySlot.keys()].sort((a, b) => a - b)) {
    const group = bySlot.get(slot)!;
    const indices = new Set(group.map(tx => tx.transactionIndex));
    if (indices.size === group.length && group.every(tx => Number.isSafeInteger(tx.transactionIndex))) {
      group.sort((a, b) => a.transactionIndex! - b.transactionIndex!);
    } else group.reverse();
    for (const tx of group) {
      const entry = decodeActivity(tx, wallet);
      if (entry === undefined) continue;
      if (entry === null) {
        skipped++;
        continue;
      }
      if (entry.accounts.some(row => (seen.get(row.key)?.raw ?? 0n) !== row.before)) balanceGaps++;
      for (const row of entry.accounts) {
        const prior = seen.get(row.key);
        if (prior && prior.raw !== row.before) discontinuous.add(row.mint);
        seen.set(row.key, { key: row.key, mint: row.mint, decimals: row.decimals, raw: row.after, opening: prior?.opening ?? row.before });
      }
      if (entry.tokens.length) activity.push(entry);
    }
  }
  return { activity, skipped, balanceGaps, discontinuous, seen };
}

export function reconcileOpening(
  ledger: ReturnType<typeof readActivity>, exhausted: boolean, closing?: Holding[],
) {
  const opening = new Map<string, { raw: bigint; decimals: number }>();
  if (ledger.skipped || (!exhausted && !closing)) return opening;
  const snapshot = new Map(closing?.map(row => [row.key, row]));
  const unproven = new Set(ledger.discontinuous);
  const add = (row: Holding, raw: bigint) => {
    const prior = opening.get(row.mint);
    opening.set(row.mint, { decimals: row.decimals, raw: (prior?.raw ?? 0n) + raw });
  };
  for (const row of ledger.seen.values()) {
    if (closing && (snapshot.get(row.key)?.raw ?? 0n) !== row.raw) unproven.add(row.mint);
    add(row, row.opening);
    snapshot.delete(row.key);
  }
  for (const row of snapshot.values()) add(row, row.raw);
  for (const mint of unproven) opening.delete(mint);
  return opening;
}

function consume(queue: { lots: Lot[]; head: number }, quantity: bigint) {
  let sol = 0;
  let usd = 0;
  let solKnown = true;
  let usdKnown = true;
  const time = queue.lots[queue.head]?.time ?? null;
  while (quantity && queue.head < queue.lots.length) {
    const lot = queue.lots[queue.head];
    const used = quantity < lot.raw ? quantity : lot.raw;
    const fraction = Number(used) / Number(lot.raw);
    if (lot.costSol == null) solKnown = false;
    else {
      const cost = lot.costSol * fraction;
      sol += cost;
      lot.costSol -= cost;
    }
    if (lot.costUsd == null) usdKnown = false;
    else {
      const cost = lot.costUsd * fraction;
      usd += cost;
      lot.costUsd -= cost;
    }
    quantity -= used;
    lot.raw -= used;
    if (!lot.raw) queue.head++;
  }
  return { sol: solKnown && !quantity ? sol : null, usd: usdKnown && !quantity ? usd : null, time };
}

export function account(activity: Activity[], complete: boolean, price: (mint: string, time: number | null) => number | null,
  opening = new Map<string, { raw: bigint; decimals: number }>()) {
  const inventory = new Map<string, { lots: Lot[]; head: number }>();
  const decimals = new Map<string, number>();
  const trades: Trade[] = [];
  for (const [mint, balance] of opening) {
    decimals.set(mint, balance.decimals);
    if (balance.raw > 0n) inventory.set(mint, {
      lots: [{ raw: balance.raw, costSol: null, costUsd: null, time: null }], head: 0,
    });
  }
  const investments = new Map<string, { sol: number; usd: number; solKnown: boolean; usdKnown: boolean }>();
  let unclassifiedExchanges = 0;
  for (const entry of activity) {
    const { tokens, inputs, outputs, grossSol, fee, swap, time, signature } = entry;
    if (!swap && (inputs.length && outputs.length || tokens.length === 1 && grossSol && Math.sign(grossSol) !== Math.sign(Number(tokens[0].raw)))) {
      unclassifiedExchanges++;
    }
    const solUsd = swap ? price(SOL, time) : null;
    const quote = inputs.find(leg => leg.mint === USDC) ?? outputs.find(leg => leg.mint === USDC) ?? inputs[0];
    const quoteUsd = swap && grossSol === 0 && quote ? price(quote.mint, time) : null;
    const grossUsd = grossSol !== 0
      ? (solUsd == null ? null : Math.abs(grossSol) * solUsd)
      : (quote && quoteUsd != null ? units(quote.raw < 0n ? -quote.raw : quote.raw, quote.decimals) * quoteUsd : null);
    const equivalentSol = grossSol !== 0 ? Math.abs(grossSol) : grossUsd != null && solUsd != null ? grossUsd / solUsd : null;
    const feeUsd = fee === 0 ? 0 : solUsd == null ? null : fee * solUsd;
    for (const leg of tokens) {
      const queue = inventory.get(leg.mint) ?? { lots: [], head: 0 };
      inventory.set(leg.mint, queue);
      const known = complete || opening.has(leg.mint);
      decimals.set(leg.mint, leg.decimals);
      if (leg.raw > 0n) {
        const costSol = swap && equivalentSol != null ? equivalentSol + fee : null;
        const costUsd = swap && grossUsd != null && feeUsd != null ? grossUsd + feeUsd : null;
        queue.lots.push({ raw: leg.raw, costSol, costUsd, time });
        if (swap) {
          const invested = investments.get(leg.mint) ?? { sol: 0, usd: 0, solKnown: true, usdKnown: true };
          invested.sol += costSol ?? 0;
          invested.usd += costUsd ?? 0;
          invested.solKnown &&= costSol != null;
          invested.usdKnown &&= costUsd != null;
          investments.set(leg.mint, invested);
        }
        continue;
      }
      const basis = consume(queue, -leg.raw);
      if (!swap || leg.mint === USDC) continue;
      const buySolSpent = known ? basis.sol : null;
      const buyUsd = known ? basis.usd : null;
      // A token-to-token swap is one event. Charge its network fee to the incoming lot only.
      const exitFee = outputs.length ? 0 : fee;
      const sellSolReceived = equivalentSol == null ? null : equivalentSol - exitFee;
      const sellUsd = grossUsd == null || (exitFee && feeUsd == null) ? null : grossUsd - (exitFee ? feeUsd! : 0);
      const solProfit = sellSolReceived != null && buySolSpent != null ? sellSolReceived - buySolSpent : null;
      trades.push({
        id: signature + ':' + leg.mint, signature, mint: leg.mint, sellTime: time,
        quantity: units(-leg.raw, leg.decimals), buySolSpent, sellSolReceived, solProfit,
        buyUsd, sellUsd, profitUsd: sellUsd != null && buyUsd != null ? sellUsd - buyUsd : null,
        returnPercent: solProfit != null && buySolSpent != null && buySolSpent > 0 ? solProfit / buySolSpent * 100 : null,
        feeSol: fee, holdSeconds: known && basis.time != null && time != null ? Math.max(0, time - basis.time) : null,
      });
    }
  }
  const positions = [...inventory].flatMap(([mint, queue]) => {
    const lots = queue.lots.slice(queue.head);
    const known = complete || opening.has(mint);
    if (mint === USDC) return [];
    const raw = lots.reduce((sum, lot) => sum + lot.raw, 0n);
    const invested = investments.get(mint);
    if (!raw && !invested) return [];
    const costKnown = known && lots.every(lot => !lot.raw || lot.costUsd != null);
    return [{
      mint, quantity: known ? units(raw, decimals.get(mint)!) : null,
      investedSol: invested?.solKnown ? invested.sol : null,
      investedUsd: invested?.usdKnown ? invested.usd : null,
      remainingCostUsd: costKnown ? lots.reduce((sum, lot) => sum + (lot.raw ? lot.costUsd ?? 0 : 0), 0) : null,
    }];
  });
  return { trades: trades.reverse(), positions, unclassifiedExchanges };
}
