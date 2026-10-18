import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: 'Did You Jeet? | We Have the Receipts', description: 'Find out whether you sold your Solana bags too early. A hilarious wallet scanner for paper hands.' };
export default function RootLayout({children}:{children:React.ReactNode}) { return <html lang="en"><body>{children}</body></html> }
