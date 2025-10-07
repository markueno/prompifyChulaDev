import { getDatabase } from '~/lib/database';
import crypto from 'crypto';

export interface KooGalleryInstance {
  id: string;
  instanceId: string;
  orderId: string;
  orderLineId: string;
  businessId: string;
  status: 'creating' | 'active' | 'suspended' | 'expired' | 'deleted';
  testFlag: boolean;
  createdAt: Date;
  updatedAt: Date;
  expiresAt?: Date;
  metadata?: Record<string, any>;
}

export interface CreateInstanceParams {
  instanceId: string;
  orderId: string;
  orderLineId: string;
  businessId: string;
  testFlag: boolean;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  expiresAt?: Date;
  metadata?: Record<string, any>;
}

/**
 * Create a new KooGallery instance
 */
export async function createInstance(params: CreateInstanceParams): Promise<KooGalleryInstance> {
  const db = getDatabase();
  
  try {
    // Insert instance record
    const result = await db.run(`
      INSERT INTO koogallery_instances (
        id, instance_id, order_id, order_line_id, business_id, 
        status, test_flag, created_at, updated_at, expires_at, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      crypto.randomUUID(),
      params.instanceId,
      params.orderId,
      params.orderLineId,
      params.businessId,
      params.status,
      params.testFlag ? 1 : 0,
      params.createdAt.toISOString(),
      params.updatedAt.toISOString(),
      params.expiresAt?.toISOString() || null,
      params.metadata ? JSON.stringify(params.metadata) : null
    ]);

    // Return the created instance
    return {
      id: result.lastInsertRowid?.toString() || '',
      instanceId: params.instanceId,
      orderId: params.orderId,
      orderLineId: params.orderLineId,
      businessId: params.businessId,
      status: params.status as any,
      testFlag: params.testFlag,
      createdAt: params.createdAt,
      updatedAt: params.updatedAt,
      expiresAt: params.expiresAt,
      metadata: params.metadata
    };

  } catch (error) {
    console.error('Error creating KooGallery instance:', error);
    throw new Error('Failed to create instance');
  }
}

/**
 * Get instance by order ID and order line ID (for idempotency)
 */
export async function getInstanceByOrderId(
  orderId: string, 
  orderLineId: string
): Promise<KooGalleryInstance | null> {
  const db = getDatabase();
  
  try {
    const row = await db.get(`
      SELECT * FROM koogallery_instances 
      WHERE order_id = ? AND order_line_id = ?
      ORDER BY created_at DESC
      LIMIT 1
    `, [orderId, orderLineId]);

    if (!row) return null;

    return {
      id: row.id,
      instanceId: row.instance_id,
      orderId: row.order_id,
      orderLineId: row.order_line_id,
      businessId: row.business_id,
      status: row.status,
      testFlag: Boolean(row.test_flag),
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
      expiresAt: row.expires_at ? new Date(row.expires_at) : undefined,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined
    };

  } catch (error) {
    console.error('Error getting instance by order ID:', error);
    return null;
  }
}

/**
 * Get instance by instance ID
 */
export async function getInstanceById(instanceId: string): Promise<KooGalleryInstance | null> {
  const db = getDatabase();
  
  try {
    const row = await db.get(`
      SELECT * FROM koogallery_instances 
      WHERE instance_id = ?
      ORDER BY created_at DESC
      LIMIT 1
    `, [instanceId]);

    if (!row) return null;

    return {
      id: row.id,
      instanceId: row.instance_id,
      orderId: row.order_id,
      orderLineId: row.order_line_id,
      businessId: row.business_id,
      status: row.status,
      testFlag: Boolean(row.test_flag),
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
      expiresAt: row.expires_at ? new Date(row.expires_at) : undefined,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined
    };

  } catch (error) {
    console.error('Error getting instance by ID:', error);
    return null;
  }
}

/**
 * Update instance status
 */
export async function updateInstanceStatus(
  instanceId: string, 
  status: string,
  metadata?: Record<string, any>
): Promise<boolean> {
  const db = getDatabase();
  
  try {
    await db.run(`
      UPDATE koogallery_instances 
      SET status = ?, updated_at = ?, metadata = ?
      WHERE instance_id = ?
    `, [
      status,
      new Date().toISOString(),
      metadata ? JSON.stringify(metadata) : null,
      instanceId
    ]);

    return true;

  } catch (error) {
    console.error('Error updating instance status:', error);
    return false;
  }
}

/**
 * Delete instance
 */
export async function deleteInstance(instanceId: string): Promise<boolean> {
  const db = getDatabase();
  
  try {
    await db.run(`
      UPDATE koogallery_instances 
      SET status = 'deleted', updated_at = ?
      WHERE instance_id = ?
    `, [new Date().toISOString(), instanceId]);

    return true;

  } catch (error) {
    console.error('Error deleting instance:', error);
    return false;
  }
}
