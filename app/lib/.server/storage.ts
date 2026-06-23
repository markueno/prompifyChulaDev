/*
 * app/lib/.server/storage.ts
 *
 * S3-compatible content-addressed blob storage (Huawei OBS via @aws-sdk/client-s3).
 * Provider-agnostic by design — see ARCHITECTURE-v2.md:872-885. Imported by nothing yet (Day 1).
 */
import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

// Lazy singleton — mirrors getPostgresPool() in database-postgresql.ts:11-33.
let client: S3Client | undefined;

function getClient(): S3Client {
  if (!client) {
    const endpoint = process.env.S3_ENDPOINT;
    const region = process.env.S3_REGION;
    const accessKeyId = process.env.S3_ACCESS_KEY_ID;
    const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;

    if (!endpoint || !region || !accessKeyId || !secretAccessKey) {
      throw new Error('S3 storage requires S3_ENDPOINT, S3_REGION, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY');
    }

    client = new S3Client({
      endpoint,
      region,
      credentials: { accessKeyId, secretAccessKey },
      forcePathStyle: false, // OBS supports virtual-hosted style — IMPLEMENTATION-PLAN §1.4a
    });
  }

  return client;
}

function getBucket(): string {
  const bucket = process.env.S3_BUCKET;

  if (!bucket) {
    throw new Error('S3_BUCKET environment variable is required');
  }

  return bucket;
}

/**
 * Content-addressed key: blobs/<sha[0:2]>/<sha[2:4]>/<sha>
 * Fans files across prefixes so no single prefix becomes hot. ARCHITECTURE-v2.md:154.
 */
export function keyForHash(sha256: string): string {
  return `blobs/${sha256.slice(0, 2)}/${sha256.slice(2, 4)}/${sha256}`;
}

export async function putObject(
  key: string,
  body: Uint8Array | Buffer | string,
  contentType = 'application/octet-stream'
): Promise<void> {
  await getClient().send(new PutObjectCommand({ Bucket: getBucket(), Key: key, Body: body, ContentType: contentType }));
}

export async function getObject(key: string): Promise<Uint8Array> {
  const res = await getClient().send(new GetObjectCommand({ Bucket: getBucket(), Key: key }));
  const bytes = await res.Body?.transformToByteArray();

  if (!bytes) {
    throw new Error(`Empty object body for key: ${key}`);
  }

  return bytes;
}

/** Returns true if the blob already exists — used by the Day 4 dedup endpoint. */
export async function headObject(key: string): Promise<boolean> {
  try {
    await getClient().send(new HeadObjectCommand({ Bucket: getBucket(), Key: key }));
    return true;
  } catch (err: any) {
    if (err?.$metadata?.httpStatusCode === 404 || err?.name === 'NotFound') {
      return false;
    }

    throw err;
  }
}

export async function getPresignedPutUrl(key: string, expiresInSeconds = 60): Promise<string> {
  return getSignedUrl(getClient(), new PutObjectCommand({ Bucket: getBucket(), Key: key }), {
    expiresIn: expiresInSeconds,
  });
}

export async function getPresignedGetUrl(key: string, expiresInSeconds = 60): Promise<string> {
  return getSignedUrl(getClient(), new GetObjectCommand({ Bucket: getBucket(), Key: key }), {
    expiresIn: expiresInSeconds,
  });
}
