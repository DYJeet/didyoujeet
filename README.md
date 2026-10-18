# DidYouJeet.xyz — website MVP

A responsive Solana meme-trading entertainment site starring **Jeet the Cat**.

## Start locally

Requires Node.js 20+.

```bash
npm install
npm run dev
```

Open http://localhost:3000. To deploy, push this folder to GitHub and import it into Vercel.

## What works

- Full responsive homepage with original vector cat mascot
- Solana public-address validation on the server
- Optional Phantom wallet connection (read-only public address; no transaction signatures)
- Interactive **Try Demo** with clearly marked illustrative receipts
- X sharing and social copy

## Important: live scanner status

**The live historical jeet scanner is NOT implemented yet.** The `/api/scan` endpoint deliberately returns an informative `503` rather than inventing real transaction data. Demo results are sample data only.

For a trustworthy production scanner, build an ingestion pipeline that:
1. Retrieves complete transaction history with pagination from an indexer (e.g. Helius).
2. Resolves token swaps, token decimals, SOL/USDC routing, fees, and partial fills.
3. Reconstructs purchase lots and sale lots using a declared accounting rule.
4. Retrieves historical token prices and post-sale peaks with liquidity checks (e.g. Birdeye/GeckoTerminal where available).
5. Excludes transfers/airdrops, token migrations, suspicious illiquid spikes, and missing price histories, or labels them as uncertain.
6. Calculates missed upside on the actual sold quantity and labels peak comparisons as *hypothetical*, not realizable profit.
7. Adds rate limiting, caching, a privacy policy, and opt-in public leaderboard participation.

Do not release a $JEET token as if it confers ownership, guaranteed benefits, or future returns. Check the domain's availability before buying it; it has **not** been verified here.
