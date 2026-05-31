import { json, type ActionFunctionArgs } from '@remix-run/cloudflare';
import { verifyKooGallerySignature } from '~/lib/koogallery/signature';
import { getInstanceById, updateInstanceStatus } from '~/lib/koogallery/instance-manager';
import { logKooGalleryRequest } from '~/lib/koogallery/logger';

export const action = async ({ request, context }: ActionFunctionArgs) => {
  try {
    const body = (await request.json()) as any;
    const { activity, instanceId, status, testFlag } = body;

    // Verify this is an update instance status request
    if (activity !== 'updateInstanceStatus') {
      return json(
        {
          resultCode: '000001',
          resultMsg: 'Invalid activity. Expected updateInstanceStatus.',
        },
        { status: 400 }
      );
    }

    // Verify required parameters
    if (!instanceId || !status) {
      return json(
        {
          resultCode: '000002',
          resultMsg: 'Missing required parameters: instanceId or status',
        },
        { status: 400 }
      );
    }

    // Verify valid status values
    if (!['FREEZE', 'UNFREEZE'].includes(status)) {
      return json(
        {
          resultCode: '000003',
          resultMsg: 'Invalid status. Must be FREEZE or UNFREEZE.',
        },
        { status: 400 }
      );
    }

    // Verify KooGallery signature
    const signatureValid = await verifyKooGallerySignature(request, body);

    if (!signatureValid) {
      return json(
        {
          resultCode: '000004',
          resultMsg: 'Invalid signature verification',
        },
        { status: 401 }
      );
    }

    // Log the request
    await logKooGalleryRequest('update-instance-status', {
      instanceId,
      status,
      testFlag,
      timestamp: new Date().toISOString(),
    });

    // Get existing instance
    const instance = await getInstanceById(instanceId);

    if (!instance) {
      return json({
        resultCode: '000005',
        resultMsg: 'Instance not found',
        instanceId,
      });
    }

    // Determine new status based on KooGallery status
    let newStatus: string;
    const metadata = instance.metadata || {};

    if (status === 'FREEZE') {
      newStatus = 'suspended';
      metadata.frozen = {
        frozenAt: new Date().toISOString(),
        reason: 'KooGallery freeze request',
        testFlag: testFlag === '1',
      };
    } else if (status === 'UNFREEZE') {
      newStatus = 'active';
      metadata.unfrozen = {
        unfrozenAt: new Date().toISOString(),
        reason: 'KooGallery unfreeze request',
        testFlag: testFlag === '1',
      };
    } else {
      return json({
        resultCode: '000006',
        resultMsg: 'Invalid status value',
      });
    }

    // Update instance status in database
    const updateSuccess = await updateInstanceStatus(instanceId, newStatus, {
      ...metadata,
      lastStatusChange: new Date().toISOString(),
      kooGalleryStatus: status,
    });

    if (!updateSuccess) {
      return json({
        resultCode: '000999',
        resultMsg: 'Failed to update instance status',
      });
    }

    /*
     * For your AI app builder, this would typically:
     * 1. Suspend/activate user access
     * 2. Disable/enable features based on status
     * 3. Send notification to user about status change
     * 4. Update user interface to reflect status
     * 5. Handle data retention policies
     */

    // Log the status change
    await logKooGalleryRequest('instance-status-changed', {
      instanceId,
      oldStatus: instance.status,
      newStatus,
      kooGalleryStatus: status,
      timestamp: new Date().toISOString(),
    });

    return json({
      resultCode: '000000',
      resultMsg: 'Instance status updated successfully',
    });
  } catch (error) {
    console.error('KooGallery update instance status error:', error);

    await logKooGalleryRequest('update-instance-status-error', {
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString(),
    });

    return json(
      {
        resultCode: '000999',
        resultMsg: 'Internal server error',
      },
      { status: 500 }
    );
  }
};

export const loader = async () => {
  return json({
    status: 'KooGallery Update Instance Status endpoint is running',
    timestamp: new Date().toISOString(),
  });
};
