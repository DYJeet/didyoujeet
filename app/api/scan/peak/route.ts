import { NextResponse } from 'next/server';

const BIRDEYE_API_KEY = process.env.BIRDEYE_API_KEY;

async function getBirdeyeHistory(
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
    console.error('Birdeye peak error:', response.status);
    return null;
  }

  return response.json();
}

export async function POST(request: Request) {
  const body = await request.json();

  const mint = body?.mint;
  const sellTime = body?.sellTime;

  if (!mint || !sellTime) {
    return NextResponse.json(
      { error: 'mint and sellTime are required' },
      { status: 400 }
    );
  }

  const now = Math.floor(Date.now() / 1000);
  const thirtyDaysAfterSell = sellTime + 30 * 24 * 60 * 60;
  const timeTo = Math.min(now, thirtyDaysAfterSell);

  const history = await getBirdeyeHistory(
    mint,
    sellTime,
    timeTo
  );

  const items = history?.data?.items ?? [];

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

  return NextResponse.json({
    mint,
    sellTime,
    sellPrice,
    peakPriceAfterSell: peakPrice,
    postSellMultiple,
  });
}
