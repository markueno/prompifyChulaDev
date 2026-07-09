import { json, type ActionFunctionArgs } from '@remix-run/cloudflare';
import { gcCodebaseVersionsPostgres } from '~/lib/database-postgresql';
import { deleteObject, keyForHash } from '~/lib/.server/storage';

/*
 * POST /api/cron/gc            — DRY RUN (default): reports what WOULD be deleted, changes nothing.
 * POST /api/cron/gc?apply=true — real run: deletes versions beyond 30/chat, unreferenced blob
 *                                rows, and their OBS objects.
 *
 * Day 18 (Step 18.5). Guarded by CRON_SECRET (same pattern as api.cron.sleep-check). Dry-run-
 * first is the plan's mandatory safety mode; the nightly cron calls dry-run until backups have
 * been restore-tested, then switches to ?apply=true (see docker-compose.prod.yaml cron service).
 * OBS objects are deleted AFTER the DB commit — a stray object is harmless, a dangling DB row
 * pointing at a deleted object is not. Source: ARCHITECTURE-v2.md:499-526.
 */
export async function action({ request, context }: ActionFunctionArgs) {
  const cronSecret = (context?.cloudflare as any)?.env?.CRON_SECRET ?? process.env.CRON_SECRET;

  const authHeader = request.headers.get('Authorization');

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (process.env.SNAPSHOTS_ENABLED !== 'true') {
    return json({ error: 'Not found' }, { status: 404 });
  }

  const apply = new URL(request.url).searchParams.get('apply') === 'true';

  try {
    const result = await gcCodebaseVersionsPostgres({ retainPerChat: 30, dryRun: !apply });

    let obsDeleted = 0;
    const obsFailures: string[] = [];

    if (apply) {
      // Best-effort OBS cleanup — DB already committed. Failures are logged and retried on the
      // next GC run (the blob rows are gone, but re-deleting a missing object is idempotent...
      // for stragglers, the OBS lifecycle rule in plan §1.5a Step 6 is the final backstop).
      for (const hash of result.orphanHashes) {
        try {
          await deleteObject(keyForHash(hash));
          obsDeleted++;
        } catch {
          obsFailures.push(hash);
        }
      }

      if (obsFailures.length > 0) {
        console.error(`[gc] ${obsFailures.length} OBS deletions failed (will not retry automatically):`, obsFailures);
      }
    }

    console.log(
      `[gc] ${apply ? 'APPLIED' : 'DRY RUN'}: versions=${result.versionsDeleted} blobs=${result.blobsDeleted}` +
        (apply ? ` obsDeleted=${obsDeleted} obsFailed=${obsFailures.length}` : '')
    );

    return json({
      mode: apply ? 'applied' : 'dry-run',
      versionsDeleted: result.versionsDeleted,
      blobsDeleted: result.blobsDeleted,
      orphanHashes: result.orphanHashes,
      ...(apply ? { obsDeleted, obsFailed: obsFailures.length } : {}),
    });
  } catch (error) {
    console.error('Cron GC error:', error);
    return json({ error: 'Internal server error' }, { status: 500 });
  }
}
