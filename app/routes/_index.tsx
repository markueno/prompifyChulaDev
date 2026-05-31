import type { LinksFunction, LoaderFunctionArgs, MetaFunction } from '@remix-run/cloudflare';
import { json, redirect } from '@remix-run/cloudflare';
import { LandingPage } from '~/components/landing/LandingPage';
import { isAuthDisabled, optionalAuth } from '~/lib/auth';

import landingStyles from '~/styles/landing.css?url';

export const links: LinksFunction = () => [
  {
    rel: 'stylesheet',
    href: 'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap',
  },
  {
    rel: 'stylesheet',
    href: 'https://fonts.googleapis.com/css2?family=Raleway:ital,wght@0,100..900;1,100..900&display=swap',
  },
  { rel: 'stylesheet', href: landingStyles },
];

export const meta: MetaFunction = () => {
  return [
    { title: 'Prompify - Your Ideas' },
    {
      name: 'description',
      content: 'Describe what you need in plain English and get a working, live app in your screen.',
    },
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

export default function Index() {
  return <LandingPage />;
}
