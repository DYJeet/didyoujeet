'use client';

import { useState } from 'react';
import { Download, Share2 } from 'lucide-react';
import type { Trade } from '../lib/ledger';
import type { ScanResult } from '../lib/scan';

const sample: Trade = {
  id: 'demo-wif', signature: '', mint: '', symbol: 'WIF', name: 'dogwifhat',
  quantity: 1000, sellTime: 1705276800, buySolSpent: 1, sellSolReceived: 1.28,
  solProfit: 0.28, buyUsd: 100, sellUsd: 128, profitUsd: 28, returnPercent: 28,
  feeSol: 0.000005, holdSeconds: 8 * 3600, peakTime: 1705795200,
  postSellMultiple: 4, missedUpsideUsd: 384,
};
export const demo = {
  mode: 'demo' as const, address: '', scanned: 32, complete: true, warnings: [],
  positions: [], trades: [sample],
};
type ReceiptResult = ScanResult | typeof demo;
const formatUsd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const usd = (value?: number | null) => value == null ? 'Unavailable' : formatUsd.format(value);
const sol = (value?: number | null) => value == null ? 'Unavailable' : value.toLocaleString('en-US', { maximumFractionDigits: 9 }) + ' SOL';
const amount = (value: number) => value.toLocaleString('en-US', { maximumSignificantDigits: 8 });
const date = (value: number | null) => value == null ? 'Time unavailable' : new Date(value * 1000).toLocaleString();
const token = (trade: { name?: string | null; symbol?: string | null; mint: string }) => trade.name || trade.symbol || trade.mint.slice(0, 8) + '…';

async function saveCard(lines: string[], demoMode: boolean) {
  const canvas = document.createElement('canvas');
  canvas.width = 1200;
  canvas.height = 630;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Image export unavailable.');
  context.fillStyle = '#101211';
  context.fillRect(0, 0, 1200, 630);
  context.fillStyle = '#c5ff4d';
  context.fillRect(0, 0, 1200, 18);
  context.font = '900 76px sans-serif';
  context.fillText('DID YOU JEET?', 64, 143);
  context.fillStyle = '#f5f6ed';
  context.font = '700 35px sans-serif';
  for (const [index, line] of lines.entries()) context.fillText(line, 64, 260 + index * 65, 775);
  context.fillStyle = '#c5ff4d';
  context.font = '700 24px sans-serif';
  context.fillText(demoMode ? 'ILLUSTRATIVE DEMO' : 'DIDYOUJEET', 64, 570);
  const mascot = document.querySelector('.cat svg');
  if (mascot) {
    const image = new Image();
    image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(mascot));
    await image.decode();
    context.drawImage(image, 841, 205, 305, 305);
  }
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(data => data ? resolve(data) : reject(new Error()), 'image/png'));
  const file = new File([blob], 'didyoujeet-receipt.png', { type: 'image/png' });
  if (navigator.canShare?.({ files: [file] }) && navigator.share) {
    try {
      await navigator.share({ files: [file], title: 'DidYouJeeT receipt' });
      return;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return;
    }
  }
  const url = URL.createObjectURL(blob);
  const download = document.createElement('a');
  download.href = url;
  download.download = file.name;
  download.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function Receipt({ result }: { result: ReceiptResult }) {
  const [limit, setLimit] = useState(12);
  const [shareError, setShareError] = useState('');
  const sampleMode = result.mode === 'demo';
  const matched = result.trades.filter(t => t.solProfit != null);
  const wins = matched.filter(t => t.solProfit! > 0);
  const losses = matched.filter(t => t.solProfit! < 0);
  const ranked = matched.slice().sort((a, b) => b.solProfit! - a.solProfit!);
  const best = wins.length ? ranked[0] : undefined;
  const worst = losses.length ? ranked[ranked.length - 1] : undefined;
  const realized = matched.length ? matched.reduce((sum, t) => sum + t.solProfit!, 0) : null;
  const realizedUsd = matched.length && matched.every(t => t.profitUsd != null)
    ? matched.reduce((sum, t) => sum + t.profitUsd!, 0) : null;
  const peaks = result.trades.filter(t => t.missedUpsideUsd != null);
  const biggest = peaks.filter(t => t.missedUpsideUsd! > 0).sort((a, b) => b.missedUpsideUsd! - a.missedUpsideUsd!)[0];
  const missed = peaks.length ? peaks.reduce((sum, t) => sum + t.missedUpsideUsd!, 0) : null;
  const shareLines = [
    ...(biggest ? ['Biggest observed JeeT: ' + token(biggest), usd(biggest.missedUpsideUsd) + ' hypothetical upside'] : []),
    ...(realized != null ? [sol(realized) + ' realized across ' + matched.length + ' matched exits'] : []),
    ...(!result.complete ? ['Partial wallet history'] : []),
  ];
  const shareText = [sampleMode ? 'DidYouJeeT demo 🐈' : 'Did I JeeT? 🐈', ...shareLines, 'https://didyoujeet.vercel.app'].join('\n');
  const status = realized == null ? 'UNDETERMINED' : realized < 0 ? 'PAPER HANDS' : realized > 0 ? 'DIAMOND HANDS' : 'BREAK EVEN';

  return <section className="results" id="results" tabIndex={-1} aria-labelledby="receipt-heading">
    <div className="section-label">YOUR JEET REPORT <span className="line" /></div>
    <div className="result-head">
      <div>
        <h2 id="receipt-heading">{sampleMode ? 'DEMO RECEIPT' : 'WALLET RECEIPT'} 💀</h2>
        <div className="receipt-status-inline"><strong>STATUS</strong><span className="status">{status}</span></div>
        <p>{sampleMode ? 'Illustrative sample.' : result.address.slice(0, 6) + '…' + result.address.slice(-6) + ' · ' + result.scanned + ' finalized transactions reviewed'}</p>
      </div>
      {shareLines.length > 0 && <div className="share-actions">
        <a className="share" href={'https://twitter.com/intent/tweet?text=' + encodeURIComponent(shareText)} target="_blank" rel="noopener noreferrer"><Share2 size={16} /> Share on X</a>
        <button className="share" onClick={() => void saveCard(shareLines, sampleMode).catch(() => setShareError('Could not create the image. Try Share on X.'))}><Download size={16} /> Share card</button>
      </div>}
    </div>
    {shareError && <p role="alert" className="error">{shareError}</p>}
    {result.warnings.map(warning => <p key={warning} className="warning">{warning}</p>)}
    <div className="result-summary">
      <div><small>REALIZED P&amp;L</small><strong>{sol(realized)}</strong><span>{usd(realizedUsd)} historical estimate · {matched.length}/{result.trades.length} exits with known SOL basis</span></div>
      <div><small>WIN RATE</small><b>{matched.length ? (100 * wins.length / matched.length).toFixed(1) + '%' : 'Unavailable'}</b><span>{wins.length} wins · {losses.length} losses · {matched.length - wins.length - losses.length} break-even</span></div>
      <div><small>BIGGEST OBSERVED JEET</small><b>{biggest ? '🏆 ' + token(biggest) : 'Unavailable'}</b><span>{biggest ? usd(biggest.missedUpsideUsd) + ' hypothetical upside' : 'No qualifying price above the sale value'}</span></div>
      <div><small>BEST TRADE</small><b>{best ? token(best) : 'Unavailable'}</b><span>{sol(best?.solProfit)}</span></div>
      <div><small>WORST TRADE</small><b>{worst ? token(worst) : 'Unavailable'}</b><span>{sol(worst?.solProfit)}</span></div>
      <div><small>OBSERVED MISSED UPSIDE</small><b>{usd(missed)}</b><span>{peaks.length}/{result.trades.length} exits with qualifying price coverage</span></div>
    </div>
    {!result.trades.length && <p>No supported token exits found in the retrieved history.</p>}
    <div className="cards">{result.trades.slice(0, limit).map(trade =>
      <article className={trade.solProfit != null && trade.solProfit > 0 ? 'trade trade-win' : 'trade'} key={trade.id}>
        <div className="trade-title">
          {trade.image && <img src={trade.image} alt="" loading="lazy" referrerPolicy="no-referrer" width={36} height={36}
            onError={event => { event.currentTarget.hidden = true; }} />}
          <h3>{token(trade)}</h3>
          {trade.symbol && <span className="muted">${trade.symbol}</span>}
          {biggest?.id === trade.id && <b className="green">🏆 Biggest observed JeeT</b>}
          {best?.id === trade.id && <b className="green">Best trade</b>}
        </div>
        <p className="trade-time">{amount(trade.quantity)} sold · {date(trade.sellTime)}</p>
        {trade.mint && <div className="trade-links">
          <a href={'https://dexscreener.com/solana/' + trade.mint} target="_blank" rel="noopener noreferrer">Chart ↗</a>
          <a href={'https://solscan.io/tx/' + trade.signature} target="_blank" rel="noopener noreferrer">Transaction ↗</a>
        </div>}
        <dl className="trade-values">
          <div><dt>FIFO basis</dt><dd>{sol(trade.buySolSpent)}<span>{usd(trade.buyUsd)}</span></dd></div>
          <div><dt>Sale proceeds</dt><dd>{sol(trade.sellSolReceived)}<span>{usd(trade.sellUsd)}</span></dd></div>
          <div><dt>Realized P&amp;L</dt><dd>{sol(trade.solProfit)}<span>{usd(trade.profitUsd)}</span></dd></div>
          <div><dt>Return</dt><dd>{trade.returnPercent == null ? 'Unavailable' : trade.returnPercent.toFixed(1) + '%'}</dd></div>
        </dl>
        <p className="trade-time">Network fee {sol(trade.feeSol)}{trade.holdSeconds != null && ' · Oldest lot held ' + amount(trade.holdSeconds / 3600) + 'h'}</p>
        {trade.peakTime != null && <p className="green">{usd(trade.missedUpsideUsd)} hypothetical · {trade.postSellMultiple?.toFixed(2)}× sale value<br /><small>Observed close {date(trade.peakTime)}</small></p>}
      </article>
    )}</div>
    {result.trades.length > limit && <button className="share show-more" onClick={() => setLimit(limit + 12)}>Show more exits</button>}
    {result.positions.length > 0 && <details className="positions"><summary>Token investment and remaining inventory</summary>
      <ul>{result.positions.slice(0, limit).map(position => <li key={position.mint}>
        <strong>{token(position)}</strong><span>{position.quantity == null ? 'Quantity unavailable' : amount(position.quantity) + ' remaining in ledger'}</span>
        <span>{sol(position.investedSol)} invested · {usd(position.investedUsd)} historical estimate</span>
        {position.quantity !== 0 && <span>{usd(position.unrealizedUsd)} unrealized P&amp;L{position.markTime != null && ' · marked ' + date(position.markTime)}</span>}
      </li>)}</ul>
      {result.positions.length > limit && <button className="share show-more" onClick={() => setLimit(limit + 12)}>Show more tokens</button>}
    </details>}
    <p className="disclaimer">Missed upside compares observed hourly closes within 30 days with actual sale proceeds. Volume and adjacent-hour checks screen price spikes. Market depth, slippage and execution can change what a sale would have returned.</p>
  </section>;
}
