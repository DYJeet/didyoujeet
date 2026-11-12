import { NextResponse } from 'next/server';

export async function POST() {
  return NextResponse.json({ error: 'Post-sale pricing is included in the wallet scan.' }, { status: 410 });
}
