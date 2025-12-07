import { getPostgresPool } from '~/lib/database-postgresql';
import crypto from 'crypto';

export interface KooGalleryLogEntry {
  id?: string;
  endpoint: string;
  method: string;
  orderId?: string;
  instanceId?: string;
  status: 'success' | 'error';
  message: string;
  requestData?: Record<string, any>;
  responseData?: Record<string, any>;
  timestamp: string;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Log KooGallery API requests and responses
 */
export async function logKooGalleryRequest(
  endpoint: string,
  data: {
    orderId?: string;
    instanceId?: string;
    status?: 'success' | 'error';
    message?: string;
    requestData?: Record<string, any>;
    responseData?: Record<string, any>;
    ipAddress?: string;
    userAgent?: string;
  }
): Promise<void> {
  try {
    const pool = getPostgresPool();
    
    await pool.query(`
      INSERT INTO koogallery_logs (
        id, endpoint, method, order_id, instance_id, status, 
        message, request_data, response_data, timestamp, ip_address, user_agent
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    `, [
      crypto.randomUUID(),
      endpoint,
      data.requestData?.method || 'POST',
      data.orderId || null,
      data.instanceId || null,
      data.status || 'success',
      data.message || '',
      data.requestData ? JSON.stringify(data.requestData) : null,
      data.responseData ? JSON.stringify(data.responseData) : null,
      data.timestamp || new Date().toISOString(),
      data.ipAddress || null,
      data.userAgent || null
    ]);

  } catch (error) {
    console.error('Error logging KooGallery request:', error);
    // Don't throw error to avoid breaking the main flow
  }
}

/**
 * Get KooGallery logs for debugging
 */
export async function getKooGalleryLogs(
  limit: number = 100,
  orderId?: string,
  instanceId?: string
): Promise<KooGalleryLogEntry[]> {
  try {
    const pool = getPostgresPool();
    
    let query = `
      SELECT * FROM koogallery_logs 
      WHERE 1=1
    `;
    const params: any[] = [];

    if (orderId) {
      query += ' AND order_id = $' + (params.length + 1);
      params.push(orderId);
    }

    if (instanceId) {
      query += ' AND instance_id = $' + (params.length + 1);
      params.push(instanceId);
    }

    query += ' ORDER BY timestamp DESC LIMIT $' + (params.length + 1);
    params.push(limit);

    const result = await pool.query(query, params);
    const rows = result.rows;

    return rows.map((row: any) => ({
      id: row.id,
      endpoint: row.endpoint,
      method: row.method,
      orderId: row.order_id,
      instanceId: row.instance_id,
      status: row.status,
      message: row.message,
      requestData: row.request_data ? JSON.parse(row.request_data) : undefined,
      responseData: row.response_data ? JSON.parse(row.response_data) : undefined,
      timestamp: row.timestamp,
      ipAddress: row.ip_address,
      userAgent: row.user_agent
    }));

  } catch (error) {
    console.error('Error getting KooGallery logs:', error);
    return [];
  }
}
