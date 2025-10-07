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

export const action = async ({ request, context }: ActionFunctionArgs) => {
  try {
    const body = await request.json();
    const { activity } = body;

    console.log('KooGallery request received:', {
      activity,
      timestamp: new Date().toISOString(),
      url: request.url
    });

    // Route to the appropriate handler based on activity
    switch (activity) {
      case 'newInstance':
        return await createInstanceAction({ request, context });
      
      case 'queryInstance':
        return await queryInstanceAction({ request, context });
      
      case 'refreshInstance':
        return await updateInstanceAction({ request, context });
      
      case 'updateInstanceStatus':
        return await updateInstanceStatusAction({ request, context });
      
      case 'releaseInstance':
        return await releaseInstanceAction({ request, context });
      
      case 'upgradeInstance':
        return await upgradeInstanceAction({ request, context });
      
      case 'changeInstanceCheck':
        // Handle verification of changes upon renewal
        return json({
          resultCode: '000000',
          resultMsg: 'Change verification supported'
        });
      
      default:
        return json({
          resultCode: '000001',
          resultMsg: `Unknown activity: ${activity}`
        }, { status: 400 });
    }

  } catch (error) {
    console.error('KooGallery saasproduce error:', error);
    
    await logKooGalleryRequest('saasproduce-error', {
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    });

    return json({
      resultCode: '000999',
      resultMsg: 'Internal server error'
    }, { status: 500 });
  }
};

export const loader = async () => {
  return json({
    status: 'KooGallery SaaS Produce endpoint is running',
    timestamp: new Date().toISOString(),
    message: 'This endpoint handles all KooGallery activities via the activity parameter'
  });
};
