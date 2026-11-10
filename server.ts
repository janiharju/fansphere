import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import express from 'express';
import cors from 'cors';
import { WebSocketServer, WebSocket } from 'ws';
import multer from 'multer';
import sharp from 'sharp';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import {
  fetchAllPostsFromFirestore,
  savePostToFirestore,
  fetchAllCommentsFromFirestore,
  saveCommentToFirestore,
  fetchAllChatMessagesFromFirestore,
  saveChatMessageToFirestore,
  fetchAllSessionsFromFirestore,
  saveSessionToFirestore,
  fetchAllRealmsFromFirestore,
  saveRealmToFirestore,
  saveUserToFirestore,
  fetchAllUsersFromFirestore,
  saveNotificationToFirestore,
  updateNotificationReadStatusInFirestore,
  updateAllNotificationsReadStatusInFirestore,
  loadNotificationsFromFirestore,
  updatePostCommentCountInFirestore,
  db,
  storage
} from './firestoreService.js';
import { doc, getDoc } from 'firebase/firestore';
import { 
  Team, MatchEvent, Match, Post, Comment, ChatMessage, Notification, 
  Session, UserReadState, ClubRealm 
} from './models/types.js';
import { 
  state, initAppState, SESSION_TTL_MS, ACTIVE_WINDOW_MS
} from './services/appState.js';



function extractMentions(text: string): string[] {
  const matches = text.match(/(?:^|\s)@([a-zA-Z0-9_\-\.\u00C0-\u017F]+)/g);
  if (!matches) return [];
  const list: string[] = [];
  for (const m of matches) {
    const clean = m.trim().replace(/^@/, '');
    if (clean && !list.includes(clean)) {
      list.push(clean);
    }
  }
  return list;
}

function extractQuotedAuthors(text: string): string[] {
  // Matches _@author:
  const matches = text.match(/_@([a-zA-Z0-9_\-\.\u00C0-\u017F]+):/g);
  if (!matches) return [];
  const list: string[] = [];
  for (const m of matches) {
    const clean = m.trim().replace(/^_@/, '').replace(/:$/, '');
    if (clean && !list.includes(clean)) {
      list.push(clean);
    }
  }
  return list;
}

// Initial seed generators












export function getDefaultRealmId(): string {
  if (typeof state.realms !== 'undefined' && Array.isArray(state.realms) && state.realms.length > 0) {
    const def = state.realms.find(r => r.is_default);
    if (def) return def.id;
    return state.realms[0].id;
  }
  return 'neutral-football-fan';
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function normalizeRealm(realm: string | undefined): string {
  if (!realm || realm.toLowerCase() === 'all') return getDefaultRealmId();
  const str = String(realm).trim().toLowerCase();

  if (typeof state.realms !== 'undefined' && Array.isArray(state.realms) && state.realms.length > 0) {
    const exactId = state.realms.find(r => r.id.toLowerCase() === str);
    if (exactId) return exactId.id;

    const exactName = state.realms.find(r => r.name.toLowerCase() === str);
    if (exactName) return exactName.id;

    const slugName = state.realms.find(r => slugify(r.name) === str);
    if (slugName) return slugName.id;

    const fuzzy = state.realms.find(r => str.includes(r.id.toLowerCase()) || str.includes(r.name.toLowerCase()) || r.name.toLowerCase().includes(str));
    if (fuzzy) return fuzzy.id;
  }
  return getDefaultRealmId();
}


initAppState();
// State accessed directly from state object to ensure reactivity

function getStandings() {
  const standings = state.teams.map((team) => {
    const gd = team.gf - team.ga;
    return {
      ...team,
      gd,
      rank: 1
    };
  });

  standings.sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if (b.gd !== a.gd) return b.gd - a.gd;
    if (b.gf !== a.gf) return b.gf - a.gf;
    return a.name.localeCompare(b.name);
  });

  standings.forEach((team, idx) => {
    team.rank = idx + 1;
  });

  return standings;
}

// Express App
const app = express();
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-session-id', 'x-user-email', 'x-user-nickname', 'x-admin-token']
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Ensure uploads folder exists and serve it statically
const uploadsDir = path.resolve(process.cwd(), 'static', 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}
app.use('/static/uploads', express.static(uploadsDir, {
  maxAge: '1d'
}));

// Broadcast manager & Session sockets
const activeSockets = new Set<WebSocket>();
const socketSessions = new Map<WebSocket, string>();

function broadcast(payload: Record<string, unknown>) {
  const message = JSON.stringify(payload);
  for (const client of activeSockets) {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(message);
      } catch {
        // ignore send error
      }
    }
  }
}

function getActiveSessions(): Session[] {
  const now = Date.now();
  const active: Session[] = [];
  const liveSessionIds = new Set(socketSessions.values());

  for (const session of state.sessions.values()) {
    const isExpired = new Date(session.expires_at).getTime() <= now;
    if (isExpired) continue;

    const lastActiveTime = new Date(session.last_active_at).getTime();
    const isRecentlyActive = (now - lastActiveTime) <= ACTIVE_WINDOW_MS;
    const hasLiveSocket = liveSessionIds.has(session.id);

    if (isRecentlyActive || hasLiveSocket) {
      active.push(session);
    }
  }
  return active;
}

function broadcastPresence() {
  const active = getActiveSessions();
  broadcast({
    type: 'presence',
    online_count: active.length,
    active_nicknames: active.map(s => s.nickname),
    active_users: active.map(s => ({ nickname: s.nickname, realm: s.realm }))
  });
}

function getSessionFromReq(req: express.Request): Session | null {
  console.log('[DEBUG] Request headers:', JSON.stringify(req.headers));
  const authHeader = req.headers['authorization'];
  let sessionId = req.headers['x-session-id'] as string | undefined;
  if (!sessionId && authHeader && authHeader.startsWith('Bearer ')) {
    sessionId = authHeader.slice(7).trim();
  }
  if (!sessionId && req.body && typeof req.body === 'object' && req.body.session_id) {
    sessionId = String(req.body.session_id).trim();
  }

  if (!sessionId) return null;

  const session = state.sessions.get(sessionId);
  console.log(`[DEBUG] Session lookup for ${sessionId}: ${session ? 'found' : 'not found'}`);
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

function getUserIdentifier(req: express.Request, session?: Session | null): string | null {
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

// Helper to find latest activity timestamp for a post (considering its creation and all comments)
function getPostLatestActivityTime(post: Post): number {
  let latestTime = new Date(post.created_at).getTime();
  if (post.last_activity_at) {
    const actTime = new Date(post.last_activity_at).getTime();
    if (!isNaN(actTime) && actTime > latestTime) {
      latestTime = actTime;
    }
  }
  for (const c of state.comments) {
    if (c.post_id === post.id) {
      const cTime = new Date(c.created_at).getTime();
      if (!isNaN(cTime) && cTime > latestTime) {
        latestTime = cTime;
      }
    }
  }
  return latestTime;
}

// Helper to compute comment count dynamically from comments
function getDynamicCommentCount(postId: number): number {
  return state.comments.filter((c: Comment) => c.post_id === postId).length;
}

// ==================== REST APIS ====================

// -1. Persistent Store Backup & Export API (Used by Cloud Build & Publishing pipeline)
app.get('/api/backup', (_req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Content-Type', 'application/json');
  res.json({
    posts: state.posts,
    comments: state.comments,
    chatMessages: state.chatMessages,
    sessions: Array.from(state.sessions.values()),
    userReadStates: Object.fromEntries(state.userReadStates.entries()),
    nextPostId: state.nextPostId,
    nextCommentId: state.nextCommentId,
    nextChatId: state.nextChatId
  });
});

app.get('/api/admin/store-backup', (_req, res) => {
  res.redirect('/api/backup');
});

app.post('/api/admin/store-restore', (req, res) => {
  const payload = req.body;
  if (!payload || !Array.isArray(payload.posts)) {
    return res.status(400).json({ error: 'Invalid store payload' });
  }

  state.posts = payload.posts;
  state.comments = Array.isArray(payload.comments) ? payload.comments : [];
  state.chatMessages = Array.isArray(payload.chatMessages) ? payload.chatMessages : [];
  if (Array.isArray(payload.sessions)) {
    state.sessions.clear();
    for (const s of payload.sessions) {
      state.sessions.set(s.id, s);
    }
  }
  state.nextPostId = payload.nextPostId || Math.max(0, ...state.posts.map(p => p.id)) + 1;
  state.nextCommentId = payload.nextCommentId || Math.max(0, ...state.comments.map(c => c.id)) + 1;
  state.nextChatId = payload.nextChatId || Math.max(0, ...state.chatMessages.map(m => m.id)) + 1;

  
  broadcastPresence();
  res.json({ success: true, message: 'Store restored successfully', postCount: state.posts.length });
});

// 0. Session & Authentication Endpoints

// 0a. Create Session (Nickname + Email)
app.post('/api/auth/session', async (req, res) => {
  if (req.headers['x-session-id']) {
    return handleSessionUpdate(req, res);
  }
  const { nickname, email } = req.body;
  const rawRealm = req.body.realm !== undefined ? req.body.realm : req.body.flair;

  if (!nickname || typeof nickname !== 'string' || nickname.trim().length < 2 || nickname.trim().length > 30) {
    return res.status(400).json({ detail: 'Nickname must be between 2 and 30 characters' });
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!email || typeof email !== 'string' || !emailRegex.test(email.trim())) {
    return res.status(400).json({ detail: 'Please enter a valid email address' });
  }

  const cleanNickname = nickname.trim().toLowerCase();
  const cleanEmail = email.trim().toLowerCase();
  const cleanRealm = normalizeRealm(rawRealm);

  // Check Email-Nickname Link in Firestore
  try {
    const userRef = doc(db, 'users', cleanEmail);
    const userSnap = await getDoc(userRef);
    if (userSnap.exists()) {
      const userData = userSnap.data();
      if (userData.nickname.toLowerCase() !== cleanNickname) {
        return res.status(400).json({ detail: 'This email is already associated with a different nickname.' });
      }
    }
  } catch (err) {
    console.error('[Firestore] User link check error:', err);
  }

  const now = Date.now();
  const sessionId = crypto.randomUUID();
  const session: Session = {
    id: sessionId,
    nickname: cleanNickname,
    email: cleanEmail,
    realm: cleanRealm,
    created_at: new Date(now).toISOString(),
    last_active_at: new Date(now).toISOString(),
    expires_at: new Date(now + SESSION_TTL_MS).toISOString()
  };

  state.sessions.set(sessionId, session);
  
  saveSessionToFirestore(session).catch(err => console.error('[Firestore] Session save error:', err));
  saveUserToFirestore({
    email: session.email,
    nickname: session.nickname,
    realm: session.realm,
    created_at: session.created_at
  }).catch(err => console.error('[Firestore] User profile save error:', err));

  broadcastPresence();

  const active = getActiveSessions();

  res.status(201).json({
    session,
    valid: true,
    online_count: active.length,
    active_nicknames: active.map(s => s.nickname)
  });
});

// 0b. Get / Verify / Reuse Session
app.get('/api/auth/session', (req, res) => {
  const authHeader = req.headers['authorization'];
  let sessionId = req.headers['x-session-id'] as string | undefined;
  if (!sessionId && authHeader && authHeader.startsWith('Bearer ')) {
    sessionId = authHeader.slice(7).trim();
  }

  if (!sessionId) {
    return res.status(401).json({ detail: 'No session ID provided', valid: false });
  }

  const session = state.sessions.get(sessionId);
  if (!session) {
    return res.status(401).json({ detail: 'Session not found', valid: false });
  }

  const now = Date.now();
  if (new Date(session.expires_at).getTime() <= now) {
    return res.status(401).json({ detail: 'Session expired', expired: true, valid: false });
  }

  // Automatic session refresh on reuse
  session.last_active_at = new Date(now).toISOString();
  session.expires_at = new Date(now + SESSION_TTL_MS).toISOString();
  
  broadcastPresence();

  const active = getActiveSessions();

  res.json({
    session,
    valid: true,
    online_count: active.length,
    active_nicknames: active.map(s => s.nickname)
  });
});

// 0c. Update Session (Change Nickname, Email & Flair)
const handleSessionUpdate = async (req: express.Request, res: express.Response) => {
  const session = getSessionFromReq(req);
  if (!session) {
    return res.status(401).json({ detail: 'Session expired or not found', expired: true, valid: false });
  }

  const { nickname, email, realm } = req.body;

  if (nickname !== undefined) {
    if (typeof nickname !== 'string' || nickname.trim().length < 2 || nickname.trim().length > 30) {
      return res.status(400).json({ detail: 'Nickname must be between 2 and 30 characters' });
    }
    session.nickname = nickname.trim().toLowerCase();
  }

  if (email !== undefined) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (typeof email !== 'string' || !emailRegex.test(email.trim())) {
      return res.status(400).json({ detail: 'Please enter a valid email address' });
    }
    const newEmail = email.trim().toLowerCase();
    
    // Check Email-Nickname link if changing email
    if (newEmail !== session.email) {
      try {
        const userRef = doc(db, 'users', newEmail);
        const userSnap = await getDoc(userRef);
        if (userSnap.exists()) {
          const userData = userSnap.data();
          if (userData.nickname.toLowerCase() !== session.nickname.toLowerCase()) {
            return res.status(400).json({ detail: 'This email is already associated with a different nickname.' });
          }
        }
      } catch (err) {
        console.error('[Firestore] User link check error:', err);
      }
    }
    session.email = newEmail;
  }


  const rawRealm = req.body.realm !== undefined ? req.body.realm : req.body.flair;
  if (rawRealm !== undefined && typeof rawRealm === 'string' && rawRealm.trim().length > 0) {
    session.realm = normalizeRealm(rawRealm);
  }

  session.last_active_at = new Date().toISOString();
  session.expires_at = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  
  saveSessionToFirestore(session).catch(err => console.error('[Firestore] Session update error:', err));
  saveUserToFirestore({
    email: session.email,
    nickname: session.nickname,
    realm: session.realm,
    created_at: session.created_at
  }).catch(err => console.error('[Firestore] User profile update error:', err));
  broadcastPresence();

  const active = getActiveSessions();

  res.json({
    session,
    valid: true,
    online_count: active.length,
    active_nicknames: active.map(s => s.nickname)
  });
};

app.patch('/api/auth/session', handleSessionUpdate);
app.put('/api/auth/session', handleSessionUpdate);

// 0d. Heartbeat / Auto-Refresh Session
app.post('/api/auth/session/refresh', (req, res) => {
  const session = getSessionFromReq(req);
  if (!session) {
    return res.status(401).json({ detail: 'Session expired or not found', expired: true, valid: false });
  }

  broadcastPresence();
  const active = getActiveSessions();

  res.json({
    session,
    valid: true,
    online_count: active.length,
    active_nicknames: active.map(s => s.nickname)
  });
});

// 0d. Logout / End Session
app.post('/api/auth/session/logout', (req, res) => {
  const authHeader = req.headers['authorization'];
  let sessionId = req.headers['x-session-id'] as string | undefined;
  if (!sessionId && authHeader && authHeader.startsWith('Bearer ')) {
    sessionId = authHeader.slice(7).trim();
  }
  if (!sessionId && req.body && req.body.session_id) {
    sessionId = req.body.session_id;
  }

  if (sessionId && state.sessions.has(sessionId)) {
    state.sessions.delete(sessionId);
    
    broadcastPresence();
  }

  res.json({ success: true });
});

// 0e. Live Presence
app.get('/api/presence', (_req, res) => {
  const active = getActiveSessions();
  res.json({
    online_count: active.length,
    active_nicknames: active.map(s => s.nickname),
    active_users: active.map(s => ({ nickname: s.nickname, realm: s.realm }))
  });
});

// Helper to determine if an author's club tag/realm matches a selected Realm
export function matchClubRealm(authorRealm: string | undefined, selectedRealm: string | undefined): boolean {
  if (!selectedRealm || selectedRealm.toLowerCase() === 'all') return true;
  if (!authorRealm) return false;

  const targetId = normalizeRealm(selectedRealm);
  const authId = normalizeRealm(authorRealm);
  return targetId === authId;
}

// Helper to get the user's realm from request (query param, session, or default)
function getUserRealm(req: express.Request): string {
  // Check query parameter first
  if (req.query.realm && typeof req.query.realm === 'string') {
    return normalizeRealm(req.query.realm);
  }
  
  // Check session
  const session = getSessionFromReq(req);
  console.log(`[DEBUG] getUserRealm session found: ${session ? session.id : 'none'}, realm: ${session?.realm}`);
  if (session?.realm) {
    return normalizeRealm(session.realm);
  }
  
  // Default to the default realm
  const defaultRealm = getDefaultRealmId();
  console.log(`[DEBUG] getUserRealm falling back to default: ${defaultRealm}`);
  return defaultRealm;
}

// Helper to filter entities by realm
function filterByRealm<T extends { author_realm?: string, author_flair?: string, realm?: string }>(entities: T[], realm: string): T[] {
  return entities.filter(e => {
    // For backward compatibility: entities without realm info are treated as neutral realm
    const entityRealm = e.author_realm || e.author_flair || e.realm;
    const effectiveRealm = entityRealm || getDefaultRealmId();
    return matchClubRealm(effectiveRealm, realm);
  });
}

// 1. Posts List (Always sorted by latest changes including comments, filterable by tag, club realm, and search query)
app.get('/api/posts', (req, res) => {
  const tag = req.query.tag as string | undefined;
  const queryRealm = req.query.realm as string | undefined;
  const q = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : '';

  // Get the user's realm (from query param, session, or default)
  const userRealm = getUserRealm(req);
  
  // Always filter by user's realm
  const filteredByUserRealm = filterByRealm(state.posts, userRealm);
  
  let filtered = [...filteredByUserRealm];
  
  if (tag && tag.toLowerCase() !== 'all') {
    filtered = filtered.filter(p => p.tag.toLowerCase() === tag.toLowerCase());
  }
  // If explicit realm query param is provided, use it for additional filtering
  if (queryRealm && queryRealm.toLowerCase() !== 'all') {
    filtered = filtered.filter(p => matchClubRealm((p as any).author_realm || (p as any).author_flair, queryRealm));
  }

  // Filter posts and comments by search keywords within the selected realm
  const matchingCommentsMap = new Map<number, Comment[]>();
  const userRealmComments = filterByRealm(state.comments, userRealm);
  if (q) {
    filtered = filtered.filter(p => {
      const titleMatch = p.title.toLowerCase().includes(q);
      const contentMatch = p.content.toLowerCase().includes(q);
      const postComments = userRealmComments.filter(c => c.post_id === p.id && c.content.toLowerCase().includes(q));
      if (postComments.length > 0) {
        matchingCommentsMap.set(p.id, postComments);
      }
      return titleMatch || contentMatch || postComments.length > 0;
    });
  }

  const session = getSessionFromReq(req);
  const userKey = getUserIdentifier(req, session);
  const userStates = userKey ? (state.userReadStates.get(userKey) || {}) : null;
  const userNickname = session ? session.nickname.toLowerCase() : (typeof req.headers['x-user-nickname'] === 'string' ? req.headers['x-user-nickname'].trim().toLowerCase() : '');

  // Always sort forum feed by latest changes, taking comments into account
  const mapped = filtered.map(p => {
    const latestActivityTime = getPostLatestActivityTime(p);
    const matchedComments = matchingCommentsMap.get(p.id) || [];
    const totalComments = getDynamicCommentCount(p.id);

    let isUnread = false;
    let unreadCommentsCount = 0;

    if (userKey) {
      const postComments = userRealmComments.filter(c => c.post_id === p.id);
      const readState = userStates ? userStates[String(p.id)] : null;
      const isAuthor = Boolean(userNickname && p.author.toLowerCase() === userNickname);

      if (!readState) {
        if (!isAuthor) {
          isUnread = true;
          // All comments from other users are unread
          unreadCommentsCount = postComments.filter(c => !userNickname || c.author.toLowerCase() !== userNickname).length;
        } else {
          // Author created the thread, thread itself is read, comments by others are unread
          unreadCommentsCount = postComments.filter(c => c.author.toLowerCase() !== userNickname).length;
        }
      } else {
        isUnread = false;
        const lastReadTime = new Date(readState.last_read_at).getTime();
        unreadCommentsCount = postComments.filter(c => {
          const commentTime = new Date(c.created_at).getTime();
          const isSelf = Boolean(userNickname && c.author.toLowerCase() === userNickname);
          return !isSelf && commentTime > lastReadTime;
        }).length;
      }
    }

    return {
      ...p,
      comment_count: totalComments,
      latest_activity_at: new Date(latestActivityTime).toISOString(),
      latest_activity_time: latestActivityTime,
      is_unread: isUnread,
      unread_comments_count: unreadCommentsCount,
      has_new_activity: isUnread || unreadCommentsCount > 0,
      matched_comments: matchedComments.map(c => ({
        id: c.id,
        author: c.author,
        author_realm: c.author_realm,
        content: c.content,
        created_at: c.created_at
      }))
    };
  });

  mapped.sort((a, b) => b.latest_activity_time - a.latest_activity_time);

  res.json(mapped);
});

// 2. Create Post
app.post('/api/posts', (req, res) => {
  const session = getSessionFromReq(req);
  if (!session) {
    return res.status(401).json({ detail: 'Session required. Please enter your nickname and email to post.', session_required: true });
  }

  const { title, content, tag, image_url } = req.body;

  if (!title || typeof title !== 'string' || title.trim().length < 3) {
    return res.status(400).json({ detail: 'Title must be at least 3 characters' });
  }
  if (!content || typeof content !== 'string' || content.trim().length < 5) {
    return res.status(400).json({ detail: 'Content must be at least 5 characters' });
  }

  const cleanImageUrl = image_url ? String(image_url).trim() : '';
  if (cleanImageUrl.startsWith('data:image/') || cleanImageUrl.length > 2048) {
    return res.status(400).json({ detail: 'Direct Base64 images are not supported. Please upload images via the upload endpoint.' });
  }

  const nowIso = new Date().toISOString();
  const assignedPostId = Math.max(state.nextPostId++, ...state.posts.map(p => p.id + 1), 1);
  state.nextPostId = assignedPostId + 1;
  const newPost: Post = {
    id: assignedPostId,
    title: title.trim(),
    content: content.trim(),
    author: session.nickname,
    author_realm: normalizeRealm(session.realm),
    tag: tag ? String(tag).trim() : 'Discussion',
    upvotes: 1,
    downvotes: 0,
    image_url: cleanImageUrl,
    created_at: nowIso,
    last_activity_at: nowIso
  };

  state.posts.unshift(newPost);

  // Automatically mark thread as read for its creator
  const creatorKey = (session.email || session.nickname).toLowerCase();
  let creatorMap = state.userReadStates.get(creatorKey);
  if (!creatorMap) {
    creatorMap = {};
    state.userReadStates.set(creatorKey, creatorMap);
  }
  creatorMap[String(assignedPostId)] = {
    last_read_at: nowIso,
    comment_count: 0
  };

  
  savePostToFirestore(newPost).catch(err => console.error('[Firestore] Post save error:', err));
  
  const extractedMentions = Array.from(new Set([...extractMentions(newPost.title), ...extractMentions(newPost.content)]));
  if (extractedMentions.length > 0) {
    for (const mentionNick of extractedMentions) {
      const notification: Notification = {
        id: crypto.randomUUID(),
        userId: mentionNick,
        messageId: newPost.id,
        type: 'post',
        read: false,
        created_at: nowIso
      };
      saveNotificationToFirestore(notification).catch(err => console.error('[Firestore] Post mention notification error:', err));
      
      // Broadcast to specific user if connected
      for (const [ws, sessionId] of socketSessions.entries()) {
        const sess = state.sessions.get(sessionId);
        if (sess && sess.nickname === mentionNick && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'new_notification', data: notification }));
        }
      }
    }
  }

  broadcast({
    type: 'new_post',
    data: {
      ...newPost,
      comment_count: 0,
      latest_activity_at: nowIso,
      score: 1
    }
  });

  res.status(201).json({
    ...newPost,
    comment_count: 0,
    latest_activity_at: nowIso,
    score: 1,
    is_unread: false,
    unread_comments_count: 0
  });
});

// Upload image endpoint
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 1048576 } 
});
app.post('/api/upload', upload.single('image'), async (req, res) => {
  const file = (req as any).file;
  if (!file) {
    return res.status(400).json({ error: 'No file uploaded or file exceeds 1MB limit' });
  }

  try {
    const sanitizedOriginal = (file.originalname || 'image.jpg').replace(/[^a-zA-Z0-9.-]/g, '_');
    const filename = `images/${crypto.randomUUID()}-${sanitizedOriginal}`;
    const storageRef = ref(storage, filename);
    await uploadBytes(storageRef, file.buffer, { contentType: file.mimetype || 'image/jpeg' });
    const downloadURL = await getDownloadURL(storageRef);
    res.json({ url: downloadURL });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ 
      error: 'Failed to upload image to Firebase Storage', 
      detail: error instanceof Error ? error.message : String(error) 
    });
  }
});

// Upload realm icon endpoint
app.post('/api/admin/upload-realm-icon', requireAdminAuth, upload.single('image'), async (req, res) => {
  const file = (req as any).file;
  if (!file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  try {
    const resizedBuffer = await sharp(file.buffer)
      .resize(256, 256, { fit: 'cover' })
      .toBuffer();
    
    const filename = `realm-icons/${crypto.randomUUID()}.png`;
    const storageRef = ref(storage, filename);
    await uploadBytes(storageRef, resizedBuffer, { contentType: 'image/png' });
    const url = await getDownloadURL(storageRef);
    res.json({ url });
  } catch (err) {
    console.error('[Storage] Realm icon upload error:', err);
    res.status(500).json({ error: 'Failed to upload icon', detail: err instanceof Error ? err.message : String(err) });
  }
});





app.get('/api/posts/:id', (req, res) => {
  const postId = parseInt(req.params.id, 10);
  const userRealm = getUserRealm(req);
  
  // Find post in user's realm
  const post = state.posts.find(p => p.id === postId && matchClubRealm(p.author_realm, userRealm));

  if (!post) {
    return res.status(404).json({ detail: 'Post not found' });
  }

  const userRealmComments = filterByRealm(state.comments, userRealm);
  const postComments = userRealmComments
    .filter(c => c.post_id === postId)
    .sort((a, b) => {
      if (b.upvotes !== a.upvotes) return b.upvotes - a.upvotes;
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    });

  const session = getSessionFromReq(req);
  const userKey = getUserIdentifier(req, session);
  if (userKey) {
    let uMap = state.userReadStates.get(userKey);
    if (!uMap) {
      uMap = {};
      state.userReadStates.set(userKey, uMap);
    }
    uMap[String(postId)] = {
      last_read_at: new Date().toISOString(),
      comment_count: postComments.length
    };
    
  }

  res.json({
    post: {
      ...post,
      comment_count: postComments.length,
      score: post.upvotes - post.downvotes
    },
    comments: postComments
  });
});

// Mark thread as read by user
app.post('/api/posts/:id/read', (req, res) => {
  const session = getSessionFromReq(req);
  const userKey = getUserIdentifier(req, session);
  const postId = parseInt(req.params.id, 10);
  const userRealm = getUserRealm(req);

  if (isNaN(postId)) {
    return res.status(400).json({ error: 'Invalid post ID' });
  }

  const post = state.posts.find(p => p.id === postId && matchClubRealm(p.author_realm, userRealm));
  if (!post) {
    return res.status(404).json({ error: 'Post not found' });
  }

  const userRealmComments = filterByRealm(state.comments, userRealm);
  const currentCommentCount = userRealmComments.filter(c => c.post_id === postId).length;
  const nowIso = new Date().toISOString();

  if (userKey) {
    let userMap = state.userReadStates.get(userKey);
    if (!userMap) {
      userMap = {};
      state.userReadStates.set(userKey, userMap);
    }
    userMap[String(postId)] = {
      last_read_at: nowIso,
      comment_count: currentCommentCount
    };
    
  }

  res.json({
    success: true,
    post_id: postId,
    read_state: userKey ? (state.userReadStates.get(userKey)?.[String(postId)] || null) : null
  });
});

// Get user read states
app.get('/api/posts-read-states', (req, res) => {
  const session = getSessionFromReq(req);
  const userKey = getUserIdentifier(req, session);
  if (!userKey) {
    return res.json({ read_states: {} });
  }
  const userMap = state.userReadStates.get(userKey) || {};
  const userRealm = getUserRealm(req);
  
  // Filter read states to only include posts that belong to the user's realm
  const filteredReadStates: Record<string, UserReadState> = {};
  const userRealmPosts = filterByRealm(state.posts, userRealm);
  for (const [postId, state] of Object.entries(userMap)) {
    const postExists = userRealmPosts.some(p => String(p.id) === postId);
    if (postExists) {
      filteredReadStates[postId] = state;
    }
  }
  res.json({ read_states: filteredReadStates });
});

// 4. Vote on Post
app.post('/api/posts/:id/vote', (req, res) => {
  const postId = parseInt(req.params.id, 10);
  const userRealm = getUserRealm(req);
  const post = state.posts.find(p => p.id === postId && matchClubRealm(p.author_realm, userRealm));

  if (!post) {
    return res.status(404).json({ detail: 'Post not found' });
  }

  const direction = req.body?.direction;
  if (direction === 'up') {
    post.upvotes += 1;
  } else if (direction === 'down') {
    post.downvotes += 1;
  } else if (direction === 'clear_up') {
    post.upvotes = Math.max(post.upvotes - 1, 0);
  } else if (direction === 'clear_down') {
    post.downvotes = Math.max(post.downvotes - 1, 0);
  }

  
  savePostToFirestore(post).catch(err => console.error('[Firestore] Vote update save error:', err));

  broadcast({
    type: 'vote_update',
    post_id: postId,
    upvotes: post.upvotes,
    downvotes: post.downvotes
  });

  res.json({
    post_id: postId,
    upvotes: post.upvotes,
    downvotes: post.downvotes,
    score: post.upvotes - post.downvotes
  });
});

// 5. Add Comment
app.post('/api/posts/:id/comments', (req, res) => {
  const session = getSessionFromReq(req);
  if (!session) {
    return res.status(401).json({ detail: 'Session required. Please enter your nickname and email to comment.', session_required: true });
  }

  const userRealm = getUserRealm(req);
  const postId = parseInt(req.params.id, 10);
  const post = state.posts.find(p => p.id === postId && matchClubRealm(p.author_realm, userRealm));

  if (!post) {
    return res.status(404).json({ detail: 'Post not found' });
  }

  const { content, parent_id, image_url } = req.body;
  if (!content || typeof content !== 'string' || content.trim().length === 0) {
    return res.status(400).json({ detail: 'Comment content cannot be empty' });
  }

  const cleanCommentImageUrl = image_url ? String(image_url).trim() : '';
  if (cleanCommentImageUrl.startsWith('data:image/') || cleanCommentImageUrl.length > 2048) {
    return res.status(400).json({ detail: 'Direct Base64 images are not supported. Please upload images via the upload endpoint.' });
  }

  const assignedCommentId = Math.max(state.nextCommentId++, ...state.comments.map(c => c.id + 1), 1);
  state.nextCommentId = assignedCommentId + 1;
  const comment: Comment = {
    id: assignedCommentId,
    post_id: postId,
    parent_id: parent_id ? parseInt(parent_id, 10) : null,
    author: session.nickname,
    author_realm: normalizeRealm(session.realm),
    content: content.trim(),
    upvotes: 1,
    image_url: cleanCommentImageUrl,
    created_at: new Date().toISOString()
  };

  state.comments.push(comment);
  const nowIso = comment.created_at;
  post.last_activity_at = nowIso;
  const currentCommentCount = getDynamicCommentCount(postId);

  // Automatically mark thread as read for commenter up to current comments count
  const commenterKey = (session.email || session.nickname).toLowerCase();
  let commenterMap = state.userReadStates.get(commenterKey);
  if (!commenterMap) {
    commenterMap = {};
    state.userReadStates.set(commenterKey, commenterMap);
  }
  commenterMap[String(postId)] = {
    last_read_at: nowIso,
    comment_count: currentCommentCount
  };

  
  saveCommentToFirestore(comment).catch((err: unknown) => console.error('[Firestore] Comment save error:', err));
  updatePostCommentCountInFirestore(postId, currentCommentCount, nowIso).catch((err: unknown) => console.error('[Firestore] Post activity update error:', err));
  
  const extractedMentions = extractMentions(comment.content);
  if (extractedMentions.length > 0) {
    for (const mentionNick of extractedMentions) {
      const notification: Notification = {
        id: crypto.randomUUID(),
        userId: mentionNick,
        messageId: comment.id,
        type: 'comment',
        read: false,
        created_at: nowIso
      };
      saveNotificationToFirestore(notification).catch(err => console.error('[Firestore] Comment mention notification error:', err));
      
      // Broadcast to specific user if connected
      for (const [ws, sessionId] of socketSessions.entries()) {
        const sess = state.sessions.get(sessionId);
        if (sess && sess.nickname === mentionNick && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'new_notification', data: notification }));
        }
      }
    }
  }

  broadcast({
    type: 'new_comment',
    data: comment,
    post_id: postId,
    comment_count: currentCommentCount,
    latest_activity_at: nowIso
  });

  res.status(201).json(comment);
});

// 6. Vote on Comment
app.post('/api/comments/:id/vote', (req, res) => {
  const commentId = parseInt(req.params.id, 10);
  const userRealm = getUserRealm(req);
  const comment = state.comments.find(c => c.id === commentId && matchClubRealm(c.author_realm, userRealm));

  if (!comment) {
    return res.status(404).json({ detail: 'Comment not found' });
  }

  comment.upvotes += 1;
  
  saveCommentToFirestore(comment).catch(err => console.error('[Firestore] Comment vote save error:', err));

  broadcast({
    type: 'comment_vote_update',
    comment_id: commentId,
    upvotes: comment.upvotes
  });

  res.json({
    comment_id: commentId,
    upvotes: comment.upvotes
  });
});

// 7. Chat History (Filterable by room and club realm)
app.get('/api/chat/history', async (req, res) => {
  console.log('API Request: /api/chat/history', req.query);
  const queryRealm = req.query.realm as string | undefined;
  const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 100;

  // Get the user's realm (from query param, session, or default)
  const session = getSessionFromReq(req);
  const userRealm = getUserRealm(req);

  const chatMessagesFromFirestore = await fetchAllChatMessagesFromFirestore(userRealm);
  chatMessagesFromFirestore.sort((a, b) => a.id - b.id);
  let roomMessages = chatMessagesFromFirestore;
  
  // Always filter by user's realm
  // For backward compatibility: messages without realm info are treated as neutral realm
  roomMessages = roomMessages.filter(m => {
    const messageRealm = m.author_realm || (m as any).author_flair || m.realm;
    // If no realm info, treat as neutral realm (default) for backward compatibility
    const effectiveRealm = messageRealm || getDefaultRealmId();
    return matchClubRealm(effectiveRealm, userRealm);
  });
  
  // If explicit realm query param is provided, use it for additional filtering
  if (queryRealm && queryRealm.toLowerCase() !== 'all') {
    roomMessages = roomMessages.filter(m => {
      const messageRealm = m.author_realm || (m as any).author_flair || m.realm;
      const effectiveRealm = messageRealm || getDefaultRealmId();
      return matchClubRealm(effectiveRealm, queryRealm);
    });
  }
  // Last `limit` messages in chronological order
  const slice = roomMessages.slice(-limit);

  res.json(slice);
});

// 8. Post Chat Message
app.post('/api/chat/message', (req, res) => {
  const session = getSessionFromReq(req);
  if (!session) {
    return res.status(401).json({ detail: 'Session required. Please enter your nickname and email to chat.', session_required: true });
  }

  const { content, badge_color } = req.body;

  if (!content || typeof content !== 'string' || content.trim().length === 0) {
    return res.status(400).json({ detail: 'Chat content cannot be empty' });
  }

  const assignedChatId = Math.max(state.nextChatId++, ...state.chatMessages.map(m => m.id + 1), 1);
  state.nextChatId = assignedChatId + 1;
  const trimmedContent = content.trim();
  const extractedMentions: string[] = extractMentions(trimmedContent);

  const msg: ChatMessage = {
    id: assignedChatId,
    author: session.nickname,
    author_realm: normalizeRealm(session.realm),
    badge_color: badge_color ? String(badge_color).trim() : '#EF4444',
    content: trimmedContent,
    created_at: new Date().toISOString(),
    reactions: {},
    realm: normalizeRealm(session.realm),
    mentions: extractedMentions
  };

  state.chatMessages.push(msg);
  
  saveChatMessageToFirestore(msg).catch(err => console.error('[Firestore] Chat save error:', err));
  
  if (extractedMentions.length > 0) {
    for (const mentionNick of extractedMentions) {
      const notification: Notification = {
        id: crypto.randomUUID(),
        userId: mentionNick,
        messageId: assignedChatId,
        type: 'chat',
        read: false,
        created_at: new Date().toISOString()
      };
      saveNotificationToFirestore(notification).catch(err => console.error('[Firestore] Notification save error:', err));
    }
  }

  broadcast({
    type: 'chat_message',
    data: msg
  });

  res.status(201).json(msg);
});

// Notifications API
app.get('/api/notifications', async (req, res) => {
  const session = getSessionFromReq(req);
  if (!session) return res.status(401).json({ detail: 'Session required' });
  
  const notifications = await loadNotificationsFromFirestore(session.nickname);
  res.json(notifications);
});

app.post('/api/notifications/:id/read', async (req, res) => {
  const session = getSessionFromReq(req);
  if (!session) return res.status(401).json({ detail: 'Session required' });
  
  await updateNotificationReadStatusInFirestore(req.params.id, true);
  res.status(204).send();
});

app.post('/api/notifications/read-all', async (req, res) => {
  const session = getSessionFromReq(req);
  if (!session) return res.status(401).json({ detail: 'Session required' });
  
  await updateAllNotificationsReadStatusInFirestore(session.nickname);
  res.status(204).send();
});

// 8b. Emoji Reaction on Chat Message
app.post('/api/chat/message/:id/react', (req, res) => {
  const session = getSessionFromReq(req);
  if (!session) {
    return res.status(401).json({ detail: 'Session required to react. Please sign in or set your nickname.', session_required: true });
  }

  const userRealm = getUserRealm(req);
  const messageId = parseInt(req.params.id, 10);
  const { emoji } = req.body;

  if (!emoji || typeof emoji !== 'string' || emoji.trim().length === 0) {
    return res.status(400).json({ detail: 'Emoji required' });
  }

  const cleanEmoji = emoji.trim();
  const msg = state.chatMessages.find(m => m.id === messageId && matchClubRealm(m.author_realm || (m as any).author_flair || m.realm, userRealm));
  if (!msg) {
    return res.status(404).json({ detail: 'Chat message not found' });
  }

  if (!msg.reactions) {
    msg.reactions = {};
  }

  const user = session.nickname;
  if (!Array.isArray(msg.reactions[cleanEmoji])) {
    msg.reactions[cleanEmoji] = [];
  }

  const userIdx = msg.reactions[cleanEmoji].indexOf(user);
  if (userIdx > -1) {
    // Toggle off if already reacted
    msg.reactions[cleanEmoji].splice(userIdx, 1);
    if (msg.reactions[cleanEmoji].length === 0) {
      delete msg.reactions[cleanEmoji];
    }
  } else {
    // Add reaction
    msg.reactions[cleanEmoji].push(user);
  }

  
  saveChatMessageToFirestore(msg).catch(err => console.error('[Firestore] Reaction save error:', err));

  broadcast({
    type: 'chat_reaction',
    data: {
      message_id: messageId,
      reactions: msg.reactions
    }
  });

  res.json({
    message_id: messageId,
    reactions: msg.reactions
  });
});

// 9. League Standings
app.get('/api/league/standings', (_req, res) => {
  res.json(getStandings());
});

// 10. League Fixtures
app.get('/api/league/fixtures', (_req, res) => {
  const fixtures = state.matches.map(m => {
    const homeTeam = state.teams.find(t => t.id === m.home_team_id);
    const awayTeam = state.teams.find(t => t.id === m.away_team_id);
    return {
      ...m,
      home_team: homeTeam ? { name: homeTeam.name, short_name: homeTeam.short_name, logo: homeTeam.logo } : { name: m.home_team_id, logo: '⚽' },
      away_team: awayTeam ? { name: awayTeam.name, short_name: awayTeam.short_name, logo: awayTeam.logo } : { name: m.away_team_id, logo: '⚽' }
    };
  });
  res.json(fixtures);
});

// 11. Simulate Match Event
app.post('/api/league/simulate-event', (req, res) => {
  const { match_id, scoring_team, player, event_type = 'GOAL' } = req.body;

  const match = state.matches.find(m => m.id === match_id);
  if (!match) {
    return res.status(404).json({ detail: 'Match not found' });
  }

  const minute = Math.min(match.minute + 5, 90);
  match.minute = minute;

  const home_id = match.home_team_id;
  const away_id = match.away_team_id;

  if (scoring_team === home_id) {
    match.home_score += 1;
    match.events.push({ min: minute, team: home_id, player, type: event_type });
  } else if (scoring_team === away_id) {
    match.away_score += 1;
    match.events.push({ min: minute, team: away_id, player, type: event_type });
  }

  // Update team stats
  const homeTeam = state.teams.find(t => t.id === home_id);
  const awayTeam = state.teams.find(t => t.id === away_id);

  if (homeTeam && awayTeam) {
    if (scoring_team === home_id) {
      homeTeam.gf += 1;
      awayTeam.ga += 1;
    } else if (scoring_team === away_id) {
      awayTeam.gf += 1;
      homeTeam.ga += 1;
    }
  }

  const standings = getStandings();

  broadcast({
    type: 'match_event',
    match,
    standings
  });

  res.json({
    status: 'success',
    match,
    standings
  });
});

// 12. Reset League (Resets state.matches/standings only, preserving all posts and chat)
app.post('/api/league/reset', (_req, res) => {
  state.teams = [];
  state.matches = [];
  const standings = getStandings();
  res.json({ status: 'reset', standings });
});

// ==================== ADMIN & CLUB REALMS MANAGEMENT ====================
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const activeAdminTokens = new Set<string>();

function requireAdminAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  const tokenHeader = req.headers['x-admin-token'] as string | undefined;
  const authHeader = req.headers['authorization'];
  const passHeader = req.headers['x-admin-password'] as string | undefined;

  let token = tokenHeader;
  if (!token && authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.slice(7).trim();
  }

  if (passHeader && passHeader === ADMIN_PASSWORD) {
    return next();
  }

  if (token && activeAdminTokens.has(token)) {
    return next();
  }

  return res.status(401).json({ detail: 'Admin login required. Please enter the administrator password.' });
}

// Admin: Login
app.post('/api/admin/login', (req, res) => {
  const { password } = req.body || {};
  if (!password || typeof password !== 'string') {
    return res.status(400).json({ detail: 'Password is required' });
  }

  if (password.trim() === ADMIN_PASSWORD) {
    const token = `admin_tok_${crypto.randomUUID()}`;
    activeAdminTokens.add(token);
    return res.json({ success: true, token });
  }

  return res.status(401).json({ detail: 'Incorrect administrator password' });
});

// Admin: Check Session
app.get('/api/admin/check', requireAdminAuth, (_req, res) => {
  res.json({ authenticated: true });
});

// Admin: Logout
app.post('/api/admin/logout', (req, res) => {
  const tokenHeader = req.headers['x-admin-token'] as string | undefined;
  const authHeader = req.headers['authorization'];
  let token = tokenHeader;
  if (!token && authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.slice(7).trim();
  }
  if (token) {
    activeAdminTokens.delete(token);
  }
  res.json({ success: true });
});

// Public: Get All Club Realms
app.get('/api/realms', (_req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.json({ realms: state.realms });
});

// Admin: Add New Club Realm
app.post('/api/admin/realms', requireAdminAuth, (req, res) => {
  const { name, badge_color, icon, description, image_icon, short_name } = req.body || {};
  if (!name || typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 50) {
    return res.status(400).json({ detail: 'Realm name must be between 2 and 50 characters' });
  }

  const cleanName = name.trim();
  const id = (req.body.id as string) || slugify(cleanName) || `realm-${Date.now()}`;

  if (state.realms.some(r => r.id === id || r.name.toLowerCase() === cleanName.toLowerCase())) {
    return res.status(400).json({ detail: `A club realm with the name "${cleanName}" already exists` });
  }

  const hexRegex = /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/;
  const cleanColor = badge_color && typeof badge_color === 'string' && hexRegex.test(badge_color.trim())
    ? badge_color.trim()
    : '#EF4444';

  const cleanIcon = icon && typeof icon === 'string' && icon.trim().length > 0
    ? icon.trim().slice(0, 8)
    : '🛡️';

  const newRealm: ClubRealm = {
    id,
    name: cleanName,
    badge_color: cleanColor,
    icon: cleanIcon,
    image_icon: image_icon && typeof image_icon === 'string' ? image_icon.trim() : '',
    short_name: short_name && typeof short_name === 'string' ? short_name.trim().slice(0, 16) : '',
    description: description && typeof description === 'string' ? description.trim() : '',
    is_default: false,
    created_at: new Date().toISOString()
  };

  state.realms.push(newRealm);
  
  saveRealmToFirestore(newRealm).catch(err => console.error('[Firestore] Realm save error:', err));

  broadcast({
    type: 'realms_updated',
    realms: state.realms
  });

  res.status(201).json({ success: true, realm: newRealm, realms: state.realms });
});

// Users Count
app.get('/api/users/count', async (req, res) => {
  const users = await fetchAllUsersFromFirestore();
  res.json({ count: users.length });
});

// Admin: Update Club Realm
app.put('/api/admin/realms/:id', requireAdminAuth, (req, res) => {
  const targetIdStr = String(req.params.id || '').trim().toLowerCase();
  const index = state.realms.findIndex(r => r.id.toLowerCase() === targetIdStr);
  
  if (index === -1) {
    return res.status(404).json({ detail: 'Club realm not found' });
  }

  const { name, badge_color, icon, description, image_icon, short_name } = req.body || {};
  
  if (name && (typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 50)) {
    return res.status(400).json({ detail: 'Realm name must be between 2 and 50 characters' });
  }

  const hexRegex = /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/;
  
  const updatedRealm = {
    ...state.realms[index],
    name: name ? name.trim() : state.realms[index].name,
    badge_color: badge_color && hexRegex.test(badge_color.trim()) ? badge_color.trim() : state.realms[index].badge_color,
    icon: icon && typeof icon === 'string' && icon.trim().length > 0 ? icon.trim().slice(0, 8) : state.realms[index].icon,
    image_icon: image_icon !== undefined && typeof image_icon === 'string' ? image_icon.trim() : state.realms[index].image_icon,
    short_name: short_name !== undefined && typeof short_name === 'string' ? short_name.trim().slice(0, 16) : state.realms[index].short_name,
    description: description !== undefined && typeof description === 'string' ? description.trim() : state.realms[index].description
  };

  state.realms[index] = updatedRealm;
  
  
  // Assuming saveRealmToFirestore handles both create and update
  saveRealmToFirestore(updatedRealm).catch(err => console.error('[Firestore] Realm update error:', err));
  
  broadcast({
    type: 'realms_updated',
    realms: state.realms
  });
  
  res.json({ success: true, realm: updatedRealm, realms: state.realms });
});

// Admin: Remove Club Realm
app.delete('/api/admin/realms/:id', requireAdminAuth, (req, res) => {
  const targetParam = req.params.id;
  const targetId = Array.isArray(targetParam) ? targetParam[0] : targetParam;
  const targetIdStr = String(targetId || '').trim().toLowerCase();
  const index = state.realms.findIndex((r: ClubRealm) => r.id.toLowerCase() === targetIdStr || r.name.toLowerCase() === targetIdStr);

  if (index === -1) {
    return res.status(404).json({ detail: 'Club realm not found' });
  }

  const removed = state.realms.splice(index, 1)[0];
  

  broadcast({
    type: 'realms_updated',
    realms: state.realms,
    deleted_id: removed.id
  });

  res.json({ success: true, deleted: removed, realms: state.realms });
});

// 13. Full Persistent Data Backup (For deployment migration, restart sync, and automated backup)
app.get('/api/backup', (_req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.json({
    posts: state.posts,
    comments: state.comments,
    chatMessages: state.chatMessages,
    sessions: Array.from(state.sessions.values()),
    realms: state.realms,
    nextPostId: state.nextPostId,
    nextCommentId: state.nextCommentId,
    nextChatId: state.nextChatId,
  });
});

// 14. Restore Post (Self-healing endpoint if client detects a restarted server is missing a locally cached post)
app.post('/api/posts/restore', (req, res) => {
  const incoming = req.body as Post;
  if (incoming && incoming.id && incoming.title && incoming.content) {
    const existing = state.posts.find(p => p.id === incoming.id);
    if (!existing) {
      state.posts.unshift(incoming);
      state.nextPostId = Math.max(state.nextPostId, incoming.id + 1);
      
      savePostToFirestore(incoming).catch(err => console.error('[Firestore] Restore post error:', err));
      console.log(`Restored post #${incoming.id} ("${incoming.title}") from client cache`);
    }
  }
  res.json({ status: 'ok' });
});

// Static Files & SPA Fallback
const staticDir = path.resolve(process.cwd(), 'static');

app.use('/static', express.static(staticDir, {
  etag: false,
  maxAge: 0,
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
}));

const PLATFORM_VERSION = '1.3.0';
const PLATFORM_BUILD_TIMESTAMP = new Date().toISOString();

// Platform Version API for PWA update detection
app.get('/api/version', (_req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.json({
    version: PLATFORM_VERSION,
    buildTime: PLATFORM_BUILD_TIMESTAMP,
    timestamp: Date.now()
  });
});

// PWA Manifest Routes
app.get(['/manifest.json', '/manifest.webmanifest'], (_req, res) => {
  res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.sendFile(path.join(staticDir, 'manifest.json'));
});

// PWA Service Worker Route (Scoped to root '/')
app.get('/sw.js', (_req, res) => {
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.setHeader('Service-Worker-Allowed', '/');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile(path.join(staticDir, 'sw.js'));
});

// Root PWA Icons & Favicon
app.get(['/pwa-192x192.png', '/pwa-512x512.png', '/pwa-maskable-512x512.png', '/apple-touch-icon.png', '/favicon.png'], (req, res) => {
  const fileName = path.basename(req.path);
  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.sendFile(path.join(staticDir, fileName));
});

app.get(['/favicon.ico', '/icon.svg'], (req, res) => {
  const fileName = req.path.endsWith('.svg') ? 'icon.svg' : 'favicon.png';
  res.setHeader('Content-Type', req.path.endsWith('.svg') ? 'image/svg+xml' : 'image/png');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.sendFile(path.join(staticDir, fileName));
});

// Admin Page Route
app.get('/admin', (_req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.sendFile(path.join(staticDir, 'admin.html'));
});

app.get('/admin/*', (_req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.sendFile(path.join(staticDir, 'admin.html'));
});

app.get('/', (_req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.sendFile(path.join(staticDir, 'index.html'));
});



// HTTP & WebSocket Server Setup
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws: WebSocket) => {
  activeSockets.add(ws);
  broadcastPresence();

  ws.on('message', (data: Buffer | string) => {
    try {
      const msg = JSON.parse(data.toString());

      if (msg.type === 'auth') {
        const sessionId = msg.sessionId || msg.session_id;
        if (sessionId && state.sessions.has(sessionId)) {
          const session = state.sessions.get(sessionId)!;
          if (new Date(session.expires_at).getTime() > Date.now()) {
            socketSessions.set(ws, sessionId);
            session.last_active_at = new Date().toISOString();
            session.expires_at = new Date(Date.now() + SESSION_TTL_MS).toISOString();
            
            broadcastPresence();
            ws.send(JSON.stringify({ type: 'auth_success', session }));
          }
        }
      } else if (msg.type === 'ping') {
        const sessionId = socketSessions.get(ws);
        if (sessionId && state.sessions.has(sessionId)) {
          const s = state.sessions.get(sessionId)!;
          s.last_active_at = new Date().toISOString();
          s.expires_at = new Date(Date.now() + SESSION_TTL_MS).toISOString();
        }
        ws.send(JSON.stringify({ type: 'pong' }));
      } else if (msg.type === 'chat') {
        // Resolve authenticated session
        let session: Session | undefined;
        const sessionId = socketSessions.get(ws) || msg.sessionId || msg.payload?.sessionId;
        if (sessionId && state.sessions.has(sessionId)) {
          const candidate = state.sessions.get(sessionId)!;
          if (new Date(candidate.expires_at).getTime() > Date.now()) {
            session = candidate;
            socketSessions.set(ws, sessionId);
          }
        }

        if (!session) {
          ws.send(JSON.stringify({ type: 'error', detail: 'Session required or expired. Please sign in.', session_required: true }));
          return;
        }

        // Auto-refresh session on chat activity
        session.last_active_at = new Date().toISOString();
        session.expires_at = new Date(Date.now() + SESSION_TTL_MS).toISOString();
        

        const payload = msg.payload || {};
        const content = (payload.content || '').trim();
        if (content) {
          const extractedMentions: string[] = extractMentions(content);
          const extractedQuotes: string[] = extractQuotedAuthors(content);
          const allUsersToNotify = Array.from(new Set([...extractedMentions, ...extractedQuotes]));

          const newChat: ChatMessage = {
            id: state.nextChatId++,
            author: session.nickname,
            author_realm: normalizeRealm(session.realm),
            badge_color: payload.badge_color || '#EF4444',
            content,
            created_at: new Date().toISOString(),
            reactions: {},
            realm: normalizeRealm(session.realm),
            mentions: extractedMentions
          };
          state.chatMessages.push(newChat);
          
          saveChatMessageToFirestore(newChat).catch(err => console.error('[Firestore] WS chat save error:', err));
          
          if (allUsersToNotify.length > 0) {
            for (const notifyNick of allUsersToNotify) {
              const notification: Notification = {
                id: crypto.randomUUID(),
                userId: notifyNick,
                messageId: newChat.id,
                type: 'chat',
                read: false,
                created_at: new Date().toISOString()
              };
              saveNotificationToFirestore(notification).catch(err => console.error('[Firestore] Notification save error:', err));
              
              // Broadcast to specific user if connected
              for (const [ws, sessionId] of socketSessions.entries()) {
                const sess = state.sessions.get(sessionId);
                if (sess && sess.nickname === notifyNick && ws.readyState === WebSocket.OPEN) {
                  ws.send(JSON.stringify({ type: 'new_notification', data: notification }));
                }
              }
            }
          }

          broadcast({
            type: 'chat_message',
            data: newChat
          });
        }
      }
    } catch {
      // ignore invalid json
    }
  });

  ws.on('close', () => {
    activeSockets.delete(ws);
    socketSessions.delete(ws);
    broadcastPresence();
  });

  ws.on('error', () => {
    activeSockets.delete(ws);
    socketSessions.delete(ws);
  });
});

process.on('SIGTERM', () => {
  
  process.exit(0);
});

process.on('SIGINT', () => {
  
  process.exit(0);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Asynchronous startup sync: If running on Cloud Run or configured via environment,
// pull and merge any newer posts, comments, or sessions from the published platform so data is preserved.
async function syncLatestDataFromLive() {
  const targets = [
    process.env.LIVE_SYNC_URL,
    'https://ais-pre-qnosikih43z4b2cia7jex2-678307131241.europe-west1.run.app/api/backup',
    'https://ais-dev-qnosikih43z4b2cia7jex2-678307131241.europe-west1.run.app/api/backup',
  ].filter(Boolean) as string[];

  for (const syncUrl of targets) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 4000);
      const res = await fetch(syncUrl, { signal: controller.signal });
      clearTimeout(timer);
      if (!res.ok) continue;

      const data = await res.json() as any;
      if (!data || !Array.isArray(data.posts) || data.posts.length === 0) continue;

      let updated = false;
      const existingPostIds = new Set(state.posts.map(p => p.id));
      for (const post of data.posts) {
        if (!existingPostIds.has(post.id)) {
          state.posts.push(post);
          existingPostIds.add(post.id);
          updated = true;
        }
      }

      const existingCommentIds = new Set(state.comments.map(c => c.id));
      if (Array.isArray(data.comments)) {
        for (const comment of data.comments) {
          if (!existingCommentIds.has(comment.id)) {
            state.comments.push(comment);
            existingCommentIds.add(comment.id);
            updated = true;
          }
        }
      }

      const existingChatIds = new Set(state.chatMessages.map(m => m.id));
      if (Array.isArray(data.chatMessages)) {
        for (const chat of data.chatMessages) {
          if (!existingChatIds.has(chat.id)) {
            state.chatMessages.push(chat);
            existingChatIds.add(chat.id);
            updated = true;
          }
        }
      }

      if (Array.isArray(data.sessions)) {
        for (const s of data.sessions) {
          if (!state.sessions.has(s.id)) {
            state.sessions.set(s.id, s);
            updated = true;
          }
        }
      }

      if (Array.isArray(data.realms)) {
        for (const r of data.realms) {
          if (r && r.name && !state.realms.some(existing => existing.id === r.id || existing.name.toLowerCase() === r.name.toLowerCase())) {
            state.realms.push(r);
            updated = true;
          }
        }
      }

      if (updated) {
        state.nextPostId = Math.max(state.nextPostId, ...state.posts.map((p: Post) => p.id + 1));
        state.nextCommentId = Math.max(state.nextCommentId, ...state.comments.map(c => c.id + 1));
        state.nextChatId = Math.max(state.nextChatId, ...state.chatMessages.map(m => m.id + 1));
        
        console.log(`Synced and preserved live community data from ${syncUrl}: ${state.posts.length} posts, ${state.comments.length} comments, ${state.sessions.size} sessions`);
        break;
      }
    } catch {
      // Continue to next candidate
    }
  }
}

async function syncWithFirestore() {
  try {
    console.log('[Firestore] Initiating bi-directional Firestore synchronization...');
    const [fsPosts, fsComments, fsChats, fsSessions, fsRealms] = await Promise.allSettled([
      fetchAllPostsFromFirestore(),
      fetchAllCommentsFromFirestore(),
      fetchAllChatMessagesFromFirestore(),
      fetchAllSessionsFromFirestore(),
      fetchAllRealmsFromFirestore()
    ]);

    let updated = false;

    // 1. Sync Posts
    if (fsPosts.status === 'fulfilled' && Array.isArray(fsPosts.value) && fsPosts.value.length > 0) {
      const existingPostIds = new Set(state.posts.map(p => p.id));
      for (const p of fsPosts.value) {
        if (!existingPostIds.has(p.id)) {
          state.posts.push(p);
          existingPostIds.add(p.id);
          updated = true;
        } else {
          const localIndex = state.posts.findIndex(lp => lp.id === p.id);
          if (localIndex !== -1) {
            const local = state.posts[localIndex];
            const localTime = new Date(local.last_activity_at || local.created_at).getTime();
            const remoteTime = new Date(p.last_activity_at || p.created_at).getTime();
            if (remoteTime > localTime || p.upvotes > local.upvotes) {
              state.posts[localIndex] = p;
              updated = true;
            }
          }
        }
      }
    }

    // Seed missing local posts to Firestore
    const firestorePostIds = new Set(
      (fsPosts.status === 'fulfilled' && Array.isArray(fsPosts.value)) ? fsPosts.value.map(p => p.id) : []
    );
    for (const p of state.posts) {
      if (!firestorePostIds.has(p.id)) {
        savePostToFirestore(p).catch(e => console.warn('[Firestore] Failed seeding post:', e));
      }
    }

    // 2. Sync Comments
    if (fsComments.status === 'fulfilled' && Array.isArray(fsComments.value) && fsComments.value.length > 0) {
      const existingCommentIds = new Set(state.comments.map(c => c.id));
      for (const c of fsComments.value) {
        if (!existingCommentIds.has(c.id)) {
          state.comments.push(c);
          existingCommentIds.add(c.id);
          updated = true;
        }
      }
    }
    const firestoreCommentIds = new Set(
      (fsComments.status === 'fulfilled' && Array.isArray(fsComments.value)) ? fsComments.value.map(c => c.id) : []
    );
    for (const c of state.comments) {
      if (!firestoreCommentIds.has(c.id)) {
        saveCommentToFirestore(c).catch(e => console.warn('[Firestore] Failed seeding comment:', e));
      }
    }

    // 3. Sync Chat Messages
    if (fsChats.status === 'fulfilled' && Array.isArray(fsChats.value) && fsChats.value.length > 0) {
      const existingChatIds = new Set(state.chatMessages.map(m => m.id));
      for (const m of fsChats.value) {
        if (m && m.content && m.content.includes('Arsenal Finland FanSphere')) {
          m.content = m.content.replace(/Arsenal Finland FanSphere/g, 'Fansphere');
          saveChatMessageToFirestore(m).catch(() => {});
        }
        if (!existingChatIds.has(m.id)) {
          state.chatMessages.push(m);
          existingChatIds.add(m.id);
          updated = true;
        }
      }
    }
    // Ensure all existing in-memory chat messages are sanitized
    for (const m of state.chatMessages) {
      if (m && m.content && m.content.includes('Arsenal Finland FanSphere')) {
        m.content = m.content.replace(/Arsenal Finland FanSphere/g, 'Fansphere');
        updated = true;
        saveChatMessageToFirestore(m).catch(() => {});
      }
    }
    const firestoreChatIds = new Set(
      (fsChats.status === 'fulfilled' && Array.isArray(fsChats.value)) ? fsChats.value.map(m => m.id) : []
    );
    for (const m of state.chatMessages) {
      if (!firestoreChatIds.has(m.id)) {
        saveChatMessageToFirestore(m).catch(e => console.warn('[Firestore] Failed seeding chat:', e));
      }
    }

    // 4. Sync Sessions
    if (fsSessions.status === 'fulfilled' && Array.isArray(fsSessions.value) && fsSessions.value.length > 0) {
      for (const s of fsSessions.value) {
        if (!state.sessions.has(s.id)) {
          state.sessions.set(s.id, s);
          updated = true;
        }
      }
    }
    for (const s of state.sessions.values()) {
      saveSessionToFirestore(s).catch(e => console.warn('[Firestore] Failed seeding session:', e));
    }

    // 5. Sync Realms
    if (fsRealms.status === 'fulfilled' && Array.isArray(fsRealms.value) && fsRealms.value.length > 0) {
      for (const r of fsRealms.value) {
        if (!state.realms.some(existing => existing.id === r.id || existing.name.toLowerCase() === r.name.toLowerCase())) {
          state.realms.push(r);
          updated = true;
        }
      }
    }
    for (const r of state.realms) {
      saveRealmToFirestore(r).catch(e => console.warn('[Firestore] Failed seeding realm:', e));
    }

    if (updated) {
      state.nextPostId = Math.max(state.nextPostId, ...state.posts.map(p => p.id + 1));
      state.nextCommentId = Math.max(state.nextCommentId, ...state.comments.map((c: Comment) => c.id + 1));
      state.nextChatId = Math.max(state.nextChatId, ...state.chatMessages.map((m: ChatMessage) => m.id + 1));
      
      console.log(`[Firestore] Sync complete. Active posts: ${state.posts.length}, comments: ${state.comments.length}, chats: ${state.chatMessages.length}, sessions: ${state.sessions.size}`);
    } else {
      console.log(`[Firestore] Sync complete. In-sync with ${state.posts.length} posts and ${state.comments.length} comments.`);
    }
  } catch (err) {
    console.error('[Firestore] Error during Firestore sync:', err);
  }
}

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

app.get('/api/firebase/status', async (_req, res) => {
  res.json({
    connected: true,
    firestore_database_id: 'ai-studio-fansphere-0efd3258-52ad-4cbd-8135-986aaf14b0c7',
    posts_count: state.posts.length,
    comments_count: state.comments.length,
    chat_messages_count: state.chatMessages.length,
    realms_count: state.realms.length
  });
});

const PORT = 3000;
const HOST = '0.0.0.0';

// Catch-all for other non-API routes
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/ws')) {
    return next();
  }
  if (req.path === '/admin' || req.path.startsWith('/admin/')) {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    return res.sendFile(path.join(staticDir, 'admin.html'));
  }
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.sendFile(path.join(staticDir, 'index.html'));
});

server.listen(PORT, HOST, () => {
  console.log(`ready - started server on 0.0.0.0:${PORT}, url: http://localhost:${PORT}`);
  console.log(`  ➜  Local:   http://localhost:${PORT}/`);
  console.log(`  ➜  Network: http://${HOST}:${PORT}/`);
  console.log(`FanSphere server running at http://${HOST}:${PORT}`);
  syncWithFirestore().catch(() => {});
  syncLatestDataFromLive().catch(() => {});
});
