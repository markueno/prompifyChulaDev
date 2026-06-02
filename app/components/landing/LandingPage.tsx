import { useFetcher, useNavigate, useSearchParams } from '@remix-run/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { CONTACT_COUNTRY_OPTIONS, CONTACT_ENQUIRY_OPTIONS } from '~/lib/contact-form-options';
import Navbar from './Navbar/Navbar';
import Hero from './Hero/Hero';
import DynamicPinCards from './DynamicPinCards';
import Outro from './Outro/Outro';
import Footer from './Footer/Footer';

type AuthActionData = { error?: string; success?: string };

const LOGIN_SIGNING_IN_MAX_MS = 4000;

// ─── Contact modal ────────────────────────────────────────────────────────────

function LandingContactModal({ onClose }: { onClose: () => void }) {
  const contactFetcher = useFetcher<AuthActionData>();

  return (
    <div className="landing-login-modal-root" role="dialog" aria-modal="true" aria-labelledby="landing-contact-title">
      <button type="button" className="landing-login-modal-backdrop" aria-label="Close" onClick={onClose} />
      <div className="landing-login-modal-panel landing-login-modal-panel--contact">
        <button type="button" className="landing-login-modal-close" aria-label="Close" onClick={onClose}>×</button>
        <div className="landing-login-modal-header">
          <h2 id="landing-contact-title">Contact us</h2>
          <p>Tell us how we can help. Fields marked * are required.</p>
        </div>

        {contactFetcher.data?.success ? (
          <div className="landing-login-modal-form landing-login-modal-form--stack">
            <div className="landing-login-modal-success" role="status">{contactFetcher.data.success}</div>
            <button type="button" className="landing-login-modal-submit" onClick={onClose}>Close</button>
          </div>
        ) : (
          <contactFetcher.Form method="post" action="/api/contact" className="landing-login-modal-form">
            {contactFetcher.data?.error && (
              <div className="landing-login-modal-error" role="alert">{contactFetcher.data.error}</div>
            )}

            <label className="landing-login-modal-label" htmlFor="landing-contact-enquiry">
              Topic <span className="landing-login-modal-required">*</span>
            </label>
            <select id="landing-contact-enquiry" name="enquiryType" required className="landing-login-modal-select" defaultValue="">
              <option value="" disabled>Select a topic</option>
              {CONTACT_ENQUIRY_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>

            <label className="landing-login-modal-label" htmlFor="landing-contact-name">
              Full name <span className="landing-login-modal-required">*</span>
            </label>
            <input id="landing-contact-name" name="name" type="text" required maxLength={125} autoComplete="name" className="landing-login-modal-input" placeholder="Your name" />

            <label className="landing-login-modal-label" htmlFor="landing-contact-email">
              Email <span className="landing-login-modal-required">*</span>
            </label>
            <input id="landing-contact-email" name="email" type="email" required autoComplete="email" className="landing-login-modal-input" placeholder="you@company.com" />

            <div className="landing-contact-field-row">
              <div className="landing-contact-field-col">
                <label className="landing-login-modal-label" htmlFor="landing-contact-country">
                  Country for phone <span className="landing-login-modal-required">*</span>
                </label>
                <select id="landing-contact-country" name="country" required className="landing-login-modal-select" defaultValue="">
                  <option value="" disabled hidden>Select country</option>
                  {CONTACT_COUNTRY_OPTIONS.filter(o => o.value).map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
              <div className="landing-contact-field-col">
                <label className="landing-login-modal-label" htmlFor="landing-contact-phone">
                  Phone number <span className="landing-login-modal-required">*</span>
                </label>
                <input id="landing-contact-phone" name="phone" type="tel" required maxLength={40} autoComplete="tel" className="landing-login-modal-input" placeholder="e.g. 555 0100" />
              </div>
            </div>

            <label className="landing-login-modal-label" htmlFor="landing-contact-message">
              How can we help? <span className="landing-login-modal-required">*</span>
            </label>
            <textarea id="landing-contact-message" name="message" required maxLength={125} rows={4} className="landing-login-modal-textarea" placeholder="How can we help? (max 125 characters)" />

            <button type="submit" className="landing-login-modal-submit" disabled={contactFetcher.state === 'submitting'}>
              {contactFetcher.state === 'submitting' ? 'Sending…' : 'Send message'}
            </button>
          </contactFetcher.Form>
        )}
      </div>
    </div>
  );
}

// ─── Main LandingPage ─────────────────────────────────────────────────────────

export function LandingPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const loginFetcher = useFetcher<AuthActionData>();
  const registerFetcher = useFetcher<AuthActionData>();
  const forgotFetcher = useFetcher<AuthActionData>();

  const loginAttemptRef = useRef(false);
  const previousLoginFetcherStateRef = useRef(loginFetcher.state);
  const loginSigningInTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [loginSigningIn, setLoginSigningIn] = useState(false);

  const [showLoginModal, setShowLoginModal] = useState(false);
  const [showContactModal, setShowContactModal] = useState(false);
  const [contactModalKey, setContactModalKey] = useState(0);
  const [authModalMode, setAuthModalMode] = useState<'login' | 'register' | 'forgot'>('login');
  const [forgotShowFormForced, setForgotShowFormForced] = useState(false);
  const [loginShowPassword, setLoginShowPassword] = useState(false);
  const [registerShowPassword, setRegisterShowPassword] = useState(false);
  const [registerShowConfirmPassword, setRegisterShowConfirmPassword] = useState(false);
  const [registerPasswordStrength, setRegisterPasswordStrength] = useState({
    length: false, lowercase: false, uppercase: false, number: false, special: false,
  });

  // ── Auth callbacks passed down to visual components ──────────────────────
  const openLoginModal = useCallback(() => {
    setShowContactModal(false);
    setAuthModalMode('login');
    setShowLoginModal(true);
  }, []);

  const openRegisterModal = useCallback(() => {
    setShowContactModal(false);
    setAuthModalMode('register');
    setShowLoginModal(true);
  }, []);

  // Opens login modal 450ms after the demo response (the "capture" moment)
  const openLoginModalSoon = useCallback(() => {
    window.setTimeout(() => {
      setShowContactModal(false);
      setAuthModalMode('login');
      setShowLoginModal(true);
    }, 450);
  }, []);

  const clearLoginSigningIn = useCallback(() => {
    if (loginSigningInTimerRef.current) {
      clearTimeout(loginSigningInTimerRef.current);
      loginSigningInTimerRef.current = null;
    }
    setLoginSigningIn(false);
  }, []);

  const closeAuthModal = useCallback(() => {
    clearLoginSigningIn();
    setShowLoginModal(false);
    setAuthModalMode('login');
    setForgotShowFormForced(false);
  }, [clearLoginSigningIn]);

  const openContactModal = useCallback(() => {
    setShowLoginModal(false);
    setAuthModalMode('login');
    setForgotShowFormForced(false);
    setContactModalKey(k => k + 1);
    setShowContactModal(true);
  }, []);

  const closeContactModal = useCallback(() => setShowContactModal(false), []);
  const goToForgotInModal = useCallback(() => { setForgotShowFormForced(false); setAuthModalMode('forgot'); }, []);

  const updateRegisterPasswordStrength = useCallback((password: string) => {
    setRegisterPasswordStrength({
      length: password.length >= 8,
      lowercase: /(?=.*[a-z])/.test(password),
      uppercase: /(?=.*[A-Z])/.test(password),
      number: /(?=.*\d)/.test(password),
      special: /(?=.*[!@#$%^&*])/.test(password),
    });
  }, []);

  // ── Login success → navigate to /app/ ────────────────────────────────────
  useEffect(() => {
    const previousState = previousLoginFetcherStateRef.current;
    previousLoginFetcherStateRef.current = loginFetcher.state;

    if (!loginAttemptRef.current || loginFetcher.state !== 'idle' || previousState === 'idle') return;
    if (loginSigningInTimerRef.current) { clearTimeout(loginSigningInTimerRef.current); loginSigningInTimerRef.current = null; }
    setLoginSigningIn(false);
    loginAttemptRef.current = false;
    if (loginFetcher.data?.error) return;
    navigate('/app/', { replace: true });
  }, [loginFetcher.state, loginFetcher.data, navigate]);

  // ── ?login=1 query param opens modal ─────────────────────────────────────
  useEffect(() => {
    if (searchParams.get('login') !== '1') return;
    const mode = searchParams.get('mode');
    setShowLoginModal(true);
    setShowContactModal(false);
    setForgotShowFormForced(false);
    setAuthModalMode(mode === 'register' || mode === 'forgot' ? mode : 'login');
  }, [searchParams]);

  // ── Block body scroll when modal is open ──────────────────────────────────
  useEffect(() => {
    if (!showLoginModal && !showContactModal) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { showContactModal ? closeContactModal() : closeAuthModal(); }
    };
    window.addEventListener('keydown', onKey);
    return () => { document.body.style.overflow = prev; window.removeEventListener('keydown', onKey); };
  }, [showLoginModal, showContactModal, closeAuthModal, closeContactModal]);

  useEffect(() => { if (forgotFetcher.state === 'submitting') setForgotShowFormForced(false); }, [forgotFetcher.state]);
  useEffect(() => { if (showLoginModal) return; }, [showLoginModal]);
  useEffect(() => () => { if (loginSigningInTimerRef.current) clearTimeout(loginSigningInTimerRef.current); }, []);

  // ── Outro shimmer + navbar fade handled by Hero/PinCards components ───────

  return (
    <div className="landing-page-wrapper">
      {/* New animated visual sections — auth callbacks wired in */}
      <Navbar onLogin={openLoginModal} onSignUp={openRegisterModal} />
      <Hero onAfterSubmit={openLoginModalSoon} onSignUp={openRegisterModal} />
      <DynamicPinCards />
      <Outro onStartBuilding={openRegisterModal} onContactUs={openContactModal} />
      <Footer />

      {/* ── Auth modal ─────────────────────────────────────────────────── */}
      {showLoginModal && (
        <div className="landing-login-modal-root" role="dialog" aria-modal="true" aria-labelledby="landing-auth-title">
          <button type="button" className="landing-login-modal-backdrop" aria-label="Close" onClick={closeAuthModal} />
          <div className="landing-login-modal-panel">
            <button type="button" className="landing-login-modal-close" aria-label="Close" onClick={closeAuthModal}>×</button>

            {/* Login */}
            {authModalMode === 'login' && (
              <>
                <div className="landing-login-modal-header">
                  <h2 id="landing-auth-title">Welcome back</h2>
                  <p>Sign in to continue building with Prompify</p>
                </div>
                <loginFetcher.Form method="post" action="/auth/login" className="landing-login-modal-form"
                  onSubmit={() => {
                    loginAttemptRef.current = true;
                    if (loginSigningInTimerRef.current) clearTimeout(loginSigningInTimerRef.current);
                    setLoginSigningIn(true);
                    loginSigningInTimerRef.current = setTimeout(() => {
                      loginSigningInTimerRef.current = null;
                      setLoginSigningIn(false);
                    }, LOGIN_SIGNING_IN_MAX_MS);
                  }}
                >
                  <input type="hidden" name="intent" value="login" />
                  {loginFetcher.data?.error && <div className="landing-login-modal-error" role="alert">{loginFetcher.data.error}</div>}

                  <label className="landing-login-modal-label" htmlFor="landing-login-email">Email</label>
                  <input id="landing-login-email" name="email" type="email" required autoComplete="email" className="landing-login-modal-input" placeholder="you@company.com" />

                  <label className="landing-login-modal-label" htmlFor="landing-login-password">Password</label>
                  <div className="landing-login-modal-password-wrap">
                    <input id="landing-login-password" name="password" type={loginShowPassword ? 'text' : 'password'} required autoComplete="current-password" className="landing-login-modal-input" placeholder="••••••••" />
                    <button type="button" className="landing-login-modal-toggle-pw" onClick={() => setLoginShowPassword(v => !v)} aria-label={loginShowPassword ? 'Hide password' : 'Show password'}>
                      {loginShowPassword ? 'Hide' : 'Show'}
                    </button>
                  </div>

                  <button type="submit" className="landing-login-modal-submit" disabled={loginFetcher.state === 'submitting' || (loginSigningIn && !loginFetcher.data?.error)}>
                    {loginFetcher.state === 'submitting' || (loginSigningIn && !loginFetcher.data?.error) ? 'Signing in…' : 'Sign in'}
                  </button>
                </loginFetcher.Form>
                <div className="landing-login-modal-footer">
                  <button type="button" className="landing-login-modal-footer-btn" onClick={() => setAuthModalMode('register')}>Create an account</button>
                  <span className="landing-login-modal-dot">·</span>
                  <button type="button" className="landing-login-modal-footer-btn" onClick={goToForgotInModal}>Forgot password?</button>
                </div>
              </>
            )}

            {/* Forgot password */}
            {authModalMode === 'forgot' && (
              <>
                <div className="landing-login-modal-header">
                  <h2 id="landing-auth-title">Forgot your password?</h2>
                  <p>Enter your email and we&apos;ll send you a link to reset it.</p>
                </div>
                {forgotFetcher.data?.success && !forgotShowFormForced ? (
                  <div className="landing-login-modal-form landing-login-modal-form--stack">
                    <div className="landing-login-modal-success" role="status">{forgotFetcher.data.success}</div>
                    <button type="button" className="landing-login-modal-submit" onClick={() => setAuthModalMode('login')}>Back to Sign in</button>
                    <button type="button" className="landing-login-modal-submit landing-login-modal-submit--secondary" onClick={() => setForgotShowFormForced(true)}>Send another link</button>
                  </div>
                ) : (
                  <forgotFetcher.Form method="post" action="/auth/forgot-password" className="landing-login-modal-form">
                    {forgotFetcher.data?.error && <div className="landing-login-modal-error" role="alert">{forgotFetcher.data.error}</div>}
                    <label className="landing-login-modal-label" htmlFor="landing-forgot-email">Email</label>
                    <input id="landing-forgot-email" name="email" type="email" required autoComplete="email" className="landing-login-modal-input" placeholder="you@company.com" />
                    <button type="submit" className="landing-login-modal-submit" disabled={forgotFetcher.state === 'submitting'}>
                      {forgotFetcher.state === 'submitting' ? 'Sending…' : 'Send reset link'}
                    </button>
                  </forgotFetcher.Form>
                )}
                <div className="landing-login-modal-footer">
                  <button type="button" className="landing-login-modal-footer-btn" onClick={() => setAuthModalMode('login')}>Back to Sign in</button>
                </div>
              </>
            )}

            {/* Register */}
            {authModalMode === 'register' && (
              <>
                <div className="landing-login-modal-header">
                  <h2 id="landing-auth-title">Create account</h2>
                  <p>Join Prompify and start building</p>
                </div>
                <registerFetcher.Form method="post" action="/auth/register" className="landing-login-modal-form">
                  <input type="hidden" name="intent" value="register" />
                  {registerFetcher.data?.error && <div className="landing-login-modal-error" role="alert">{registerFetcher.data.error}</div>}
                  {registerFetcher.data?.success && <div className="landing-login-modal-success" role="status">{registerFetcher.data.success}</div>}

                  <label className="landing-login-modal-label" htmlFor="landing-register-email">Email</label>
                  <input id="landing-register-email" name="email" type="email" required autoComplete="email" className="landing-login-modal-input" placeholder="you@company.com" />

                  <label className="landing-login-modal-label" htmlFor="landing-register-password">Password</label>
                  <div className="landing-login-modal-password-wrap">
                    <input id="landing-register-password" name="password" type={registerShowPassword ? 'text' : 'password'} required autoComplete="new-password" className="landing-login-modal-input" placeholder="Create a strong password" onChange={e => updateRegisterPasswordStrength(e.target.value)} />
                    <button type="button" className="landing-login-modal-toggle-pw" onClick={() => setRegisterShowPassword(v => !v)} aria-label={registerShowPassword ? 'Hide' : 'Show'}>
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

                  <label className="landing-login-modal-label" htmlFor="landing-register-confirm">Confirm password</label>
                  <div className="landing-login-modal-password-wrap">
                    <input id="landing-register-confirm" name="confirmPassword" type={registerShowConfirmPassword ? 'text' : 'password'} required autoComplete="new-password" className="landing-login-modal-input" placeholder="Confirm your password" />
                    <button type="button" className="landing-login-modal-toggle-pw" onClick={() => setRegisterShowConfirmPassword(v => !v)} aria-label={registerShowConfirmPassword ? 'Hide' : 'Show'}>
                      {registerShowConfirmPassword ? 'Hide' : 'Show'}
                    </button>
                  </div>

                  <button type="submit" className="landing-login-modal-submit" disabled={registerFetcher.state === 'submitting'}>
                    {registerFetcher.state === 'submitting' ? 'Creating account…' : 'Create account'}
                  </button>
                </registerFetcher.Form>
                <div className="landing-login-modal-footer">
                  <button type="button" className="landing-login-modal-footer-btn" onClick={() => setAuthModalMode('login')}>Already have an account? Sign in</button>
                  <span className="landing-login-modal-dot">·</span>
                  <button type="button" className="landing-login-modal-footer-btn" onClick={goToForgotInModal}>Forgot password?</button>
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
