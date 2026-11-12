'use client';
import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Search, Share2, Wallet, Zap, ShieldCheck } from 'lucide-react';
import JeetCat from '../components/JeetCat';
import { Receipt, demo } from '../components/Receipt';
import type { ScanResult } from '../lib/scan';

export default function Home() {
  const [address, setAddress] = useState('');
  const [result, setResult] = useState<ScanResult | typeof demo | null>(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const inFlight = useRef(false);

  useEffect(() => {
    if (result) document.getElementById('results')?.focus({ preventScroll: false });
  }, [result]);

  async function scan(wallet?: string) {
    if (inFlight.current) return;
    setError('');
    if (wallet === 'demo') {
      setResult(demo);
      return;
    }
    const input = (wallet ?? address).trim();
    if (!input) {
      setError('Paste a Solana wallet address first.');
      return;
    }
    inFlight.current = true;
    setResult(null);
    setLoading(true);
    setProgress('Retrieving finalized wallet history…');
    try {
      const response = await fetch('/api/scan', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/x-ndjson' },
        body: JSON.stringify({ address: input }), signal: AbortSignal.timeout(65_000),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error || 'Wallet scan is temporarily unavailable.');
      }
      if (!response.body) throw new Error('Wallet scan was interrupted.');
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = '';
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += value;
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';
          for (const line of lines) {
            const event = JSON.parse(line);
            if (event.error) throw new Error(event.error);
            if (event.result) {
              setResult(event.result);
              return;
            }
            if (event.progress?.stage === 'history') setProgress(event.progress.count + ' transactions retrieved…');
            if (event.progress?.stage === 'pricing') setProgress('Checking cost basis and historical prices…');
          }
        }
        throw new Error('Wallet scan was interrupted. Try again.');
      } finally {
        await reader.cancel().catch(() => {});
      }
    } catch (failure) {
      setError(failure instanceof Error && failure.name !== 'TimeoutError' ? failure.message : 'The scan timed out. Try again.');
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }

  async function connect() {
    const injected = window as Window & { solana?: { isPhantom?: boolean; connect(): Promise<{ publicKey: { toString(): string } }> } };
    if (!injected.solana?.isPhantom) {
      setError('Open in Phantom’s browser or paste a public wallet address.');
      return;
    }
    try {
      const connection = await injected.solana.connect();
      const wallet = connection.publicKey.toString();
      setAddress(wallet);
      await scan(wallet);
    } catch {
      setError('Wallet connection cancelled. You can still paste an address.');
    }
  }

  return <main><div className="noise" /><header className="topbar"><div className="brand"><span className="brand-icon">😼</span> DID<span>YOU</span>JEET<span className="dot">.XYZ</span></div><div className="header-right"><span className="chain"><span className="pulse" /> BUILT ON SOLANA</span><button className="connect" onClick={connect} disabled={loading} aria-label="Connect Phantom wallet"><Wallet size={16} /> CONNECT WALLET</button></div></header>
    <section className="hero"><div className="eyebrow"><span>✦</span> THE ULTIMATE PAPER HANDS DETECTOR <span>✦</span></div><div className="hero-layout"><div className="hero-copy"><h1>DID YOU <span>JEET<span className="question">?</span></span></h1><p className="lead">That bag you sold for lunch money?<br /><strong>Yeah. It probably went to the moon.</strong></p><p className="muted">Paste any Solana wallet. Expose your worst exits. Get roasted by a cat. No wallet connection required.</p><div className="scanbox"><div className="inputrow"><Search size={22} /><input aria-label="Solana wallet address" autoCapitalize="none" autoCorrect="off" spellCheck={false} maxLength={64} placeholder="Paste your Solana wallet address..." value={address} onChange={e => setAddress(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') scan() }} /></div><button className="scanbtn" disabled={loading} onClick={() => scan()}>{loading ? 'SCANNING...' : 'EXPOSE MY PAPER HANDS'} <ArrowRight size={19} /></button></div><div className="under-input"><span><ShieldCheck size={15} /> Read-only. No signing.</span><button disabled={loading} onClick={() => scan('demo')}>TRY DEMO <ArrowRight size={14} /></button><a
  href="https://github.com/DYJeet/didyoujeet"
  target="_blank"
  rel="noopener noreferrer"
  className="secondary-btn"
>
  GitHub ⭐
</a></div>{loading && <p role="status" className="muted">{progress}</p>}{error && <div className="error" role="alert">{error}</div>}</div><div className="mascot-wrap"><div className="burst burst1">✳</div><div className="burst burst2">✦</div><div className="speech">YOU SOLD<br />THERE?! <span>💀</span></div><div className="cat"><JeetCat size={290} /></div><div className="tag">MEET JEET THE CAT 🐈</div></div></div></section>
    <section className="ticker"><div>💸 SOLD TOO EARLY <span>✳</span> 🐈 WE HAVE THE RECEIPTS <span>✳</span> 📉 BUY HIGH SELL LOW <span>✳</span> 💎 DIAMOND HANDS NOT FOUND <span>✳</span> 💸 SOLD TOO EARLY <span>✳</span> 🐈 WE HAVE THE RECEIPTS</div></section>
    {result && <Receipt result={result} />}
    <section className="how"><div className="section-label">HOW IT WORKS <span className="line" /></div><h2>THREE STEPS TO <span>EMOTIONAL DAMAGE.</span></h2><div className="steps"><div><div className="stepicon">01 <Wallet /></div><h3>DROP THE ADDRESS</h3><p>Paste a public Solana address. No seed phrases, signatures, or sketchy approvals.</p></div><div><div className="stepicon">02 <Zap /></div><h3>FIND YOUR EXITS</h3><p>Review historical sells and compare them with subsequent price moves where reliable data exists.</p></div><div><div className="stepicon">03 <Share2 /></div><h3>SHARE THE PAIN</h3><p>Get your receipt, laugh through the pain, and post your biggest jeet to X.</p></div></div></section>
    <section className="bottom-cta"><div className="emoji">😹</div><h2>THE CHART WENT UP.<br /><span>YOU WENT HOME.</span></h2><p>Every wallet has a story. Some are just embarrassing.</p><button onClick={() => { window.scrollTo({ top: 0, behavior: 'smooth' }); document.querySelector('input')?.focus() }}>CHECK YOUR WALLET <ArrowRight size={18} /></button></section><footer><div className="brand">😼 DID<span>YOU</span>JEET<span className="dot">.XYZ</span></div><span>MADE FOR THE SOLANA DEGENS. NOT FINANCIAL ADVICE.</span><span>© {new Date().getFullYear()} DIDYOUJEET</span></footer></main>
}
