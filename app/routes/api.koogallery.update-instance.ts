import { json, type ActionFunctionArgs } from '@remix-run/cloudflare';
import { verifyKooGallerySignature } from '~/lib/koogallery/signature';
import { getInstanceById, updateInstanceStatus } from '~/lib/koogallery/instance-manager';
import { logKooGalleryRequest } from '~/lib/koogallery/logger';

export const action = async ({ request, context }: ActionFunctionArgs) => {
  try {
    const body = (await request.json()) as any;
    const { activity, scene, orderId, orderLineId, instanceId, productId, expireTime, testFlag } = body;

    // Verify this is an update instance request
    if (activity !== 'refreshInstance') {
      return json(
        {
          resultCode: '000001',
          resultMsg: 'Invalid activity. Expected refreshInstance.',
        },
        { status: 400 }
      );
    }

    // Verify required parameters
    if (!scene || !orderId || !orderLineId || !instanceId || !expireTime) {
      return json(
        {
          resultCode: '000002',
          resultMsg: 'Missing required parameters: scene, orderId, orderLineId, instanceId, or expireTime',
        },
        { status: 400 }
      );
    }

    // Verify KooGallery signature
    const signatureValid = await verifyKooGallerySignature(request, body);

    if (!signatureValid) {
      return json(
        {
          resultCode: '000003',
          resultMsg: 'Invalid signature verification',
        },
        { status: 401 }
      );
    }

    // Log the request
    await logKooGalleryRequest('update-instance', {
      instanceId,
      orderId,
      orderLineId,
      scene,
      expireTime,
      testFlag,
      timestamp: new Date().toISOString(),
    });

    // Get existing instance
    const instance = await getInstanceById(instanceId);

    if (!instance) {
      return json({
        resultCode: '000004',
        resultMsg: 'Instance not found',
        instanceId,
      });
    }

    // Parse expiration time (format: yyyyMMddHHmmss)
    const expireDate = new Date(
      expireTime.substring(0, 4) +
        '-' + // year
        expireTime.substring(4, 6) +
        '-' + // month
        expireTime.substring(6, 8) +
        'T' + // day
        expireTime.substring(8, 10) +
        ':' + // hour
        expireTime.substring(10, 12) +
        ':' + // minute
        expireTime.substring(12, 14) +
        'Z' // second
    );

    // Update instance based on scene
    let newStatus = instance.status;
    const metadata = instance.metadata || {};

    switch (scene) {
      case 'TRIAL_TO_FORMAL':
        newStatus = 'active';
        metadata.trialToFormal = true;
        metadata.originalOrderId = orderId;
        break;

      case 'RENEWAL':
        newStatus = 'active';
        metadata.lastRenewal = {
          orderId,
          orderLineId,
          productId,
          renewedAt: new Date().toISOString(),
        };
        break;

      case 'UNSUBSCRIBE_RENEWAL_PERIOD':
        newStatus = 'expired';
        metadata.renewalCancelled = {
          orderId,
          orderLineId,
          cancelledAt: new Date().toISOString(),
        };
        break;

      case 'RENEWAL_CHANGE':
        newStatus = 'active';
        metadata.renewalChange = {
          orderId,
          orderLineId,
          productId,
          changedAt: new Date().toISOString(),
        };
        break;

      default:
        return json({
          resultCode: '000005',
          resultMsg: 'Invalid scene parameter',
        });
    }

    // Update instance in database
    const updateSuccess = await updateInstanceStatus(instanceId, newStatus, {
      ...metadata,
      expiresAt: expireDate.toISOString(),
      lastUpdated: new Date().toISOString(),
      scene,
      orderId,
      orderLineId,
      productId,
    });

    if (!updateSuccess) {
      return json({
        resultCode: '000999',
        resultMsg: 'Failed to update instance',
      });
    }

    /*
     * For your AI app builder, this would typically:
     * 1. Update user subscription status
     * 2. Modify resource limits based on new plan
     * 3. Send notification to user about changes
     * 4. Update billing information
     */

    return json({
      resultCode: '000000',
      resultMsg: 'Instance updated successfully',
    });
  } catch (error) {
    console.error('KooGallery update instance error:', error);

    await logKooGalleryRequest('update-instance-error', {
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
    status: 'KooGallery Update Instance endpoint is running',
    timestamp: new Date().toISOString(),
  });
};
