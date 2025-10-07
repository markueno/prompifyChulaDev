import { json, type ActionFunctionArgs } from '@remix-run/cloudflare';
import { verifyKooGallerySignature } from '~/lib/koogallery/signature';
import { getInstanceById, updateInstanceStatus } from '~/lib/koogallery/instance-manager';
import { logKooGalleryRequest } from '~/lib/koogallery/logger';

export const action = async ({ request, context }: ActionFunctionArgs) => {
  try {
    const body = await request.json();
    const { 
      activity, 
      instanceId, 
      orderId, 
      orderLineId, 
      productId, 
      testFlag 
    } = body;

    // Verify this is an upgrade instance request
    if (activity !== 'upgradeInstance') {
      return json(
        { 
          resultCode: '000001', 
          resultMsg: 'Invalid activity. Expected upgradeInstance.' 
        },
        { status: 400 }
      );
    }

    // Verify required parameters
    if (!instanceId || !orderId || !orderLineId) {
      return json(
        { 
          resultCode: '000002', 
          resultMsg: 'Missing required parameters: instanceId, orderId, or orderLineId' 
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
          resultMsg: 'Invalid signature verification' 
        },
        { status: 401 }
      );
    }

    // Log the request
    await logKooGalleryRequest('upgrade-instance', {
      instanceId,
      orderId,
      orderLineId,
      productId,
      testFlag,
      timestamp: new Date().toISOString()
    });

    // Get existing instance
    const instance = await getInstanceById(instanceId);
    if (!instance) {
      return json({
        resultCode: '000004',
        resultMsg: 'Instance not found',
        instanceId: instanceId
      });
    }

    // Check if instance is in a valid state for upgrade
    if (instance.status === 'deleted' || instance.status === 'suspended') {
      return json({
        resultCode: '000005',
        resultMsg: 'Instance cannot be upgraded in current status',
        currentStatus: instance.status
      });
    }

    // For your AI app builder, this would typically:
    // 1. Query KooGallery API to get upgrade details
    // 2. Validate the upgrade is supported
    // 3. Update user's plan/features
    // 4. Adjust resource limits
    // 5. Update billing information
    // 6. Send notification to user

    // Query KooGallery API for upgrade information
    const upgradeInfo = await queryKooGalleryOrder(orderId, orderLineId);
    if (!upgradeInfo) {
      return json({
        resultCode: '000006',
        resultMsg: 'Failed to retrieve upgrade information from KooGallery'
      });
    }

    // Perform the upgrade
    const upgradeSuccess = await performInstanceUpgrade(instanceId, {
      orderId,
      orderLineId,
      productId,
      upgradeInfo,
      testFlag: testFlag === '1'
    });

    if (!upgradeSuccess) {
      return json({
        resultCode: '000999',
        resultMsg: 'Failed to upgrade instance'
      });
    }

    // Update instance metadata with upgrade information
    const metadata = instance.metadata || {};
    const upgradeMetadata = {
      ...metadata,
      upgrades: [
        ...(metadata.upgrades || []),
        {
          orderId,
          orderLineId,
          productId,
          upgradedAt: new Date().toISOString(),
          upgradeInfo,
          testFlag: testFlag === '1'
        }
      ],
      lastUpgrade: new Date().toISOString()
    };

    await updateInstanceStatus(instanceId, 'active', upgradeMetadata);

    // Log successful upgrade
    await logKooGalleryRequest('instance-upgraded', {
      instanceId,
      orderId,
      orderLineId,
      productId,
      upgradeInfo,
      timestamp: new Date().toISOString()
    });

    return json({
      resultCode: '000000',
      resultMsg: 'Instance upgraded successfully'
    });

  } catch (error) {
    console.error('KooGallery upgrade instance error:', error);
    
    await logKooGalleryRequest('upgrade-instance-error', {
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    });

    return json(
      { 
        resultCode: '000999', 
        resultMsg: 'Internal server error' 
      },
      { status: 500 }
    );
  }
};

/**
 * Query KooGallery API to get order information
 * This is required for upgrade operations
 */
async function queryKooGalleryOrder(
  orderId: string, 
  orderLineId: string
): Promise<any> {
  try {
    // In a real implementation, you would call KooGallery's order query API
    // For now, return mock data
    return {
      orderId,
      orderLineId,
      status: 'paid',
      amount: 99.99,
      currency: 'USD',
      productDetails: {
        name: 'AI App Builder Pro',
        features: ['advanced-templates', 'priority-support', 'unlimited-projects']
      }
    };
  } catch (error) {
    console.error('Failed to query KooGallery order:', error);
    return null;
  }
}

/**
 * Perform the actual instance upgrade
 * Customize this function based on your AI app builder's requirements
 */
async function performInstanceUpgrade(
  instanceId: string,
  options: {
    orderId: string;
    orderLineId: string;
    productId?: string;
    upgradeInfo: any;
    testFlag: boolean;
  }
): Promise<boolean> {
  try {
    console.log(`Upgrading instance: ${instanceId}`);
    
    // Example upgrade operations:
    
    // 1. Update user's plan
    console.log(`Updating plan for instance: ${instanceId}`);
    
    // 2. Increase resource limits
    console.log(`Increasing resource limits for instance: ${instanceId}`);
    
    // 3. Enable new features
    console.log(`Enabling new features for instance: ${instanceId}`);
    
    // 4. Update billing
    console.log(`Updating billing for instance: ${instanceId}`);
    
    // 5. Send notification
    console.log(`Sending upgrade notification for instance: ${instanceId}`);
    
    // Add your specific upgrade logic here:
    // - Update user subscription tier
    // - Increase API rate limits
    // - Enable premium features
    // - Update storage quotas
    // - Send upgrade confirmation email
    
    return true;
  } catch (error) {
    console.error('Instance upgrade failed:', error);
    return false;
  }
}

export const loader = async () => {
  return json({ 
    status: 'KooGallery Upgrade Instance endpoint is running',
    timestamp: new Date().toISOString()
  });
};

