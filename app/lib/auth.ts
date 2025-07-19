import jwt from 'jsonwebtoken';
import { redirect } from '@remix-run/cloudflare';

export interface User {
  id: string;
  email: string;
  verified: boolean;
}

export interface JWTPayload {
  userId: string;
  email: string;
  verified: boolean;
  iat: number;
  exp: number;
}

export async function verifyToken(token: string, secret: string): Promise<User | null> {
  try {
    const decoded = jwt.verify(token, secret) as JWTPayload;
    return {
      id: decoded.userId,
      email: decoded.email,
      verified: decoded.verified
    };
  } catch (error) {
    console.error('Token verification failed:', error);
    return null;
  }
}

export async function getAuthToken(request: Request): Promise<string | null> {
  const cookieHeader = request.headers.get('Cookie');
  if (!cookieHeader) return null;

  const cookies = cookieHeader.split(';').reduce((acc, cookie) => {
    const [key, value] = cookie.trim().split('=');
    acc[key] = value;
    return acc;
  }, {} as Record<string, string>);

  return cookies.auth_token || null;
}

export async function requireAuth(request: Request, context: any): Promise<User> {
  const token = await getAuthToken(request);
  
  if (!token) {
    throw redirect('/auth/login');
  }

  const secret = context.cloudflare?.env?.JWT_SECRET || 'your-secret-key';
  const user = await verifyToken(token, secret);
  
  if (!user) {
    throw redirect('/auth/login');
  }

  if (!user.verified) {
    throw redirect('/auth/verify-pending');
  }

  return user;
}

export async function optionalAuth(request: Request, context: any): Promise<User | null> {
  const token = await getAuthToken(request);
  
  if (!token) {
    return null;
  }

  const secret = context.cloudflare?.env?.JWT_SECRET || 'your-secret-key';
  const user = await verifyToken(token, secret);
  
  return user;
}

export function createAuthCookie(token: string): string {
  return `auth_token=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=86400`;
}

export function clearAuthCookie(): string {
  return 'auth_token=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0';
} 