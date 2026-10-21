import { NextResponse } from 'next/server';
import { PublicKey } from '@solana/web3.js';

const BIRDEYE_API_KEY = process.env.BIRDEYE_API_KEY;

type SignatureInfo = {
  signature: string;
  slot?: number;
  blockTime?: number | null;
  err?: unknown;
};async function getBirdeyeHistory(
  mint: string,
  timeFrom: number,
  timeTo: number
) {
  if (!BIRDEYE_API_KEY) return null;

  const url =
    `https://public-api.birdeye.so/defi/history_price` +
    `?address=${mint}&address_type=token&type=1H` +
    `&time_from=${timeFrom}&time_to=${timeTo}`;

  const response = await fetch(url, {
    headers: {
      'X-API-KEY': BIRDEYE_API_KEY,
      'x-chain': 'solana',
    },
  });

  if (!response.ok) {
    console.error('Birdeye error:', response.status);
    return null;
  }

  return response.json();
}


export async function POST(request: Request) {
  try {
    const { address } = await request.json();

    if (typeof address !== 'string' || !address.trim()) {
      return NextResponse.json(
        { error: 'Please enter a wallet address.' },
        { status: 400 }
      );
    }

    let wallet: PublicKey;

    try {
      wallet = new PublicKey(address.trim());

      if (!PublicKey.isOnCurve(wallet.toBytes())) {
        return NextResponse.json(
          { error: 'Please enter a standard wallet address.' },
          { status: 400 }
        );
      }
    } catch {
      return NextResponse.json(
        { error: 'Invalid Solana wallet address.' },
        { status: 400 }
      );
    }

    const rpcUrl = process.env.HELIUS_RPC_URL;

    if (!rpcUrl) {
      return NextResponse.json(
        { error: 'Helius RPC URL is not configured.' },
        { status: 500 }
      );
    }

    async function rpcCall(method: string, params: unknown[]) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetch(rpcUrl!, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method,
        params,
      }),
      cache: 'no-store',
    });

    if (response.status === 429) {
      const delay = 1000 * (attempt + 1);

      console.log(`Helius 429 - retrying in ${delay}ms`);

      await new Promise((resolve) => setTimeout(resolve, delay));
      continue;
    }

    if (!response.ok) {
      throw new Error(`Helius request failed: ${response.status}`);
    }

    const data = await response.json();

    if (data.error) {
      throw new Error(data.error.message || 'Solana RPC error');
    }

    return data.result;
  }

  throw new Error('Helius request failed after 3 attempts');
}


    const historyResult = (await rpcCall('getTransactionsForAddress', [
  wallet.toBase58(),
  {
    transactionDetails: 'full',
    sortOrder: 'desc',
    limit: 100,
    filters: {
      tokenAccounts: 'balanceChanged',
      status: 'succeeded',
    },
  },
])) as {
  data?: any[];
  paginationToken?: string | null;
};

const detailedTransactions = historyResult?.data ?? [];

let paginationToken = historyResult?.paginationToken ?? null;

for (let page = 1; page < 25 && paginationToken; page += 1) {
  const nextPage = (await rpcCall('getTransactionsForAddress', [
    wallet.toBase58(),
    {
      transactionDetails: 'full',
      sortOrder: 'desc',
      limit: 100,
      filters: {
        tokenAccounts: 'balanceChanged',
        status: 'succeeded',
      },
      paginationToken,
    },
  ])) as {
    data?: any[];
    paginationToken?: string | null;
  };

  detailedTransactions.push(...(nextPage?.data ?? []));
  paginationToken = nextPage?.paginationToken ?? null;
}


const recentSignatures: SignatureInfo[] = detailedTransactions
  .map((tx: any) => ({
    signature:
      tx.signature ??
      tx.transaction?.signatures?.[0] ??
      '',
    slot: tx.slot,
    blockTime: tx.blockTime ?? null,
    err: tx.meta?.err ?? null,
  }))
  .filter((tx) => tx.signature);

  const signatures = recentSignatures;



    const tokenChanges: {
      signature: string;
      blockTime: number | null;
      mint: string;
      change: number;
      direction: 'IN' | 'OUT';
      solChange: number;
      tradeType: 'BUY' | 'SELL' | 'TRANSFER';
    }[] = [];

    const heliusApiKey =
  new URL(rpcUrl).searchParams.get('api-key') ?? '';

if (!heliusApiKey) {
  throw new Error('Could not read Helius API key from HELIUS_RPC_URL');
}

const walletHistoryResponse = await fetch(
  `https://api.helius.xyz/v1/wallet/${wallet.toBase58()}/history?tokenAccounts=balanceChanged&limit=100`,
  {
    headers: {
      'X-Api-Key': heliusApiKey,
    },
  }
);

if (!walletHistoryResponse.ok) {
  throw new Error(
    `Helius Wallet History failed: ${walletHistoryResponse.status}`
  );
}

const walletHistory = await walletHistoryResponse.json();

const HISTORY_SOL_MINT = 'So11111111111111111111111111111111111111111';
const WRAPPED_SOL_MINT = 'So11111111111111111111111111111111111111112';



for (const tx of walletHistory.data ?? []) {
  const changes = (tx.balanceChanges ?? []).filter(
    (change: any) => Math.abs(Number(change.amount ?? 0)) > 0
  );

  const nativeSolChange =
  Number(
    changes.find(
      (change: any) => change.mint === HISTORY_SOL_MINT
    )?.amount ?? 0
  );

const wrappedSolChange =
  Number(
    changes.find(
      (change: any) => change.mint === WRAPPED_SOL_MINT
    )?.amount ?? 0
  );

const solChange = nativeSolChange + wrappedSolChange;

const hasIncoming = changes.some(
    (change: any) =>
      change.mint !== HISTORY_SOL_MINT &&
      Number(change.amount) > 0
  );

  const hasOutgoing = changes.some(
    (change: any) =>
      change.mint !== HISTORY_SOL_MINT &&
      Number(change.amount) < 0
  );

  for (const change of changes) {
    if (
  change.mint === HISTORY_SOL_MINT ||
  change.mint === WRAPPED_SOL_MINT
) continue;

    const amount = Number(change.amount);

    tokenChanges.push({
      signature: tx.signature,
      blockTime: tx.timestamp ?? null,
      mint: change.mint,
      change: amount,
      direction: amount > 0 ? 'IN' : 'OUT',
      solChange: Number(solChange),
      tradeType:
        amount > 0 && Number(solChange) < 0
          ? 'BUY'
          : amount < 0 && Number(solChange) > 0
            ? 'SELL'
            : 'TRANSFER',
    });
  }
}
    const uniqueTokenChanges = Array.from(
  new Map(
    tokenChanges.map((t) => [
      `${t.signature}-${t.mint}-${t.tradeType}-${t.change}`,
      t,
    ])
  ).values()
);

const buys = uniqueTokenChanges.filter((t) => t.tradeType === 'BUY');
const sells = uniqueTokenChanges.filter((t) => t.tradeType === 'SELL');
console.log('BUYS:', buys);
    console.log('SELLS:', sells);
    const buyLots = buys

  .filter(

    (buy) =>

      buy.blockTime != null &&

      buy.change > 0

  )

  .sort(

    (a, b) =>

      (a.blockTime ?? 0) - (b.blockTime ?? 0)

  )

  .map((buy) => ({

    ...buy,

    remainingAmount: Math.abs(buy.change),

  }));

const pairedTrades = sells

  .filter((sell) => sell.blockTime != null)

  .sort(

    (a, b) =>

      (a.blockTime ?? 0) - (b.blockTime ?? 0)

  )

  .map((sell) => {

    let amountToMatch = Math.abs(sell.change);

    let buySolSpent = 0;

    let matchingBuy: (typeof buys)[number] | undefined;

    for (const lot of buyLots) {

      if (

        lot.mint !== sell.mint ||

        lot.blockTime == null ||

        sell.blockTime == null ||

        lot.blockTime > sell.blockTime ||

        lot.remainingAmount <= 0 ||

        amountToMatch <= 0

      ) {

        continue;

      }

      const amountUsed = Math.min(

        amountToMatch,

        lot.remainingAmount

      );

      const lotTokenAmount = Math.abs(lot.change);

      if (lotTokenAmount > 0) {

        buySolSpent +=

          Math.abs(lot.solChange) *

          (amountUsed / lotTokenAmount);

      }

      if (!matchingBuy) {

        matchingBuy = lot;

      }

      lot.remainingAmount -= amountUsed;

      amountToMatch -= amountUsed;

    }

    const sellSolReceived = Math.max(

      Number(sell.solChange),

      0

    );

    return {

      sell,

      sellTime: sell.blockTime,

      buyTime: matchingBuy?.blockTime ?? null,

      buy: matchingBuy,

      buySolSpent,

      sellSolReceived,

      solProfit: sellSolReceived - buySolSpent,

      returnPercent:

        buySolSpent > 0

          ? ((sellSolReceived - buySolSpent) /

              buySolSpent) *

            100

          : null,

    };

  });


console.log(
  'UNMATCHED TRADES:',
  pairedTrades
    .filter((trade) => trade.returnPercent == null)
    .map((trade) => ({
      mint: trade.sell.mint,
      sellTime: trade.sellTime,
      sellAmount: trade.sell.change,
      sellSolReceived: trade.sellSolReceived,
      matchingBuy: trade.buy ?? null,
    }))
);


const unmatchedMints = new Set(
  pairedTrades
    .filter((trade) => trade.returnPercent == null)
    .map((trade) => trade.sell.mint)
);

console.log(
  'UNMATCHED TOKEN HISTORY:',
  tokenChanges
    .filter((change) => unmatchedMints.has(change.mint))
    .map((change) => ({
      mint: change.mint,
      blockTime: change.blockTime,
      change: change.change,
      direction: change.direction,
      solChange: change.solChange,
      tradeType: change.tradeType,
    }))
);


pairedTrades.splice(
  0,
  pairedTrades.length,
  ...Array.from(
    new Map(
      pairedTrades.map((trade) => [
        `${trade.sell.mint}-${trade.buyTime}-${trade.sellTime}-${trade.buySolSpent}-${trade.sellSolReceived}`,
        trade,
      ])
    ).values()
  )
);

console.log('REACHED METADATA SECTION');
const uniqueMints = [...new Set(
  pairedTrades.map((trade) => trade.sell.mint)
)];

let assetMetadata: any[] = [];

try {
  const metadataResponse = await fetch(rpcUrl!, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'getAssetBatch',
      params: {
        ids: uniqueMints,
      },
    }),
  });

  const metadataJson = await metadataResponse.json();
  assetMetadata = metadataJson.result ?? [];

  console.log(
    'META COUNT:',
    Array.isArray(assetMetadata) ? assetMetadata.length : 'not array'
  );

  console.log(
    'FIRST META:',
    JSON.stringify(assetMetadata?.[0], null, 2)
  );
} catch (error) {
  console.error('TOKEN METADATA FAILED:', error);
}
const SOL_MINT = 'So11111111111111111111111111111111111111112';

const now = Math.floor(Date.now() / 1000);

let currentSolUsd: number | null = null;

try {
  const solNow = await getBirdeyeHistory(
    SOL_MINT,
    now - 3600,
    now
  );

  const solItems = solNow?.data?.items ?? [];

  if (solItems.length) {
    currentSolUsd = Number(solItems[solItems.length - 1].value);
  }
} catch (error) {
  console.error('CURRENT SOL PRICE FAILED:', error);
}



  
const tradesWithBirdeye = [];
for (const [index, trade] of pairedTrades.entries()) {
  if (index >= 12) {
    tradesWithBirdeye.push({
      ...trade,
      postSellMultiple: null,
      peakPriceAfterSell: null,
    });
    continue;
  }
    if (!trade.sellTime) {
  tradesWithBirdeye.push({
    ...trade,
    postSellMultiple: null,
    peakPriceAfterSell: null,
  });
  await new Promise((resolve) => setTimeout(resolve, 1100));
  continue;
}


    const thirtyDaysAfterSell = trade.sellTime + 30 * 24 * 60 * 60;
    const timeTo = Math.min(now, thirtyDaysAfterSell);

    const history = await getBirdeyeHistory(
      trade.sell.mint,
      trade.sellTime,
      timeTo
    );

    const items = history?.data?.items ?? [];
    console.log('BIRDEYE ITEMS:', trade.sell.mint, items.length);

    const sortedItems = [...items].sort(
      (a: any, b: any) => Number(a.unixTime) - Number(b.unixTime)
    );

    const sellPrice = sortedItems.length
      ? Number(sortedItems[0].value)
      : null;

    const peakPrice = sortedItems.length
      ? Math.max(...sortedItems.map((item: any) => Number(item.value)))
      : null;

    const postSellMultiple =
      peakPrice && sellPrice && sellPrice > 0
        ? peakPrice / sellPrice
        : null;

    tradesWithBirdeye.push({
  ...trade,
  postSellMultiple,
  peakPriceAfterSell: peakPrice,
});

await new Promise((resolve) => setTimeout(resolve, 1100));

}


console.log(
  'TRADES WITH BIRDEYE:',
  JSON.stringify(tradesWithBirdeye, null, 2)
);

    console.log('PAIRED TRADES:', JSON.stringify(pairedTrades, null, 2));
    console.log('TOKEN CHANGES:', tokenChanges.length, tokenChanges.slice(0, 10));
    const metadataByMint = new Map(

    assetMetadata.filter((asset: any) => asset?.id).map((asset: any) => [
   
      asset.id,
    {
      name: asset.content?.metadata?.name ?? null,
      symbol: asset.content?.metadata?.symbol ?? null,
      image: asset.content?.links?.image ?? null,
    },
  ])
);

const tradesWithNames = tradesWithBirdeye
  .map((trade: any) => {
    const metadata = metadataByMint.get(trade.sell.mint);

    return {
      ...trade,
      mint: trade.sell.mint,
      name: metadata?.name ?? null,
      symbol: metadata?.symbol ?? null,
      image: metadata?.image ?? null,
      missedGainPercent:
        trade.postSellMultiple != null
          ? Math.max(0, (trade.postSellMultiple - 1) * 100)
          : null,

          buyUsd:
  currentSolUsd != null
    ? trade.buySolSpent * currentSolUsd
    : null,

sellUsd:
  currentSolUsd != null
    ? trade.sellSolReceived * currentSolUsd
    : null,

    profitUsd:
    currentSolUsd != null
    ? trade.solProfit * currentSolUsd
    : null,

    missedUpsideUsd:
  currentSolUsd != null &&
  trade.sellSolReceived != null &&
  trade.postSellMultiple != null
    ? trade.sellSolReceived *
      currentSolUsd *
      Math.max(0, trade.postSellMultiple - 1)
    : null,

    holdSeconds:
    trade.buyTime != null && trade.sellTime != null
    ? Math.max(0, trade.sellTime - trade.buyTime)
    : null,
          
    };
  })
  .filter(
    (trade: any) =>
      trade.symbol?.toUpperCase() !== 'USDC'
  );

    return NextResponse.json({
      address: wallet.toBase58(),
      mode: 'live',
      scanned: signatures.length,
      historyCount: signatures.length,
      tokenChanges,
      trades: tradesWithNames,
      totalMissedUsd: 0,
      transactions: signatures
    });

  } catch (error) {
    console.error('SCAN FAILED:', error);
    

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Unable to scan wallet.'
      },
      { status: 500 }
    );
  }
}
