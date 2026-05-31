import { json, type ActionFunctionArgs } from '@remix-run/cloudflare';
import { verifyKooGallerySignature } from '~/lib/koogallery/signature';
import { createInstance, getInstanceByOrderId } from '~/lib/koogallery/instance-manager';
import { logKooGalleryRequest } from '~/lib/koogallery/logger';

export const action = async ({ request, context }: ActionFunctionArgs) => {
  try {
    // Parse request body
    const body = (await request.json()) as any;
    const { activity, orderId, orderLineId, businessId, testFlag } = body;

    // Verify this is a create instance request
    if (activity !== 'newInstance') {
      return json(
        {
          resultCode: '000001',
          resultMsg: 'Invalid activity. Expected newInstance.',
        },
        { status: 400 }
      );
    }

    // Verify required parameters
    if (!orderId || !orderLineId || !businessId) {
      return json(
        {
          resultCode: '000002',
          resultMsg: 'Missing required parameters: orderId, orderLineId, or businessId',
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
    await logKooGalleryRequest('create-instance', {
      orderId,
      orderLineId,
      businessId,
      testFlag,
      timestamp: new Date().toISOString(),
    });

    // Check if instance already exists (idempotency)
    const existingInstance = await getInstanceByOrderId(orderId, orderLineId);

    if (existingInstance) {
      return json({
        resultCode: '000000',
        resultMsg: 'Instance already exists',
        instanceId: existingInstance.instanceId,
      });
    }

    // Create new instance
    const instanceId = businessId; // Use businessId as recommended by KooGallery
    const instance = await createInstance({
      instanceId,
      orderId,
      orderLineId,
      businessId,
      testFlag: testFlag === '1',
      status: 'creating',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    /*
     * For your AI app builder, this would typically:
     * 1. Create user workspace
     * 2. Initialize default templates
     * 3. Set up user preferences
     * 4. Allocate resources
     */

    // Return success response
    return json({
      resultCode: '000000', // Synchronous creation
      resultMsg: 'Instance created successfully',
      instanceId,
    });
  } catch (error) {
    console.error('KooGallery create instance error:', error);

    // Log error
    await logKooGalleryRequest('create-instance-error', {
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

// Handle GET requests for health check
export const loader = async () => {
  return json({
    status: 'KooGallery Create Instance endpoint is running',
    timestamp: new Date().toISOString(),
  });
};
