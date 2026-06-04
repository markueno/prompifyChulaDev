import { lazy, Suspense } from 'react'

// React.lazy replaces next/dynamic — Remix handles SSR exclusion at the route level
const PinCardsSection = lazy(() => import('./PinCards/PinCardsSection'))

const Fallback = (
  <section
    style={{
      width: '100vw',
      height: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: '#06060a',
    }}
  >
    <div
      style={{
        width: 48,
        height: 48,
        borderRadius: 12,
        background: 'rgba(255,255,255,0.05)',
        animation: 'pulse 2s cubic-bezier(0.4,0,0.6,1) infinite',
      }}
    />
  </section>
)

export default function DynamicPinCards() {
  return (
    <Suspense fallback={Fallback}>
      <PinCardsSection />
    </Suspense>
  )
}
