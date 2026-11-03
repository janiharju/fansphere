import { Request } from 'express';
import { sessions, SESSION_TTL_MS } from './appState';
import { Session } from '../models/types';

export function getSessionFromReq(req: Request): Session | null {
  const authHeader = req.headers['authorization'];
  let sessionId = req.headers['x-session-id'] as string | undefined;
  if (!sessionId && authHeader && authHeader.startsWith('Bearer ')) {
    sessionId = authHeader.slice(7).trim();
  }
  if (!sessionId && req.body && typeof req.body === 'object' && req.body.session_id) {
    sessionId = String(req.body.session_id).trim();
  }

  if (!sessionId) return null;

  const session = sessions.get(sessionId);
  if (!session) return null;

  const now = Date.now();
  if (new Date(session.expires_at).getTime() <= now) {
    return null;
  }

  // Automatic session refresh on use
  session.last_active_at = new Date(now).toISOString();
  session.expires_at = new Date(now + SESSION_TTL_MS).toISOString();
  
  return session;
}

export function getUserIdentifier(req: Request, session?: Session | null): string | null {
  if (session && session.email) return session.email.toLowerCase();
  if (session && session.nickname) return session.nickname.toLowerCase();
  const headerEmail = req.headers['x-user-email'];
  if (typeof headerEmail === 'string' && headerEmail.trim()) {
    return headerEmail.trim().toLowerCase();
  }
  const headerNick = req.headers['x-user-nickname'];
  if (typeof headerNick === 'string' && headerNick.trim()) {
    return headerNick.trim().toLowerCase();
  }
  return null;
}
