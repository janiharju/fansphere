import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import express from 'express';
import cors from 'cors';
import { WebSocketServer, WebSocket } from 'ws';
import multer from 'multer';
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
  loadUsersFromFirestore,
  saveNotificationToFirestore,
  updateNotificationReadStatusInFirestore,
  updateAllNotificationsReadStatusInFirestore,
  loadNotificationsFromFirestore,
  updatePostCommentCountInFirestore,
  db,
  storage
} from './firestoreService.js';
import { doc, getDoc } from 'firebase/firestore';


interface Team {
  id: string;
  name: string;
  short_name: string;
  logo: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  gf: number;
  ga: number;
  points: number;
  form: string[];
}

interface MatchEvent {
  min: number;
  team: string;
  player: string;
  type: string;
}

interface Match {
  id: string;
  home_team_id: string;
  away_team_id: string;
  home_score: number;
  away_score: number;
  minute: number;
  status: string;
  events: MatchEvent[];
}

interface Post {
  id: number;
  title: string;
  content: string;
  author: string;
  author_flair: string;
  tag: string;
  upvotes: number;
  downvotes: number;
  comment_count?: number;
  image_url: string;
  created_at: string;
  last_activity_at?: string;
}

interface Comment {
  id: number;
  post_id: number;
  parent_id: number | null;
  author: string;
  author_flair: string;
  content: string;
  upvotes: number;
  image_url?: string;
  created_at: string;
}

interface ChatMessage {
  id: number;
  room: string;
  author: string;
  author_flair: string;
  badge_color: string;
  content: string;
  created_at: string;
  reactions?: Record<string, string[]>;
  realm?: string;
  mentions?: string[];
}

interface Notification {
  id: string;
  userId: string;
  messageId: number;
  type: 'chat' | 'post' | 'comment';
  read: boolean;
  created_at: string;
}

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
function getInitialTeams(): Team[] {
  return [
    { id: 'ARS', name: 'Arsenal', short_name: 'Arsenal', logo: '🔴⚪', played: 28, won: 20, drawn: 5, lost: 3, gf: 64, ga: 22, points: 65, form: ['W', 'W', 'D', 'W', 'W'] },
    { id: 'MCI', name: 'Manchester City', short_name: 'Man City', logo: '🩵⚪', played: 28, won: 19, drawn: 6, lost: 3, gf: 63, ga: 26, points: 63, form: ['W', 'D', 'W', 'W', 'W'] },
    { id: 'LIV', name: 'Liverpool', short_name: 'Liverpool', logo: '🔴🔴', played: 28, won: 19, drawn: 5, lost: 4, gf: 62, ga: 25, points: 62, form: ['W', 'W', 'L', 'W', 'D'] },
    { id: 'AVL', name: 'Aston Villa', short_name: 'Aston Villa', logo: '🟣🩵', played: 28, won: 16, drawn: 5, lost: 7, gf: 52, ga: 35, points: 53, form: ['L', 'W', 'W', 'D', 'W'] },
    { id: 'CHE', name: 'Chelsea', short_name: 'Chelsea', logo: '🔵⚪', played: 28, won: 14, drawn: 7, lost: 7, gf: 49, ga: 36, points: 49, form: ['D', 'W', 'W', 'L', 'D'] },
    { id: 'NEW', name: 'Newcastle United', short_name: 'Newcastle', logo: '⚪⚫', played: 28, won: 14, drawn: 5, lost: 9, gf: 48, ga: 38, points: 47, form: ['W', 'L', 'W', 'W', 'L'] },
    { id: 'TOT', name: 'Tottenham Hotspur', short_name: 'Tottenham', logo: '⚪⚪', played: 28, won: 13, drawn: 5, lost: 10, gf: 50, ga: 42, points: 44, form: ['L', 'L', 'W', 'D', 'W'] },
    { id: 'BHA', name: 'Brighton & Hove Albion', short_name: 'Brighton', logo: '🔵⚪', played: 28, won: 11, drawn: 8, lost: 9, gf: 43, ga: 40, points: 41, form: ['D', 'W', 'D', 'L', 'W'] },
    { id: 'FUL', name: 'Fulham', short_name: 'Fulham', logo: '⚪⚫', played: 28, won: 11, drawn: 6, lost: 11, gf: 41, ga: 41, points: 39, form: ['W', 'D', 'L', 'W', 'L'] },
    { id: 'MUN', name: 'Manchester United', short_name: 'Man Utd', logo: '🔴⚫', played: 28, won: 10, drawn: 6, lost: 12, gf: 38, ga: 42, points: 36, form: ['L', 'D', 'W', 'L', 'L'] },
    { id: 'BOU', name: 'AFC Bournemouth', short_name: 'Bournemouth', logo: '🔴⚫', played: 28, won: 9, drawn: 8, lost: 11, gf: 40, ga: 44, points: 35, form: ['W', 'L', 'D', 'D', 'W'] },
    { id: 'WHU', name: 'West Ham United', short_name: 'West Ham', logo: '🍷🩵', played: 28, won: 9, drawn: 7, lost: 12, gf: 37, ga: 48, points: 34, form: ['L', 'W', 'L', 'D', 'D'] },
    { id: 'BRE', name: 'Brentford', short_name: 'Brentford', logo: '🔴⚪', played: 28, won: 9, drawn: 5, lost: 14, gf: 45, ga: 52, points: 32, form: ['L', 'L', 'W', 'L', 'D'] },
    { id: 'CRY', name: 'Crystal Palace', short_name: 'Crystal Palace', logo: '🔴🔵', played: 28, won: 7, drawn: 10, lost: 11, gf: 33, ga: 43, points: 31, form: ['D', 'D', 'L', 'W', 'D'] },
    { id: 'EVE', name: 'Everton', short_name: 'Everton', logo: '🔵⚪', played: 28, won: 7, drawn: 9, lost: 12, gf: 30, ga: 41, points: 30, form: ['D', 'W', 'L', 'D', 'L'] },
    { id: 'NFO', name: 'Nottingham Forest', short_name: 'Nottm Forest', logo: '🔴⚪', played: 28, won: 7, drawn: 7, lost: 14, gf: 32, ga: 49, points: 28, form: ['W', 'L', 'L', 'D', 'L'] },
    { id: 'WOL', name: 'Wolverhampton Wanderers', short_name: 'Wolves', logo: '🟡⚫', played: 28, won: 7, drawn: 6, lost: 15, gf: 36, ga: 54, points: 27, form: ['L', 'L', 'L', 'W', 'L'] },
    { id: 'IPS', name: 'Ipswich Town', short_name: 'Ipswich', logo: '🔵⚪', played: 28, won: 4, drawn: 9, lost: 15, gf: 27, ga: 56, points: 21, form: ['L', 'D', 'L', 'L', 'D'] },
    { id: 'LEI', name: 'Leicester City', short_name: 'Leicester', logo: '🔵⚪', played: 28, won: 4, drawn: 7, lost: 17, gf: 29, ga: 61, points: 19, form: ['L', 'L', 'D', 'L', 'L'] },
    { id: 'SOU', name: 'Southampton', short_name: 'Southampton', logo: '🔴⚪', played: 28, won: 2, drawn: 4, lost: 22, gf: 19, ga: 68, points: 10, form: ['L', 'L', 'L', 'L', 'L'] },
  ];
}

function getInitialMatches(): Match[] {
  return [
    {
      id: 'm1',
      home_team_id: 'ARS',
      away_team_id: 'CHE',
      home_score: 2,
      away_score: 1,
      minute: 74,
      status: 'LIVE',
      events: [
        { min: 18, team: 'ARS', player: 'Saka', type: 'GOAL' },
        { min: 42, team: 'CHE', player: 'Palmer', type: 'GOAL' },
        { min: 63, team: 'ARS', player: 'Havertz', type: 'GOAL' }
      ]
    },
    {
      id: 'm2',
      home_team_id: 'MCI',
      away_team_id: 'NEW',
      home_score: 1,
      away_score: 1,
      minute: 68,
      status: 'LIVE',
      events: [
        { min: 24, team: 'NEW', player: 'Isak', type: 'GOAL' },
        { min: 55, team: 'MCI', player: 'Haaland', type: 'GOAL' }
      ]
    },
    {
      id: 'm3',
      home_team_id: 'LIV',
      away_team_id: 'TOT',
      home_score: 0,
      away_score: 0,
      minute: 0,
      status: 'UPCOMING',
      events: []
    }
  ];
}

function getInitialPosts(): Post[] {
  return [];
}

function getInitialComments(): Comment[] {
  return [];
}

function getInitialChatMessages(): ChatMessage[] {
  return [];
}

// ==================== SESSION & PERSISTENT FILE-BACKED DATA STORE ====================
// Configurable data path: allows persistent volumes (e.g. /app/data, /mnt/data, or custom volume mounts)
const DATA_DIR = process.env.DATA_DIR 
  ? path.resolve(process.env.DATA_DIR) 
  : path.resolve(process.cwd(), 'data');
const DATA_FILE = process.env.STORE_FILE_PATH 
  ? path.resolve(process.env.STORE_FILE_PATH) 
  : path.join(DATA_DIR, 'store.json');
const BACKUP_FILE = path.join(DATA_DIR, 'store.backup.json');

export interface Session {
  id: string;
  nickname: string;
  email: string;
  flair: string;
  created_at: string;
  last_active_at: string;
  expires_at: string;
}

const SESSION_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours of inactivity before expiration
const ACTIVE_WINDOW_MS = 10 * 60 * 1000; // 10 minutes of recent activity for online presence

export function normalizeFlair(flair: string | undefined): string {
  if (!flair) return 'Arsenal Finland Official Member';
  const str = String(flair).trim().toLowerCase();
  if (str.includes('tester')) return 'Testers';
  if (str.includes('neutral')) return 'Neutral Football Fan';
  if (str.includes('Arsenal Finland') || str.includes('gunner') || str.includes('gooner') || str.includes('arsenal') || str.includes('official')) {
    return 'Arsenal Finland Official Member';
  }
  if (typeof realms !== 'undefined' && Array.isArray(realms)) {
    const matched = realms.find(r => r.name.toLowerCase() === str || r.id.toLowerCase() === str);
    if (matched) return matched.name;
  }
  return 'Arsenal Finland Official Member';
}

function getInitialSessions(): Session[] {
  const now = Date.now();
  const twoHours = SESSION_TTL_MS;
  return [
    {
      id: 'sess-helsinki-gunner',
      nickname: 'HelsinkiGunner',
      email: 'helsinki.gunner@ArsenalFinland.fi',
      flair: 'Arsenal Finland Official Member',
      created_at: new Date(now - 3600000).toISOString(),
      last_active_at: new Date(now - 60000).toISOString(),
      expires_at: new Date(now + twoHours).toISOString()
    },
    {
      id: 'sess-tampere-gooner',
      nickname: 'TampereGooner',
      email: 'tampere.gooner@ArsenalFinland.fi',
      flair: 'Arsenal Finland Official Member',
      created_at: new Date(now - 7200000).toISOString(),
      last_active_at: new Date(now - 120000).toISOString(),
      expires_at: new Date(now + twoHours).toISOString()
    },
    {
      id: 'sess-arsefin-admin',
      nickname: 'ArsenalFinlandAdmin',
      email: 'admin@ArsenalFinland.fi',
      flair: 'Arsenal Finland Official Member',
      created_at: new Date(now - 10000000).toISOString(),
      last_active_at: new Date(now - 30000).toISOString(),
      expires_at: new Date(now + twoHours).toISOString()
    },
    {
      id: 'sess-turku-tester',
      nickname: 'TurkuTester',
      email: 'tester.turku@ArsenalFinland.fi',
      flair: 'Testers',
      created_at: new Date(now - 4000000).toISOString(),
      last_active_at: new Date(now - 180000).toISOString(),
      expires_at: new Date(now + twoHours).toISOString()
    }
  ];
}

export interface ClubRealm {
  id: string;
  name: string;
  badge_color: string;
  icon: string;
  description?: string;
  is_default?: boolean;
  created_at: string;
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function getInitialRealms(): ClubRealm[] {
  const now = new Date().toISOString();
  return [
    {
      id: 'Arsenal Finland-official',
      name: 'Arsenal Finland Official Member',
      badge_color: '#EF4444',
      icon: '🔴',
      description: 'Official verified Arsenal Finland community members and supporters',
      is_default: true,
      created_at: now
    },
    {
      id: 'neutral-football-fan',
      name: 'Neutral Football Fan',
      badge_color: '#94A3B8',
      icon: '⚪',
      description: 'Neutral fans, tacticians, and general football supporters',
      is_default: false,
      created_at: now
    },
    {
      id: 'testers',
      name: 'Testers',
      badge_color: '#A855F7',
      icon: '🧪',
      description: 'Test realm for quality assurance and feature verification',
      is_default: false,
      created_at: now
    }
  ];
}

export interface UserReadState {
  last_read_at: string;
  comment_count: number;
}

interface StoredData {
  posts: Post[];
  comments: Comment[];
  chatMessages: ChatMessage[];
  sessions?: Session[];
  realms?: ClubRealm[];
  userReadStates?: Record<string, Record<string, UserReadState>>;
  nextPostId: number;
  nextCommentId: number;
  nextChatId: number;
}

const CANDIDATE_FILES = Array.from(new Set([
  DATA_FILE,
  BACKUP_FILE,
  path.resolve(process.cwd(), 'data', 'store.json'),
  path.resolve(process.cwd(), 'data', 'store.backup.json'),
  path.resolve('/app/data/store.json'),
  path.resolve('/app/data/store.backup.json'),
  path.resolve('/app/applet/data/store.json'),
  path.resolve('/app/applet/data/store.backup.json'),
  path.resolve('/tmp/fansphere_store.json'),
  path.resolve('/tmp/fansphere_store_backup.json')
]));

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function saveDataSync(data: StoredData) {
  try {
    ensureDataDir();
    const serialized = JSON.stringify(data, null, 2);

    try {
      const tempFile = `${DATA_FILE}.tmp`;
      fs.writeFileSync(tempFile, serialized, 'utf-8');
      fs.renameSync(tempFile, DATA_FILE);
    } catch (e) {
      console.error(`Failed to write DATA_FILE at ${DATA_FILE}:`, e);
    }

    // Mirror to secondary backups and /tmp to ensure data survives any restart
    for (const target of CANDIDATE_FILES) {
      if (target === DATA_FILE) continue;
      try {
        const dir = path.dirname(target);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        const temp = `${target}.tmp`;
        fs.writeFileSync(temp, serialized, 'utf-8');
        fs.renameSync(temp, target);
      } catch {
        // non-blocking
      }
    }
  } catch (err) {
    console.error('Error saving persistent store to disk:', err);
  }
}

let saveTimer: NodeJS.Timeout | null = null;
function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveDataSync({
      posts,
      comments,
      chatMessages,
      sessions: Array.from(sessions.values()),
      realms,
      userReadStates: Object.fromEntries(userReadStates.entries()),
      nextPostId,
      nextCommentId,
      nextChatId,
    });
    saveTimer = null;
  }, 100);
}

function forceSaveNow() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  saveDataSync({
    posts,
    comments,
    chatMessages,
    sessions: Array.from(sessions.values()),
    realms,
    userReadStates: Object.fromEntries(userReadStates.entries()),
    nextPostId,
    nextCommentId,
    nextChatId,
  });
}

function parseStoreFile(filePath: string): StoredData | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed.posts) && Array.isArray(parsed.comments) && Array.isArray(parsed.chatMessages)) {
      const maxPostId = parsed.posts.reduce((max: number, p: Post) => Math.max(max, p.id || 0), 0);
      const maxCommentId = parsed.comments.reduce((max: number, c: Comment) => Math.max(max, c.id || 0), 0);
      const maxChatId = parsed.chatMessages.reduce((max: number, m: ChatMessage) => Math.max(max, m.id || 0), 0);
      return {
        posts: parsed.posts,
        comments: parsed.comments,
        chatMessages: parsed.chatMessages,
        sessions: Array.isArray(parsed.sessions) ? parsed.sessions : getInitialSessions(),
        realms: Array.isArray(parsed.realms) ? parsed.realms : getInitialRealms(),
        userReadStates: (parsed.userReadStates && typeof parsed.userReadStates === 'object') ? parsed.userReadStates : {},
        nextPostId: Math.max(parsed.nextPostId || 1, maxPostId + 1),
        nextCommentId: Math.max(parsed.nextCommentId || 1, maxCommentId + 1),
        nextChatId: Math.max(parsed.nextChatId || 1, maxChatId + 1),
      };
    }
  } catch (err) {
    console.error(`Could not parse ${filePath}:`, err);
  }
  return null;
}

function mergeStores(stores: StoredData[]): StoredData {
  const mergedPostsMap = new Map<number, Post>();
  const mergedCommentsMap = new Map<number, Comment>();
  const mergedChatMap = new Map<number, ChatMessage>();
  const mergedSessionsMap = new Map<string, Session>();
  const mergedRealmsMap = new Map<string, ClubRealm>();
  const mergedUserReadStates: Record<string, Record<string, UserReadState>> = {};
  let maxPostId = 1;
  let maxCommentId = 1;
  let maxChatId = 1;

  const SEED_POST_IDS = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  const SEED_COMMENT_IDS = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  const SEED_CHAT_IDS = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17]);

  for (const s of stores) {
    if (!s) continue;
    if (Array.isArray(s.posts)) {
      for (const p of s.posts) {
        if (!p || !p.id || SEED_POST_IDS.has(p.id)) continue;
        const existing = mergedPostsMap.get(p.id);
        if (!existing || new Date(p.last_activity_at || p.created_at).getTime() >= new Date(existing.last_activity_at || existing.created_at).getTime()) {
          mergedPostsMap.set(p.id, p);
        }
        maxPostId = Math.max(maxPostId, p.id + 1);
      }
    }
    if (Array.isArray(s.comments)) {
      for (const c of s.comments) {
        if (!c || !c.id || SEED_COMMENT_IDS.has(c.id)) continue;
        mergedCommentsMap.set(c.id, c);
        maxCommentId = Math.max(maxCommentId, c.id + 1);
      }
    }
    if (Array.isArray(s.chatMessages)) {
      for (const m of s.chatMessages) {
        if (!m || !m.id || SEED_CHAT_IDS.has(m.id)) continue;
        mergedChatMap.set(m.id, m);
        maxChatId = Math.max(maxChatId, m.id + 1);
      }
    }
    if (Array.isArray(s.sessions)) {
      for (const sess of s.sessions) {
        if (!sess || !sess.id) continue;
        mergedSessionsMap.set(sess.id, sess);
      }
    }
    if (Array.isArray(s.realms)) {
      for (const r of s.realms) {
        if (!r || !r.name) continue;
        const key = r.id || slugify(r.name);
        if (!mergedRealmsMap.has(key)) {
          mergedRealmsMap.set(key, { ...r, id: key });
        }
      }
    }
    if (s.userReadStates && typeof s.userReadStates === 'object') {
      for (const [userKey, postMap] of Object.entries(s.userReadStates)) {
        if (!postMap || typeof postMap !== 'object') continue;
        const uKey = userKey.toLowerCase();
        if (!mergedUserReadStates[uKey]) mergedUserReadStates[uKey] = {};
        for (const [postId, stateObj] of Object.entries(postMap)) {
          if (!stateObj) continue;
          const existing = mergedUserReadStates[uKey][postId];
          if (!existing || new Date(stateObj.last_read_at).getTime() >= new Date(existing.last_read_at).getTime()) {
            mergedUserReadStates[uKey][postId] = stateObj;
          }
        }
      }
    }
    maxPostId = Math.max(maxPostId, s.nextPostId || 1);
    maxCommentId = Math.max(maxCommentId, s.nextCommentId || 1);
    maxChatId = Math.max(maxChatId, s.nextChatId || 1);
  }

  if (mergedPostsMap.size === 0) {
    for (const p of getInitialPosts()) mergedPostsMap.set(p.id, p);
  }
  if (mergedCommentsMap.size === 0) {
    for (const c of getInitialComments()) mergedCommentsMap.set(c.id, c);
  }
  if (mergedChatMap.size === 0) {
    for (const m of getInitialChatMessages()) mergedChatMap.set(m.id, m);
  }
  if (mergedSessionsMap.size === 0) {
    for (const s of getInitialSessions()) mergedSessionsMap.set(s.id, s);
  }
  if (mergedRealmsMap.size === 0) {
    for (const r of getInitialRealms()) mergedRealmsMap.set(r.id, r);
  }

  const postsList = Array.from(mergedPostsMap.values()).sort((a, b) => b.id - a.id);
  const commentsList = Array.from(mergedCommentsMap.values()).sort((a, b) => a.id - b.id);
  const chatList = Array.from(mergedChatMap.values()).sort((a, b) => a.id - b.id);
  const sessionList = Array.from(mergedSessionsMap.values());
  const realmList = Array.from(mergedRealmsMap.values());

  return {
    posts: postsList,
    comments: commentsList,
    chatMessages: chatList,
    sessions: sessionList,
    realms: realmList,
    userReadStates: mergedUserReadStates,
    nextPostId: Math.max(maxPostId, ...postsList.map(p => p.id + 1), 1),
    nextCommentId: Math.max(maxCommentId, ...commentsList.map(c => c.id + 1), 1),
    nextChatId: Math.max(maxChatId, ...chatList.map(m => m.id + 1), 1)
  };
}

function loadInitialStore(): StoredData {
  ensureDataDir();

  const validStores: StoredData[] = [];
  for (const candidate of CANDIDATE_FILES) {
    const parsed = parseStoreFile(candidate);
    if (parsed) validStores.push(parsed);
  }

  if (validStores.length > 0) {
    const merged = mergeStores(validStores);
    console.log(`Loaded and merged ${merged.posts.length} posts, ${merged.comments.length} comments, and ${merged.chatMessages.length} chat messages from ${validStores.length} storage candidate(s)`);
    saveDataSync(merged);
    return merged;
  }

  // 3. Fallback to initial seed only if no store exists anywhere
  const initial: StoredData = {
    posts: getInitialPosts(),
    comments: getInitialComments(),
    chatMessages: getInitialChatMessages(),
    sessions: getInitialSessions(),
    realms: getInitialRealms(),
    userReadStates: {},
    nextPostId: 1,
    nextCommentId: 1,
    nextChatId: 1,
  };
  saveDataSync(initial);
  console.log(`Initialized persistent store with default seed at ${DATA_FILE}`);
  return initial;
}

const storedData = loadInitialStore();
let teams: Team[] = getInitialTeams();
let matches: Match[] = getInitialMatches();
let posts: Post[] = storedData.posts;
let comments: Comment[] = storedData.comments;
let chatMessages: ChatMessage[] = storedData.chatMessages;
let realms: ClubRealm[] = (storedData.realms && storedData.realms.length > 0) ? storedData.realms : getInitialRealms();

const userReadStates = new Map<string, Record<string, UserReadState>>();
if (storedData.userReadStates) {
  for (const [uKey, states] of Object.entries(storedData.userReadStates)) {
    if (states && typeof states === 'object') {
      userReadStates.set(uKey.toLowerCase(), states);
    }
  }
}


// Sanitize defunct ephemeral upload URLs that no longer exist on container disk
for (const p of posts) {
  if (p.image_url && p.image_url.startsWith('/static/uploads/')) {
    const localPath = path.resolve(process.cwd(), p.image_url.replace(/^\//, ''));
    if (!fs.existsSync(localPath)) {
      p.image_url = '';
    }
  }
}
for (const c of comments) {
  if (c.image_url && c.image_url.startsWith('/static/uploads/')) {
    const localPath = path.resolve(process.cwd(), c.image_url.replace(/^\//, ''));
    if (!fs.existsSync(localPath)) {
      c.image_url = '';
    }
  }
}

const sessions = new Map<string, Session>();
for (const s of (storedData.sessions || getInitialSessions())) {
  sessions.set(s.id, s);
}
const users = new Map<string, any>();


let nextPostId = storedData.nextPostId;
let nextCommentId = storedData.nextCommentId;
let nextChatId = storedData.nextChatId;

function getStandings() {
  const standings = teams.map((team) => {
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
app.use(cors());
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

  for (const session of sessions.values()) {
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
    active_users: active.map(s => ({ nickname: s.nickname, flair: s.flair }))
  });
}

function getSessionFromReq(req: express.Request): Session | null {
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
  scheduleSave();

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
  for (const c of comments) {
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
  return comments.filter(c => c.post_id === postId).length;
}

// ==================== REST APIS ====================

// -1. Persistent Store Backup & Export API (Used by Cloud Build & Publishing pipeline)
app.get('/api/backup', (_req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Content-Type', 'application/json');
  if (fs.existsSync(DATA_FILE)) {
    try {
      const content = fs.readFileSync(DATA_FILE, 'utf-8');
      return res.send(content);
    } catch {
      // fallback to memory
    }
  }
  res.json({
    posts,
    comments,
    chatMessages,
    sessions: Array.from(sessions.values()),
    userReadStates: Object.fromEntries(userReadStates.entries()),
    nextPostId,
    nextCommentId,
    nextChatId
  });
});

app.get('/api/admin/store-backup', (_req, res) => {
  res.redirect('/api/backup');
});

app.post('/api/admin/store-restore', (req, res) => {
  const payload = req.body as StoredData;
  if (!payload || !Array.isArray(payload.posts)) {
    return res.status(400).json({ error: 'Invalid store payload' });
  }

  posts = payload.posts;
  comments = Array.isArray(payload.comments) ? payload.comments : [];
  chatMessages = Array.isArray(payload.chatMessages) ? payload.chatMessages : [];
  if (Array.isArray(payload.sessions)) {
    sessions.clear();
    for (const s of payload.sessions) {
      sessions.set(s.id, s);
    }
  }
  nextPostId = payload.nextPostId || Math.max(0, ...posts.map(p => p.id)) + 1;
  nextCommentId = payload.nextCommentId || Math.max(0, ...comments.map(c => c.id)) + 1;
  nextChatId = payload.nextChatId || Math.max(0, ...chatMessages.map(m => m.id)) + 1;

  forceSaveNow();
  broadcastPresence();
  res.json({ success: true, message: 'Store restored successfully', postCount: posts.length });
});

// 0. Session & Authentication Endpoints

// 0a. Create Session (Nickname + Email)
app.post('/api/auth/session', async (req, res) => {
  if (req.headers['x-session-id']) {
    return handleSessionUpdate(req, res);
  }
  const { nickname, email, flair } = req.body;

  if (!nickname || typeof nickname !== 'string' || nickname.trim().length < 2 || nickname.trim().length > 30) {
    return res.status(400).json({ detail: 'Nickname must be between 2 and 30 characters' });
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!email || typeof email !== 'string' || !emailRegex.test(email.trim())) {
    return res.status(400).json({ detail: 'Please enter a valid email address' });
  }

  const cleanNickname = nickname.trim().toLowerCase();
  const cleanEmail = email.trim().toLowerCase();
  const cleanFlair = normalizeFlair(flair);

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
    flair: cleanFlair,
    created_at: new Date(now).toISOString(),
    last_active_at: new Date(now).toISOString(),
    expires_at: new Date(now + SESSION_TTL_MS).toISOString()
  };

  sessions.set(sessionId, session);
  forceSaveNow();
  saveSessionToFirestore(session).catch(err => console.error('[Firestore] Session save error:', err));
  saveUserToFirestore({
    email: session.email,
    nickname: session.nickname,
    flair: session.flair,
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

  const session = sessions.get(sessionId);
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
  scheduleSave();
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

  const { nickname, email, flair } = req.body;

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


  if (flair !== undefined && typeof flair === 'string' && flair.trim().length > 0) {
    session.flair = normalizeFlair(flair);
  }

  session.last_active_at = new Date().toISOString();
  session.expires_at = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  forceSaveNow();
  saveSessionToFirestore(session).catch(err => console.error('[Firestore] Session update error:', err));
  saveUserToFirestore({
    email: session.email,
    nickname: session.nickname,
    flair: session.flair,
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

  if (sessionId && sessions.has(sessionId)) {
    sessions.delete(sessionId);
    forceSaveNow();
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
    active_users: active.map(s => ({ nickname: s.nickname, flair: s.flair }))
  });
});

// Helper to determine if an author's club tag/flair matches a selected Realm
export function matchClubRealm(authorFlair: string | undefined, selectedRealm: string | undefined): boolean {
  if (!selectedRealm || selectedRealm.toLowerCase() === 'all') return true;
  if (!authorFlair) return false;

  const a = authorFlair.trim().toLowerCase();
  const b = selectedRealm.trim().toLowerCase();
  if (a === b) return true;

  // Testers realm
  if (b.includes('tester')) {
    return a.includes('tester');
  }

  // Neutral Football Fan realm
  if (b.includes('neutral')) {
    return a.includes('neutral');
  }

  // Arsenal Finland official club realm
  const arsenalFinlandVariants = ['Arsenal Finland', 'arsenal', 'gunner', 'gooner', 'official', 'member'];
  if (arsenalFinlandVariants.some(v => b.includes(v))) {
    return arsenalFinlandVariants.some(v => a.includes(v));
  }

  // Dynamic registered realms matching
  const dynamicRealm = realms.find(r => r.name.toLowerCase() === b || r.id.toLowerCase() === b);
  if (dynamicRealm) {
    const dynName = dynamicRealm.name.toLowerCase();
    const dynId = dynamicRealm.id.toLowerCase();
    return a === dynName || a === dynId || slugify(a) === dynId || a.includes(dynName) || dynName.includes(a);
  }

  return a.includes(b) || b.includes(a);
}

// 1. Posts List (Always sorted by latest changes including comments, filterable by tag, club realm, and search query)
app.get('/api/posts', (req, res) => {
  const tag = req.query.tag as string | undefined;
  const realm = req.query.realm as string | undefined;
  const q = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : '';

  let filtered = [...posts];
  if (tag && tag.toLowerCase() !== 'all') {
    filtered = filtered.filter(p => p.tag.toLowerCase() === tag.toLowerCase());
  }
  if (realm && realm.toLowerCase() !== 'all') {
    filtered = filtered.filter(p => matchClubRealm(p.author_flair, realm));
  }

  // Filter posts and comments by search keywords within the selected realm
  const matchingCommentsMap = new Map<number, Comment[]>();
  if (q) {
    filtered = filtered.filter(p => {
      const titleMatch = p.title.toLowerCase().includes(q);
      const contentMatch = p.content.toLowerCase().includes(q);
      const postComments = comments.filter(c => c.post_id === p.id && c.content.toLowerCase().includes(q));
      if (postComments.length > 0) {
        matchingCommentsMap.set(p.id, postComments);
      }
      return titleMatch || contentMatch || postComments.length > 0;
    });
  }

  const session = getSessionFromReq(req);
  const userKey = getUserIdentifier(req, session);
  const userStates = userKey ? (userReadStates.get(userKey) || {}) : null;
  const userNickname = session ? session.nickname.toLowerCase() : (typeof req.headers['x-user-nickname'] === 'string' ? req.headers['x-user-nickname'].trim().toLowerCase() : '');

  // Always sort forum feed by latest changes, taking comments into account
  const mapped = filtered.map(p => {
    const latestActivityTime = getPostLatestActivityTime(p);
    const matchedComments = matchingCommentsMap.get(p.id) || [];
    const totalComments = getDynamicCommentCount(p.id);

    let isUnread = false;
    let unreadCommentsCount = 0;

    if (userKey) {
      const postComments = comments.filter(c => c.post_id === p.id);
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
        author_flair: c.author_flair,
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
  const assignedPostId = Math.max(nextPostId++, ...posts.map(p => p.id + 1), 1);
  nextPostId = assignedPostId + 1;
  const newPost: Post = {
    id: assignedPostId,
    title: title.trim(),
    content: content.trim(),
    author: session.nickname,
    author_flair: session.flair || 'Arsenal Finland Official Member',
    tag: tag ? String(tag).trim() : 'Discussion',
    upvotes: 1,
    downvotes: 0,
    image_url: cleanImageUrl,
    created_at: nowIso,
    last_activity_at: nowIso
  };

  posts.unshift(newPost);

  // Automatically mark thread as read for its creator
  const creatorKey = (session.email || session.nickname).toLowerCase();
  let creatorMap = userReadStates.get(creatorKey);
  if (!creatorMap) {
    creatorMap = {};
    userReadStates.set(creatorKey, creatorMap);
  }
  creatorMap[String(assignedPostId)] = {
    last_read_at: nowIso,
    comment_count: 0
  };

  forceSaveNow();
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
        const sess = sessions.get(sessionId);
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




app.get('/api/posts/:id', (req, res) => {
  const postId = parseInt(req.params.id, 10);
  const post = posts.find(p => p.id === postId);

  if (!post) {
    return res.status(404).json({ detail: 'Post not found' });
  }

  const postComments = comments
    .filter(c => c.post_id === postId)
    .sort((a, b) => {
      if (b.upvotes !== a.upvotes) return b.upvotes - a.upvotes;
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    });

  const session = getSessionFromReq(req);
  const userKey = getUserIdentifier(req, session);
  if (userKey) {
    let uMap = userReadStates.get(userKey);
    if (!uMap) {
      uMap = {};
      userReadStates.set(userKey, uMap);
    }
    uMap[String(postId)] = {
      last_read_at: new Date().toISOString(),
      comment_count: postComments.length
    };
    scheduleSave();
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

  if (isNaN(postId)) {
    return res.status(400).json({ error: 'Invalid post ID' });
  }

  const post = posts.find(p => p.id === postId);
  if (!post) {
    return res.status(404).json({ error: 'Post not found' });
  }

  const currentCommentCount = comments.filter(c => c.post_id === postId).length;
  const nowIso = new Date().toISOString();

  if (userKey) {
    let userMap = userReadStates.get(userKey);
    if (!userMap) {
      userMap = {};
      userReadStates.set(userKey, userMap);
    }
    userMap[String(postId)] = {
      last_read_at: nowIso,
      comment_count: currentCommentCount
    };
    scheduleSave();
  }

  res.json({
    success: true,
    post_id: postId,
    read_state: userKey ? (userReadStates.get(userKey)?.[String(postId)] || null) : null
  });
});

// Get user read states
app.get('/api/posts-read-states', (req, res) => {
  const session = getSessionFromReq(req);
  const userKey = getUserIdentifier(req, session);
  if (!userKey) {
    return res.json({ read_states: {} });
  }
  const userMap = userReadStates.get(userKey) || {};
  res.json({ read_states: userMap });
});

// 4. Vote on Post
app.post('/api/posts/:id/vote', (req, res) => {
  const postId = parseInt(req.params.id, 10);
  const post = posts.find(p => p.id === postId);

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

  forceSaveNow();
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

  const postId = parseInt(req.params.id, 10);
  const post = posts.find(p => p.id === postId);

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

  const assignedCommentId = Math.max(nextCommentId++, ...comments.map(c => c.id + 1), 1);
  nextCommentId = assignedCommentId + 1;
  const comment: Comment = {
    id: assignedCommentId,
    post_id: postId,
    parent_id: parent_id ? parseInt(parent_id, 10) : null,
    author: session.nickname,
    author_flair: session.flair || 'Arsenal Finland Official Member',
    content: content.trim(),
    upvotes: 1,
    image_url: cleanCommentImageUrl,
    created_at: new Date().toISOString()
  };

  comments.push(comment);
  const nowIso = comment.created_at;
  post.last_activity_at = nowIso;
  const currentCommentCount = getDynamicCommentCount(postId);

  // Automatically mark thread as read for commenter up to current comments count
  const commenterKey = (session.email || session.nickname).toLowerCase();
  let commenterMap = userReadStates.get(commenterKey);
  if (!commenterMap) {
    commenterMap = {};
    userReadStates.set(commenterKey, commenterMap);
  }
  commenterMap[String(postId)] = {
    last_read_at: nowIso,
    comment_count: currentCommentCount
  };

  forceSaveNow();
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
        const sess = sessions.get(sessionId);
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
  const comment = comments.find(c => c.id === commentId);

  if (!comment) {
    return res.status(404).json({ detail: 'Comment not found' });
  }

  comment.upvotes += 1;
  scheduleSave();
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
  const room = (req.query.room as string) || 'general';
  const realm = req.query.realm as string | undefined;
  const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 100;

  const chatMessagesFromFirestore = await fetchAllChatMessagesFromFirestore();
  chatMessagesFromFirestore.sort((a, b) => a.id - b.id);
  let roomMessages = chatMessagesFromFirestore.filter(m => m.room === room);
  if (realm && realm.toLowerCase() !== 'all') {
    roomMessages = roomMessages.filter(m => matchClubRealm(m.author_flair, realm));
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

  const { content, badge_color, room } = req.body;

  if (!content || typeof content !== 'string' || content.trim().length === 0) {
    return res.status(400).json({ detail: 'Chat content cannot be empty' });
  }

  const assignedChatId = Math.max(nextChatId++, ...chatMessages.map(m => m.id + 1), 1);
  nextChatId = assignedChatId + 1;
  const trimmedContent = content.trim();
  const extractedMentions: string[] = extractMentions(trimmedContent);

  const msg: ChatMessage = {
    id: assignedChatId,
    room: room ? String(room).trim() : 'general',
    author: session.nickname,
    author_flair: session.flair || 'Arsenal Finland Official Member',
    badge_color: badge_color ? String(badge_color).trim() : '#EF4444',
    content: trimmedContent,
    created_at: new Date().toISOString(),
    reactions: {},
    realm: session.flair || 'Arsenal Finland Official Member',
    mentions: extractedMentions
  };

  chatMessages.push(msg);
  forceSaveNow();
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

  const messageId = parseInt(req.params.id, 10);
  const { emoji } = req.body;

  if (!emoji || typeof emoji !== 'string' || emoji.trim().length === 0) {
    return res.status(400).json({ detail: 'Emoji required' });
  }

  const cleanEmoji = emoji.trim();
  const msg = chatMessages.find(m => m.id === messageId);
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

  forceSaveNow();
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
  const fixtures = matches.map(m => {
    const homeTeam = teams.find(t => t.id === m.home_team_id);
    const awayTeam = teams.find(t => t.id === m.away_team_id);
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

  const match = matches.find(m => m.id === match_id);
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
  const homeTeam = teams.find(t => t.id === home_id);
  const awayTeam = teams.find(t => t.id === away_id);

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

// 12. Reset League (Resets matches/standings only, preserving all posts and chat)
app.post('/api/league/reset', (_req, res) => {
  teams = getInitialTeams();
  matches = getInitialMatches();
  const standings = getStandings();
  res.json({ status: 'reset', standings });
});

// ==================== ADMIN & CLUB REALMS MANAGEMENT ====================
const ADMIN_PASSWORD = 'sala666sana';
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
  res.json({ realms });
});

// Admin: Add New Club Realm
app.post('/api/admin/realms', requireAdminAuth, (req, res) => {
  const { name, badge_color, icon, description } = req.body || {};
  if (!name || typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 50) {
    return res.status(400).json({ detail: 'Realm name must be between 2 and 50 characters' });
  }

  const cleanName = name.trim();
  const id = slugify(cleanName) || `realm-${Date.now()}`;

  if (realms.some(r => r.id === id || r.name.toLowerCase() === cleanName.toLowerCase())) {
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
    description: description && typeof description === 'string' ? description.trim() : '',
    is_default: false,
    created_at: new Date().toISOString()
  };

  realms.push(newRealm);
  forceSaveNow();
  saveRealmToFirestore(newRealm).catch(err => console.error('[Firestore] Realm save error:', err));

  broadcast({
    type: 'realms_updated',
    realms
  });

  res.status(201).json({ success: true, realm: newRealm, realms });
});

// Admin: Update Club Realm
app.put('/api/admin/realms/:id', requireAdminAuth, (req, res) => {
  const targetIdStr = String(req.params.id || '').trim().toLowerCase();
  const index = realms.findIndex(r => r.id.toLowerCase() === targetIdStr);
  
  if (index === -1) {
    return res.status(404).json({ detail: 'Club realm not found' });
  }

  const { name, badge_color, icon, description } = req.body || {};
  
  if (name && (typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 50)) {
    return res.status(400).json({ detail: 'Realm name must be between 2 and 50 characters' });
  }

  const hexRegex = /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/;
  
  const updatedRealm = {
    ...realms[index],
    name: name ? name.trim() : realms[index].name,
    badge_color: badge_color && hexRegex.test(badge_color.trim()) ? badge_color.trim() : realms[index].badge_color,
    icon: icon && typeof icon === 'string' && icon.trim().length > 0 ? icon.trim().slice(0, 8) : realms[index].icon,
    description: description !== undefined && typeof description === 'string' ? description.trim() : realms[index].description
  };

  realms[index] = updatedRealm;
  forceSaveNow();
  
  // Assuming saveRealmToFirestore handles both create and update
  saveRealmToFirestore(updatedRealm).catch(err => console.error('[Firestore] Realm update error:', err));
  
  broadcast({
    type: 'realms_updated',
    realms
  });
  
  res.json({ success: true, realm: updatedRealm, realms });
});

// Admin: Remove Club Realm
app.delete('/api/admin/realms/:id', requireAdminAuth, (req, res) => {
  const targetParam = req.params.id;
  const targetId = Array.isArray(targetParam) ? targetParam[0] : targetParam;
  const targetIdStr = String(targetId || '').trim().toLowerCase();
  const index = realms.findIndex(r => r.id.toLowerCase() === targetIdStr || r.name.toLowerCase() === targetIdStr);

  if (index === -1) {
    return res.status(404).json({ detail: 'Club realm not found' });
  }

  const removed = realms.splice(index, 1)[0];
  forceSaveNow();

  broadcast({
    type: 'realms_updated',
    realms,
    deleted_id: removed.id
  });

  res.json({ success: true, deleted: removed, realms });
});

// 13. Full Persistent Data Backup (For deployment migration, restart sync, and automated backup)
app.get('/api/backup', (_req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.json({
    posts,
    comments,
    chatMessages,
    sessions: Array.from(sessions.values()),
    realms,
    nextPostId,
    nextCommentId,
    nextChatId,
  });
});

// 14. Restore Post (Self-healing endpoint if client detects a restarted server is missing a locally cached post)
app.post('/api/posts/restore', (req, res) => {
  const incoming = req.body as Post;
  if (incoming && incoming.id && incoming.title && incoming.content) {
    const existing = posts.find(p => p.id === incoming.id);
    if (!existing) {
      posts.unshift(incoming);
      nextPostId = Math.max(nextPostId, incoming.id + 1);
      forceSaveNow();
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
        if (sessionId && sessions.has(sessionId)) {
          const session = sessions.get(sessionId)!;
          if (new Date(session.expires_at).getTime() > Date.now()) {
            socketSessions.set(ws, sessionId);
            session.last_active_at = new Date().toISOString();
            session.expires_at = new Date(Date.now() + SESSION_TTL_MS).toISOString();
            scheduleSave();
            broadcastPresence();
            ws.send(JSON.stringify({ type: 'auth_success', session }));
          }
        }
      } else if (msg.type === 'ping') {
        const sessionId = socketSessions.get(ws);
        if (sessionId && sessions.has(sessionId)) {
          const s = sessions.get(sessionId)!;
          s.last_active_at = new Date().toISOString();
          s.expires_at = new Date(Date.now() + SESSION_TTL_MS).toISOString();
        }
        ws.send(JSON.stringify({ type: 'pong' }));
      } else if (msg.type === 'chat') {
        // Resolve authenticated session
        let session: Session | undefined;
        const sessionId = socketSessions.get(ws) || msg.sessionId || msg.payload?.sessionId;
        if (sessionId && sessions.has(sessionId)) {
          const candidate = sessions.get(sessionId)!;
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
        scheduleSave();

        const payload = msg.payload || {};
        const content = (payload.content || '').trim();
        if (content) {
          const extractedMentions: string[] = extractMentions(content);
          const extractedQuotes: string[] = extractQuotedAuthors(content);
          const allUsersToNotify = Array.from(new Set([...extractedMentions, ...extractedQuotes]));

          const newChat: ChatMessage = {
            id: nextChatId++,
            room: payload.room || 'general',
            author: session.nickname,
            author_flair: session.flair || 'Arsenal Finland Official Member',
            badge_color: payload.badge_color || '#EF4444',
            content,
            created_at: new Date().toISOString(),
            reactions: {},
            realm: session.flair || 'Arsenal Finland Official Member',
            mentions: extractedMentions
          };
          chatMessages.push(newChat);
          scheduleSave();
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
                const sess = sessions.get(sessionId);
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
  forceSaveNow();
  process.exit(0);
});

process.on('SIGINT', () => {
  forceSaveNow();
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

      const data = await res.json() as StoredData;
      if (!data || !Array.isArray(data.posts) || data.posts.length === 0) continue;

      let updated = false;
      const existingPostIds = new Set(posts.map(p => p.id));
      for (const post of data.posts) {
        if (!existingPostIds.has(post.id)) {
          posts.push(post);
          existingPostIds.add(post.id);
          updated = true;
        }
      }

      const existingCommentIds = new Set(comments.map(c => c.id));
      if (Array.isArray(data.comments)) {
        for (const comment of data.comments) {
          if (!existingCommentIds.has(comment.id)) {
            comments.push(comment);
            existingCommentIds.add(comment.id);
            updated = true;
          }
        }
      }

      const existingChatIds = new Set(chatMessages.map(m => m.id));
      if (Array.isArray(data.chatMessages)) {
        for (const chat of data.chatMessages) {
          if (!existingChatIds.has(chat.id)) {
            chatMessages.push(chat);
            existingChatIds.add(chat.id);
            updated = true;
          }
        }
      }

      if (Array.isArray(data.sessions)) {
        for (const s of data.sessions) {
          if (!sessions.has(s.id)) {
            sessions.set(s.id, s);
            updated = true;
          }
        }
      }

      if (Array.isArray(data.realms)) {
        for (const r of data.realms) {
          if (r && r.name && !realms.some(existing => existing.id === r.id || existing.name.toLowerCase() === r.name.toLowerCase())) {
            realms.push(r);
            updated = true;
          }
        }
      }

      if (updated) {
        nextPostId = Math.max(nextPostId, ...posts.map(p => p.id + 1));
        nextCommentId = Math.max(nextCommentId, ...comments.map(c => c.id + 1));
        nextChatId = Math.max(nextChatId, ...chatMessages.map(m => m.id + 1));
        forceSaveNow();
        console.log(`Synced and preserved live community data from ${syncUrl}: ${posts.length} posts, ${comments.length} comments, ${sessions.size} sessions`);
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
      const existingPostIds = new Set(posts.map(p => p.id));
      for (const p of fsPosts.value) {
        if (!existingPostIds.has(p.id)) {
          posts.push(p);
          existingPostIds.add(p.id);
          updated = true;
        } else {
          const localIndex = posts.findIndex(lp => lp.id === p.id);
          if (localIndex !== -1) {
            const local = posts[localIndex];
            const localTime = new Date(local.last_activity_at || local.created_at).getTime();
            const remoteTime = new Date(p.last_activity_at || p.created_at).getTime();
            if (remoteTime > localTime || p.upvotes > local.upvotes) {
              posts[localIndex] = p;
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
    for (const p of posts) {
      if (!firestorePostIds.has(p.id)) {
        savePostToFirestore(p).catch(e => console.warn('[Firestore] Failed seeding post:', e));
      }
    }

    // 2. Sync Comments
    if (fsComments.status === 'fulfilled' && Array.isArray(fsComments.value) && fsComments.value.length > 0) {
      const existingCommentIds = new Set(comments.map(c => c.id));
      for (const c of fsComments.value) {
        if (!existingCommentIds.has(c.id)) {
          comments.push(c);
          existingCommentIds.add(c.id);
          updated = true;
        }
      }
    }
    const firestoreCommentIds = new Set(
      (fsComments.status === 'fulfilled' && Array.isArray(fsComments.value)) ? fsComments.value.map(c => c.id) : []
    );
    for (const c of comments) {
      if (!firestoreCommentIds.has(c.id)) {
        saveCommentToFirestore(c).catch(e => console.warn('[Firestore] Failed seeding comment:', e));
      }
    }

    // 3. Sync Chat Messages
    if (fsChats.status === 'fulfilled' && Array.isArray(fsChats.value) && fsChats.value.length > 0) {
      const existingChatIds = new Set(chatMessages.map(m => m.id));
      for (const m of fsChats.value) {
        if (m && m.content && m.content.includes('Arsenal Finland FanSphere')) {
          m.content = m.content.replace(/Arsenal Finland FanSphere/g, 'Fansphere');
          saveChatMessageToFirestore(m).catch(() => {});
        }
        if (!existingChatIds.has(m.id)) {
          chatMessages.push(m);
          existingChatIds.add(m.id);
          updated = true;
        }
      }
    }
    // Ensure all existing in-memory chat messages are sanitized
    for (const m of chatMessages) {
      if (m && m.content && m.content.includes('Arsenal Finland FanSphere')) {
        m.content = m.content.replace(/Arsenal Finland FanSphere/g, 'Fansphere');
        updated = true;
        saveChatMessageToFirestore(m).catch(() => {});
      }
    }
    const firestoreChatIds = new Set(
      (fsChats.status === 'fulfilled' && Array.isArray(fsChats.value)) ? fsChats.value.map(m => m.id) : []
    );
    for (const m of chatMessages) {
      if (!firestoreChatIds.has(m.id)) {
        saveChatMessageToFirestore(m).catch(e => console.warn('[Firestore] Failed seeding chat:', e));
      }
    }

    // 4. Sync Sessions
    if (fsSessions.status === 'fulfilled' && Array.isArray(fsSessions.value) && fsSessions.value.length > 0) {
      for (const s of fsSessions.value) {
        if (!sessions.has(s.id)) {
          sessions.set(s.id, s);
          updated = true;
        }
      }
    }
    for (const s of sessions.values()) {
      saveSessionToFirestore(s).catch(e => console.warn('[Firestore] Failed seeding session:', e));
    }

    // 5. Sync Realms
    if (fsRealms.status === 'fulfilled' && Array.isArray(fsRealms.value) && fsRealms.value.length > 0) {
      for (const r of fsRealms.value) {
        if (!realms.some(existing => existing.id === r.id || existing.name.toLowerCase() === r.name.toLowerCase())) {
          realms.push(r);
          updated = true;
        }
      }
    }
    for (const r of realms) {
      saveRealmToFirestore(r).catch(e => console.warn('[Firestore] Failed seeding realm:', e));
    }

    if (updated) {
      nextPostId = Math.max(nextPostId, ...posts.map(p => p.id + 1));
      nextCommentId = Math.max(nextCommentId, ...comments.map(c => c.id + 1));
      nextChatId = Math.max(nextChatId, ...chatMessages.map(m => m.id + 1));
      forceSaveNow();
      console.log(`[Firestore] Sync complete. Active posts: ${posts.length}, comments: ${comments.length}, chats: ${chatMessages.length}, sessions: ${sessions.size}`);
    } else {
      console.log(`[Firestore] Sync complete. In-sync with ${posts.length} posts and ${comments.length} comments.`);
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
    posts_count: posts.length,
    comments_count: comments.length,
    chat_messages_count: chatMessages.length,
    realms_count: realms.length
  });
});

const PORT = 3000;
const HOST = '0.0.0.0';

server.listen(PORT, HOST, () => {
  console.log(`ready - started server on 0.0.0.0:${PORT}, url: http://localhost:${PORT}`);
  console.log(`  ➜  Local:   http://localhost:${PORT}/`);
  console.log(`  ➜  Network: http://${HOST}:${PORT}/`);
  console.log(`FanSphere server running at http://${HOST}:${PORT}`);
  syncWithFirestore().catch(() => {});
  syncLatestDataFromLive().catch(() => {});
});
