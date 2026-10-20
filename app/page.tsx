'use client';
import { useState } from 'react';
import { ArrowRight, Copy, ExternalLink, Search, Share2, Wallet, Zap, ShieldCheck } from 'lucide-react';
import JeetCat from '../components/JeetCat';

type Trade = { symbol: string; name?: string | null; image?: string | null; missedGainPercent?: number | null; missedUpsideUsd?: number | null; solProfit?: number; buySolSpent?: number; buyUsd?: number | null; sellUsd?: number | null; profitUsd?: number | null; holdSeconds?: number | null; mint: string; sellTime?: number | null; soldUsd: number; sellSolReceived?: number; returnPercent?: number | null; postSellMultiple?: number | null; peakMultiple: number; missedUsd: number; soldAt: string; status: string };
type Result = { address: string; mode: 'demo' | 'live'; trades: Trade[]; scanned: number; warning?: string };
const demo: Result = { address: 'DEMO-WALLET', mode: 'demo', scanned: 32, trades: [{ symbol: 'WIF', mint: '', soldUsd: 128, peakMultiple: 84, missedUsd: 10624, soldAt: '2024-01-14', status: 'LEGENDARY JEET' }, { symbol: 'BONK', mint: '', soldUsd: 63, peakMultiple: 37, missedUsd: 2268, soldAt: '2023-11-18', status: 'ABSOLUTE PAPER HANDS' }, { symbol: 'POPCAT', mint: '', soldUsd: 220, peakMultiple: 12, missedUsd: 2420, soldAt: '2024-04-22', status: 'CERTIFIED JEET' }] };
const money = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
const formatHoldTime = (seconds?: number | null) => {
  if (seconds == null) return 'N/A';

  const mins = Math.floor(seconds / 60);
  const hours = Math.floor(mins / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}D ${hours % 24}H`;
  if (hours > 0) return `${hours}H ${mins % 60}M`;
  return `${mins}M`;
};

export default function Home() {
  const [address, setAddress] = useState(''); const [result, setResult] = useState<Result | null>(null);

  const [extraProgress, setExtraProgress] = useState({
  done: 0,
  total: 0,
  running: false,
});

   const [loading, setLoading] = useState(false); const [error, setError] = useState(''); const [copied, setCopied] = useState(false);

  const safeTrades = result?.trades ?? [];
  const matchedTrades = safeTrades.filter((t) => t.returnPercent != null);
  const winningTrades = matchedTrades.filter(
    (t) => (t.returnPercent ?? 0) > 0
  );

  const winRate = matchedTrades.length
    ? (winningTrades.length / matchedTrades.length) * 100
    : 0;

  const total = matchedTrades.length
    ? matchedTrades.reduce((sum, t) => sum + (t.returnPercent ?? 0), 0) / matchedTrades.length
    : 0;
  const totalMissedUpside = safeTrades.reduce(
    (sum, t) => sum + (t.missedUpsideUsd ?? 0),
    0

  );

  const biggestJeet = safeTrades.reduce<Trade | null>((best, t) => {
    const currentValue = t.missedUpsideUsd ?? 0;
    const bestValue = best?.missedUpsideUsd ?? 0;

    return currentValue > bestValue ? t : best;
  }, null);

  const bestTrade = safeTrades.reduce<Trade | null>((best, t) => {
    const currentProfit = t.profitUsd ?? 0;
    const bestProfit = best?.profitUsd ?? 0;

    return currentProfit > bestProfit ? t : best;
  }, null);

  async function scanExtraTrades(data: Result) {

    
    const extraTrades = (data.trades ?? []).slice(12);

    setExtraProgress({
      done: 0,
      total: extraTrades.length,
      running: extraTrades.length > 0,
    });

    for (const trade of extraTrades) {
      if (!trade.mint || !trade.sellTime) continue;

      const response = await fetch('/api/scan/peak', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mint: trade.mint,
          sellTime: trade.sellTime,
        })
      })
      if (!response.ok) continue;

      const peak = await response.json();

      const postSellMultiple = peak?.postSellMultiple ?? null;

      const missedUpsideUsd = 
      trade.sellUsd != null && postSellMultiple != null
        ? trade.sellUsd * Math.max(0, postSellMultiple - 1)
        : null;

setResult((current) => {
  if (!current) return current;

  return {
    ...current,
    trades: current.trades.map((t) =>
      t.mint === trade.mint && t.sellTime === trade.sellTime
        ? {
            ...t,
            postSellMultiple,
            missedGainPercent:
              postSellMultiple != null
                ? Math.max(0, (postSellMultiple - 1) * 100)
                : null,
            missedUpsideUsd,
          }
        : t
    ),
  };
});

setExtraProgress((current) => ({
  ...current,
  done: current.done + 1,
}));

await new Promise((resolve) => setTimeout(resolve, 1100));

}

setExtraProgress((current) => ({
  ...current,
  running: false,
}));

  }



  async function scan(wallet?: string) { setError(''); setLoading(true); setResult(null); try { if (wallet === 'demo') { setResult(demo); return; } const addr = (wallet || address).trim(); if (!addr) throw new Error('Paste a Solana wallet address first.'); const r = await fetch('/api/scan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ address: addr }) }); const data = await r.json(); if (!r.ok) throw new Error(data.error || 'Scan failed'); setResult(data); void scanExtraTrades(data); } catch (e) { setError(e instanceof Error ? e.message : 'Something went wrong') } finally { setLoading(false) } }
  async function connect() { try { const provider = (window as any).solana; if (!provider?.isPhantom) { setError('Phantom not detected. Install Phantom, or paste a public wallet address instead.'); return; } const response = await provider.connect(); const a = response.publicKey.toString(); setAddress(a); await scan(a) } catch { setError('Wallet connection cancelled. You can still paste an address.') } }
  function share() { if (!result) return; const text = `💀 DID I JEET? 💀\n${result.mode === 'demo' ? 'DEMO RESULT — ' : ''}My paper hands missed ${money(total)} across ${(result.trades?.length ?? 0)} trades.\nWe have the receipts. 🐈\ndidyoujeet.xyz`; window.open('https://twitter.com/intent/tweet?text=' + encodeURIComponent(text), '_blank', 'noopener,noreferrer') }
  return <main><div className="noise" /><header className="topbar"><div className="brand"><span className="brand-icon">😼</span> DID<span>YOU</span>JEET<span className="dot">.XYZ</span></div><div className="header-right"><span className="chain"><span className="pulse" /> BUILT ON SOLANA</span><button className="connect" onClick={connect}><Wallet size={16} /> CONNECT WALLET</button></div></header>
    <section className="hero"><div className="eyebrow"><span>✦</span> THE ULTIMATE PAPER HANDS DETECTOR <span>✦</span></div><div className="hero-layout"><div className="hero-copy"><h1>DID YOU <span>JEET<span className="question">?</span></span></h1><p className="lead">That bag you sold for lunch money?<br /><strong>Yeah. It probably went to the moon.</strong></p><p className="muted">Paste any Solana wallet. Expose your worst exits. Get roasted by a cat. No wallet connection required.</p><div className="scanbox"><div className="inputrow"><Search size={22} /><input aria-label="Solana wallet address" placeholder="Paste your Solana wallet address..." value={address} onChange={e => setAddress(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') scan() }} /></div><button className="scanbtn" disabled={loading} onClick={() => scan()}>{loading ? 'SCANNING...' : 'EXPOSE MY PAPER HANDS'} <ArrowRight size={19} /></button></div><div className="under-input"><span><ShieldCheck size={15} /> Read-only. No signing.</span><button onClick={() => scan('demo')}>TRY DEMO <ArrowRight size={14} /></button><a
  href="https://github.com/DYJeet/didyoujeet"
  target="_blank"
  rel="noopener noreferrer"
  className="secondary-btn"
>
  GitHub ⭐
</a></div>{error && <div className="error">{error}</div>}</div><div className="mascot-wrap"><div className="burst burst1">✳</div><div className="burst burst2">✦</div><div className="speech">YOU SOLD<br />THERE?! <span>💀</span></div><div className="cat"><JeetCat size={290} /></div><div className="tag">MEET JEET THE CAT 🐈</div></div></div></section>
    <section className="ticker"><div>💸 SOLD TOO EARLY <span>✳</span> 🐈 WE HAVE THE RECEIPTS <span>✳</span> 📉 BUY HIGH SELL LOW <span>✳</span> 💎 DIAMOND HANDS NOT FOUND <span>✳</span> 💸 SOLD TOO EARLY <span>✳</span> 🐈 WE HAVE THE RECEIPTS</div></section>
    {result && <section className="results" id="results"><div className="section-label">YOUR JEET REPORT <span className="line" /></div>{extraProgress.running && (<div className="tiny green">Analyzing remaining trades... {extraProgress.done}/{extraProgress.total}</div>)}<div className="result-head"><div><h2>{result.mode === 'demo' ? 'DEMO JEET RECEIPT' : 'WALLET RECEIPT'} <span>💀</span></h2><div><small>STATUS</small><strong className="status">{safeTrades.length ? (total < 0 ? 'PAPER HANDS' : 'DIAMOND HANDS') : 'UNDETERMINED'}</strong><span>Jeet the cat is judging you</span></div><p>{result.mode === 'demo' ? 'Illustrative sample data — not a real wallet scan.' : `${result.address.slice(0, 6)}...${result.address.slice(-6)} • ${result.scanned} transactions reviewed`}</p></div><button className="share" onClick={share}><Share2 size={16} /> SHARE ON X</button></div><div className="result-summary"><div><small>AVERAGE RETURN</small><strong>{total.toFixed(1)}%</strong><span>Average return across matched Buy/Sell pairs</span></div>
      <div>
        <small>WIN RATE</small>
        <b className="green">{winRate.toFixed(1)}%</b>
        <div className="tiny green">
          {winningTrades.length} wins / {matchedTrades.length} matched trades
        </div>
      </div>
      <div>
        <small>TOTAL MISSED UPSIDE</small>
        <b className="green">≈ ${totalMissedUpside.toFixed(2)}</b>
        <div className="tiny">
          Combined post-sell upside
        </div>
      </div>
      <div>
        <small>BIGGEST JEET</small>
        <b className="green">
          {biggestJeet ? biggestJeet.name ?? biggestJeet.symbol : 'N/A'}
        </b>
        <div className="tiny">
          {biggestJeet?.missedUpsideUsd != null
            ? `≈ $${biggestJeet.missedUpsideUsd.toFixed(2)} missed`
            : 'No missed upside found'}
        </div>
      </div>
      <div>
        <small>BEST TRADE</small>
        <b className="green">
          {bestTrade ? bestTrade.name ?? bestTrade.symbol : 'N/A'}
        </b>
        <div className="tiny green">
          {bestTrade?.profitUsd != null
            ? `≈ +$${bestTrade.profitUsd.toFixed(2)} profit`
            : 'No profitable trade found'}
        </div>
      </div>
      <div><small>JEETS FOUND</small><strong>{matchedTrades.length}</strong><span>Potential early exits</span></div></div>{result.warning && <p className="warning">⚠ {result.warning}</p>}<div className="cards">{safeTrades.map((t, i) =>
        <article
          className={t.returnPercent != null && t.returnPercent > 0 ? 'trade trade-win' : 'trade'}
          key={i}
        >
          <div className="trade-top"><span className="rank">#{i + 1}</span>{biggestJeet?.mint ===t.mint && biggestJeet?.sellTime === t.sellTime && (
            <span className="tiny green">🏆 BIGGEST JEET</span>
          )}{bestTrade?.mint === t.mint && (
            <span className="tiny green">🏆 BEST TRADE</span>
          )}<div>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  {t.image ? (
                    <img
                      src={t.image}
                      alt={t.name ?? t.symbol}
                      width={42}
                      height={42}
                      style={{
                        borderRadius: '50%',
                        objectFit: 'cover',
                        flexShrink: 0,
                      }}
                    />



                  ) : (
                    <div
                      style={{
                        width: 42,
                        height: 42,
                        borderRadius: '50%',
                        background: '#202020',
                        flexShrink: 0,
                      }}
                    />
                  )}

                  <div>
                    <h3>{t.name ?? t.symbol}</h3>
                    <div className="tiny">
                      {t.symbol ? `$${t.symbol}` : ''}
                    </div>
                  </div>
                </div>

                <div className="tiny">
                  {t.missedGainPercent != null
                    ? `GAIN MISSED +${t.missedGainPercent.toFixed(1)}%`
                    : 'GAIN MISSED N/A'}
                </div>

                <div className="tiny">
                  {t.missedUpsideUsd != null
                    ? `≈ $${t.missedUpsideUsd.toFixed(2)} MISSED UPSIDE`
                    : ''}
                </div>

                <a
                  href={`https://dexscreener.com/solana/${t.mint}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="tiny"
                >
                  VIEW CHART ↗
                </a>

                <div className="tiny">
                  HELD {formatHoldTime(t.holdSeconds)}
                </div>


              </div><span className="tiny">{t.status}</span></div><span className="multiple">{t.peakMultiple}× {t.returnPercent == null
                ? 'UNMATCHED'
                : t.postSellMultiple == null
                  ? 'AFTER SELL'
                  : t.postSellMultiple <= 1.01
                    ? 'NO HIGHER HIGH'
                    : `${t.postSellMultiple.toFixed(2)}x AFTER SELL`}

            </span></div><div className="trade-bottom"><div>
              <small>BOUGHT FOR</small>
              <b>{(t.buySolSpent ?? 0).toFixed(4)} SOL</b>

              <div className="tiny">
                {t.buyUsd != null ? `≈ $${t.buyUsd.toFixed(2)}` : ''}
              </div>

              <small>SOLD FOR</small>
              <b>{(t.sellSolReceived ?? 0).toFixed(4)} SOL</b>

              <div className="tiny">
                {t.sellUsd != null ? `≈ $${t.sellUsd.toFixed(2)}` : ''}
              </div>

            </div><div><small>
              {t.returnPercent == null
                ? 'RETURN'
                : t.returnPercent >= 0
                  ? 'PROFIT'
                  : 'LOSS'}
            </small>

              <b className="green">
                {t.returnPercent == null
                  ? 'N/A'
                  : `${t.returnPercent > 0 ? '+' : ''}${t.returnPercent.toFixed(1)}%`}
              </b>

              <div className="tiny">
                {t.solProfit != null
                  ? `${t.solProfit >= 0 ? 'PROFIT MADE' : 'LOSS TAKEN'} ${t.solProfit > 0 ? '+' : ''}${t.solProfit.toFixed(4)} SOL`
                  : ''}
              </div><div className="tiny">
                {t.profitUsd != null
                  ? `≈ ${t.profitUsd >= 0 ? '+' : '-'}$${Math.abs(t.profitUsd).toFixed(2)}`
                  : ''}
              </div></div></div></article>)}</div>{!safeTrades.length && <p>No verified jeets found in this scan. That's not proof of diamond hands — try a wallet with more history.</p>}<p className="disclaimer">Results are entertainment, not financial advice. Price peaks do not account for liquidity, slippage, fees, or execution. Never share seed phrases.</p></section>}
    <section className="how"><div className="section-label">HOW IT WORKS <span className="line" /></div><h2>THREE STEPS TO <span>EMOTIONAL DAMAGE.</span></h2><div className="steps"><div><div className="stepicon">01 <Wallet /></div><h3>DROP THE ADDRESS</h3><p>Paste a public Solana address. No seed phrases, signatures, or sketchy approvals.</p></div><div><div className="stepicon">02 <Zap /></div><h3>FIND YOUR EXITS</h3><p>Review historical sells and compare them with subsequent price moves where reliable data exists.</p></div><div><div className="stepicon">03 <Share2 /></div><h3>SHARE THE PAIN</h3><p>Get your receipt, laugh through the pain, and post your biggest jeet to X.</p></div></div></section>
    <section className="bottom-cta"><div className="emoji">😹</div><h2>THE CHART WENT UP.<br /><span>YOU WENT HOME.</span></h2><p>Every wallet has a story. Some are just embarrassing.</p><button onClick={() => { window.scrollTo({ top: 0, behavior: 'smooth' }); document.querySelector('input')?.focus() }}>CHECK YOUR WALLET <ArrowRight size={18} /></button></section><footer><div className="brand">😼 DID<span>YOU</span>JEET<span className="dot">.XYZ</span></div><span>MADE FOR THE SOLANA DEGENS. NOT FINANCIAL ADVICE.</span><span>© {new Date().getFullYear()} DIDYOUJEET</span></footer></main>
}
