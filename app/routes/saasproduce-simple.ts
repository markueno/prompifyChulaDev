import { json, type ActionFunctionArgs } from '@remix-run/cloudflare';
import { verifyKooGallerySignature } from '~/lib/koogallery/signature';

export const action = async ({ request, context, params }: ActionFunctionArgs) => {
  try {
    // Clone the request to avoid body reading issues
    const clonedRequest = request.clone();
    const body = (await clonedRequest.json()) as any;
    const { activity, orderId, orderLineId, businessId, testFlag } = body;

    console.log('KooGallery request received:', {
      activity,
      orderId,
      businessId,
      timestamp: new Date().toISOString(),
      url: request.url,
    });

    // Verify KooGallery signature (NO DATABASE NEEDED)
    const signatureValid = await verifyKooGallerySignature(request, body);

    if (!signatureValid) {
      console.log('Signature verification failed');
      return json(
        {
          resultCode: '000003',
          resultMsg: 'Invalid signature verification',
        },
        { status: 401 }
      );
    }

    console.log('Signature verification successful');

    // Process based on activity (NO DATABASE NEEDED)
    switch (activity) {
      case 'newInstance':
        console.log('Creating new instance for:', { orderId, businessId });

        /*
         * Here you would typically:
         * 1. Create user account in your system
         * 2. Send welcome email
         * 3. Initialize user workspace
         * 4. Set up default templates
         */

        return json({
          resultCode: '000000',
          resultMsg: 'Instance created successfully',
          instanceId: businessId, // Use businessId as instanceId
        });

      case 'queryInstance':
        console.log('Querying instance:', { orderId, businessId });

        /*
         * Here you would typically:
         * 1. Check if user exists in your system
         * 2. Return user status/plan information
         */

        return json({
          resultCode: '000000',
          resultMsg: 'Instance query successful',
          instanceId: businessId,
          status: 'active', // or whatever status your system uses
        });

      case 'refreshInstance':
        console.log('Refreshing instance (renewal):', { orderId, businessId });

        /*
         * Here you would typically:
         * 1. Extend user subscription
         * 2. Update billing information
         * 3. Send renewal confirmation email
         */

        return json({
          resultCode: '000000',
          resultMsg: 'Instance refreshed successfully',
          instanceId: businessId,
        });

      case 'updateInstanceStatus':
        console.log('Updating instance status:', { orderId, businessId });

        /*
         * Here you would typically:
         * 1. Freeze/unfreeze user account
         * 2. Update user permissions
         * 3. Send status change notification
         */

        return json({
          resultCode: '000000',
          resultMsg: 'Instance status updated successfully',
          instanceId: businessId,
        });

      case 'releaseInstance':
        console.log('Releasing instance (cancellation):', { orderId, businessId });

        /*
         * Here you would typically:
         * 1. Disable user account
         * 2. Cancel subscription
         * 3. Send cancellation confirmation
         * 4. Clean up user data (if required)
         */

        return json({
          resultCode: '000000',
          resultMsg: 'Instance released successfully',
          instanceId: businessId,
        });

      case 'upgradeInstance':
        console.log('Upgrading instance:', { orderId, businessId });

        /*
         * Here you would typically:
         * 1. Upgrade user plan
         * 2. Add new features/permissions
         * 3. Send upgrade confirmation email
         */

        return json({
          resultCode: '000000',
          resultMsg: 'Instance upgraded successfully',
          instanceId: businessId,
        });

      case 'changeInstanceCheck':
        console.log('Checking instance changes:', { orderId, businessId });

        // Handle verification of changes upon renewal
        return json({
          resultCode: '000000',
          resultMsg: 'Change verification successful',
          instanceId: businessId,
        });

      default:
        console.log('Unknown activity:', activity);
        return json(
          {
            resultCode: '000001',
            resultMsg: `Unknown activity: ${activity}`,
          },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error('KooGallery saasproduce error:', error);

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
    status: 'KooGallery SaaS Produce endpoint is running (Database-Free Version)',
    timestamp: new Date().toISOString(),
    message: 'This endpoint handles all KooGallery activities without database dependencies',
  });
};
