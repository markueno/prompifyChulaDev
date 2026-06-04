import { useRef, useState, useEffect, Suspense, type ComponentType } from 'react'

interface LazyVisualProps {
  component: ComponentType
  rootMargin?: string
}

export default function LazyVisual({ component: Component, rootMargin = '200px' }: LazyVisualProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [isVisible, setIsVisible] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true)
          // Once visible, keep it mounted (no unload on scroll away)
          // If you want to unmount on leave, remove this disconnect:
          // observer.disconnect()
        } else {
          // Unmount when out of view to free resources
          setIsVisible(false)
        }
      },
      { rootMargin }
    )

    observer.observe(el)
    return () => observer.disconnect()
  }, [rootMargin])

  return (
    <div ref={ref} className="w-full h-full">
      {isVisible ? <Suspense fallback={null}><Component /></Suspense> : null}
    </div>
  )
}