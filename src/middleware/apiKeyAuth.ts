import { Request, Response, NextFunction } from 'express';
import { prisma } from '../db/prisma.js';
import type { ApiKeyInfo } from '../types/index.js';

// Extend Express Request to include apiKeyInfo
declare global {
  namespace Express {
    interface Request {
      apiKeyInfo?: ApiKeyInfo;
    }
  }
}

// Validate API key from headers
async function validateApiKey(req: Request, res: Response, next: NextFunction) {
  const apiKey = req.headers['x-api-key'];

  if (!apiKey) {
    res.status(401).json({ error: 'Missing X-API-Key header' });
    return;
  }

  try {
    const row = await prisma.apiKey.findFirst({
      where: {
        keyValue: apiKey as string,
        active: 1
      },
      select: {
        id: true,
        name: true,
        role: true,
        eventId: true
      }
    });

    if (!row) {
      res.status(403).json({ error: 'Invalid API key' });
      return;
    }

    // Attach API key info to request
    req.apiKeyInfo = row as ApiKeyInfo;
    next();
  } catch (err) {
    console.error('Error in API key validation:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// Check if user has permission for specific endpoint
function requireRole(...allowedRoles: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.apiKeyInfo) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const { role } = req.apiKeyInfo;

    // Admin has access to everything
    if (role === 'admin') {
      next();
      return;
    }

    // Check if user's role is in allowed roles
    if (allowedRoles.includes(role)) {
      next();
      return;
    }

    res.status(403).json({ 
      error: 'Insufficient permissions',
      detail: `This endpoint requires one of these roles: ${allowedRoles.join(', ')}`
    });
  };
}

// Check if promoter owns the event
function requireEventOwnership(req: Request, res: Response, next: NextFunction): void {
  if (!req.apiKeyInfo) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const { role, eventId } = req.apiKeyInfo;

  // Admin can access any event
  if (role === 'admin') {
    next();
    return;
  }

  // Promoter must own this event
  if (role === 'promoter') {
    const requestedEventId = req.params.eventId;
    
    if (eventId === requestedEventId) {
      next();
      return;
    }

    res.status(403).json({ 
      error: 'You do not have permission to access this event',
      detail: 'Promoters can only access their own events'
    });
    return;
  }

  res.status(403).json({ error: 'Insufficient permissions' });
}

// Utility function to create/add an API key
async function addApiKey(name: string): Promise<{ id: number; name: string }> {
  const result = await prisma.apiKey.create({
    data: {
      name: name,
      keyValue: name, // Placeholder - should use proper key generation
      role: 'user',
      active: 1
    },
    select: {
      id: true,
      name: true
    }
  });
  
  return result;
}

export { validateApiKey, requireRole, requireEventOwnership, addApiKey };
