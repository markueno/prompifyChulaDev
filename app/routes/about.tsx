import type { LinksFunction, LoaderFunctionArgs, MetaFunction } from '@remix-run/cloudflare';
import { json } from '@remix-run/cloudflare';
import { Link, useFetcher, useLoaderData } from '@remix-run/react';
import { useCallback, useEffect } from 'react';
import { CONTACT_COUNTRY_OPTIONS, CONTACT_ENQUIRY_OPTIONS } from '~/lib/contact-form-options';
import { optionalAuth } from '~/lib/auth';

const SITE_URL = process.env.SITE_URL || 'https://prompify.com';

/** Brand ink — the same dark the landing page sits on, so the two pages feel related. */
const INK = '#231710';

/*
 * LEAVING_PAGE_NOTE — why every link off this page carries `reloadDocument`.
 *
 * The landing page gets its styling from landing.css, declared in _index's own `links()`. This
 * page no longer declares that stylesheet (it paints its own backdrop), so a client-side
 * transition from here to "/" landed on the landing page without landing.css applied: the hero
 * `<img>` rendered at natural size with no `object-fit`/`position: fixed`, i.e. a giant raw
 * photograph, and only a manual refresh — a full document load, where the stylesheet is
 * server-rendered into the markup — put it right.
 *
 * It worked before only because this page used to pull in landing.css as well, so the stylesheet
 * already happened to be in the document. That was coincidence, not design.
 *
 * A full document load also suits both destinations independently: "/" is a heavy GSAP +
 * ScrollTrigger + WebGL page that sets itself up on mount, and "/app/" is the whole workbench.
 * Neither benefits from being client-side transitioned into from a static marketing page.
 */

/*
 * /about — the public About + Contact page. Builds the E-E-A-T trust-signal structure
 * (who/why/how, team, contact, FAQ) and carries the only public contact form outside the
 * landing-page modal.
 *
 * Design note: LandingAppChrome paints a fixed photographic backdrop (#231710 under a burnt-orange
 * wash), so this page is deliberately styled light-on-dark with frosted-glass panels, matching the
 * landing navbar. It does NOT use the bolt-elements theme tokens — those flip with the app theme
 * and would render dark-on-dark here.
 */
/*
 * No landing.css here. This page paints its own backdrop (see AboutBackdrop) rather than using
 * LandingAppChrome's photographic one, so it has no dependency on the landing stylesheet — which
 * is deliberate: it previously rendered unreadable when that stylesheet wasn't linked.
 */
export const links: LinksFunction = () => [{ rel: 'canonical', href: `${SITE_URL}/about` }];

export const meta: MetaFunction = () => [
  { title: 'About Prompify — the team behind the AI app builder' },
  {
    name: 'description',
    content:
      'Who builds Prompify, why we built it, and how it works. Meet the team across Hong Kong and Thailand, and get in touch.',
  },
  { property: 'og:title', content: 'About Prompify — the team behind the AI app builder' },
  {
    property: 'og:description',
    content: 'Meet the team behind Prompify, see how it works, and get in touch.',
  },
  { property: 'og:type', content: 'website' },
  { property: 'og:url', content: `${SITE_URL}/about` },
  { name: 'twitter:card', content: 'summary' },
  { name: 'twitter:title', content: 'About Prompify — the team behind the AI app builder' },
];

/*
 * Public on purpose. This page used to redirect signed-in visitors (and all of local dev, under
 * AUTH_DISABLED) straight to /app, which meant the team and contact form were unreachable for
 * anyone logged in — and invisible while developing. An About/Contact page that existing
 * customers cannot open is the wrong behaviour; the session is read only to tailor the header CTA.
 */
export async function loader({ request, context }: LoaderFunctionArgs) {
  const user = await optionalAuth(request, context);
  return json({ isSignedIn: Boolean(user) });
}

/** The project team. `photo` below is a single GROUP photo — drop a file in and it renders. */
type TeamMember = { name: string; role: string; location: string };

const TEAM: TeamMember[] = [
  { name: 'Mark Masahiro Ueno', role: 'CEO', location: 'Hong Kong' },
  { name: 'Alima Nur Begimbaeva', role: 'Project Lead & AI Engineer', location: 'Hong Kong' },
  { name: 'Punpun Pannatorn Visansavadh', role: 'AI Engineer', location: 'Thailand' },
  { name: 'Nina Patcharada Tawaditap', role: 'Frontend Developer', location: 'Thailand' },
  { name: 'Peng Xiaojun', role: 'Fullstack Engineer', location: 'Hong Kong' },
  { name: 'Kevin Yan Zixiao', role: 'Fullstack Engineer', location: 'Hong Kong' },
];

/*
 * The one team photo. Leave empty to render the upload placeholder; set it to a path under
 * /public (e.g. '/team/group.jpg') and the real image takes over. Nothing else needs changing.
 */
const TEAM_PHOTO = '';

const STEPS = [
  { title: 'Describe it', body: 'Write what you need in plain English — no code, no setup.' },
  { title: 'Watch it build', body: 'Prompify generates the app and runs it live in your browser.' },
  { title: 'Refine it', body: 'Ask for changes in chat, or edit the code directly. Every version is saved.' },
  { title: 'Ship it', body: 'Publish your app and share it with your team.' },
];

const FAQS = [
  {
    q: 'What is Prompify?',
    a: 'An AI app builder: describe what you need in plain English and get a working, live web app in your browser.',
  },
  {
    q: 'How does it work?',
    a: 'You write a prompt; Prompify generates the code, runs it in a WebContainer, saves it as a version, and lets you edit or deploy it.',
  },
  {
    q: 'Do I need to write code?',
    a: 'No — you describe what you want. You can edit the code if you choose to.',
  },
  {
    q: 'What kind of apps can I build?',
    a: 'Internal business tools: CRMs, inventory and stock systems, HR and leave tracking, booking and scheduling, and knowledge bases.',
  },
];

const NAV = [
  { href: '#about', label: 'About' },
  { href: '#team', label: 'Team' },
  { href: '#how', label: 'How it works' },
  { href: '#contact', label: 'Contact' },
  { href: '#faq', label: 'FAQ' },
];

const orgSchema = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name: 'Prompify',
  url: `${SITE_URL}`,
  logo: `${SITE_URL}/prompify1.png`,
  description: 'Prompify turns plain-English prompts into working, live web apps you can run in your browser.',
  // TODO:owner — fill these with real values when available. Left empty rather than fabricated.
  founder: { '@type': 'Person', name: '' },
  foundingDate: '',
  employee: TEAM.map(m => ({ '@type': 'Person', name: m.name, jobTitle: m.role })),
  contactPoint: [{ '@type': 'ContactPoint', contactType: 'support', email: '', url: `${SITE_URL}/about` }],
};

const aboutSchema = {
  '@context': 'https://schema.org',
  '@type': 'AboutPage',
  name: 'About Prompify',
  url: `${SITE_URL}/about`,
};

const faqSchema = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: FAQS.map(f => ({
    '@type': 'Question',
    name: f.q,
    acceptedAnswer: { '@type': 'Answer', text: f.a },
  })),
};

// ─── Shared visual language ───────────────────────────────────────────────────

/** Frosted panel, same treatment as the landing navbar. */
const glass: React.CSSProperties = {
  background: 'rgba(255, 255, 255, 0.07)',
  border: '1px solid rgba(255, 255, 255, 0.14)',
  backdropFilter: 'blur(22px) saturate(1.25)',
  WebkitBackdropFilter: 'blur(22px) saturate(1.25)',
};

/** Anchored sections sit below the sticky bar rather than under it. */
const anchorOffset: React.CSSProperties = { scrollMarginTop: '88px' };

/**
 * The page backdrop: flat brand ink, with semi-opaque brand-orange graphics over it.
 *
 * Fixed and non-interactive, so it stays put while the page scrolls and never intercepts a click.
 * Everything is CSS/SVG — no image to load, nothing to go stale, and it can't push layout around
 * the way the old photographic backdrop's <img> could.
 */
function AboutBackdrop() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-0 overflow-hidden"
      style={{ background: INK }}
    >
      {/* Soft brand glows — the main colour. Large and low-opacity so they read as light, not blobs. */}
      <div
        className="absolute"
        style={{
          top: '-18%',
          left: '-12%',
          width: '65vw',
          height: '65vw',
          background: 'radial-gradient(circle, rgba(249,115,22,0.20) 0%, rgba(249,115,22,0) 68%)',
        }}
      />
      <div
        className="absolute"
        style={{
          bottom: '-25%',
          right: '-15%',
          width: '70vw',
          height: '70vw',
          background: 'radial-gradient(circle, rgba(194,65,12,0.22) 0%, rgba(194,65,12,0) 68%)',
        }}
      />
      <div
        className="absolute"
        style={{
          top: '38%',
          right: '26%',
          width: '34vw',
          height: '34vw',
          background: 'radial-gradient(circle, rgba(253,186,116,0.10) 0%, rgba(253,186,116,0) 70%)',
        }}
      />

      {/* Faint grid, for texture rather than pattern — barely visible by design. */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage:
            'linear-gradient(rgba(255,255,255,0.030) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.030) 1px, transparent 1px)',
          backgroundSize: '64px 64px',
          maskImage: 'radial-gradient(ellipse at 50% 0%, #000 35%, transparent 78%)',
          WebkitMaskImage: 'radial-gradient(ellipse at 50% 0%, #000 35%, transparent 78%)',
        }}
      />

      {/* Semi-opaque orange rings, echoing the logo's geometry. */}
      <svg
        className="absolute"
        style={{ top: '-10vw', right: '-8vw', width: '52vw', height: '52vw', opacity: 0.5 }}
        viewBox="0 0 400 400"
        fill="none"
      >
        <circle cx="200" cy="200" r="150" stroke="rgba(249,115,22,0.16)" strokeWidth="1.5" />
        <circle cx="200" cy="200" r="110" stroke="rgba(249,115,22,0.11)" strokeWidth="1.5" />
        <circle cx="200" cy="200" r="70" stroke="rgba(249,115,22,0.08)" strokeWidth="1.5" />
      </svg>
      <svg
        className="absolute"
        style={{ bottom: '-14vw', left: '-10vw', width: '46vw', height: '46vw', opacity: 0.45 }}
        viewBox="0 0 400 400"
        fill="none"
      >
        <circle cx="200" cy="200" r="160" stroke="rgba(253,186,116,0.12)" strokeWidth="1.5" />
        <circle cx="200" cy="200" r="118" stroke="rgba(253,186,116,0.09)" strokeWidth="1.5" />
      </svg>

      {/* The mark itself, as a watermark. Low enough not to compete with the text. */}
      <img
        src="/prompify2.png"
        alt=""
        className="absolute hidden select-none md:block"
        style={{ bottom: '6vh', right: '5vw', width: '20vw', maxWidth: '260px', opacity: 0.05 }}
      />

      {/* Settles the top of the page so the sticky header always has something solid behind it. */}
      <div
        className="absolute inset-x-0 top-0 h-40"
        style={{ background: `linear-gradient(${INK} 0%, rgba(35,23,16,0) 100%)` }}
      />
    </div>
  );
}

/** Scroll to a section, honouring scroll-margin-top and reduced-motion. */
function scrollToHash(hash: string) {
  const el = document.querySelector(hash);

  if (!el) {
    return false;
  }

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  el.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });

  return true;
}

/**
 * In-page navigation, done by hand.
 *
 * A plain `<a href="#team">` took TWO clicks to work. The first click changes the hash, React
 * Router treats that as a location change, and the <ScrollRestoration> in root.tsx resets the
 * scroll — undoing the jump the browser just made. The second click changes no location, so
 * nothing interferes and the native jump survives.
 *
 * So: scroll it ourselves, and update the hash with replaceState, which keeps the URL shareable
 * without handing a navigation to the router. replaceState also keeps the back button meaning
 * "the page before this one" rather than "the section before this one".
 */
function useSectionNav() {
  const onNavClick = useCallback((event: React.MouseEvent<HTMLAnchorElement>, hash: string) => {
    // Leave modified clicks alone — open-in-new-tab should still work.
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) {
      return;
    }

    if (scrollToHash(hash)) {
      event.preventDefault();
      window.history.replaceState(null, '', hash);
    }
  }, []);

  // A link straight to /about#contact should land on the section, not the top of the page.
  useEffect(() => {
    // After paint, so the target has its final position. 0 is a no-op to cancel.
    const id = window.location.hash ? window.requestAnimationFrame(() => scrollToHash(window.location.hash)) : 0;

    return () => window.cancelAnimationFrame(id);
  }, []);

  return onNavClick;
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return <p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-accent-400">{children}</p>;
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return <h2 className="text-3xl font-bold leading-tight text-white sm:text-4xl">{children}</h2>;
}

// ─── Contact form ─────────────────────────────────────────────────────────────

const fieldClass =
  'w-full rounded-lg border border-white/15 bg-black/25 px-3.5 py-2.5 text-sm text-white placeholder-white/35 outline-none transition focus:border-accent-500 focus:ring-2 focus:ring-accent-500/35';
const labelClass = 'mb-1.5 block text-sm font-medium text-white/85';

function ContactForm() {
  const fetcher = useFetcher<{ error?: string; success?: string }>();
  const sending = fetcher.state === 'submitting';

  if (fetcher.data?.success) {
    return (
      <div className="rounded-2xl p-6 sm:p-7" style={glass}>
        <div className="flex items-start gap-3">
          <div
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent-500/20 text-accent-300"
            aria-hidden="true"
          >
            ✓
          </div>
          <div>
            <h3 className="font-semibold text-white">Message sent</h3>
            <p className="mt-1 text-sm text-white/70" role="status">
              {fetcher.data.success}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <fetcher.Form method="post" action="/api/contact" className="rounded-2xl p-6 sm:p-7" style={glass}>
      {fetcher.data?.error && (
        <div
          className="mb-4 rounded-lg border border-red-400/30 bg-red-500/15 px-3.5 py-2.5 text-sm text-red-100"
          role="alert"
        >
          {fetcher.data.error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className={labelClass} htmlFor="about-enquiry">
            Topic <span className="text-accent-400">*</span>
          </label>
          <select id="about-enquiry" name="enquiryType" required defaultValue="" className={fieldClass}>
            <option value="" disabled>
              Select a topic
            </option>
            {CONTACT_ENQUIRY_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value} className="bg-[#231710]">
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className={labelClass} htmlFor="about-name">
            Full name <span className="text-accent-400">*</span>
          </label>
          <input
            id="about-name"
            name="name"
            type="text"
            required
            maxLength={125}
            autoComplete="name"
            placeholder="Your name"
            className={fieldClass}
          />
        </div>

        <div>
          <label className={labelClass} htmlFor="about-email">
            Email <span className="text-accent-400">*</span>
          </label>
          <input
            id="about-email"
            name="email"
            type="email"
            required
            autoComplete="email"
            placeholder="you@company.com"
            className={fieldClass}
          />
        </div>

        <div>
          <label className={labelClass} htmlFor="about-country">
            Country <span className="text-accent-400">*</span>
          </label>
          <select id="about-country" name="country" required defaultValue="" className={fieldClass}>
            <option value="" disabled hidden>
              Select country
            </option>
            {CONTACT_COUNTRY_OPTIONS.filter(o => o.value).map(opt => (
              <option key={opt.value} value={opt.value} className="bg-[#231710]">
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className={labelClass} htmlFor="about-phone">
            Phone <span className="text-accent-400">*</span>
          </label>
          <input
            id="about-phone"
            name="phone"
            type="tel"
            required
            maxLength={40}
            autoComplete="tel"
            placeholder="e.g. 555 0100"
            className={fieldClass}
          />
        </div>

        <div className="sm:col-span-2">
          <label className={labelClass} htmlFor="about-message">
            How can we help? <span className="text-accent-400">*</span>
          </label>
          <textarea
            id="about-message"
            name="message"
            required
            rows={4}
            minLength={10}
            maxLength={125}
            placeholder="Tell us a little about what you need (max 125 characters)"
            className={`${fieldClass} resize-y`}
          />
        </div>
      </div>

      <button
        type="submit"
        disabled={sending}
        className="mt-5 w-full rounded-full bg-accent-500 px-6 py-3 text-sm font-semibold text-white transition hover:bg-accent-600 focus:outline-none focus:ring-2 focus:ring-accent-500/50 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {sending ? 'Sending…' : 'Send message'}
      </button>
    </fetcher.Form>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function About() {
  const { isSignedIn } = useLoaderData<typeof loader>();
  const onNavClick = useSectionNav();

  return (
    <div
      className="relative flex min-h-[100dvh] w-full flex-col"
      style={{
        background: INK,
        fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      }}
    >
      <AboutBackdrop />

      {/* Everything below sits above the backdrop. */}
      <div className="relative z-[1] flex min-h-0 w-full flex-1 flex-col">
        {/* JSON-LD: Organization + AboutPage + FAQPage */}
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(orgSchema) }} />
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(aboutSchema) }} />
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }} />

        {/* ── Sticky section nav ─────────────────────────────────────────── */}
        <header
          className="sticky top-0 z-20 flex items-center justify-between gap-4 px-5 py-3 sm:px-8"
          style={{
            background: 'rgba(35, 23, 16, 0.72)',
            backdropFilter: 'blur(24px) saturate(1.3)',
            WebkitBackdropFilter: 'blur(24px) saturate(1.3)',
            borderBottom: '1px solid rgba(255,255,255,0.12)',
          }}
        >
          {/* reloadDocument: see the note on LEAVING_PAGE_NOTE below. */}
          <Link reloadDocument to="/" className="flex shrink-0 items-center gap-2" aria-label="Prompify home">
            <img src="/prompify2.png" alt="" width={26} height={26} className="block" />
            <span className="text-base font-semibold text-white">Prompify</span>
          </Link>

          <nav aria-label="Page sections" className="hidden items-center gap-1 md:flex">
            {NAV.map(item => (
              <a
                key={item.href}
                href={item.href}
                onClick={e => onNavClick(e, item.href)}
                className="rounded-full px-3 py-1.5 text-sm text-white/75 transition hover:bg-white/10 hover:text-white"
              >
                {item.label}
              </a>
            ))}
          </nav>

          <Link
            reloadDocument
            to={isSignedIn ? '/app/' : '/'}
            className="shrink-0 rounded-full bg-accent-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-accent-600"
          >
            {isSignedIn ? 'Open app' : 'Start building'}
          </Link>
        </header>

        <main className="w-full text-white">
          {/* ── Hero ─────────────────────────────────────────────────────── */}
          <section
            id="about"
            style={anchorOffset}
            className="mx-auto w-full max-w-5xl px-5 pb-14 pt-16 sm:px-8 sm:pt-24"
          >
            <Eyebrow>About us</Eyebrow>
            <h1 className="max-w-3xl text-4xl font-bold leading-[1.1] sm:text-5xl md:text-6xl">
              The team behind <span className="text-accent-400">Prompify</span>
            </h1>
            <p className="mt-5 max-w-2xl text-lg leading-relaxed text-white/75">
              Prompify turns plain-English prompts into working, live web apps you can run in your browser. We&apos;re a
              small, cross-border team building it across Hong Kong and Thailand.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <a
                href="#team"
                onClick={e => onNavClick(e, '#team')}
                className="rounded-full bg-white/10 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-white/20"
                style={glass}
              >
                Meet the team
              </a>
              <a
                href="#contact"
                onClick={e => onNavClick(e, '#contact')}
                className="rounded-full bg-accent-500 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-accent-600"
              >
                Get in touch
              </a>
            </div>
          </section>

          {/* ── Team ─────────────────────────────────────────────────────── */}
          <section id="team" style={anchorOffset} className="mx-auto w-full max-w-5xl px-5 py-14 sm:px-8">
            <Eyebrow>Team</Eyebrow>
            <SectionHeading>Six people, two countries</SectionHeading>

            {/* One group photo. Placeholder until TEAM_PHOTO points at a real file. */}
            <div className="mt-8 overflow-hidden rounded-2xl" style={glass}>
              {TEAM_PHOTO ? (
                <img src={TEAM_PHOTO} alt="The Prompify team" className="aspect-[16/9] w-full object-cover" />
              ) : (
                <div className="flex aspect-[16/9] w-full flex-col items-center justify-center gap-3 border-2 border-dashed border-white/15 bg-black/20 text-center">
                  <svg
                    viewBox="0 0 24 24"
                    width="34"
                    height="34"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                    className="text-white/35"
                  >
                    <rect x="3" y="5" width="18" height="14" rx="2" />
                    <circle cx="8.5" cy="10.5" r="1.5" />
                    <path d="m21 15-4.5-4.5L9 18" />
                  </svg>
                  <p className="text-sm font-medium text-white/55">Team photo coming soon</p>
                </div>
              )}
            </div>

            <ul className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {TEAM.map(member => (
                <li key={member.name} className="rounded-xl px-5 py-4 transition hover:bg-white/[0.11]" style={glass}>
                  <p className="text-xs font-semibold uppercase tracking-wide text-accent-400">{member.role}</p>
                  <p className="mt-1.5 font-semibold leading-snug text-white">{member.name}</p>
                  <p className="mt-2 flex items-center gap-1.5 text-sm text-white/60">
                    <svg
                      viewBox="0 0 24 24"
                      width="13"
                      height="13"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                      className="shrink-0"
                    >
                      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0Z" />
                      <circle cx="12" cy="10" r="3" />
                    </svg>
                    {member.location}
                  </p>
                </li>
              ))}
            </ul>
          </section>

          {/* ── How it works ─────────────────────────────────────────────── */}
          <section id="how" style={anchorOffset} className="mx-auto w-full max-w-5xl px-5 py-14 sm:px-8">
            <Eyebrow>How it works</Eyebrow>
            <SectionHeading>From a sentence to a running app</SectionHeading>
            <ol className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2">
              {STEPS.map((step, i) => (
                <li key={step.title} className="rounded-xl p-5" style={glass}>
                  <span className="text-sm font-bold text-accent-400">{String(i + 1).padStart(2, '0')}</span>
                  <h3 className="mt-2 font-semibold text-white">{step.title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-white/70">{step.body}</p>
                </li>
              ))}
            </ol>
          </section>

          {/* ── Contact ──────────────────────────────────────────────────── */}
          <section id="contact" style={anchorOffset} className="mx-auto w-full max-w-5xl px-5 py-14 sm:px-8">
            <div className="grid grid-cols-1 gap-8 lg:grid-cols-[0.85fr_1.15fr] lg:gap-10">
              <div>
                <Eyebrow>Contact</Eyebrow>
                <SectionHeading>Talk to us</SectionHeading>
                <p className="mt-4 text-base leading-relaxed text-white/70">
                  Questions about pricing, a demo, security review, or a partnership — send a note and the right person
                  on the team will reply.
                </p>
                <ul className="mt-6 space-y-2.5 text-sm text-white/65">
                  <li className="flex items-start gap-2.5">
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-accent-500" aria-hidden="true" />
                    We usually reply within one business day.
                  </li>
                  <li className="flex items-start gap-2.5">
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-accent-500" aria-hidden="true" />
                    Tell us your use case and we&apos;ll show you a relevant build.
                  </li>
                  <li className="flex items-start gap-2.5">
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-accent-500" aria-hidden="true" />
                    Enterprise, security and compliance questions welcome.
                  </li>
                </ul>
              </div>
              <ContactForm />
            </div>
          </section>

          {/* ── FAQ ──────────────────────────────────────────────────────── */}
          <section id="faq" style={anchorOffset} className="mx-auto w-full max-w-5xl px-5 py-14 sm:px-8">
            <Eyebrow>FAQ</Eyebrow>
            <SectionHeading>Common questions</SectionHeading>
            <div className="mt-8 space-y-3">
              {FAQS.map(faq => (
                <details key={faq.q} className="group rounded-xl px-5 py-4" style={glass}>
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium text-white marker:content-['']">
                    {faq.q}
                    <span
                      className="shrink-0 text-accent-400 transition-transform group-open:rotate-45"
                      aria-hidden="true"
                    >
                      +
                    </span>
                  </summary>
                  <p className="mt-3 text-sm leading-relaxed text-white/70">{faq.a}</p>
                </details>
              ))}
            </div>
          </section>

          {/* ── Footer ───────────────────────────────────────────────────── */}
          <footer className="mt-6 border-t border-white/10 px-5 py-8 sm:px-8">
            <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-4">
              <p className="text-sm text-white/50">© 2026 Basic Concept Limited. All rights reserved.</p>
              <Link
                reloadDocument
                to="/"
                className="text-sm text-white/70 underline-offset-4 transition hover:text-white hover:underline"
              >
                ← Back to home
              </Link>
            </div>
          </footer>
        </main>
      </div>
    </div>
  );
}
