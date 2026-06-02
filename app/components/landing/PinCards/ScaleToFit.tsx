'use client'
import { useRef, useState, useEffect, type ReactNode } from 'react'

interface Props {
  designWidth: number
  children: ReactNode
}

export default function ScaleToFit({ designWidth, children }: Props) {
  const outerRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)

  useEffect(() => {
    const el = outerRef.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => {
      const w = entry.contentRect.width
      setScale(Math.min(1.4, w / designWidth))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [designWidth])

  return (
    <div ref={outerRef} style={{ width: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
      <div style={{ transform: `scale(${scale})`, transformOrigin: 'center center', width: designWidth, flexShrink: 0 }}>
        {children}
      </div>
    </div>
  )
}