import type { LinksFunction, LoaderFunctionArgs, MetaFunction } from '@remix-run/cloudflare';
import { json } from '@remix-run/cloudflare';
import { Link, useFetcher, useLoaderData } from '@remix-run/react';
import { useCallback, useEffect } from 'react';
import { CONTACT_COUNTRY_OPTIONS, CONTACT_ENQUIRY_OPTIONS } from '~/lib/contact-form-options';
import { optionalAuth } from '~/lib/auth';

const SITE_URL = process.env.SITE_URL || 'https://prompify.com';

/*
 * Palette, taken from the brand rather than invented here.
 *
 * PAPER and INK are the pairing the landing page's outro section already uses, and ACCENT_TEXT is
 * landing.css's own --prompify-accent-text: brand orange measures ~2.2:1 on a light surface, far
 * under the 4.5:1 WCAG AA wants, so #f97316 is a FILL colour and #9a3412 is the text one. RULE is
 * the hairline that carries most of the structure on this page.
 */
const PAPER = '#f0e4d5';
const INK = '#231710';
const ACCENT_TEXT = '#9a3412';
const ACCENT = '#f97316';
const RULE = 'rgba(35, 23, 16, 0.16)';

const HEADING_FONT = "'Raleway', 'Inter', -apple-system, BlinkMacSystemFont, sans-serif";
const BODY_FONT = "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";

/*
 * LEAVING_PAGE_NOTE — why every link off this page carries `reloadDocument`.
 *
 * The landing page gets its styling from landing.css, declared in _index's own links(). This page
 * does not declare that stylesheet, so a client-side transition from here to "/" landed on the
 * landing page without landing.css applied: the hero <img> rendered at natural size with no
 * object-fit/position, i.e. a giant raw photograph, and only a manual refresh put it right.
 *
 * A full document load also suits both destinations independently: "/" is a heavy GSAP +
 * ScrollTrigger + WebGL page that initialises on mount, and "/app/" is the whole workbench.
 */

/*
 * /about — the public About + Contact page, carrying the E-E-A-T structure (who/why/how, team,
 * contact, FAQ) and the only public contact form outside the landing-page modal.
 *
 * Design note, because the first version of this page got it wrong: it was dark, with frosted
 * glass panels, radial colour glows, a grid texture, all-caps labels over every section and four
 * numbered step cards. That is the house style of a generated page, and it read as one. The
 * structure here is deliberately plain instead — warm paper, real contrast, hairline rules and
 * whitespace doing the work that boxes were doing, one section label per block set in the left
 * margin, and no decoration that isn't carrying information.
 */
export const links: LinksFunction = () => [
  { rel: 'canonical', href: `${SITE_URL}/about` },
  { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
  { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossOrigin: 'anonymous' },
  // Raleway is the landing page's heading face; headings here use it rather than defaulting to Inter.
  { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=Raleway:wght@500;600;700&display=swap' },
];

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
 * AUTH_DISABLED) to /app, which left the team and the contact form unreachable for existing
 * customers and invisible while developing. The session is read only to pick the header link.
 */
export async function loader({ request, context }: LoaderFunctionArgs) {
  const user = await optionalAuth(request, context);
  return json({ isSignedIn: Boolean(user) });
}

type TeamMember = { name: string; role: string; location: string };

const TEAM: TeamMember[] = [
  { name: 'Mark Masahiro Ueno', role: 'CEO', location: 'Hong Kong' },
  { name: 'Alima Nur Begimbaeva', role: 'Project lead & AI engineer', location: 'Hong Kong' },
  { name: 'Punpun Pannatorn Visansavadh', role: 'AI engineer', location: 'Thailand' },
  { name: 'Nina Patcharada Tawaditap', role: 'Frontend developer', location: 'Thailand' },
  { name: 'Peng Xiaojun', role: 'Fullstack engineer', location: 'Hong Kong' },
  { name: 'Kevin Yan Zixiao', role: 'Fullstack engineer', location: 'Hong Kong' },
];

/** The one team photo. Point this at a file under /public and the placeholder gives way. */
const TEAM_PHOTO = '';

const STEPS = [
  {
    lead: 'You describe it',
    body: 'In plain English — the app you need, the way you would explain it to a colleague.',
  },
  {
    lead: 'Prompify builds it',
    body: 'The code is generated and runs live in your browser straight away, not as a mockup.',
  },
  {
    lead: 'You change your mind',
    body: 'Ask for changes in chat or edit the code directly. Every version is kept, so nothing is lost.',
  },
  { lead: 'You publish it', body: 'Share the finished app with your team.' },
];

const FAQS = [
  {
    q: 'What is Prompify?',
    a: 'An AI app builder. You describe what you need in plain English and get a working web app running in your browser.',
  },
  {
    q: 'How does it work?',
    a: 'You write a prompt. Prompify generates the code, runs it in a WebContainer, saves it as a version you can return to, and lets you edit or publish it.',
  },
  {
    q: 'Do I need to write code?',
    a: 'No. You describe what you want in plain English. If you do write code, you can edit anything it produces.',
  },
  {
    q: 'What can I build with it?',
    a: 'Internal business tools — customer and contact records, stock and inventory, HR and leave, bookings and scheduling, and knowledge bases.',
  },
];

const NAV = [
  { href: '#team', label: 'Team' },
  { href: '#how', label: 'How it works' },
  { href: '#contact', label: 'Contact' },
  { href: '#faq', label: 'Questions' },
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
  mainEntity: FAQS.map(f => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })),
};

// ─── In-page navigation ───────────────────────────────────────────────────────

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
 * A plain `<a href="#team">` took TWO clicks to work: the first changed the hash, React Router
 * read that as a location change, and <ScrollRestoration> in root.tsx reset the scroll, undoing
 * the jump. So scroll it ourselves and update the hash with replaceState, which keeps the URL
 * shareable without handing a navigation to the router — and leaves the back button meaning "the
 * page before this one" rather than walking back through every section.
 */
function useSectionNav() {
  const onNavClick = useCallback((event: React.MouseEvent<HTMLAnchorElement>, hash: string) => {
    // Leave modified clicks alone so open-in-new-tab still works.
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) {
      return;
    }

    if (scrollToHash(hash)) {
      event.preventDefault();
      window.history.replaceState(null, '', hash);
    }
  }, []);

  useEffect(() => {
    // A link straight to /about#contact should land on the section. 0 is a no-op to cancel.
    const id = window.location.hash ? window.requestAnimationFrame(() => scrollToHash(window.location.hash)) : 0;

    return () => window.cancelAnimationFrame(id);
  }, []);

  return onNavClick;
}

// ─── Layout primitives ────────────────────────────────────────────────────────

/**
 * Every block is the same shape: its name sits in the left margin, the content runs beside it.
 * One repeated layout idea, rather than a different card treatment per section.
 */
function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} style={{ scrollMarginTop: '76px' }} className="border-t py-14 sm:py-20" data-rule>
      <div className="mx-auto grid w-full max-w-5xl grid-cols-1 gap-8 px-6 sm:px-8 md:grid-cols-[150px_1fr] md:gap-12">
        <h2 className="text-base font-medium" style={{ fontFamily: HEADING_FONT, color: ACCENT_TEXT }}>
          {title}
        </h2>
        <div className="min-w-0">{children}</div>
      </div>
    </section>
  );
}

const inputStyle: React.CSSProperties = {
  background: '#fffaf4',
  border: `1px solid ${RULE}`,
  color: INK,
};

const fieldClass = 'w-full px-3 py-2.5 text-[15px] outline-none transition focus:border-current';
const labelClass = 'mb-1.5 block text-sm';

// ─── Contact form ─────────────────────────────────────────────────────────────

function ContactForm() {
  const fetcher = useFetcher<{ error?: string; success?: string }>();
  const sending = fetcher.state === 'submitting';

  if (fetcher.data?.success) {
    return (
      <p className="text-[15px] leading-relaxed" role="status" style={{ color: INK }}>
        {fetcher.data.success}
      </p>
    );
  }

  return (
    <fetcher.Form method="post" action="/api/contact">
      {fetcher.data?.error && (
        <p
          className="mb-5 py-2 pl-3 text-sm"
          role="alert"
          style={{ borderLeft: `2px solid ${ACCENT_TEXT}`, color: ACCENT_TEXT }}
        >
          {fetcher.data.error}
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className={labelClass} htmlFor="about-enquiry">
            What is this about?
          </label>
          <select
            id="about-enquiry"
            name="enquiryType"
            required
            defaultValue=""
            className={fieldClass}
            style={inputStyle}
          >
            <option value="" disabled>
              Choose one
            </option>
            {CONTACT_ENQUIRY_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className={labelClass} htmlFor="about-name">
            Your name
          </label>
          <input
            id="about-name"
            name="name"
            type="text"
            required
            maxLength={125}
            autoComplete="name"
            className={fieldClass}
            style={inputStyle}
          />
        </div>

        <div>
          <label className={labelClass} htmlFor="about-email">
            Email
          </label>
          <input
            id="about-email"
            name="email"
            type="email"
            required
            autoComplete="email"
            className={fieldClass}
            style={inputStyle}
          />
        </div>

        <div>
          <label className={labelClass} htmlFor="about-country">
            Country
          </label>
          <select id="about-country" name="country" required defaultValue="" className={fieldClass} style={inputStyle}>
            <option value="" disabled hidden>
              Choose one
            </option>
            {CONTACT_COUNTRY_OPTIONS.filter(o => o.value).map(opt => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className={labelClass} htmlFor="about-phone">
            Phone
          </label>
          <input
            id="about-phone"
            name="phone"
            type="tel"
            required
            maxLength={40}
            autoComplete="tel"
            className={fieldClass}
            style={inputStyle}
          />
        </div>

        <div className="sm:col-span-2">
          <label className={labelClass} htmlFor="about-message">
            What do you need?
          </label>
          <textarea
            id="about-message"
            name="message"
            required
            rows={4}
            minLength={10}
            maxLength={125}
            className={`${fieldClass} resize-y`}
            style={inputStyle}
          />
          <p className="mt-1.5 text-xs" style={{ color: 'rgba(35,23,16,0.55)' }}>
            Up to 125 characters.
          </p>
        </div>
      </div>

      <button
        type="submit"
        disabled={sending}
        className="mt-5 px-6 py-2.5 text-[15px] font-medium transition disabled:opacity-55"
        style={{ background: INK, color: PAPER }}
      >
        {sending ? 'Sending' : 'Send'}
      </button>
    </fetcher.Form>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function About() {
  const { isSignedIn } = useLoaderData<typeof loader>();
  const onNavClick = useSectionNav();

  return (
    <div className="min-h-[100dvh] w-full" style={{ background: PAPER, color: INK, fontFamily: BODY_FONT }}>
      {/* Hairline rules carry the structure, so they are defined once here. */}
      <style>{`[data-rule]{border-color:${RULE}}`}</style>

      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(orgSchema) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(aboutSchema) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }} />

      <header className="sticky top-0 z-20 border-b" data-rule style={{ background: PAPER }}>
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-6 px-6 py-3.5 sm:px-8">
          {/* reloadDocument: see LEAVING_PAGE_NOTE. */}
          <Link reloadDocument to="/" className="flex shrink-0 items-center gap-2" aria-label="Prompify home">
            <img src="/prompify2.png" alt="" width={22} height={22} className="block" />
            <span className="text-[15px] font-semibold" style={{ fontFamily: HEADING_FONT }}>
              Prompify
            </span>
          </Link>

          <nav aria-label="Sections" className="hidden items-center gap-6 md:flex">
            {NAV.map(item => (
              <a
                key={item.href}
                href={item.href}
                onClick={e => onNavClick(e, item.href)}
                className="text-sm transition hover:opacity-100"
                style={{ opacity: 0.7 }}
              >
                {item.label}
              </a>
            ))}
          </nav>

          <Link
            reloadDocument
            to={isSignedIn ? '/app/' : '/'}
            className="shrink-0 text-sm font-medium"
            style={{ color: ACCENT_TEXT }}
          >
            {isSignedIn ? 'Open app' : 'Start building'}
          </Link>
        </div>
      </header>

      <main>
        {/* Opening. No label above the headline, no badge, nothing centred. */}
        <div className="mx-auto w-full max-w-5xl px-6 pb-14 pt-16 sm:px-8 sm:pt-24">
          <h1
            className="max-w-[18ch] text-4xl font-bold leading-[1.08] sm:text-5xl md:text-6xl"
            style={{ fontFamily: HEADING_FONT, letterSpacing: '-0.02em' }}
          >
            We build Prompify.
          </h1>
          <p className="mt-6 max-w-[58ch] text-lg leading-relaxed" style={{ color: 'rgba(35,23,16,0.78)' }}>
            Six of us, between Hong Kong and Thailand. Prompify turns a plain-English description into a working web app
            you can open in your browser — the kind of internal tool a team would otherwise wait months for, or never
            get at all.
          </p>
        </div>

        <Section id="team" title="Team">
          <div className="mb-10" style={{ border: `1px solid ${RULE}` }}>
            {TEAM_PHOTO ? (
              <img src={TEAM_PHOTO} alt="The Prompify team" className="block aspect-[16/9] w-full object-cover" />
            ) : (
              <div className="flex aspect-[16/9] w-full items-end p-5" style={{ background: 'rgba(35,23,16,0.05)' }}>
                <span className="text-sm" style={{ color: 'rgba(35,23,16,0.5)' }}>
                  Team photograph to follow
                </span>
              </div>
            )}
          </div>

          <ul>
            {TEAM.map((member, i) => (
              <li
                key={member.name}
                className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 py-3.5"
                style={i === 0 ? undefined : { borderTop: `1px solid ${RULE}` }}
              >
                <span className="text-[17px] font-medium" style={{ fontFamily: HEADING_FONT }}>
                  {member.name}
                </span>
                <span className="text-[15px]" style={{ color: 'rgba(35,23,16,0.62)' }}>
                  {member.role}
                  <span aria-hidden="true"> · </span>
                  {member.location}
                </span>
              </li>
            ))}
          </ul>
        </Section>

        <Section id="how" title="How it works">
          <div className="max-w-[62ch]">
            {STEPS.map((step, i) => (
              <p
                key={step.lead}
                className="py-3.5 text-[17px] leading-relaxed"
                style={i === 0 ? undefined : { borderTop: `1px solid ${RULE}` }}
              >
                <span className="font-semibold" style={{ fontFamily: HEADING_FONT }}>
                  {step.lead}.
                </span>{' '}
                <span style={{ color: 'rgba(35,23,16,0.75)' }}>{step.body}</span>
              </p>
            ))}
          </div>
        </Section>

        <Section id="contact" title="Contact">
          <p className="mb-8 max-w-[58ch] text-[17px] leading-relaxed" style={{ color: 'rgba(35,23,16,0.78)' }}>
            Pricing, a demo, a security review, or something we haven&apos;t thought of — write to us and whoever knows
            the answer will reply, usually within a working day.
          </p>
          <div className="max-w-xl">
            <ContactForm />
          </div>
        </Section>

        <Section id="faq" title="Questions">
          <div className="max-w-[62ch]">
            {FAQS.map((faq, i) => (
              <details
                key={faq.q}
                className="group py-3.5"
                style={i === 0 ? undefined : { borderTop: `1px solid ${RULE}` }}
              >
                <summary
                  className="cursor-pointer list-none text-[17px] font-medium marker:content-['']"
                  style={{ fontFamily: HEADING_FONT }}
                >
                  {faq.q}
                </summary>
                <p className="mt-2.5 text-[15px] leading-relaxed" style={{ color: 'rgba(35,23,16,0.75)' }}>
                  {faq.a}
                </p>
              </details>
            ))}
          </div>
        </Section>

        <footer className="border-t py-10" data-rule>
          <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-4 px-6 text-sm sm:px-8">
            <span style={{ color: 'rgba(35,23,16,0.55)' }}>© 2026 Basic Concept Limited</span>
            <Link reloadDocument to="/" style={{ color: ACCENT_TEXT }}>
              Back to prompify.com
            </Link>
          </div>
        </footer>
      </main>

      {/* The single piece of decoration on the page: a brand-orange rule closing it off. */}
      <div style={{ height: '4px', background: ACCENT }} />
    </div>
  );
}
