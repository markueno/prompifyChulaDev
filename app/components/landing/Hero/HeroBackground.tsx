import { forwardRef } from 'react'

const HeroBackground = forwardRef<HTMLDivElement>((_, ref) => (
  <div className="hero-bg" ref={ref}>
    <img
      src="/images/background1.jpeg"
      alt="Nature background"
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        objectFit: 'cover',
      }}
    />
    <div className="gradient-overlay" />
    <div className="vignette" />
  </div>
))

HeroBackground.displayName = 'HeroBackground'
export default HeroBackground
