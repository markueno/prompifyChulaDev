import { json, type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { isAuthDisabled } from '~/lib/auth';

export async function loader({ context }: LoaderFunctionArgs) {
  const authDisabled = isAuthDisabled(context);
  
  // Get environment info (be careful not to expose sensitive data)
  const env = context?.cloudflare?.env || {};
  const envKeys = Object.keys(env).filter(key => 
    key.includes('AUTH') || 
    key.includes('JWT') || 
    key.includes('SESSION')
  );
  
  return json({
    authDisabled,
    environmentKeys: envKeys,
    hasCloudflareContext: !!context?.cloudflare,
    contextKeys: context ? Object.keys(context) : [],
    timestamp: new Date().toISOString()
  });
}

