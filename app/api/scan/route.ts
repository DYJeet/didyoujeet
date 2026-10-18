import { NextResponse } from 'next/server';
import { PublicKey } from '@solana/web3.js';
export async function POST(request:Request){
  let address:unknown;
  try{({address}=await request.json())}catch{return NextResponse.json({error:'Invalid request body.'},{status:400})}
  if(typeof address!=='string'||address.length>64)return NextResponse.json({error:'Enter a valid Solana wallet address.'},{status:400});
  try{const key=new PublicKey(address);if(!PublicKey.isOnCurve(key.toBytes()))return NextResponse.json({error:'Please enter a regular wallet address (not a program-derived address).'},{status:400})}catch{return NextResponse.json({error:'That does not look like a valid Solana address.'},{status:400})}
  // Honest MVP: the real on-chain indexer and historical token-price engine are not configured.
  // Never fabricate a wallet's trades, P&L, or missed upside.
  return NextResponse.json({error:'Live wallet scanning is not enabled in this preview yet. Click TRY DEMO to explore the experience. Production scanning requires an indexed transaction feed and reliable historical token prices.'},{status:503});
}
