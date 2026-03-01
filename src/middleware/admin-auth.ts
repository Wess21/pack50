import jwt from 'jsonwebtoken';
import { Request, Response, NextFunction } from 'express';
import { env } from '../config/env.js';

const JWT_SECRET = env.JWT_SECRET || 'fallback-dev-secret-change-in-production';
const TOKEN_EXPIRY = '7d';

export interface AdminRequest extends Request {
  adminId?: number;
}

/**
 * Generate JWT token for authenticated admin
 */
export function generateToken(adminId: number): string {
  return jwt.sign({ adminId }, JWT_SECRET, { expiresIn: TOKEN_EXPIRY });
}

/**
 * Middleware to require admin authentication
 * Validates JWT token from Authorization header
 */
export function requireAdmin(
  req: AdminRequest,
  res: Response,
  next: NextFunction
): void {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'No token provided' });
    return;
  }

  const token = authHeader.replace('Bearer ', '');

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { adminId: number };
    req.adminId = decoded.adminId;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}
