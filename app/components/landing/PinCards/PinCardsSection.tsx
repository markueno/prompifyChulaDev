import { useRef, lazy } from 'react'
import { useGSAP } from '@gsap/react'
import gsap from 'gsap'
import ScrollTrigger from 'gsap/ScrollTrigger'
import PinCard from './PinCard'
import SectionBackground from './SectionBackground'
import LazyVisual from './LazyVisual'
import WebGLErrorBoundary from '../WebGLErrorBoundary'

gsap.registerPlugin(useGSAP, ScrollTrigger)

// React.lazy replaces next/dynamic — Suspense boundaries are inside LazyVisual
const PromptToProduct             = lazy(() => import('./scenes/PromptToProduct'))
const BusinessIntelligenceVisual  = lazy(() => import('./scenes/BusinessIntelligenceVisual'))
const ConstellationVisual         = lazy(() => import('./scenes/ConstellationVisual'))
const SecurityVisual              = lazy(() => import('./scenes/SecurityVisual'))
const DeployVisual                = lazy(() => import('./scenes/DeployVisual'))

// Thin always-mounted wrapper for BusinessIntelligenceVisual — the component manages its own
// IntersectionObserver pause/resume internally, so we never destroy/recreate the WebGL context.
function BIWrapper() {
  return (
    <WebGLErrorBoundary>
      <BusinessIntelligenceVisual />
    </WebGLErrorBoundary>
  )
}

const CARD_DATA = [
  {
    heading: 'Prompt to Product',
    description:
      'Turn any prompt into a fully functional business application. No code required — just describe what you need and watch it come to life.',
    Visual: PromptToProduct,
  },
  {
    heading: 'Business Intelligence',
    description:
      'Healthcare, finance, retail, education, tech — Prompify adapts to your domain with specialized prompt templates and compliance guardrails.',
    Visual: BIWrapper,
  },
  {
    heading: 'Every Model. One Platform.',
    description:
      'Seamlessly route between GPT-4, Claude, DeepSeek, Groq, and Mistral. Prompify automatically selects the best model for each task.',
    Visual: ConstellationVisual,
  },
  {
    heading: 'Your Data. Your Control.',
    description:
      'SOC 2 compliant. End-to-end encryption. Zero data retention. Enterprise-grade security that never compromises on capability.',
    Visual: SecurityVisual,
  },
  {
    heading: 'Deploy with Confidence',
    description:
      'SSO, audit logs, role-based access, and 99.9% uptime SLA. Go from pilot to production in days, not months.',
    Visual: DeployVisual,
  },
] as const

export default function PinCardsSection() {
  const containerRef = useRef<HTMLDivElement>(null)

  useGSAP(() => {
    const pinCards = gsap.utils.toArray<HTMLElement>('.pin-card')

    pinCards.forEach((card, index) => {
      if (index < pinCards.length - 1) {
        ScrollTrigger.create({
          trigger: card,
          start: 'top top',
          endTrigger: pinCards[pinCards.length - 1],
          end: 'top top',
          pin: true,
          pinSpacing: false,
        })

        gsap.to(card, {
          scrollTrigger: {
            trigger: pinCards[index + 1],
            start: 'top bottom',
            end: 'top center',
            scrub: 1.5,
          },
          opacity: 0,
          ease: 'none',
        })

        gsap.to(card, {
          scrollTrigger: {
            trigger: pinCards[index + 1],
            start: 'top bottom',
            end: 'bottom top',
            scrub: 1.5,
          },
          scale: 0.85,
          rotationX: index % 2 === 0 ? 10 : -10,
          force3D: true,
          ease: 'none',
        })
      }
    })

  }, { scope: containerRef })

  return (
    <section
      ref={containerRef}
      className="pin-cards-section relative"
      style={{ background: '#f0e4d5' }}
    >
      <SectionBackground />

      {CARD_DATA.map(({ heading, description, Visual }, index) => (
        <PinCard
          key={index}
          heading={heading}
          description={description}
          index={index}
        >
          <LazyVisual component={Visual} rootMargin="300px" />
        </PinCard>
      ))}
    </section>
  )
}