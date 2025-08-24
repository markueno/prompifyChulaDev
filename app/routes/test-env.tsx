import { json, type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { useLoaderData } from '@remix-run/react';

export async function loader({ context }: LoaderFunctionArgs) {
  // Get environment info (be careful not to expose sensitive data)
  const cloudflareEnv = context?.cloudflare?.env || {};
  const processEnv = process.env || {};
  
  // Filter out sensitive keys
  const safeCloudflareKeys = Object.keys(cloudflareEnv).filter(key => 
    !key.includes('KEY') && 
    !key.includes('SECRET') && 
    !key.includes('PASSWORD') &&
    !key.includes('TOKEN')
  );
  
  const safeProcessKeys = Object.keys(processEnv).filter(key => 
    !key.includes('KEY') && 
    !key.includes('SECRET') && 
    !key.includes('PASSWORD') &&
    !key.includes('TOKEN') &&
    (key.includes('AUTH') || key.includes('NODE_ENV') || key.includes('VITE_'))
  );
  
  return json({
    hasCloudflareContext: !!context?.cloudflare,
    cloudflareEnvKeys: safeCloudflareKeys,
    processEnvKeys: safeProcessKeys,
    NODE_ENV: processEnv.NODE_ENV,
    AUTH_DISABLED: processEnv.AUTH_DISABLED,
    VITE_AUTH_DISABLED: processEnv.VITE_AUTH_DISABLED,
    timestamp: new Date().toISOString()
  });
}

export default function TestEnv() {
  const data = useLoaderData<typeof loader>();
  
  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-4">Environment Test</h1>
      <pre className="bg-gray-100 p-4 rounded overflow-auto">
        {JSON.stringify(data, null, 2)}
      </pre>
    </div>
  );
}

