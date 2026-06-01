'use client'

export default function SectionBackground() {
  return (
    <div className="absolute inset-0 z-0 overflow-hidden">
      <div
        className="absolute inset-0"
        style={{
          background: [
            'radial-gradient(ellipse 60% 50% at 20% 30%, rgba(180, 120, 80, 0.15) 0%, transparent 60%)',
            'radial-gradient(ellipse 40% 40% at 80% 20%, rgba(200, 140, 90, 0.1) 0%, transparent 50%)',
            '#f0e4d5',
          ].join(', '),
        }}
      />
    </div>
  )
}
