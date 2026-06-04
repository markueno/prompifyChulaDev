'use client'

import { useEffect, useRef } from 'react'

interface NavbarProps {
  onLogin?: () => void
  onSignUp?: () => void
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
          onClick={() => onLogin ? onLogin() : window.location.href = '/login'}
          style={{
            padding: '0.375rem 0.9rem',
            borderRadius: '9999px',
            background: 'linear-gradient(135deg, rgba(255,255,255,0.28), rgba(255,255,255,0.14))',
            border: '1px solid rgba(255, 255, 255, 0.35)',
            color: 'rgba(255, 255, 255, 0.97)',
            fontSize: '0.75rem',
            fontWeight: 500,
            cursor: 'pointer',
            fontFamily: 'inherit',
            backdropFilter: 'blur(16px) saturate(1.4)',
            WebkitBackdropFilter: 'blur(16px) saturate(1.4)',
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.55), 0 2px 8px rgba(0,0,0,0.18)',
            textShadow: '0 1px 2px rgba(0,0,0,0.25)',
          }}
        >
          Login
        </button>

        <button
          onClick={() => onSignUp ? onSignUp() : window.location.href = '/signup'}
          style={{
            padding: '0.375rem 0.9rem',
            borderRadius: '9999px',
            background: 'linear-gradient(135deg, rgba(249,115,22,0.58), rgba(249,115,22,0.32))',
            border: '1px solid rgba(249, 115, 22, 0.50)',
            color: 'rgba(255, 255, 255, 0.98)',
            fontSize: '0.75rem',
            fontWeight: 600,
            cursor: 'pointer',
            fontFamily: 'inherit',
            backdropFilter: 'blur(16px) saturate(1.4)',
            WebkitBackdropFilter: 'blur(16px) saturate(1.4)',
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.35), 0 2px 10px rgba(249,115,22,0.28)',
            textShadow: '0 1px 2px rgba(0,0,0,0.25)',
          }}
        >
          Sign Up
        </button>
      </div>
    </nav>
  )
}

