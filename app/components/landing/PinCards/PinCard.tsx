'use client'

import { type ReactNode } from 'react'

interface PinCardProps {
  heading: string
  description: string
  index: number
  children: ReactNode
}

export default function PinCard({ heading, description, index, children }: PinCardProps) {
  return (
    <section
      className="pin-card"
      style={{ background: 'transparent' }}
    >
      <div
        className="pin-card-inner"
        style={{ background: 'transparent' }}
      >
        {/* Number + text header row */}
        <div className="pin-card-header">
          <span className="card-number">
            {String(index + 1).padStart(2, '0')}
          </span>
          <div className="pin-card-text">
            <h2 style={{ color: '#231710' }}>{heading}</h2>
            <p style={{ color: '#231710' }}>{description}</p>
          </div>
        </div>

        {/* Animation — centered, takes remaining height */}
        <div className="pin-card-canvas">
          {children}
        </div>
      </div>
    </section>
  )
}
