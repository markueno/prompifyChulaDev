import { json, type ActionFunctionArgs } from '@remix-run/cloudflare';
import { verifyKooGallerySignature } from '~/lib/koogallery/signature';
import { getInstanceById, deleteInstance } from '~/lib/koogallery/instance-manager';
import { logKooGalleryRequest } from '~/lib/koogallery/logger';

export const action = async ({ request, context }: ActionFunctionArgs) => {
  try {
    const body = await request.json();
    const { activity, instanceId, orderId, orderLineId, testFlag } = body;

    // Verify this is a release instance request
    if (activity !== 'releaseInstance') {
      return json(
        { 
          resultCode: '000001', 
          resultMsg: 'Invalid activity. Expected releaseInstance.' 
        },
        { status: 400 }
      );
    }

    // Verify required parameters
    if (!instanceId) {
      return json(
        { 
          resultCode: '000002', 
          resultMsg: 'Missing required parameter: instanceId' 
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
    await logKooGalleryRequest('release-instance', {
      instanceId,
      orderId,
      orderLineId,
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

    // Check if instance is already released
    if (instance.status === 'deleted') {
      return json({
        resultCode: '000000',
        resultMsg: 'Instance already released'
      });
    }

    // For your AI app builder, this would typically:
    // 1. Backup user data (if required by retention policy)
    // 2. Cancel any active subscriptions
    // 3. Disable user access immediately
    // 4. Clean up resources (files, databases, etc.)
    // 5. Send final notification to user
    // 6. Update billing records

    // Perform cleanup operations
    try {
      // Example cleanup operations (customize for your app):
      await performInstanceCleanup(instanceId, {
        orderId,
        orderLineId,
        testFlag: testFlag === '1'
      });
    } catch (cleanupError) {
      console.error('Instance cleanup failed:', cleanupError);
      // Log but don't fail the release - KooGallery expects success
      await logKooGalleryRequest('instance-cleanup-failed', {
        instanceId,
        error: cleanupError instanceof Error ? cleanupError.message : 'Unknown cleanup error',
        timestamp: new Date().toISOString()
      });
    }

    // Mark instance as deleted in database
    const deleteSuccess = await deleteInstance(instanceId);
    if (!deleteSuccess) {
      return json({
        resultCode: '000999',
        resultMsg: 'Failed to release instance'
      });
    }

    // Log successful release
    await logKooGalleryRequest('instance-released', {
      instanceId,
      orderId,
      orderLineId,
      originalStatus: instance.status,
      releasedAt: new Date().toISOString(),
      testFlag: testFlag === '1'
    });

    return json({
      resultCode: '000000',
      resultMsg: 'Instance released successfully'
    });

  } catch (error) {
    console.error('KooGallery release instance error:', error);
    
    await logKooGalleryRequest('release-instance-error', {
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
 * Perform cleanup operations when releasing an instance
 * Customize this function based on your AI app builder's requirements
 */
async function performInstanceCleanup(
  instanceId: string, 
  options: {
    orderId?: string;
    orderLineId?: string;
    testFlag: boolean;
  }
): Promise<void> {
  // Example cleanup operations:
  
  // 1. Disable user access
  console.log(`Disabling access for instance: ${instanceId}`);
  
  // 2. Cancel any active subscriptions
  console.log(`Cancelling subscriptions for instance: ${instanceId}`);
  
  // 3. Clean up user data (if not required for retention)
  if (!options.testFlag) {
    console.log(`Cleaning up user data for instance: ${instanceId}`);
    // Only clean up real data, not test data
  }
  
  // 4. Remove from active user lists
  console.log(`Removing instance from active lists: ${instanceId}`);
  
  // 5. Send final notification
  console.log(`Sending release notification for instance: ${instanceId}`);
  
  // Add your specific cleanup logic here:
  // - Delete user files
  // - Cancel API subscriptions
  // - Remove from monitoring
  // - Update analytics
  // - Send goodbye email
}

export const loader = async () => {
  return json({ 
    status: 'KooGallery Release Instance endpoint is running',
    timestamp: new Date().toISOString()
  });
};

