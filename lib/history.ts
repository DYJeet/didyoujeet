import { SOL, type Holding } from './ledger.ts';
import { newHistory, rpc } from './providers.ts';

const tokenPrograms = [
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
  'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
];

type Accounts = {
  context: { slot: number };
  value: {
    pubkey: string;
    account: { data: { parsed: { info: {
      owner: string; mint: string; tokenAmount: { amount: string; decimals: number };
    } } } };
  }[];
};

export async function snapshotHoldings(url: string, address: string, deadline: number, signal?: AbortSignal) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const [legacy, extension] = await Promise.all(tokenPrograms.map(programId =>
        rpc<Accounts>(url, 'getTokenAccountsByOwner', [
          address, { programId }, { commitment: 'finalized', encoding: 'jsonParsed' },
        ], deadline, signal)));
      // A minContextSlot does not pin a read. Require a shared finalized slot.
      const slot = legacy.context.slot;
      if (!Number.isSafeInteger(slot) || slot !== extension.context.slot) continue;
      const holdings: Holding[] = [];
      for (const row of [...legacy.value, ...extension.value]) {
        const info = row.account.data.parsed.info;
        if (info.owner !== address || typeof info.mint !== 'string' || !/^\d+$/.test(info.tokenAmount.amount)
          || !Number.isInteger(info.tokenAmount.decimals) || info.tokenAmount.decimals < 0 || info.tokenAmount.decimals > 255) return undefined;
        if (info.mint !== SOL) holdings.push({
          key: row.pubkey + ':' + info.mint, mint: info.mint,
          raw: BigInt(info.tokenAmount.amount), decimals: info.tokenAmount.decimals,
        });
      }
      return { slot, holdings };
    } catch {
      signal?.throwIfAborted();
      return undefined;
    }
  }
}

export function newScanHistory() {
  return {
    pagination: newHistory(),
    snapshot: undefined as Awaited<ReturnType<typeof snapshotHoldings>>,
    started: false,
    expires: Date.now() + 10 * 60_000,
  };
}
