import type { LinksFunction, LoaderFunctionArgs, MetaFunction } from '@remix-run/cloudflare';
import { json, redirect } from '@remix-run/cloudflare';
import { Link } from '@remix-run/react';
import { LandingAppChrome } from '~/components/landing/LandingAppChrome';
import { isAuthDisabled, optionalAuth } from '~/lib/auth';

const SITE_URL = process.env.SITE_URL || 'https://prompify.com';

/*
 * /about — public About page. Builds the E-E-A-T trust-signal STRUCTURE (who/why/how, contact,
 * FAQ) with placeholders left empty where no real data exists yet — never fabricated, per the
 * SEO/GEO golden rule. The founder/team bio, founding date, and contact channels below are
 * clearly marked TODOs for the owner to fill with real facts.
 */
export const links: LinksFunction = () => [{ rel: 'canonical', href: `${SITE_URL}/about` }];

export const meta: MetaFunction = () => [
  { title: 'About Prompify — AI app builder from prompts' },
  {
    name: 'description',
    content:
      'What Prompify is, who built it, and how it works. Prompify turns plain-English prompts into working, live web apps you can run in your browser.',
  },
  { property: 'og:title', content: 'About Prompify — AI app builder from prompts' },
  {
    property: 'og:description',
    content: 'What Prompify is, who built it, and how it turns prompts into live web apps.',
  },
  { property: 'og:type', content: 'website' },
  { property: 'og:url', content: `${SITE_URL}/about` },
  { name: 'twitter:card', content: 'summary' },
  { name: 'twitter:title', content: 'About Prompify — AI app builder from prompts' },
];

export async function loader({ request, context }: LoaderFunctionArgs) {
  /*
   * Match the landing behavior: under AUTH_DISABLED or when already signed in, send people to
   * the app rather than the marketing About page.
   */
  if (isAuthDisabled(context)) {
    return redirect('/app/');
  }

  const user = await optionalAuth(request, context);

  if (user) {
    return redirect('/app/');
  }

  return json({});
}

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
  mainEntity: [
    {
      '@type': 'Question',
      name: 'What is Prompify?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Prompify is an AI app builder: you describe what you need in plain English and it generates a working, live web app you can run in your browser.',
      },
    },
    {
      '@type': 'Question',
      name: 'How does Prompify work?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'You write a prompt describing the app you want. Prompify generates the code, runs it in a WebContainer in your browser, and lets you edit and deploy the result. Each generation is saved as a version you can restore.',
      },
    },
    {
      '@type': 'Question',
      name: 'Do I need to write code to use Prompify?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'No. You describe what you want in plain English. Prompify writes the code; you can edit it if you want to.',
      },
    },
  ],
};

export default function About() {
  return (
    <LandingAppChrome>
      <div className="flex items-center justify-between px-6 py-5">
        <Link to="/" className="text-2xl font-semibold text-accent">
          Prompify
        </Link>
        <Link to="/" className="text-sm text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary">
          ← Back to home
        </Link>
      </div>

      <main className="mx-auto w-full max-w-3xl px-6 pb-24 text-bolt-elements-textPrimary">
        <h1 className="mt-8 text-4xl font-bold">About Prompify</h1>
        <p className="mt-4 text-lg text-bolt-elements-textSecondary">
          Prompify turns plain-English prompts into working, live web apps you can run in your browser.
        </p>

        {/* JSON-LD: Organization + AboutPage + FAQPage */}
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(orgSchema) }} />
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(aboutSchema) }} />
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }} />

        {/* E-E-A-T: Who / Why / How. Real structure; placeholders left for the owner to fill. */}
        <section className="mt-12">
          <h2 className="text-2xl font-semibold">Who is behind Prompify?</h2>
          <div className="mt-3 rounded-lg border border-bolt-elements-borderColor p-4">
            {/* TODO:owner — replace this placeholder with the real founder/team name, role, and a
                short bio. Left empty per the no-fabrication rule. */}
            <p className="text-bolt-elements-textSecondary">
              <em>Founder &amp; team bio — to be added.</em> This section is intentionally a placeholder. When you have
              a real founder name, role, and a short first-person bio, add it here (and set the <code>founder</code>{' '}
              field in the JSON-LD above).
            </p>
          </div>
        </section>

        <section className="mt-10">
          <h2 className="text-2xl font-semibold">Why we built it</h2>
          <p className="mt-3 text-bolt-elements-textSecondary">
            {/* TODO:owner — replace with the real founding motivation. */}
            <em>Founding story — to be added.</em> Describe the problem you set out to solve and why an AI app builder
            was the answer.
          </p>
        </section>

        <section className="mt-10">
          <h2 className="text-2xl font-semibold">How it works</h2>
          <ol className="mt-3 list-decimal space-y-2 pl-6 text-bolt-elements-textSecondary">
            <li>You write a prompt describing the app you want in plain English.</li>
            <li>Prompify generates the code and runs it live in a browser WebContainer.</li>
            <li>Every generation is saved as a version you can restore later.</li>
            <li>Edit the code directly or ask for changes in chat, then deploy.</li>
          </ol>
        </section>

        <section className="mt-10">
          <h2 className="text-2xl font-semibold">Contact</h2>
          {/* TODO:owner — add the real support email / contact form / social links here. */}
          <p className="mt-3 text-bolt-elements-textSecondary">
            <em>Contact details — to be added.</em> Set a real support email and the <code>contactPoint</code> in the
            Organization JSON-LD above when available.
          </p>
        </section>

        <section className="mt-12">
          <h2 className="text-2xl font-semibold">FAQ</h2>
          <div className="mt-3 space-y-4">
            <div>
              <h3 className="font-semibold">What is Prompify?</h3>
              <p className="text-bolt-elements-textSecondary">
                An AI app builder: describe what you need in plain English and get a working, live web app in your
                browser.
              </p>
            </div>
            <div>
              <h3 className="font-semibold">How does it work?</h3>
              <p className="text-bolt-elements-textSecondary">
                You write a prompt; Prompify generates the code, runs it in a WebContainer, saves it as a version, and
                lets you edit or deploy.
              </p>
            </div>
            <div>
              <h3 className="font-semibold">Do I need to write code?</h3>
              <p className="text-bolt-elements-textSecondary">
                No — you describe what you want. You can edit the code if you choose to.
              </p>
            </div>
          </div>
        </section>
      </main>
    </LandingAppChrome>
  );
}
