import type { ActionFunctionArgs, LinksFunction, LoaderFunctionArgs, MetaFunction } from '@remix-run/cloudflare';
import { json, redirect } from '@remix-run/cloudflare';
import { LandingPage } from '~/components/landing/LandingPage';
import { createAuthCookie, isAuthDisabled, optionalAuth } from '~/lib/auth';

import landingStyles from '~/styles/landing.css?url';

const SITE_URL = process.env.SITE_URL || 'https://prompify.com';

export const links: LinksFunction = () => [
  // Canonical host = https://prompify.com (pick ONE host; 301 the www variant at the edge/nginx).
  { rel: 'canonical', href: `${SITE_URL}/` },
  { rel: 'stylesheet', href: landingStyles },
  /*
   * Note: Google Fonts are loaded async below (non-render-blocking) instead of via blocking
   * <link rel=stylesheet> — improves LCP / Core Web Vitals. Inter is also loaded globally by
   * root.tsx; here we additionally pull Raleway for landing headings, non-blocking.
   */
];

export const meta: MetaFunction = () => {
  return [
    { title: 'Prompify — AI App Builder from Prompts' },
    {
      name: 'description',
      content:
        'Prompify turns plain-English prompts into working, live web apps you can run in your browser. Describe what you need and ship a real app — no code required.',
    },
    { property: 'og:title', content: 'Prompify — AI App Builder from Prompts' },
    {
      property: 'og:description',
      content: 'Describe what you need in plain English and get a working, live web app in your browser.',
    },
    { property: 'og:type', content: 'website' },
    { property: 'og:url', content: `${SITE_URL}/` },
    { property: 'og:site_name', content: 'Prompify' },
    { property: 'og:image', content: `${SITE_URL}/prompify1.png` },
    { name: 'twitter:card', content: 'summary_large_image' },
    { name: 'twitter:title', content: 'Prompify — AI App Builder from Prompts' },
    {
      name: 'twitter:description',
      content: 'Describe what you need in plain English and get a working, live web app in your browser.',
    },
    { name: 'twitter:image', content: `${SITE_URL}/prompify1.png` },
  ];
};

export async function loader({ request, context }: LoaderFunctionArgs) {
  if (isAuthDisabled(context)) {
    return redirect('/app/');
  }

  const user = await optionalAuth(request, context);

  if (user) {
    return redirect('/app/');
  }

  return json({});
}

export async function action({ request }: ActionFunctionArgs) {
  const formData = await request.formData();
  const email = (formData.get('email') as string) || '';
  const password = (formData.get('password') as string) || '';
  const intent = (formData.get('intent') as string) || '';

  if (intent !== 'login') {
    return redirect('/?login=1&error=' + encodeURIComponent('Invalid action'));
  }

  if (!email || !password) {
    return redirect('/?login=1&error=' + encodeURIComponent('Email and password are required'));
  }

  try {
    const response = await fetch('http://localhost:5173/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    const data = (await response.json()) as any;

    if (!response.ok || !data.success) {
      return redirect('/?login=1&error=' + encodeURIComponent(data?.message || 'Invalid email or password'));
    }

    const headers = new Headers();
    headers.append('Set-Cookie', createAuthCookie(data.token, request));

    return redirect('/app/', { headers });
  } catch (error) {
    console.error('Login error:', error);
    return redirect('/?login=1&error=' + encodeURIComponent('An unexpected error occurred'));
  }
}

/*
 * Organization + WebSite JSON-LD. No fabricated stats/bios/dates — fields left empty where no
 * real data exists yet (the owner fills them on /about).
 */
const orgSchema = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name: 'Prompify',
  url: SITE_URL,
  logo: `${SITE_URL}/prompify1.png`,
  description: 'Prompify turns plain-English prompts into working, live web apps you can run in your browser.',
  founder: { '@type': 'Person', name: '' },
  foundingDate: '',
  contactPoint: [{ '@type': 'ContactPoint', contactType: 'support', email: '', url: `${SITE_URL}/about` }],
};

const websiteSchema = {
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  name: 'Prompify',
  url: SITE_URL,
  description: 'AI app builder from prompts — describe what you need in plain English and get a live web app.',
};

const asyncFontLoader = `
(function () {
  function loadFont(href) {
    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.media = 'print';
    link.onload = function () { this.media = 'all'; };
    document.head.appendChild(link);
  }
  loadFont('https://fonts.googleapis.com/css2?family=Raleway:ital,wght@0,100..900;1,100..900&display=swap');
})();
`;

export default function Index() {
  return (
    <>
      <LandingPage />
      <script dangerouslySetInnerHTML={{ __html: asyncFontLoader }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(orgSchema) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(websiteSchema) }} />
    </>
  );
}
