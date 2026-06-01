'use client'

import { useRef } from 'react'

interface OutroProps {
  onStartBuilding?: () => void
}

export default function Outro({ onStartBuilding }: OutroProps) {
  const sectionRef = useRef<HTMLElement>(null)

  const scrollToFooter = (e: React.MouseEvent) => {
    e.preventDefault()
    document.querySelector('.info')?.scrollIntoView({ behavior: 'smooth' })
  }

  return (
    <section className="outro" ref={sectionRef}>
      <h2 className="shimmer-text">
        <span style={{ color: '#fb923c' }}>Prompt</span><br />
        Refine and Deploy
      </h2>
      <p>
        From retail CRMs to logistics systems, Prompify AI powers smart integrations that transform daily operations.
        <br /><br /><b>At Prompify, creativity meets creation.</b>
      </p>
      <div className="outro-buttons">
        <button className="outro-cta-btn" onClick={() => onStartBuilding?.()}>
          Start Building
        </button>
        <a href="#contact" className="contact-us-btn" onClick={scrollToFooter}>
          Contact Us
        </a>
      </div>
    </section>
  )
}

