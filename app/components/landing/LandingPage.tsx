import { useNavigate } from '@remix-run/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';

gsap.registerPlugin(ScrollTrigger);

const PIC_BASE = '/landing-pics';

const PIN_CARDS = [
  { num: '01', title: 'Prompt-to-Production in Minutes', img: '1.avif', text: 'Describe what you need in plain English and get a working, live app asap— no coding, no developers, no waiting.' },
  { num: '02', title: 'Multi-LLM Intelligence Engine', img: '2.png', text: 'Every request is automatically routed to the smartest, fastest, most cost-effective AI model — so you get great results without thinking about what\'s under the hood.' },
  { num: '03', title: 'Business Intelligence Framework', img: '3.gif', text: 'Connect a spreadsheet or database, ask questions like "What were last month\'s sales by region?" and get instant answers with charts included.' },
  { num: '04', title: 'Private LLM & Data Sovereignty', img: '4.webp', text: 'One switch keeps everything running on your own servers. Nothing leaves your walls — perfect for industries where privacy isn\'t optional.' },
  { num: '05', title: 'Domain-Intelligence Modules', img: '5.png', text: 'Built-in knowledge for finance, healthcare, and retail means smarter, more accurate results from day one — not generic AI guesswork.' },
  { num: '06', title: 'Enterprise-Grade Deployment', img: '6.jpg', text: 'Security, single sign-on, audit logs, and compliance reports come standard. No extra setup needed to pass your procurement team\'s checklist.' },
];

function escapeHtml(text: string) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

export function LandingPage() {
  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement>(null);
  const heroBgRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const lenisRef = useRef<Lenis | null>(null);
  const messagesAreaRef = useRef<HTMLDivElement>(null);

  const [promptValue, setPromptValue] = useState('');
  const [floatingValue, setFloatingValue] = useState('');
  const [messages, setMessages] = useState<{ role: 'user' | 'assistant'; content: string }[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showExamples, setShowExamples] = useState(true);
  const [showFloatingResponse, setShowFloatingResponse] = useState(false);
  const [floatingResponseContent, setFloatingResponseContent] = useState('');

  const goToLogin = useCallback(() => {
    navigate('/auth/login');
  }, [navigate]);

  const handleSubmit = useCallback((text?: string, fromFloating?: boolean) => {
    const input = text || (fromFloating ? floatingValue : promptValue);
    if (!input.trim() || isLoading) return;

    setMessages((prev) => [...prev, { role: 'user', content: input }]);
    if (fromFloating) {
      setFloatingValue('');
    } else {
      setPromptValue('');
    }
    setShowExamples(false);
    setIsLoading(true);

    if (fromFloating) {
      setFloatingResponseContent('Building your app...');
      setShowFloatingResponse(true);
    }

    setTimeout(() => {
      const response = `Got it! I'm building your "${input}" right now. Your app will be live asap — no code required.`;
      setMessages((prev) => [...prev, { role: 'assistant', content: response }]);
      setIsLoading(false);

      if (fromFloating) {
        setFloatingResponseContent(response);
        setTimeout(() => setShowFloatingResponse(false), 6000);
      }
    }, 1600);
  }, [promptValue, floatingValue, isLoading]);

  useEffect(() => {
    messagesAreaRef.current?.scrollTo({ top: messagesAreaRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, isLoading]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const heroBg = heroBgRef.current;
    const content = contentRef.current;

    const lenis = new Lenis();
    lenisRef.current = lenis;
    lenis.on('scroll', ScrollTrigger.update);

    gsap.ticker.add((time) => {
      lenis.raf(time * 1000);
    });
    gsap.ticker.lagSmoothing(0);

    const floatingBar = container.querySelector('.landing-floating-chat-bar');

    const handleScroll = () => {
      const scrollTop = window.scrollY;
      const heroH = window.innerHeight;

      if (heroBg && content && scrollTop <= heroH) {
        const progress = scrollTop / heroH;
        heroBg.style.transform = `scale(${1 + progress * 0.06})`;
        heroBg.style.opacity = '1';
        heroBg.style.visibility = 'visible';
        const fadeProgress = Math.max((progress - 0.45) / 0.55, 0);
        content.style.opacity = String(Math.max(1 - fadeProgress * 2, 0));
        content.style.transform = `translateY(${-fadeProgress * 80}px)`;
        content.style.pointerEvents = progress > 0.55 ? 'none' : 'auto';
      } else if (content) {
        content.style.opacity = '0';
        content.style.pointerEvents = 'none';
      }

      if (heroBg) {
        heroBg.style.visibility = scrollTop > heroH * 1.3 ? 'hidden' : 'visible';
      }

      if (floatingBar) {
        floatingBar.classList.toggle('visible', scrollTop > heroH * 0.55);
      }
    };

    handleScroll();
    window.addEventListener('scroll', handleScroll, { passive: true });

    const pinCards = container.querySelectorAll('.landing-pin-card');
    pinCards.forEach((eachCard, index) => {
      if (index < pinCards.length - 1) {
        ScrollTrigger.create({
          trigger: eachCard,
          start: 'top top',
          endTrigger: pinCards[pinCards.length - 1],
          end: 'top top',
          pin: true,
          pinSpacing: false,
        });

        const tl = gsap.timeline({
          scrollTrigger: {
            trigger: pinCards[index + 1],
            start: 'top bottom',
            end: 'top top',
            scrub: 3,
          },
        });

        tl.to(
          eachCard,
          {
            scale: 0.75,
            rotationX: index % 2 === 0 ? 20 : -20,
            force3D: true,
            ease: 'none',
          },
          0
        );

        const overlay = eachCard.querySelector('.landing-overlay');
        if (overlay) {
          tl.to(overlay, { opacity: 0.4, ease: 'none' }, 0);
        }
      }
    });

    ScrollTrigger.create({
      trigger: '.landing-hero-section',
      start: 'top 80%',
      onEnter: () => {
        const el = container.querySelector('.landing-heading .landing-highlight');
        el?.classList.add('active');
      },
    });

    ScrollTrigger.create({
      trigger: '.landing-outro',
      start: 'top 80%',
      onEnter: () => {
        const el = container.querySelector('.landing-shimmer-text');
        el?.classList.add('active');
      },
    });

    return () => {
      window.removeEventListener('scroll', handleScroll);
      ScrollTrigger.getAll().forEach((t) => t.kill());
      lenis.destroy();
      lenisRef.current = null;
    };
  }, []);

  return (
    <div ref={containerRef} className="landing-page">
      {/* Hero background */}
      <div ref={heroBgRef} className="landing-hero-bg">
        <img src={`${PIC_BASE}/background1.jpeg`} alt="Background" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
        <div className="gradient-overlay" />
        <div className="vignette" />
      </div>

      {/* Floating chat bar */}
      <div className="landing-floating-chat-bar" id="landingFloatingChatBar">
        <div className="landing-floating-bar-inner">
          <svg className="landing-floating-sparkle" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
          </svg>
          <input
            type="text"
            className="landing-floating-input"
            placeholder="Describe the app you want to build..."
            value={floatingValue}
            onChange={(e) => setFloatingValue(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSubmit(undefined, true)}
          />
          <button
            type="button"
            className="landing-send-btn landing-floating-send-btn"
            disabled={!floatingValue.trim() || isLoading}
            onClick={() => handleSubmit(undefined, true)}
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width={14} height={14}>
              <path d="m22 2-7 20-4-9-9-4Z" /><path d="M22 2 11 13" />
            </svg>
          </button>
        </div>
        {showFloatingResponse && (
          <div className="landing-floating-response show">
            <div className="landing-floating-response-text">
              {floatingResponseContent}
            </div>
          </div>
        )}
      </div>

      <main>
        {/* Hero section */}
        <section className="landing-hero-section">
          <div ref={contentRef} className="landing-content">
            <div className="landing-badge">
              <span className="landing-badge-dot" />
              Now in Beta
            </div>

            <h1 className="landing-heading">
              <span className="landing-highlight">Prompify</span>
              <br />
              Your Ideas
            </h1>
            <p className="landing-subtitle">
              Describe what you need in plain English and get a working, live app in your screen.
            </p>

            <div className="landing-prompt-wrapper">
              <div className="landing-prompt-box">
                <div
                  ref={messagesAreaRef}
                  className={`landing-messages-area ${messages.length > 0 ? 'has-messages' : ''}`}
                >
                  {messages.map((msg, i) => (
                    <div key={i} className={`landing-message-row ${msg.role}`}>
                      <div className={`landing-message-bubble ${msg.role}`} dangerouslySetInnerHTML={{ __html: escapeHtml(msg.content) }} />
                    </div>
                  ))}
                  {isLoading && (
                    <div className="landing-message-row assistant">
                      <div className="landing-loading-bubble">
                        <div className="landing-spinner" />
                        <span>Building your app...</span>
                      </div>
                    </div>
                  )}
                </div>
                <div className="input-area" style={{ padding: '0.75rem' }}>
                  <div className="landing-input-row">
                    <svg className="sparkle-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width={20} height={20} style={{ color: '#fb923c', flexShrink: 0 }}>
                      <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
                    </svg>
                    <input
                      type="text"
                      className="landing-prompt-input"
                      placeholder="Describe the app you want to build..."
                      value={promptValue}
                      onChange={(e) => setPromptValue(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
                    />
                    <button
                      type="button"
                      className="landing-send-btn"
                      disabled={!promptValue.trim() || isLoading}
                      onClick={() => handleSubmit()}
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width={16} height={16}>
                        <path d="m22 2-7 20-4-9-9-4Z" /><path d="M22 2 11 13" />
                      </svg>
                    </button>
                  </div>
                </div>
                {showExamples && (
                  <div className="landing-examples">
                    <button type="button" className="landing-example-btn" onClick={() => handleSubmit('Build me a CRM dashboard')}>Build me a CRM dashboard</button>
                    <button type="button" className="landing-example-btn" onClick={() => handleSubmit('Create an inventory tracker')}>Create an inventory tracker</button>
                    <button type="button" className="landing-example-btn" onClick={() => handleSubmit('Design a booking system')}>Design a booking system</button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* Pin cards with sliding effects */}
        {PIN_CARDS.map((card) => (
          <section key={card.num} className="landing-pin-card">
            <div className="landing-overlay" />
            <span>({card.num})</span>
            <div className="landing-pin-card-content">
              <h2>{card.title}</h2>
              <img src={`${PIC_BASE}/${card.img}`} alt="" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
              <p>{card.text}</p>
            </div>
          </section>
        ))}

        {/* Outro */}
        <section className="landing-outro">
          <h2 className="landing-shimmer-text">
            Prompt
            <br />
            Refine and Deploy
          </h2>
          <p>
            From retail CRMs to logistics systems, Prompify AI powers smart integrations that transform daily operations.
            <br /><br />
            <b>At Prompify, creativity meets creation.</b>
          </p>
          <div className="landing-outro-buttons">
            <a href="/auth/login" className="landing-cta-btn">Start Prompting</a>
            <a href="#contact" className="landing-cta-btn">Contact Us</a>
          </div>
        </section>

        {/* Footer */}
        <section className="landing-info">
          <div className="landing-info-top">
            <p>© 2024 Basic Concept Limited. All rights reserved.</p>
          </div>
          <div className="landing-info-bottom">
            <div className="landing-info-col">
              <h4>Company</h4>
              <a href="#about">About Us</a>
              <a href="#careers">Careers</a>
              <a href="#blog">Blog</a>
            </div>
            <div className="landing-info-col">
              <h4>Product</h4>
              <a href="#features">Features</a>
              <a href="#pricing">Pricing</a>
              <a href="#docs">Documentation</a>
            </div>
            <div className="landing-info-col">
              <h4>Support</h4>
              <a href="#help">Help Center</a>
              <a href="#contact">Contact Us</a>
              <a href="#faq">FAQ</a>
            </div>
            <div className="landing-info-col">
              <h4>Legal</h4>
              <a href="#privacy">Privacy Policy</a>
              <a href="#terms">Terms of Service</a>
              <a href="#cookies">Cookie Policy</a>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
