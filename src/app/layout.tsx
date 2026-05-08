import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Исламский портал',
  description: 'Время намазов и исламские инструменты',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  )
}
