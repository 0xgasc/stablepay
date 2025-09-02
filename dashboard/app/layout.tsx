import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'StablePay Dashboard',
  description: 'Multi-chain USDC payment management',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className="bg-gray-50">{children}</body>
    </html>
  )
}