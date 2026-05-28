import { updateAppStatus, getInactiveApps, addAuditLog } from '~/lib/database';
import type { AppStatus } from '~/lib/database';

export async function wakeApp(
  projectId: string,
  companyId: string,
  actorId: string,
  ipAddress?: string | null
): Promise<{ success: boolean; error?: string }> {
  try {
    await updateAppStatus(projectId, 'active');

    // For container runtime apps, container start logic goes here in Phase 3
    // e.g. await startContainer(projectId);

    await addAuditLog({
      companyId,
      actorId,
      projectId,
      action: 'WAKE',
      ipAddress: ipAddress ?? null,
    });

    return { success: true };
  } catch (error) {
    console.error('Error waking app:', error);
    return { success: false, error: String(error) };
  }
}

export async function sleepApp(
  projectId: string,
  companyId: string,
  actorId: string,
  ipAddress?: string | null
): Promise<{ success: boolean; error?: string }> {
  try {
    await updateAppStatus(projectId, 'sleeping');

    // For container runtime apps, container stop logic goes here in Phase 3
    // e.g. await stopContainer(projectId);

    await addAuditLog({
      companyId,
      actorId,
      projectId,
      action: 'SLEEP',
      ipAddress: ipAddress ?? null,
    });

    return { success: true };
  } catch (error) {
    console.error('Error sleeping app:', error);
    return { success: false, error: String(error) };
  }
}

export async function markInactiveAppsSleeping(thresholdMinutes = 15): Promise<number> {
  const inactiveApps = await getInactiveApps(thresholdMinutes);
  let count = 0;

  for (const app of inactiveApps) {
    const result = await sleepApp(app.id, app.company_id, 'system');
    if (result.success) count++;
  }

  return count;
}

export type { AppStatus };
