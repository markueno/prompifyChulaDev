import { useEffect, useRef } from 'react'

interface NavbarProps {
  onLogin: () => void
  onSignUp: () => void
}

export default function Navbar({ onLogin, onSignUp }: NavbarProps) {
  const navRef = useRef<HTMLElement>(null)

  useEffect(() => {
    const nav = navRef.current
    if (!nav) return

    const handleScroll = () => {
      const scrollY = window.scrollY
      const opacity = Math.max(0, 1 - (scrollY - 60) / 120)
      nav.style.opacity = String(opacity)
      nav.style.pointerEvents = opacity < 0.05 ? 'none' : 'auto'
    }

    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  return (
    <nav
      ref={navRef}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 9998,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0.45rem 2rem',
        background: 'rgba(255, 255, 255, 0.11)',
        backdropFilter: 'blur(28px) saturate(1.3)',
        WebkitBackdropFilter: 'blur(28px) saturate(1.3)',
        borderBottom: '1px solid rgba(255, 255, 255, 0.16)',
        boxShadow: '0 1px 0 rgba(255,255,255,0.18) inset',
        fontFamily: 'var(--font-inter), -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      }}
    >
      <img src="/prompify2.png" alt="Prompify" width={30} height={30} style={{ display: 'block' }} />

      <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
        <button
          onClick={onLogin}
          style={{
            padding: '0.375rem 0.85rem',
            borderRadius: '9999px',
            background: 'rgba(255, 255, 255, 0.22)',
            border: '1px solid rgba(255, 255, 255, 0.06)',
            color: 'white',
            fontSize: '0.75rem',
            fontWeight: 500,
            cursor: 'pointer',
            fontFamily: 'inherit',
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)',
          }}
        >
          Login
        </button>

        <button
          onClick={onSignUp}
          style={{
            padding: '0.375rem 0.85rem',
            borderRadius: '9999px',
            background: 'rgba(249, 115, 22, 0.38)',
            border: '1px solid rgba(249, 115, 22, 0.1)',
            color: 'white',
            fontSize: '0.75rem',
            fontWeight: 600,
            cursor: 'pointer',
            fontFamily: 'inherit',
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)',
          }}
        >
          Sign Up
        </button>
      </div>
    </nav>
  )
}
