import crypto from 'crypto';
import {
  getPostgresPool,
  createPostgresTables,
  getUserByEmailPostgres,
  createUserPostgres,
  getUserByVerificationTokenPostgres,
  verifyUserPostgres,
  updateLoginAttemptsPostgres,
  resetLoginAttemptsPostgres,
  logEmailPostgres,
  createUserSessionPostgres,
  invalidateUserSessionsPostgres,
  validateSessionPostgres,
  updateSessionActivityPostgres,
  logoutUserPostgres,
  getActiveSessionCountPostgres,
  saveChatPostgres,
  getChatsByUserPostgres,
  getChatByIdPostgres,
  deleteChatPostgres,
  logUserActivityPostgres,
  getUserActivityPostgres
} from './database-postgresql';

// Database configuration
const DATABASE_URL = process.env.DATABASE_URL;

// For PostgreSQL
let postgresDb: any;

export function getDatabase() {
  if (!postgresDb) {
    // Initialize PostgreSQL tables if they don't exist
    createPostgresTables().catch(console.error);
    postgresDb = getPostgresPool();
  }
  return postgresDb;
}

// Database helper functions - all use PostgreSQL
export async function getUserByEmail(email: string) {
  return getUserByEmailPostgres(email);
}

export async function createUser(user: any) {
  try {
    return createUserPostgres(user);
  } catch (error) {
    console.error('Error creating user:', error);
    return false;
  }
}

export async function getUserByVerificationToken(token: string) {
  return getUserByVerificationTokenPostgres(token);
}

export async function verifyUser(userId: string) {
  try {
    return verifyUserPostgres(userId);
  } catch (error) {
    console.error('Error verifying user:', error);
    return false;
  }
}

export async function updateLoginAttempts(email: string, attempts: number) {
  try {
    return updateLoginAttemptsPostgres(email, attempts);
  } catch (error) {
    console.error('Error updating login attempts:', error);
    return false;
  }
}

export async function resetLoginAttempts(userId: string) {
  try {
    return resetLoginAttemptsPostgres(userId);
  } catch (error) {
    console.error('Error resetting login attempts:', error);
    return false;
  }
}

export async function logEmail(userId: string, emailType: string, delivered: boolean, errorMessage?: string) {
  try {
    return logEmailPostgres(userId, emailType, delivered, errorMessage);
  } catch (error) {
    console.error('Error logging email:', error);
    return false;
  }
} 

export async function createUserSession(userId: string, tokenHash: string, expiresAt: string, ipAddress?: string, userAgent?: string) {
  try {
    return createUserSessionPostgres(userId, tokenHash, expiresAt, ipAddress, userAgent);
  } catch (error) {
    console.error('Error creating user session:', error);
    return false;
  }
}

export async function invalidateUserSessions(userId: string) {
  try {
    return invalidateUserSessionsPostgres(userId);
  } catch (error) {
    console.error('Error invalidating user sessions:', error);
    return false;
  }
}

export async function validateSession(tokenHash: string) {
  try {
    return validateSessionPostgres(tokenHash);
  } catch (error) {
    console.error('Error validating session:', error);
    return null;
  }
}

export async function updateSessionActivity(tokenHash: string) {
  try {
    return updateSessionActivityPostgres(tokenHash);
  } catch (error) {
    console.error('Error updating session activity:', error);
    return false;
  }
}

// Chat management functions
export async function saveChat(userId: string, chatData: {
  id: string;
  urlId?: string;
  description?: string;
  messages: any[];
  metadata?: any;
}) {
  try {
    return saveChatPostgres(userId, chatData);
  } catch (error) {
    console.error('Error saving chat:', error);
    return null;
  }
}

export async function getChatsByUser(userId: string) {
  try {
    return getChatsByUserPostgres(userId);
  } catch (error) {
    console.error('Error getting chats by user:', error);
    return [];
  }
}

export async function getChatById(chatId: string, userId: string) {
  try {
    return getChatByIdPostgres(chatId, userId);
  } catch (error) {
    console.error('Error getting chat by ID:', error);
    return null;
  }
}

export async function deleteChat(chatId: string, userId: string) {
  try {
    return deleteChatPostgres(chatId, userId);
  } catch (error) {
    console.error('Error deleting chat:', error);
    return false;
  }
}

// User activity tracking functions
export async function logUserActivity(userId: string, actionType: string, actionDetails: any = {}, ipAddress?: string, userAgent?: string) {
  try {
    return logUserActivityPostgres(userId, actionType, actionDetails, ipAddress, userAgent);
  } catch (error) {
    console.error('Error logging user activity:', error);
    return false;
  }
}

export async function getUserActivity(userId: string, limit: number = 100) {
  try {
    return getUserActivityPostgres(userId, limit);
  } catch (error) {
    console.error('Error getting user activity:', error);
    return [];
  }
}

export async function logoutUser(tokenHash: string) {
  try {
    return logoutUserPostgres(tokenHash);
  } catch (error) {
    console.error('Error logging out user:', error);
    return false;
  }
}

export async function getActiveSessionCount(userId: string) {
  try {
    return getActiveSessionCountPostgres(userId);
  } catch (error) {
    console.error('Error getting active session count:', error);
    return 0;
  }
}
