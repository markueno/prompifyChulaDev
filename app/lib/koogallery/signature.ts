import crypto from 'crypto';

/**
 * Verify KooGallery HTTP Body Signature
 * Based on KooGallery SaaS 2.0 documentation
 */
export async function verifyKooGallerySignature(
  request: Request, 
  requestBody: any
): Promise<boolean> {
  try {
    const url = new URL(request.url);
    const signature = url.searchParams.get('signature');
    const timestamp = url.searchParams.get('timestamp');
    const nonce = url.searchParams.get('nonce');

    if (!signature || !timestamp || !nonce) {
      console.error('Missing signature parameters');
      return false;
    }

    // Check timestamp (must be within 60 seconds)
    // KooGallery sends timestamps in milliseconds, so convert to seconds
    const currentTime = Math.floor(Date.now() / 1000);
    const requestTime = Math.floor(parseInt(timestamp) / 1000);
    
    console.log('Timestamp validation:', {
      currentTime,
      requestTime,
      difference: Math.abs(currentTime - requestTime),
      timestamp: timestamp
    });
    
    if (Math.abs(currentTime - requestTime) > 60) {
      console.error('Request timestamp expired', {
        currentTime,
        requestTime,
        difference: Math.abs(currentTime - requestTime),
        timestamp: timestamp
      });
      return false;
    }

    // Get access key from environment
    const accessKey = process.env.KOOGALLERY_ACCESS_KEY;
    if (!accessKey) {
      console.error('KooGallery access key not configured');
      return false;
    }

    // Generate canonical request string
    const requestPayload = JSON.stringify(requestBody);
    const payloadHash = crypto
      .createHash('sha256')
      .update(requestPayload)
      .digest('hex')
      .toLowerCase();

    const canonicalRequest = accessKey + nonce + timestamp + payloadHash;

    // Generate expected signature
    const expectedSignature = crypto
      .createHmac('sha256', accessKey)
      .update(canonicalRequest)
      .digest('hex')
      .toUpperCase();

    // Compare signatures
    const isValid = signature.toUpperCase() === expectedSignature;

    if (!isValid) {
      console.error('Signature verification failed', {
        provided: signature,
        expected: expectedSignature,
        canonicalRequest
      });
    }

    return isValid;

  } catch (error) {
    console.error('Signature verification error:', error);
    return false;
  }
}

/**
 * Generate signature for outbound requests to KooGallery
 */
export function generateKooGallerySignature(
  accessKey: string,
  nonce: string,
  timestamp: string,
  requestBody: any
): string {
  const requestPayload = JSON.stringify(requestBody);
  const payloadHash = crypto
    .createHash('sha256')
    .update(requestPayload)
    .digest('hex')
    .toLowerCase();

  const canonicalRequest = accessKey + nonce + timestamp + payloadHash;

  return crypto
    .createHmac('sha256', accessKey)
    .update(canonicalRequest)
    .digest('hex')
    .toUpperCase();
}

