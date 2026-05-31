import { json, type ActionFunctionArgs } from '@remix-run/cloudflare';
import { verifyKooGallerySignature } from '~/lib/koogallery/signature';
import { getInstanceById } from '~/lib/koogallery/instance-manager';
import { logKooGalleryRequest } from '~/lib/koogallery/logger';

export const action = async ({ request, context }: ActionFunctionArgs) => {
  try {
    const body = (await request.json()) as any;
    const { activity, instanceId } = body;

    // Verify this is a query instance request
    if (activity !== 'queryInstance') {
      return json(
        {
          resultCode: '000001',
          resultMsg: 'Invalid activity. Expected queryInstance.',
        },
        { status: 400 }
      );
    }

    // Verify required parameters
    if (!instanceId) {
      return json(
        {
          resultCode: '000002',
          resultMsg: 'Missing required parameter: instanceId',
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
    await logKooGalleryRequest('query-instance', {
      instanceId,
      timestamp: new Date().toISOString(),
    });

    // Get instance information
    const instance = await getInstanceById(instanceId);

    if (!instance) {
      return json({
        resultCode: '000004',
        resultMsg: 'Instance not found',
        instanceId,
      });
    }

    // Return instance information
    return json({
      resultCode: '000000',
      resultMsg: 'Instance found',
      instanceId: instance.instanceId,
      status: instance.status,
      orderId: instance.orderId,
      orderLineId: instance.orderLineId,
      businessId: instance.businessId,
      createdAt: instance.createdAt.toISOString(),
      updatedAt: instance.updatedAt.toISOString(),
      expiresAt: instance.expiresAt?.toISOString(),
      metadata: instance.metadata,
    });
  } catch (error) {
    console.error('KooGallery query instance error:', error);

    await logKooGalleryRequest('query-instance-error', {
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
    status: 'KooGallery Query Instance endpoint is running',
    timestamp: new Date().toISOString(),
  });
};
