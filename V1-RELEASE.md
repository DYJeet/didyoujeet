# DidYouJeeT V1 release candidate

## Recovery and baseline

The application lives in [DYJeet/didyoujeet](https://github.com/DYJeet/didyoujeet). The initial review found seven commits on `main`, a `v0.1.0` tag, and no other GitHub branches. The first uploaded ZIP predates the tracked application and contains the same core app paths as its successor. The tracked source contains the Next.js frontend, JeeT the Cat, both scan API routes, and the dependency lockfile.

The latest ready production deployment, [5Ud24y7pG2D6qmRhGWys8Dzqvw5V](https://vercel.com/dyj-eet/didyoujeet/5Ud24y7pG2D6qmRhGWys8Dzqvw5V), matches GitHub commit [91fbdc1](https://github.com/DYJeet/didyoujeet/commit/91fbdc1e4e440718891eba8bf0f2afd515a1e8df). The available deployment history showed six ready builds, all backed by known commits in this repository. No recovery from a deployment was needed to reproduce the deployed source. Unpushed Codespaces work was not accessible for comparison. The local branch `recovery/v1-baseline-2026-11-12` and the verified Git bundle retain the complete available baseline history.

The deployed baseline counted paginated Helius RPC results, then calculated trades from a different 100-record endpoint. It included apparent sales with unknown acquisition cost as profit, converted historical amounts at today's SOL price, and used the first candle after the sale as a substitute for the execution price. The browser made an unbounded sequence of supplemental price requests, and the X text formatted average return as missed dollars.

## Accounting and price coverage

- The API uses finalized Helius `getTransactionsForAddress` with token-balance changes. It reuses the paginated records for calculations and follows the provider's transaction order. Signature deduplication is independent of timestamps.
- Up to 25 pages of 100 records and 24 seconds are available for history. Cursor loops, malformed records, balance gaps, provider interruption and the scan budget can make the result partial. Partial history suppresses cost basis and ledger holdings. Provider coverage may omit older records or accounts.
- Supported trades are simple two-leg transactions with a recognized Pump.fun, PumpSwap or Jupiter instruction. Complex routes, other protocols and extra token transfers can remain unclassified. Incoming transfers have unknown basis. Outgoing transfers consume FIFO lots. A partially unknown sale has unavailable realized P&L.
- SOL and wrapped SOL are combined using wallet-controlled lamport changes. Recoverable rent and separately identified top-level native transfers are excluded. Payer network fees are included once. For token-to-token swaps the fee is assigned to the incoming lot. Failed-transaction fees and separate tips are excluded from trading P&L.
- Historical USD uses the most recent completed hourly Birdeye candle at each leg's transaction time. Token-to-token swaps use an available USD quote and SOL conversion for that time. USDC is excluded from the meme-token trophy and position cards by mint.
- An open position gets an estimated unrealized USD mark when complete cost basis and a sufficiently traded recent close are available. Remaining quantity is reconstructed from the retrieved ledger and is subject to provider coverage.
- Biggest observed JeeT uses quantity sold multiplied by the highest eligible observed close, less the actual sale proceeds in historical USD. The scan checks finished candles fully after the sale and within 30 days. A qualifying candle has at least USD 1,000 reported volume, at least ten times the hypothetical sale value in volume, and an adjacent qualifying candle supporting at least half the price. This screens thin and isolated prints. Historical market depth and executable proceeds remain unknown. Coverage counts are visible so missing or unpriced tokens do not turn into zero upside.
- To bound costs, each scan attempts up to eight historical mint/day windows, eight exit price windows, three position marks and one batch of up to 100 metadata records. A 45-second server-side provider budget, request timeouts, staggered rate limits, jittered retry, bounded caches and in-flight deduplication apply. Each instance permits three concurrent new scans and twelve new scans in a rolling minute. Distributed Vercel instances do not share these limits or caches.

## Verification

Use Node 24 and run:

```sh
npm ci
npm run typecheck
npm test
npm run build
npm audit
```

There is no separately configured lint command. The production build performs Next.js's lint/type phase. All 19 automated tests passed. The suite covers FIFO, partial exits, fees, wrapped SOL, token-to-token swaps, transfers, failed transactions, historical prices, cursor loops, provider failures, suspect candles and three finalized mainnet transaction records. The [buy](https://solscan.io/tx/23cKgL3x5L97T9pjSi1q2A9ZqDtEgwXyKns79n9KBzy13fB8pUCw11pTo4FUp8wdezVxg7aGN1Hkrk65JDbPeNUM) and [sell](https://solscan.io/tx/2DkMeTkD7s91sUShChJLccssu2SfbtJkG6QSpqCpCLbUoVfPC9L6iYsJrnF7YA7cnwiGaSm6jz1wnD3RLvzw37Eu) match the public Solana RPC's token quantities and lamport changes. The realized loss was 0.022782205 SOL after network fees, excluding separately identifiable tip and refundable rent.

Chromium checks at 320 px, 390 px and 1440 px passed for input validation, a paginated wallet receipt built from finalized transactions, the outage state, the demo, a single trophy, X share text and PNG export. The built homepage loads about 110 kB of first-load JS. A mocked two-page wallet history with metadata failure took about 0.25 seconds. A mocked wallet with historical USD and post-sale price windows took about 1.9 seconds under the configured pacing. Live Vercel scan latency, quota consumption and high-volume live wallet performance require preview verification.

Dependency audit went from six findings, including one high, to zero reported findings. The release removes a full SDK that was used only for public key validation, replaces it with Base58 and Ed25519 primitives, and updates the locked PostCSS dependency. Secrets are read only by server modules and provider error responses omit upstream payloads and URLs.

## Release and rollback

1. Publish `development/v1-release` with GitHub write access. Keep `main` as the production branch until owner approval.
2. In Vercel project [didyoujeet](https://vercel.com/dyj-eet/didyoujeet), verify the preview environment for that branch has server-only `HELIUS_RPC_URL` and `BIRDEYE_API_KEY`, using the owner's existing service plans and quota. Vercel currently lists only `HELIUS_RPC_URL` in Production and no Preview variables for this project. The new candidate deliberately shows unavailable price data without Birdeye.
3. Verify the candidate on a Vercel preview against a genuinely empty address, a small trading wallet and a high-volume wallet. Verify partial coverage, historical price reads, provider consumption and response latency, and compare representative exits to public transaction records. Confirm native Safari sharing and image save on an iPhone.
4. Verify ownership and routing for `didyoujeet.xyz`. Vercel currently lists only `didyoujeet.vercel.app`. With owner approval for any domain or production changes, attach the custom domain, verify the records Vercel provides, and confirm HTTPS. The candidate's share links point to the verified Vercel domain.
5. After owner approval, merge the verified branch to `main` and confirm the new production deployment is ready. Smoke-test the domain and scanner.
6. If necessary, use Vercel Instant Rollback to the currently ready deployment `dpl_5Ud24y7pG2D6qmRhGWys8Dzqvw5V`. Confirm the aliases and scanner are back on the old deployment. Revert the merge separately if Git should also reflect the rollback.
