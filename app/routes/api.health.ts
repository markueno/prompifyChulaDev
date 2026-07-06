import type { LoaderFunctionArgs } from '@remix-run/node';

export const loader = async ({ request: _request }: LoaderFunctionArgs) => {
  /*
   * Return a simple 200 OK response with some basic health information.
   * NOTE: guard process.uptime — vite-plugin-node-polyfills injects a browser `process` shim
   * into the SSR bundle that lacks uptime(), which 500'd this route on the compiled Node
   * server (Day 13) and would have failed docker/compose healthchecks.
   */
  return new Response(
    JSON.stringify({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: typeof process.uptime === 'function' ? process.uptime() : null,
    }),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
      },
    }
  );
};
