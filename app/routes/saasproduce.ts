import { json, type ActionFunctionArgs } from '@remix-run/cloudflare';
import { verifyKooGallerySignature } from '~/lib/koogallery/signature';
import { logKooGalleryRequest } from '~/lib/koogallery/logger';

// Import all the individual handlers
import { action as createInstanceAction } from './api.koogallery.create-instance';
import { action as queryInstanceAction } from './api.koogallery.query-instance';
import { action as updateInstanceAction } from './api.koogallery.update-instance';
import { action as updateInstanceStatusAction } from './api.koogallery.update-instance-status';
import { action as releaseInstanceAction } from './api.koogallery.release-instance';
import { action as upgradeInstanceAction } from './api.koogallery.upgrade-instance';

export const action = async ({ request, context, params }: ActionFunctionArgs) => {
  try {
    // Clone the request to avoid body reading issues
    const clonedRequest = request.clone();
    const body = (await clonedRequest.json()) as any;
    const { activity } = body;

    console.log('KooGallery request received:', {
      activity,
      timestamp: new Date().toISOString(),
      url: request.url,
    });

    // Route to the appropriate handler based on activity
    switch (activity) {
      case 'newInstance':
        return await createInstanceAction({ request, context, params });

      case 'queryInstance':
        return await queryInstanceAction({ request, context, params });

      case 'refreshInstance':
        return await updateInstanceAction({ request, context, params });

      case 'updateInstanceStatus':
        return await updateInstanceStatusAction({ request, context, params });

      case 'releaseInstance':
        return await releaseInstanceAction({ request, context, params });

      case 'upgradeInstance':
        return await upgradeInstanceAction({ request, context, params });

      case 'changeInstanceCheck':
        // Handle verification of changes upon renewal
        return json({
          resultCode: '000000',
          resultMsg: 'Change verification supported',
        });

      default:
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

    // Don't try to log to database if there's already a database error
    try {
      await logKooGalleryRequest('saasproduce-error', {
        message: error instanceof Error ? error.message : 'Unknown error',
        status: 'error',
        timestamp: new Date().toISOString(),
      });
    } catch (logError) {
      console.error('Failed to log error:', logError);
    }

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
    status: 'KooGallery SaaS Produce endpoint is running',
    timestamp: new Date().toISOString(),
    message: 'This endpoint handles all KooGallery activities via the activity parameter',
  });
};
