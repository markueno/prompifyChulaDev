'use client'

import { useRef } from 'react'

interface OutroProps {
  onStartBuilding?: () => void
  onContactUs?: () => void
}

export default function Outro({ onStartBuilding, onContactUs }: OutroProps) {
  const sectionRef = useRef<HTMLElement>(null)

  return (
    <section className="outro" ref={sectionRef}>
      <h2 className="shimmer-text">
        <span style={{ color: '#f97316' }}>Prompt</span><br />
        Refine and Deploy
      </h2>
      <p>
        From retail CRMs to logistics systems, Prompify AI powers smart integrations that transform daily operations.
        <br /><br /><b>At Prompify, creativity meets creation.</b>
      </p>
      <div className="outro-buttons">
        <button className="outro-cta-btn" onClick={() => onStartBuilding ? onStartBuilding() : window.location.href = '/signup'}>
          Start Building
        </button>
        <button className="contact-us-btn" onClick={() => onContactUs ? onContactUs() : window.location.href = '/contact'}>
          Contact Us
        </button>
      </div>
    </section>
  )
}

