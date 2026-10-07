import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import express from 'express';
import cors from 'cors';
import { WebSocketServer, WebSocket } from 'ws';

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
  comment_count: number;
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
  const now = Date.now();
  return [
    {
      id: 1,
      title: '[Match Thread] Arsenal vs Chelsea (London Derby - Matchday 28 Live Discussion)',
      content: 'The Gunners host Chelsea at Emirates Stadium! Arteta starts with Raya, White, Saliba, Gabriel, Timber, Partey, Rice, Odegaard, Saka, Havertz, Martinelli. Live tactical thoughts, match reactions, and celebration thread. COYG! 🔴⚪',
      author: 'HelsinkiGunner',
      author_flair: 'ArseFinland Member',
      tag: 'Match Thread',
      upvotes: 87,
      downvotes: 3,
      comment_count: 4,
      image_url: '',
      created_at: new Date(now - 2 * 3600 * 1000).toISOString()
    },
    {
      id: 2,
      title: 'ArseFinland Official Watch Party: Sports Academy Helsinki & Hook Tampere this Saturday!',
      content: 'Moro kaikki Arsenal-fanit! ArseFinland järjestää jälleen yhteiskatsomon. Tervetuloa katsomaan peliä isolta screeniltä mahtavassa seurassa Helsingissä (Sports Academy, Kaivokatu 8) ja Tampereella (Ravintola Hook). Jäsenkortilla tutut faniedut hanatuotteista ja burgereista. Paikalle kannattaa saapua n. 45 min ennen aloituspotkua varmistaaksesi hyvät istumapaikat!',
      author: 'ArseFinlandAdmin',
      author_flair: 'Club Official',
      tag: 'Meetups',
      upvotes: 64,
      downvotes: 1,
      comment_count: 2,
      image_url: '',
      created_at: new Date(now - 4 * 3600 * 1000).toISOString()
    },
    {
      id: 3,
      title: "Tactical breakdown: Jurrien Timber's role as inverted fullback and how it frees Odegaard",
      content: "Watching the past 5 matches, Arteta has dialed in our rest defense significantly. When Timber inverts alongside Rice or Partey into the half-space, it creates a box midfield that completely neutralizes counter-attacks while letting Martin Odegaard drift into the right half-space triangle with Saka and White. Thoughts on how this will hold up against Europe's best?",
      author: 'ArtetaTactics',
      author_flair: 'Analyst',
      tag: 'Tactics',
      upvotes: 42,
      downvotes: 2,
      comment_count: 3,
      image_url: '',
      created_at: new Date(now - 7 * 3600 * 1000).toISOString()
    },
    {
      id: 4,
      title: 'Summer Transfer Window: Who should be our dream striker target?',
      content: 'With the Premier League title race reaching fever pitch, Edu and the scouting department are reportedly evaluating our #9 options for the summer window. Options being floated in the media: Benjamin Šeško, Alexander Isak, or Viktor Gyökeres. Who fits Arteta\'s physical press and link-up play best?',
      author: 'GoonerJussi',
      author_flair: 'Gunner',
      tag: 'Transfers',
      upvotes: 35,
      downvotes: 4,
      comment_count: 1,
      image_url: '',
      created_at: new Date(now - 24 * 3600 * 1000).toISOString()
    },
    {
      id: 5,
      title: "When you check the league table on Sunday evening and we're top of the league",
      content: 'Trust the process. 65 points and counting. The red and white cannon firing on all cylinders! Terveisiä kaikille ArseFinlandin jäsenille ympäri Suomea!',
      author: 'PohjolanTykkimies',
      author_flair: 'Suomi Gunner',
      tag: 'Memes',
      upvotes: 98,
      downvotes: 2,
      comment_count: 1,
      image_url: '',
      created_at: new Date(now - 48 * 3600 * 1000).toISOString()
    }
  ];
}

function getInitialComments(): Comment[] {
  const now = Date.now();
  return [
    { id: 1, post_id: 1, parent_id: null, author: 'TurkuGunner', author_flair: 'Gunner', content: "Saka's goal in the 18th minute was pure filth! Cut inside, two defenders flat-footed.", upvotes: 18, created_at: new Date(now - 50 * 60 * 1000).toISOString() },
    { id: 2, post_id: 1, parent_id: 1, author: 'TampereGooner', author_flair: 'Gunner', content: "Agreed! And look at Havertz's pressing run to drag the center back away to create the shooting lane.", upvotes: 9, created_at: new Date(now - 40 * 60 * 1000).toISOString() },
    { id: 3, post_id: 1, parent_id: null, author: 'Mikko_V', author_flair: 'Fan', content: "Raya's distribution from the back tonight has been world class under pressure.", upvotes: 12, created_at: new Date(now - 25 * 60 * 1000).toISOString() },
    { id: 4, post_id: 1, parent_id: null, author: 'OuluCannon', author_flair: 'Gunner', content: "Havertz makes it 2-1!! The Emirates is electric right now!", upvotes: 24, created_at: new Date(now - 10 * 60 * 1000).toISOString() },

    { id: 5, post_id: 2, parent_id: null, author: 'EspooRed', author_flair: 'Gunner', content: "Nähdään Sports Academyssa! Viime katsomossa oli aivan mieletön tunnelma Pohjois-Lontoon derbyssä.", upvotes: 8, created_at: new Date(now - 3 * 3600 * 1000).toISOString() },
    { id: 6, post_id: 2, parent_id: null, author: 'Jari_Arsenal', author_flair: 'Member', content: "Tampereen Hookissa myös pöytävaraus hoidettu 12 hengelle. Tervetuloa mukaan uudetkin fanit!", upvotes: 11, created_at: new Date(now - 2 * 3600 * 1000).toISOString() },

    { id: 7, post_id: 3, parent_id: null, author: 'NordicGooner', author_flair: 'Tactics', content: "Spot on analysis. Timber's recovery pace when we lose possession high up the pitch is unmatched.", upvotes: 6, created_at: new Date(now - 5 * 3600 * 1000).toISOString() },
    { id: 8, post_id: 3, parent_id: 7, author: 'ArtetaTactics', author_flair: 'Analyst', content: "Exactly, it allows Gabriel to step up aggressively knowing Timber can sweep behind.", upvotes: 4, created_at: new Date(now - 4 * 3600 * 1000).toISOString() },
    { id: 9, post_id: 3, parent_id: null, author: 'Lauri_Gunner', author_flair: 'Fan', content: "He was sorely missed last season due to the ACL injury. Having him back healthy changes everything.", upvotes: 5, created_at: new Date(now - 3 * 3600 * 1000).toISOString() },

    { id: 10, post_id: 4, parent_id: null, author: 'StadinTykkimies', author_flair: 'Gunner', content: "Gyökeres would be an absolute powerhouse in the Premier League. His hold-up play and work rate are phenomenal.", upvotes: 7, created_at: new Date(now - 18 * 3600 * 1000).toISOString() },

    { id: 11, post_id: 5, parent_id: null, author: 'Matti_99', author_flair: 'Fan', content: "Mind the gap!! 🔴⚪", upvotes: 14, created_at: new Date(now - 24 * 3600 * 1000).toISOString() }
  ];
}

function getInitialChatMessages(): ChatMessage[] {
  const now = Date.now();
  return [
    { id: 1, room: 'general', author: 'HelsinkiGunner', author_flair: 'Gunner', badge_color: '#EF4444', content: 'Welcome to ArseFinland FanSphere everyone! Tervetuloa!', created_at: new Date(now - 25 * 60 * 1000).toISOString() },
    { id: 2, room: 'general', author: 'TurkuGunner', author_flair: 'Gunner', badge_color: '#EF4444', content: 'What a match so far! Saka is on fire today 🔥', created_at: new Date(now - 20 * 60 * 1000).toISOString() },
    { id: 3, room: 'general', author: 'TampereGooner', author_flair: 'Gunner', badge_color: '#10B981', content: 'Watching live at Ravintola Hook with 15 other Finnish gooners 🍻', created_at: new Date(now - 15 * 60 * 1000).toISOString() },
    { id: 4, room: 'general', author: 'CityFan_99', author_flair: 'Man City', badge_color: '#06B6D4', content: 'City just equalized at St James Park! Haaland ⚽', created_at: new Date(now - 10 * 60 * 1000).toISOString() },
    { id: 5, room: 'general', author: 'Mikko_V', author_flair: 'Gunner', badge_color: '#EF4444', content: 'KAI HAVERTZ SCORESSSS 2-1!! GET IN THERE!! 🔴⚪', created_at: new Date(now - 5 * 60 * 1000).toISOString() },
    { id: 6, room: 'general', author: 'ArseFinlandAdmin', author_flair: 'Official', badge_color: '#F59E0B', content: "Reminder: Voting is open for today's Man of the Match in the forum!", created_at: new Date(now - 2 * 60 * 1000).toISOString() },
    { id: 7, room: 'general', author: 'NordicGooner', author_flair: 'Gunner', badge_color: '#EF4444', content: "15 minutes left to hold on to the 3 points! Let's go boys!", created_at: new Date(now - 1 * 60 * 1000).toISOString() },

    { id: 8, room: 'matchday', author: 'HelsinkiGunner', author_flair: 'Gunner', badge_color: '#EF4444', content: "MATCHDAY LIVE CHAT! Lineups are in, let's hear your score predictions!", created_at: new Date(now - 45 * 60 * 1000).toISOString() },
    { id: 9, room: 'matchday', author: 'Mikko_V', author_flair: 'Gunner', badge_color: '#EF4444', content: '3-1 Arsenal, Saka brace and Odegaard masterclass incoming!', created_at: new Date(now - 35 * 60 * 1000).toISOString() },
    { id: 10, room: 'matchday', author: 'TurkuGunner', author_flair: 'Gunner', badge_color: '#EF4444', content: 'GOALLLLL SAKA 18\'!! What a curler into the far corner!! 🔥⚽', created_at: new Date(now - 22 * 60 * 1000).toISOString() },
    { id: 11, room: 'matchday', author: 'BlueFan', author_flair: 'Chelsea', badge_color: '#3B82F6', content: 'Palmer answers right back before half time 1-1, game on!', created_at: new Date(now - 18 * 60 * 1000).toISOString() },
    { id: 12, room: 'matchday', author: 'TampereGooner', author_flair: 'Gunner', badge_color: '#10B981', content: 'HAVERTZ WITH THE HEADER 2-1!! The Emirates is rocking right now!', created_at: new Date(now - 6 * 60 * 1000).toISOString() },
    { id: 13, room: 'matchday', author: 'ArtetaTactics', author_flair: 'Analyst', badge_color: '#93C5FD', content: 'Huge tactical substitution by Arteta putting in Merino to stabilize the midfield.', created_at: new Date(now - 2 * 60 * 1000).toISOString() },

    { id: 14, room: 'suomi-fans', author: 'ArseFinlandAdmin', author_flair: 'Official', badge_color: '#F59E0B', content: 'Tervetuloa kaikille Suomen Arsenal-kannattajille! Täällä sovitaan kisakatsomoista.', created_at: new Date(now - 3 * 3600 * 1000).toISOString() },
    { id: 15, room: 'suomi-fans', author: 'HelsinkiGunner', author_flair: 'Gunner', badge_color: '#EF4444', content: 'Sports Academyyn tulossa ainakin 25 tykkimiestä lauantaina. Pöydät varattu!', created_at: new Date(now - 2 * 3600 * 1000).toISOString() },
    { id: 16, room: 'suomi-fans', author: 'TampereGooner', author_flair: 'Gunner', badge_color: '#10B981', content: 'Tampereen Hookissa myös hyvä porukka kasassa! Siivet & bisseä kylkeen 🍗🍺', created_at: new Date(now - 1 * 3600 * 1000).toISOString() },
    { id: 17, room: 'suomi-fans', author: 'OuluCannon', author_flair: 'Gunner', badge_color: '#EF4444', content: 'Onko Oulun St. Michaelissa tänään väkeä? Voisin tulla toisella puoliajalla!', created_at: new Date(now - 30 * 60 * 1000).toISOString() }
  ];
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
  if (!flair) return 'ArseFinland Official Member';
  const str = String(flair).trim().toLowerCase();
  if (str.includes('tester')) return 'Testers';
  if (str.includes('neutral')) return 'Neutral Football Fan';
  if (str.includes('arsefinland') || str.includes('gunner') || str.includes('gooner') || str.includes('arsenal') || str.includes('official')) {
    return 'ArseFinland Official Member';
  }
  return 'ArseFinland Official Member';
}

function getInitialSessions(): Session[] {
  const now = Date.now();
  const twoHours = SESSION_TTL_MS;
  return [
    {
      id: 'sess-helsinki-gunner',
      nickname: 'HelsinkiGunner',
      email: 'helsinki.gunner@arsefinland.fi',
      flair: 'ArseFinland Official Member',
      created_at: new Date(now - 3600000).toISOString(),
      last_active_at: new Date(now - 60000).toISOString(),
      expires_at: new Date(now + twoHours).toISOString()
    },
    {
      id: 'sess-tampere-gooner',
      nickname: 'TampereGooner',
      email: 'tampere.gooner@arsefinland.fi',
      flair: 'ArseFinland Official Member',
      created_at: new Date(now - 7200000).toISOString(),
      last_active_at: new Date(now - 120000).toISOString(),
      expires_at: new Date(now + twoHours).toISOString()
    },
    {
      id: 'sess-arsefin-admin',
      nickname: 'ArseFinlandAdmin',
      email: 'admin@arsefinland.fi',
      flair: 'ArseFinland Official Member',
      created_at: new Date(now - 10000000).toISOString(),
      last_active_at: new Date(now - 30000).toISOString(),
      expires_at: new Date(now + twoHours).toISOString()
    },
    {
      id: 'sess-turku-tester',
      nickname: 'TurkuTester',
      email: 'tester.turku@arsefinland.fi',
      flair: 'Testers',
      created_at: new Date(now - 4000000).toISOString(),
      last_active_at: new Date(now - 180000).toISOString(),
      expires_at: new Date(now + twoHours).toISOString()
    }
  ];
}

interface StoredData {
  posts: Post[];
  comments: Comment[];
  chatMessages: ChatMessage[];
  sessions?: Session[];
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
  let maxPostId = 1;
  let maxCommentId = 1;
  let maxChatId = 1;

  for (const s of stores) {
    if (!s) continue;
    if (Array.isArray(s.posts)) {
      for (const p of s.posts) {
        if (!p || !p.id) continue;
        const existing = mergedPostsMap.get(p.id);
        if (!existing || new Date(p.last_activity_at || p.created_at).getTime() >= new Date(existing.last_activity_at || existing.created_at).getTime()) {
          mergedPostsMap.set(p.id, p);
        }
        maxPostId = Math.max(maxPostId, p.id + 1);
      }
    }
    if (Array.isArray(s.comments)) {
      for (const c of s.comments) {
        if (!c || !c.id) continue;
        mergedCommentsMap.set(c.id, c);
        maxCommentId = Math.max(maxCommentId, c.id + 1);
      }
    }
    if (Array.isArray(s.chatMessages)) {
      for (const m of s.chatMessages) {
        if (!m || !m.id) continue;
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

  const postsList = Array.from(mergedPostsMap.values()).sort((a, b) => b.id - a.id);
  const commentsList = Array.from(mergedCommentsMap.values()).sort((a, b) => a.id - b.id);
  const chatList = Array.from(mergedChatMap.values()).sort((a, b) => a.id - b.id);
  const sessionList = Array.from(mergedSessionsMap.values());

  return {
    posts: postsList,
    comments: commentsList,
    chatMessages: chatList,
    sessions: sessionList,
    nextPostId: Math.max(maxPostId, ...postsList.map(p => p.id + 1)),
    nextCommentId: Math.max(maxCommentId, ...commentsList.map(c => c.id + 1)),
    nextChatId: Math.max(maxChatId, ...chatList.map(m => m.id + 1))
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
    nextPostId: 6,
    nextCommentId: 12,
    nextChatId: 18,
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

const sessions = new Map<string, Session>();
for (const s of (storedData.sessions || getInitialSessions())) {
  sessions.set(s.id, s);
}

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
app.use(express.json());

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
    active_nicknames: active.map(s => s.nickname)
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
app.post('/api/auth/session', (req, res) => {
  const { nickname, email, flair } = req.body;

  if (!nickname || typeof nickname !== 'string' || nickname.trim().length < 2 || nickname.trim().length > 30) {
    return res.status(400).json({ detail: 'Nickname must be between 2 and 30 characters' });
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!email || typeof email !== 'string' || !emailRegex.test(email.trim())) {
    return res.status(400).json({ detail: 'Please enter a valid email address' });
  }

  const cleanNickname = nickname.trim();
  const cleanEmail = email.trim().toLowerCase();
  const cleanFlair = normalizeFlair(flair);

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
const handleSessionUpdate = (req: express.Request, res: express.Response) => {
  const session = getSessionFromReq(req);
  if (!session) {
    return res.status(401).json({ detail: 'Session expired or not found', expired: true, valid: false });
  }

  const { nickname, email, flair } = req.body;

  if (nickname !== undefined) {
    if (typeof nickname !== 'string' || nickname.trim().length < 2 || nickname.trim().length > 30) {
      return res.status(400).json({ detail: 'Nickname must be between 2 and 30 characters' });
    }
    session.nickname = nickname.trim();
  }

  if (email !== undefined) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (typeof email !== 'string' || !emailRegex.test(email.trim())) {
      return res.status(400).json({ detail: 'Please enter a valid email address' });
    }
    session.email = email.trim().toLowerCase();
  }

  if (flair !== undefined && typeof flair === 'string' && flair.trim().length > 0) {
    session.flair = normalizeFlair(flair);
  }

  session.last_active_at = new Date().toISOString();
  session.expires_at = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  forceSaveNow();
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
    active_nicknames: active.map(s => s.nickname)
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

  // ArseFinland official club realm
  const arseFinlandVariants = ['arsefinland', 'arsenal', 'gunner', 'gooner', 'official', 'member'];
  if (arseFinlandVariants.some(v => b.includes(v))) {
    return arseFinlandVariants.some(v => a.includes(v));
  }

  return a.includes(b) || b.includes(a);
}

// 1. Posts List (Always sorted by latest changes including comments, filterable by tag and club realm)
app.get('/api/posts', (req, res) => {
  const tag = req.query.tag as string | undefined;
  const realm = req.query.realm as string | undefined;

  let filtered = [...posts];
  if (tag && tag.toLowerCase() !== 'all') {
    filtered = filtered.filter(p => p.tag.toLowerCase() === tag.toLowerCase());
  }
  if (realm && realm.toLowerCase() !== 'all') {
    filtered = filtered.filter(p => matchClubRealm(p.author_flair, realm));
  }

  // Always sort forum feed by latest changes, taking comments into account
  const mapped = filtered.map(p => {
    const latestActivityTime = getPostLatestActivityTime(p);
    return {
      ...p,
      latest_activity_at: new Date(latestActivityTime).toISOString(),
      latest_activity_time: latestActivityTime
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

  const nowIso = new Date().toISOString();
  const newPost: Post = {
    id: nextPostId++,
    title: title.trim(),
    content: content.trim(),
    author: session.nickname,
    author_flair: session.flair || 'ArseFinland Official Member',
    tag: tag ? String(tag).trim() : 'Discussion',
    upvotes: 1,
    downvotes: 0,
    comment_count: 0,
    image_url: image_url ? String(image_url).trim() : '',
    created_at: nowIso,
    last_activity_at: nowIso
  };

  posts.unshift(newPost);
  forceSaveNow();

  broadcast({
    type: 'new_post',
    data: {
      ...newPost,
      latest_activity_at: nowIso,
      score: 1
    }
  });

  res.status(201).json({
    ...newPost,
    latest_activity_at: nowIso,
    score: 1
  });
});

// 3. Post Detail
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

  res.json({
    post: {
      ...post,
      score: post.upvotes - post.downvotes
    },
    comments: postComments
  });
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

  const { content, parent_id } = req.body;
  if (!content || typeof content !== 'string' || content.trim().length === 0) {
    return res.status(400).json({ detail: 'Comment content cannot be empty' });
  }

  const comment: Comment = {
    id: nextCommentId++,
    post_id: postId,
    parent_id: parent_id ? parseInt(parent_id, 10) : null,
    author: session.nickname,
    author_flair: session.flair || 'ArseFinland Official Member',
    content: content.trim(),
    upvotes: 1,
    created_at: new Date().toISOString()
  };

  comments.push(comment);
  post.comment_count += 1;
  const nowIso = comment.created_at;
  post.last_activity_at = nowIso;
  forceSaveNow();

  broadcast({
    type: 'new_comment',
    data: comment,
    post_id: postId,
    comment_count: post.comment_count,
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
app.get('/api/chat/history', (req, res) => {
  const room = (req.query.room as string) || 'general';
  const realm = req.query.realm as string | undefined;
  const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 100;

  let roomMessages = chatMessages.filter(m => m.room === room);
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

  const msg: ChatMessage = {
    id: nextChatId++,
    room: room ? String(room).trim() : 'general',
    author: session.nickname,
    author_flair: session.flair || 'ArseFinland Official Member',
    badge_color: badge_color ? String(badge_color).trim() : '#EF4444',
    content: content.trim(),
    created_at: new Date().toISOString()
  };

  chatMessages.push(msg);
  forceSaveNow();

  broadcast({
    type: 'chat_message',
    data: msg
  });

  res.status(201).json(msg);
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
          const newChat: ChatMessage = {
            id: nextChatId++,
            room: payload.room || 'general',
            author: session.nickname,
            author_flair: session.flair || 'ArseFinland Official Member',
            badge_color: payload.badge_color || '#EF4444',
            content,
            created_at: new Date().toISOString()
          };
          chatMessages.push(newChat);
          scheduleSave();
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

const PORT = 3000;
const HOST = '0.0.0.0';

server.listen(PORT, HOST, () => {
  console.log(`ready - started server on 0.0.0.0:${PORT}, url: http://localhost:${PORT}`);
  console.log(`  ➜  Local:   http://localhost:${PORT}/`);
  console.log(`  ➜  Network: http://${HOST}:${PORT}/`);
  console.log(`FanSphere server running at http://${HOST}:${PORT}`);
  syncLatestDataFromLive().catch(() => {});
});
