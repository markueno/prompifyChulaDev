import { useRef, useState, useEffect } from 'react'
import { useGSAP } from '@gsap/react'
import gsap from 'gsap'
import ScrollTrigger from 'gsap/ScrollTrigger'
import HeroBackground from './HeroBackground'

gsap.registerPlugin(useGSAP, ScrollTrigger)

interface Message {
  role: 'user' | 'assistant'
  content: string
}

interface HeroProps {
  onAfterSubmit?: () => void
  onSignUp?: () => void
}

export default function Hero({ onAfterSubmit, onSignUp }: HeroProps) {
  const [messages, setMessages] = useState<Message[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [inputValue, setInputValue] = useState('')
  const [floatingInputValue, setFloatingInputValue] = useState('')
  const [floatingVisible, setFloatingVisible] = useState(false)
  const [floatingResponseText, setFloatingResponseText] = useState('')
  const [showFloatingResponse, setShowFloatingResponse] = useState(false)
  const [showExamples, setShowExamples] = useState(true)

  const heroSectionRef = useRef<HTMLElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const heroBgRef = useRef<HTMLDivElement>(null)
  const messagesAreaRef = useRef<HTMLDivElement>(null)
  const floatingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isLoadingRef = useRef(false)

  useEffect(() => {
    isLoadingRef.current = isLoading
  }, [isLoading])

  // Parallax + floating bar scroll handler
  useEffect(() => {
    // Fix 4: local closure vars — setState fires only when the value actually flips
    let floatingVisible = false
    let showingResponse = false

    const handleScroll = () => {
      const scrollTop = window.scrollY
      const heroH = window.innerHeight
      const heroBg = heroBgRef.current
      const contentEl = contentRef.current

      if (scrollTop <= heroH) {
        const progress = scrollTop / heroH

        if (heroBg) {
          heroBg.style.transform = `scale(${1 + progress * 0.06})`
          heroBg.style.opacity = '1'
        }

        const fadeProgress = Math.max((progress - 0.45) / 0.55, 0)
        if (contentEl) {
          contentEl.style.opacity = String(Math.max(1 - fadeProgress * 2, 0))
          contentEl.style.transform = `translateY(${-fadeProgress * 80}px)`
          contentEl.style.pointerEvents = progress > 0.55 ? 'none' : 'auto'
        }
      } else {
        if (contentEl) {
          contentEl.style.opacity = '0'
          contentEl.style.pointerEvents = 'none'
        }
      }

      if (heroBg) {
        heroBg.style.visibility = scrollTop > heroH * 1.3 ? 'hidden' : 'visible'
      }

      const shouldShow = scrollTop > heroH * 0.55
      if (shouldShow !== floatingVisible) {
        floatingVisible = shouldShow
        setFloatingVisible(shouldShow)
        if (!shouldShow) {
          if (showingResponse) {
            showingResponse = false
            setShowFloatingResponse(false)
          }
          if (floatingTimerRef.current) clearTimeout(floatingTimerRef.current)
        }
      }
    }

    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  // Trigger highlight gradient animation when hero enters viewport
  useGSAP(() => {
    ScrollTrigger.create({
      trigger: heroSectionRef.current,
      start: 'top 80%',
      onEnter: () => {
        heroSectionRef.current?.querySelector('.highlight')?.classList.add('active')
      },
    })
  }, { scope: heroSectionRef })

  // Scroll messages area to bottom on new message
  useEffect(() => {
    requestAnimationFrame(() => {
      if (messagesAreaRef.current) {
        messagesAreaRef.current.scrollTop = messagesAreaRef.current.scrollHeight
      }
    })
  }, [messages])

  const handleSubmit = (text: string | null, fromFloating: boolean) => {
    const currentInput = fromFloating ? floatingInputValue : inputValue
    const input = text || currentInput
    if (!input.trim() || isLoadingRef.current) return

    const userMessage = input

    if (fromFloating) {
      setFloatingInputValue('')
    } else {
      setInputValue('')
    }

    isLoadingRef.current = true
    setIsLoading(true)
    setShowExamples(false)
    setMessages(prev => [...prev, { role: 'user', content: userMessage }])

    if (fromFloating) {
      setFloatingResponseText('Building your app...')
      setShowFloatingResponse(true)
    }

    setTimeout(() => {
      const response = `Got it! I'm building your "${userMessage}" right now. Your app will be live asap — no code required.`

      setMessages(prev => [...prev, { role: 'assistant', content: response }])
      isLoadingRef.current = false
      setIsLoading(false)

      if (fromFloating) {
        setFloatingResponseText(response)
        setShowFloatingResponse(true)

        if (floatingTimerRef.current) clearTimeout(floatingTimerRef.current)
        floatingTimerRef.current = setTimeout(() => {
          setShowFloatingResponse(false)
        }, 6000)
      }

      // Open the sign-up/login modal after showing the demo response
      onAfterSubmit?.()
    }, 1600)
  }

  return (
    <>
      <HeroBackground ref={heroBgRef} />

      {/* Floating chat bar */}
      <div className={`floating-chat-bar${floatingVisible ? ' visible' : ''}`}>
        <div className="floating-bar-inner">
          <svg
            className="floating-sparkle"
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
            <path d="M5 3v4" /><path d="M19 17v4" /><path d="M3 5h4" /><path d="M17 19h4" />
          </svg>
          <input
            type="text"
            className="floating-input"
            placeholder="Describe the app you want to build..."
            value={floatingInputValue}
            onChange={e => setFloatingInputValue(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSubmit(null, true)}
          />
          <button
            className="send-btn floating-send-btn"
            disabled={!floatingInputValue.trim() || isLoading}
            onClick={() => handleSubmit(null, true)}
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m22 2-7 20-4-9-9-4Z" /><path d="M22 2 11 13" />
            </svg>
          </button>
          <button className="send-btn floating-send-btn floating-signup-btn" onClick={onSignUp}>
            Sign Up
          </button>
        </div>
        <div className={`floating-response${showFloatingResponse ? ' show' : ''}`}>
          <div className="floating-response-text">{floatingResponseText}</div>
        </div>
      </div>

      {/* Hero section */}
      <section className="hero-section" ref={heroSectionRef} id="heroSection">
        <div className="content" ref={contentRef} id="content">
          <div className="badge">
            <span className="badge-dot" />
            Now in Beta
          </div>

          <h1 className="heading">
            <span className="highlight">Prompify</span><br />Your Ideas
          </h1>

          <p className="subtitle">
            Build what you need before your coffee gets cold.
          </p>

          <div className="prompt-wrapper">
            <div className="prompt-box">
              {/* Messages area — hidden until first message */}
              <div
                ref={messagesAreaRef}
                className={`messages-area${messages.length > 0 ? ' has-messages' : ''}`}
              >
                {messages.map((msg, i) => (
                  <div key={i} className={`message-row ${msg.role}`}>
                    <div className={`message-bubble ${msg.role}`}>
                      {msg.content}
                    </div>
                  </div>
                ))}
                {isLoading && (
                  <div className="message-row assistant">
                    <div className="loading-bubble">
                      <div className="spinner" />
                      <span>Building your app...</span>
                    </div>
                  </div>
                )}
              </div>

              {/* Input area */}
              <div className="input-area">
                <div className="input-row">
                  <svg
                    className="sparkle-icon"
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
                    <path d="M5 3v4" /><path d="M19 17v4" /><path d="M3 5h4" /><path d="M17 19h4" />
                  </svg>
                  <input
                    type="text"
                    className="prompt-input"
                    placeholder="Describe the app you want to build..."
                    value={inputValue}
                    onChange={e => setInputValue(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleSubmit(null, false)}
                  />
                  <button
                    className="send-btn"
                    disabled={!inputValue.trim() || isLoading}
                    onClick={() => handleSubmit(null, false)}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="m22 2-7 20-4-9-9-4Z" /><path d="M22 2 11 13" />
                    </svg>
                  </button>
                </div>
              </div>

              {/* Example prompts */}
              {showExamples && (
                <div className="examples">
                  <button className="example-btn" onClick={() => handleSubmit('Build me a CRM dashboard', false)}>
                    Build me a CRM dashboard
                  </button>
                  <button className="example-btn" onClick={() => handleSubmit('Create an inventory tracker', false)}>
                    Create an inventory tracker
                  </button>
                  <button className="example-btn" onClick={() => handleSubmit('Design a booking system', false)}>
                    Design a booking system
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>
    </>
  )
}
