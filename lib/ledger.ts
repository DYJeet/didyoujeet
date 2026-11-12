export const SOL = 'So11111111111111111111111111111111111111112';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
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
    if (swapPrograms.has(stack.at(-1) ?? '') && swapInstruction.test(line)) {
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
  const accounts: { key: string; before: bigint; after: bigint }[] = [];
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
      key: keys[index].pubkey + ':' + mint,
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

export function readActivity(transactions: Transaction[], wallet: string) {
  const activity: Activity[] = [];
  let skipped = 0;
  let balanceGaps = 0;
  const balances = new Map<string, bigint>();
  // The provider returns ledger order, including transactions that share a slot or timestamp.
  for (const tx of transactions.slice().reverse()) {
    if (tx.meta?.err) continue;
    try {
      const signature = signatureOf(tx);
      if (!signature) throw new Error('Missing signature');
      const decoded = decode(tx, wallet);
      if (decoded.accounts.some(row => (balances.get(row.key) ?? 0n) !== row.before)) balanceGaps++;
      for (const row of decoded.accounts) balances.set(row.key, row.after);
      if (decoded.tokens.length) activity.push({ ...decoded, signature, time: tx.blockTime ?? null });
    } catch {
      skipped++;
    }
  }
  return { activity, skipped, balanceGaps };
}

function consume(lots: Lot[], quantity: bigint) {
  let sol = 0;
  let usd = 0;
  let solKnown = true;
  let usdKnown = true;
  const time = lots.find(lot => lot.raw)?.time ?? null;
  for (const lot of lots) {
    if (!quantity) break;
    if (!lot.raw) continue;
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
  }
  return { sol: solKnown && !quantity ? sol : null, usd: usdKnown && !quantity ? usd : null, time };
}

export function account(activity: Activity[], complete: boolean, price: (mint: string, time: number | null) => number | null) {
  const inventory = new Map<string, Lot[]>();
  const decimals = new Map<string, number>();
  const trades: Trade[] = [];
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
      const lots = inventory.get(leg.mint) ?? [];
      inventory.set(leg.mint, lots);
      decimals.set(leg.mint, leg.decimals);
      if (leg.raw > 0n) {
        const costSol = swap && equivalentSol != null ? equivalentSol + fee : null;
        const costUsd = swap && grossUsd != null && feeUsd != null ? grossUsd + feeUsd : null;
        lots.push({ raw: leg.raw, costSol, costUsd, time });
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
      const basis = consume(lots, -leg.raw);
      if (!swap || leg.mint === USDC) continue;
      const buySolSpent = complete ? basis.sol : null;
      const buyUsd = complete ? basis.usd : null;
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
        feeSol: fee, holdSeconds: complete && basis.time != null && time != null ? Math.max(0, time - basis.time) : null,
      });
    }
  }
  const positions = [...inventory].flatMap(([mint, lots]) => {
    if (mint === USDC) return [];
    const raw = lots.reduce((sum, lot) => sum + lot.raw, 0n);
    const invested = investments.get(mint);
    if (!raw && !invested) return [];
    const costKnown = complete && lots.every(lot => !lot.raw || lot.costUsd != null);
    return [{
      mint, quantity: complete ? units(raw, decimals.get(mint)!) : null,
      investedSol: invested?.solKnown ? invested.sol : null,
      investedUsd: invested?.usdKnown ? invested.usd : null,
      remainingCostUsd: costKnown ? lots.reduce((sum, lot) => sum + (lot.raw ? lot.costUsd ?? 0 : 0), 0) : null,
    }];
  });
  return { trades: trades.reverse(), positions, unclassifiedExchanges };
}
