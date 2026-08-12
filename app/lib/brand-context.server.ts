/**
 * Workspace brand context — the design document generated from a workspace's public website and
 * injected into every prompt that workspace produces.
 *
 * Scoped to the workspace (company), not the user: a team shares one brand, and it should follow
 * the account across devices rather than living in one browser's localStorage.
 */
import { getPostgresPool } from '~/lib/database-postgresql';

export interface BrandContext {
  companyId: string;
  sourceUrl: string | null;
  content: string;
  updatedAt: string | null;
}

/** Hard cap so a runaway document can't bloat every prompt this workspace generates. */
export const MAX_BRAND_CONTEXT_CHARS = 12_000;

export async function getBrandContext(companyId: string): Promise<BrandContext | null> {
  const pool = getPostgresPool();

  const { rows } = await pool.query(
    `SELECT company_id, source_url, content, updated_at FROM workspace_brand_context WHERE company_id = $1`,
    [companyId]
  );

  if (rows.length === 0) {
    return null;
  }

  return {
    companyId: rows[0].company_id,
    sourceUrl: rows[0].source_url ?? null,
    content: rows[0].content ?? '',
    updatedAt: rows[0].updated_at ? new Date(rows[0].updated_at).toISOString() : null,
  };
}

export async function saveBrandContext(params: {
  companyId: string;
  content: string;
  sourceUrl?: string | null;
  userId: string;
}): Promise<void> {
  const pool = getPostgresPool();
  const content = params.content.trim().slice(0, MAX_BRAND_CONTEXT_CHARS);

  await pool.query(
    `INSERT INTO workspace_brand_context (company_id, source_url, content, updated_by, updated_at)
     VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
     ON CONFLICT (company_id) DO UPDATE SET
       source_url = EXCLUDED.source_url,
       content = EXCLUDED.content,
       updated_by = EXCLUDED.updated_by,
       updated_at = CURRENT_TIMESTAMP`,
    [params.companyId, params.sourceUrl ?? null, content, params.userId]
  );
}

export async function deleteBrandContext(companyId: string): Promise<void> {
  const pool = getPostgresPool();
  await pool.query(`DELETE FROM workspace_brand_context WHERE company_id = $1`, [companyId]);
}
