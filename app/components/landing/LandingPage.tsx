import { useFetcher } from '@remix-run/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { CONTACT_COUNTRY_OPTIONS, CONTACT_ENQUIRY_OPTIONS } from '~/lib/contact-form-options';
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

type AuthActionData = { error?: string; success?: string };

function LandingContactModal({ onClose }: { onClose: () => void }) {
  const contactFetcher = useFetcher<AuthActionData>();

  return (
    <div
      className="landing-login-modal-root"
      role="dialog"
      aria-modal="true"
      aria-labelledby="landing-contact-title"
    >
      <button type="button" className="landing-login-modal-backdrop" aria-label="Close" onClick={onClose} />
      <div className="landing-login-modal-panel landing-login-modal-panel--contact">
        <button type="button" className="landing-login-modal-close" aria-label="Close" onClick={onClose}>
          ×
        </button>
        <div className="landing-login-modal-header">
          <h2 id="landing-contact-title">Contact us</h2>
          <p>Tell us how we can help. Fields marked * are required.</p>
        </div>

        {contactFetcher.data?.success ? (
          <div className="landing-login-modal-form landing-login-modal-form--stack">
            <div className="landing-login-modal-success" role="status">
              {contactFetcher.data.success}
            </div>
            <button type="button" className="landing-login-modal-submit" onClick={onClose}>
              Close
            </button>
          </div>
        ) : (
          <contactFetcher.Form method="post" action="/api/contact" className="landing-login-modal-form">
            {contactFetcher.data?.error && (
              <div className="landing-login-modal-error" role="alert">
                {contactFetcher.data.error}
              </div>
            )}

            <label className="landing-login-modal-label" htmlFor="landing-contact-enquiry">
              Topic <span className="landing-login-modal-required">*</span>
            </label>
            <select
              id="landing-contact-enquiry"
              name="enquiryType"
              required
              className="landing-login-modal-select"
              defaultValue=""
            >
              <option value="" disabled>
                Select a topic
              </option>
              {CONTACT_ENQUIRY_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            <p className="landing-login-modal-hint">We route your message to the right team.</p>

            <label className="landing-login-modal-label" htmlFor="landing-contact-name">
              Full name <span className="landing-login-modal-required">*</span>
            </label>
            <input
              id="landing-contact-name"
              name="name"
              type="text"
              required
              maxLength={125}
              autoComplete="name"
              className="landing-login-modal-input"
              placeholder="Your name"
            />

            <label className="landing-login-modal-label" htmlFor="landing-contact-email">
              Email <span className="landing-login-modal-required">*</span>
            </label>
            <input
              id="landing-contact-email"
              name="email"
              type="email"
              required
              autoComplete="email"
              className="landing-login-modal-input"
              placeholder="you@company.com"
            />

            <div className="landing-contact-field-row">
              <div className="landing-contact-field-col">
                <label className="landing-login-modal-label" htmlFor="landing-contact-country">
                  Country for phone <span className="landing-login-modal-required">*</span>
                </label>
                <select
                  id="landing-contact-country"
                  name="country"
                  required
                  className="landing-login-modal-select"
                  defaultValue=""
                >
                  <option value="" disabled hidden>
                    Select country for phone
                  </option>
                  {CONTACT_COUNTRY_OPTIONS.filter((o) => o.value).map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                <p className="landing-login-modal-hint">Dial code for your number (stored with your phone in our records).</p>
              </div>
              <div className="landing-contact-field-col">
                <label className="landing-login-modal-label" htmlFor="landing-contact-phone">
                  Phone number <span className="landing-login-modal-required">*</span>
                </label>
                <input
                  id="landing-contact-phone"
                  name="phone"
                  type="tel"
                  required
                  maxLength={40}
                  autoComplete="tel"
                  className="landing-login-modal-input"
                  placeholder="e.g. 555 0100 or full number"
                />
              </div>
            </div>

            <label className="landing-login-modal-label" htmlFor="landing-contact-message">
              How can we help? <span className="landing-login-modal-required">*</span>
            </label>
            <textarea
              id="landing-contact-message"
              name="message"
              required
              maxLength={125}
              rows={4}
              className="landing-login-modal-textarea"
              placeholder="How can we help? (max 125 characters)"
            />

            <button
              type="submit"
              className="landing-login-modal-submit"
              disabled={contactFetcher.state === 'submitting'}
            >
              {contactFetcher.state === 'submitting' ? 'Sending…' : 'Send message'}
            </button>
          </contactFetcher.Form>
        )}
      </div>
    </div>
  );
}

export function LandingPage() {
  const loginFetcher = useFetcher<AuthActionData>();
  const registerFetcher = useFetcher<AuthActionData>();
  const forgotFetcher = useFetcher<AuthActionData>();
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
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [showContactModal, setShowContactModal] = useState(false);
  const [contactModalKey, setContactModalKey] = useState(0);
  const [authModalMode, setAuthModalMode] = useState<'login' | 'register' | 'forgot'>('login');
  const [forgotShowFormForced, setForgotShowFormForced] = useState(false);
  const [loginShowPassword, setLoginShowPassword] = useState(false);
  const [registerShowPassword, setRegisterShowPassword] = useState(false);
  const [registerShowConfirmPassword, setRegisterShowConfirmPassword] = useState(false);
  const [registerPasswordStrength, setRegisterPasswordStrength] = useState({
    length: false,
    lowercase: false,
    uppercase: false,
    number: false,
    special: false,
  });

  const closeAuthModal = useCallback(() => {
    setShowLoginModal(false);
    setAuthModalMode('login');
    setForgotShowFormForced(false);
  }, []);

  const closeContactModal = useCallback(() => {
    setShowContactModal(false);
  }, []);

  const openContactModal = useCallback(() => {
    setShowLoginModal(false);
    setAuthModalMode('login');
    setForgotShowFormForced(false);
    setContactModalKey((k) => k + 1);
    setShowContactModal(true);
  }, []);

  const goToForgotInModal = useCallback(() => {
    setForgotShowFormForced(false);
    setAuthModalMode('forgot');
  }, []);

  const openLoginModalSoon = useCallback(() => {
    window.setTimeout(() => {
      setShowContactModal(false);
      setAuthModalMode('login');
      setShowLoginModal(true);
    }, 450);
  }, []);

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
      }
      openLoginModalSoon();
    }, 1600);
  }, [promptValue, floatingValue, isLoading, openLoginModalSoon]);

  useEffect(() => {
    messagesAreaRef.current?.scrollTo({ top: messagesAreaRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, isLoading]);

  useEffect(() => {
    if (showLoginModal) {
      setShowFloatingResponse(false);
    }
  }, [showLoginModal]);

  useEffect(() => {
    if (!showLoginModal && !showContactModal) {
      return;
    }
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showContactModal) {
          closeContactModal();
        } else {
          closeAuthModal();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKey);
    };
  }, [showLoginModal, showContactModal, closeAuthModal, closeContactModal]);

  useEffect(() => {
    if (forgotFetcher.state === 'submitting') {
      setForgotShowFormForced(false);
    }
  }, [forgotFetcher.state]);

  const updateRegisterPasswordStrength = useCallback((password: string) => {
    setRegisterPasswordStrength({
      length: password.length >= 8,
      lowercase: /(?=.*[a-z])/.test(password),
      uppercase: /(?=.*[A-Z])/.test(password),
      number: /(?=.*\d)/.test(password),
      special: /(?=.*[!@#$%^&*])/.test(password),
    });
  }, []);

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
        <section className="landing-outro" id="contact">
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
            <button
              type="button"
              className="landing-cta-btn landing-cta-btn--shine"
              onClick={() => {
                setShowContactModal(false);
                setAuthModalMode('login');
                setShowLoginModal(true);
              }}
            >
              Start Prompting
            </button>
            <button type="button" className="landing-cta-btn" onClick={openContactModal}>
              Contact Us
            </button>
          </div>
        </section>

        {/* Footer */}
        <section className="landing-info">
          <div className="landing-info-top">
            <p>© 2024 Basic Concept Limited. All rights reserved.</p>
          </div>
          {/*
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
              <button type="button" className="landing-info-footer-btn" onClick={openContactModal}>
                Contact Us
              </button>
              <a href="#faq">FAQ</a>
            </div>
            <div className="landing-info-col">
              <h4>Legal</h4>
              <a href="#privacy">Privacy Policy</a>
              <a href="#terms">Terms of Service</a>
              <a href="#cookies">Cookie Policy</a>
            </div>
          </div>
          */}
        </section>
      </main>

      {showLoginModal && (
        <div
          className="landing-login-modal-root"
          role="dialog"
          aria-modal="true"
          aria-labelledby="landing-auth-title"
        >
          <button
            type="button"
            className="landing-login-modal-backdrop"
            aria-label="Close"
            onClick={closeAuthModal}
          />
          <div className="landing-login-modal-panel">
            <button type="button" className="landing-login-modal-close" aria-label="Close" onClick={closeAuthModal}>
              ×
            </button>

            {authModalMode === 'login' && (
              <>
                <div className="landing-login-modal-header">
                  <h2 id="landing-auth-title">Welcome back</h2>
                  <p>Sign in to continue building with Prompify</p>
                </div>

                <loginFetcher.Form method="post" action="/auth/login" className="landing-login-modal-form">
                  <input type="hidden" name="intent" value="login" />

                  {loginFetcher.data?.error && (
                    <div className="landing-login-modal-error" role="alert">
                      {loginFetcher.data.error}
                    </div>
                  )}

                  <label className="landing-login-modal-label" htmlFor="landing-login-email">
                    Email
                  </label>
                  <input
                    id="landing-login-email"
                    name="email"
                    type="email"
                    required
                    autoComplete="email"
                    className="landing-login-modal-input"
                    placeholder="you@company.com"
                  />

                  <label className="landing-login-modal-label" htmlFor="landing-login-password">
                    Password
                  </label>
                  <div className="landing-login-modal-password-wrap">
                    <input
                      id="landing-login-password"
                      name="password"
                      type={loginShowPassword ? 'text' : 'password'}
                      required
                      autoComplete="current-password"
                      className="landing-login-modal-input"
                      placeholder="••••••••"
                    />
                    <button
                      type="button"
                      className="landing-login-modal-toggle-pw"
                      onClick={() => setLoginShowPassword((v) => !v)}
                      aria-label={loginShowPassword ? 'Hide password' : 'Show password'}
                    >
                      {loginShowPassword ? 'Hide' : 'Show'}
                    </button>
                  </div>

                  <button
                    type="submit"
                    className="landing-login-modal-submit"
                    disabled={loginFetcher.state === 'submitting'}
                  >
                    {loginFetcher.state === 'submitting' ? 'Signing in…' : 'Sign in'}
                  </button>
                </loginFetcher.Form>

                <div className="landing-login-modal-footer">
                  <button type="button" className="landing-login-modal-footer-btn" onClick={() => setAuthModalMode('register')}>
                    Create an account
                  </button>
                  <span className="landing-login-modal-dot">·</span>
                  <button type="button" className="landing-login-modal-footer-btn" onClick={goToForgotInModal}>
                    Forgot password?
                  </button>
                </div>
              </>
            )}

            {authModalMode === 'forgot' && (
              <>
                <div className="landing-login-modal-header">
                  <h2 id="landing-auth-title">Forgot your password?</h2>
                  <p>Enter your email and we&apos;ll send you a link to reset it.</p>
                </div>

                {forgotFetcher.data?.success && !forgotShowFormForced ? (
                  <div className="landing-login-modal-form landing-login-modal-form--stack">
                    <div className="landing-login-modal-success" role="status">
                      {forgotFetcher.data.success}
                    </div>
                    <button
                      type="button"
                      className="landing-login-modal-submit"
                      onClick={() => setAuthModalMode('login')}
                    >
                      Back to Sign in
                    </button>
                    <button
                      type="button"
                      className="landing-login-modal-submit landing-login-modal-submit--secondary"
                      onClick={() => setForgotShowFormForced(true)}
                    >
                      Send another link
                    </button>
                  </div>
                ) : (
                  <forgotFetcher.Form method="post" action="/auth/forgot-password" className="landing-login-modal-form">
                    {forgotFetcher.data?.error && (
                      <div className="landing-login-modal-error" role="alert">
                        {forgotFetcher.data.error}
                      </div>
                    )}

                    <label className="landing-login-modal-label" htmlFor="landing-forgot-email">
                      Email
                    </label>
                    <input
                      id="landing-forgot-email"
                      name="email"
                      type="email"
                      required
                      autoComplete="email"
                      className="landing-login-modal-input"
                      placeholder="you@company.com"
                    />

                    <button
                      type="submit"
                      className="landing-login-modal-submit"
                      disabled={forgotFetcher.state === 'submitting'}
                    >
                      {forgotFetcher.state === 'submitting' ? 'Sending…' : 'Send reset link'}
                    </button>
                  </forgotFetcher.Form>
                )}

                <div className="landing-login-modal-footer">
                  <button type="button" className="landing-login-modal-footer-btn" onClick={() => setAuthModalMode('login')}>
                    Back to Sign in
                  </button>
                </div>
              </>
            )}

            {authModalMode === 'register' && (
              <>
                <div className="landing-login-modal-header">
                  <h2 id="landing-auth-title">Create account</h2>
                  <p>Join Prompify and start building</p>
                </div>

                <registerFetcher.Form method="post" action="/auth/register" className="landing-login-modal-form">
                  <input type="hidden" name="intent" value="register" />

                  {registerFetcher.data?.error && (
                    <div className="landing-login-modal-error" role="alert">
                      {registerFetcher.data.error}
                    </div>
                  )}

                  {registerFetcher.data?.success && (
                    <div className="landing-login-modal-success" role="status">
                      {registerFetcher.data.success}
                    </div>
                  )}

                  <label className="landing-login-modal-label" htmlFor="landing-register-email">
                    Email
                  </label>
                  <input
                    id="landing-register-email"
                    name="email"
                    type="email"
                    required
                    autoComplete="email"
                    className="landing-login-modal-input"
                    placeholder="you@company.com"
                  />

                  <label className="landing-login-modal-label" htmlFor="landing-register-password">
                    Password
                  </label>
                  <div className="landing-login-modal-password-wrap">
                    <input
                      id="landing-register-password"
                      name="password"
                      type={registerShowPassword ? 'text' : 'password'}
                      required
                      autoComplete="new-password"
                      className="landing-login-modal-input"
                      placeholder="Create a strong password"
                      onChange={(e) => updateRegisterPasswordStrength(e.target.value)}
                    />
                    <button
                      type="button"
                      className="landing-login-modal-toggle-pw"
                      onClick={() => setRegisterShowPassword((v) => !v)}
                      aria-label={registerShowPassword ? 'Hide password' : 'Show password'}
                    >
                      {registerShowPassword ? 'Hide' : 'Show'}
                    </button>
                  </div>

                  <ul className="landing-modal-pw-strength" aria-label="Password requirements">
                    <li className={registerPasswordStrength.length ? 'met' : ''}>At least 8 characters</li>
                    <li className={registerPasswordStrength.lowercase ? 'met' : ''}>One lowercase letter</li>
                    <li className={registerPasswordStrength.uppercase ? 'met' : ''}>One uppercase letter</li>
                    <li className={registerPasswordStrength.number ? 'met' : ''}>One number</li>
                    <li className={registerPasswordStrength.special ? 'met' : ''}>One special character (!@#$%^&amp;*)</li>
                  </ul>

                  <label className="landing-login-modal-label" htmlFor="landing-register-confirm">
                    Confirm password
                  </label>
                  <div className="landing-login-modal-password-wrap">
                    <input
                      id="landing-register-confirm"
                      name="confirmPassword"
                      type={registerShowConfirmPassword ? 'text' : 'password'}
                      required
                      autoComplete="new-password"
                      className="landing-login-modal-input"
                      placeholder="Confirm your password"
                    />
                    <button
                      type="button"
                      className="landing-login-modal-toggle-pw"
                      onClick={() => setRegisterShowConfirmPassword((v) => !v)}
                      aria-label={registerShowConfirmPassword ? 'Hide password' : 'Show password'}
                    >
                      {registerShowConfirmPassword ? 'Hide' : 'Show'}
                    </button>
                  </div>

                  <button
                    type="submit"
                    className="landing-login-modal-submit"
                    disabled={registerFetcher.state === 'submitting'}
                  >
                    {registerFetcher.state === 'submitting' ? 'Creating account…' : 'Create account'}
                  </button>
                </registerFetcher.Form>

                <div className="landing-login-modal-footer">
                  <button type="button" className="landing-login-modal-footer-btn" onClick={() => setAuthModalMode('login')}>
                    Already have an account? Sign in
                  </button>
                  <span className="landing-login-modal-dot">·</span>
                  <button type="button" className="landing-login-modal-footer-btn" onClick={goToForgotInModal}>
                    Forgot password?
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {showContactModal && <LandingContactModal key={contactModalKey} onClose={closeContactModal} />}
    </div>
  );
}
