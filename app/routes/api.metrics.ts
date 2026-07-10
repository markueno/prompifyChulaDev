import { json, type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { getPostgresPool } from '~/lib/database-postgresql';

export async function loader({ request, context }: LoaderFunctionArgs) {
  const cronSecret = (context?.cloudflare as any)?.env?.CRON_SECRET ?? process.env.CRON_SECRET;
  const authHeader = request.headers.get('Authorization');

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return json({ error: 'Unauthorized' }, { status: 401 });
  }

  const metrics: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
  };

  const dbUrl = (context?.cloudflare as any)?.env?.DATABASE_URL ?? process.env.DATABASE_URL;

  if (dbUrl && (context?.cloudflare as any)?.env?.DATABASE_TYPE !== 'sqlite') {
    try {
      const pool = getPostgresPool();

      metrics.pool = {
        totalCount: pool.totalCount,
        idleCount: pool.idleCount,
        waitingCount: pool.waitingCount,
      };

      const client = await pool.connect();
      try {
        const tableSizes = await client.query(`
          SELECT
            relname AS table_name,
            pg_total_relation_size(relid) AS total_bytes,
            pg_relation_size(relid) AS table_bytes,
            pg_total_relation_size(relid) - pg_relation_size(relid) AS index_bytes
          FROM pg_stat_user_tables
          WHERE relname IN ('codebase_versions', 'codebase_blobs', 'chats', 'users', 'rate_limits')
          ORDER BY pg_total_relation_size(relid) DESC
        `);
        metrics.tables = tableSizes.rows.map((r: any) => ({
          name: r.table_name,
          totalBytes: Number(r.total_bytes),
          tableBytes: Number(r.table_bytes),
          indexBytes: Number(r.index_bytes),
          totalMb: (Number(r.total_bytes) / 1024 / 1024).toFixed(2),
        }));

        const versionCount = await client.query('SELECT COUNT(*)::int AS count FROM codebase_versions');
        metrics.totalVersions = versionCount.rows[0].count;

        const blobCount = await client.query('SELECT COUNT(*)::int AS count FROM codebase_blobs');
        metrics.totalBlobs = blobCount.rows[0].count;
      } finally {
        client.release();
      }
    } catch (e) {
      metrics.dbError = e instanceof Error ? e.message : String(e);
    }
  }

  return json(metrics);
}
