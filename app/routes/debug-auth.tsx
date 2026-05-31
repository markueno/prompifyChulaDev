import { json, type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { useLoaderData } from '@remix-run/react';
import { isAuthDisabled, getMockAdminUser } from '~/lib/auth';

export async function loader({ context }: LoaderFunctionArgs) {
  const authDisabled = isAuthDisabled(context);
  const mockUser = getMockAdminUser();

  // Get environment info (be careful not to expose sensitive data)
  const cloudflareEnv = context?.cloudflare?.env || {};
  const processEnv = process.env || {};

  // Filter out sensitive keys
  const safeCloudflareKeys = Object.keys(cloudflareEnv).filter(
    key => !key.includes('KEY') && !key.includes('SECRET') && !key.includes('PASSWORD') && !key.includes('TOKEN')
  );

  const safeProcessKeys = Object.keys(processEnv).filter(
    key =>
      !key.includes('KEY') &&
      !key.includes('SECRET') &&
      !key.includes('PASSWORD') &&
      !key.includes('TOKEN') &&
      (key.includes('AUTH') || key.includes('NODE_ENV') || key.includes('VITE_'))
  );

  return json({
    authDisabled,
    mockUser,
    hasCloudflareContext: !!context?.cloudflare,
    cloudflareEnvKeys: safeCloudflareKeys,
    processEnvKeys: safeProcessKeys,
    NODE_ENV: processEnv.NODE_ENV,
    AUTH_DISABLED: processEnv.AUTH_DISABLED,
    VITE_AUTH_DISABLED: processEnv.VITE_AUTH_DISABLED,
    timestamp: new Date().toISOString(),
  });
}

export default function DebugAuth() {
  const data = useLoaderData<typeof loader>();

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <h1 className="text-3xl font-bold mb-6">Authentication Debug</h1>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white p-6 rounded-lg shadow-md">
          <h2 className="text-xl font-semibold mb-4">Status</h2>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="font-medium">Authentication Disabled:</span>
              <span
                className={`px-2 py-1 rounded text-sm font-semibold ${
                  data.authDisabled ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                }`}
              >
                {data.authDisabled ? 'YES' : 'NO'}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="font-medium">Mock User:</span>
              <span className="text-sm text-gray-600">{data.mockUser.id}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="font-medium">Environment:</span>
              <span className="text-sm text-gray-600">{data.NODE_ENV}</span>
            </div>
          </div>
        </div>

        <div className="bg-white p-6 rounded-lg shadow-md">
          <h2 className="text-xl font-semibold mb-4">Environment Variables</h2>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="font-medium">AUTH_DISABLED:</span>
              <span className="text-sm text-gray-600">{data.AUTH_DISABLED || 'undefined'}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="font-medium">VITE_AUTH_DISABLED:</span>
              <span className="text-sm text-gray-600">{data.VITE_AUTH_DISABLED || 'undefined'}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-6 bg-white p-6 rounded-lg shadow-md">
        <h2 className="text-xl font-semibold mb-4">Raw Data</h2>
        <pre className="bg-gray-100 p-4 rounded overflow-auto text-sm">{JSON.stringify(data, null, 2)}</pre>
      </div>
    </div>
  );
}
