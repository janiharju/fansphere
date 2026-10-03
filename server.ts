import http from 'node:http';
import path from 'node:path';
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

// In-Memory Data Store
let teams: Team[] = getInitialTeams();
let matches: Match[] = getInitialMatches();
let posts: Post[] = getInitialPosts();
let comments: Comment[] = getInitialComments();
let chatMessages: ChatMessage[] = getInitialChatMessages();

let nextPostId = 6;
let nextCommentId = 12;
let nextChatId = 18;

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

// Broadcast manager
const activeSockets = new Set<WebSocket>();

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

function broadcastPresence() {
  broadcast({
    type: 'presence',
    online_count: Math.max(activeSockets.size, 1) + 14
  });
}

// ==================== REST APIS ====================

// 1. Posts List
app.get('/api/posts', (req, res) => {
  const sort = (req.query.sort as string) || 'hot';
  const tag = req.query.tag as string | undefined;

  let filtered = [...posts];
  if (tag && tag.toLowerCase() !== 'all') {
    filtered = filtered.filter(p => p.tag.toLowerCase() === tag.toLowerCase());
  }

  const now = Date.now();
  const scoredPosts = filtered.map(p => {
    const score = p.upvotes - p.downvotes;
    const createdTime = new Date(p.created_at).getTime();
    const hoursAge = Math.max((now - createdTime) / 3600000, 0.1);
    const hot_score = (score + 5) / Math.pow(hoursAge + 2, 1.5);
    return {
      ...p,
      score,
      hot_score
    };
  });

  if (sort === 'hot') {
    scoredPosts.sort((a, b) => b.hot_score - a.hot_score);
  } else if (sort === 'new') {
    scoredPosts.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  } else if (sort === 'top') {
    scoredPosts.sort((a, b) => b.score - a.score);
  }

  res.json(scoredPosts);
});

// 2. Create Post
app.post('/api/posts', (req, res) => {
  const { title, content, author, author_flair, tag, image_url } = req.body;

  if (!title || typeof title !== 'string' || title.trim().length < 3) {
    return res.status(400).json({ detail: 'Title must be at least 3 characters' });
  }
  if (!content || typeof content !== 'string' || content.trim().length < 5) {
    return res.status(400).json({ detail: 'Content must be at least 5 characters' });
  }

  const newPost: Post = {
    id: nextPostId++,
    title: title.trim(),
    content: content.trim(),
    author: author ? String(author).trim() : 'Gunner',
    author_flair: author_flair ? String(author_flair).trim() : 'Fan',
    tag: tag ? String(tag).trim() : 'Discussion',
    upvotes: 1,
    downvotes: 0,
    comment_count: 0,
    image_url: image_url ? String(image_url).trim() : '',
    created_at: new Date().toISOString()
  };

  posts.unshift(newPost);

  broadcast({
    type: 'new_post',
    data: {
      ...newPost,
      score: 1
    }
  });

  res.status(201).json({
    ...newPost,
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
  const postId = parseInt(req.params.id, 10);
  const post = posts.find(p => p.id === postId);

  if (!post) {
    return res.status(404).json({ detail: 'Post not found' });
  }

  const { content, author, author_flair, parent_id } = req.body;
  if (!content || typeof content !== 'string' || content.trim().length === 0) {
    return res.status(400).json({ detail: 'Comment content cannot be empty' });
  }

  const comment: Comment = {
    id: nextCommentId++,
    post_id: postId,
    parent_id: parent_id ? parseInt(parent_id, 10) : null,
    author: author ? String(author).trim() : 'Gunner',
    author_flair: author_flair ? String(author_flair).trim() : 'Fan',
    content: content.trim(),
    upvotes: 1,
    created_at: new Date().toISOString()
  };

  comments.push(comment);
  post.comment_count += 1;

  broadcast({
    type: 'new_comment',
    data: comment
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

// 7. Chat History
app.get('/api/chat/history', (req, res) => {
  const room = (req.query.room as string) || 'general';
  const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;

  const roomMessages = chatMessages.filter(m => m.room === room);
  // Last `limit` messages in chronological order
  const slice = roomMessages.slice(-limit);

  res.json(slice);
});

// 8. Post Chat Message
app.post('/api/chat/message', (req, res) => {
  const { content, author, author_flair, badge_color, room } = req.body;

  if (!content || typeof content !== 'string' || content.trim().length === 0) {
    return res.status(400).json({ detail: 'Chat content cannot be empty' });
  }

  const msg: ChatMessage = {
    id: nextChatId++,
    room: room ? String(room).trim() : 'general',
    author: author ? String(author).trim() : 'Anonymous Gunner',
    author_flair: author_flair ? String(author_flair).trim() : 'Gunner',
    badge_color: badge_color ? String(badge_color).trim() : '#EF4444',
    content: content.trim(),
    created_at: new Date().toISOString()
  };

  chatMessages.push(msg);

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

// 12. Reset League
app.post('/api/league/reset', (_req, res) => {
  teams = getInitialTeams();
  matches = getInitialMatches();
  posts = getInitialPosts();
  comments = getInitialComments();
  chatMessages = getInitialChatMessages();
  nextPostId = 6;
  nextCommentId = 12;
  nextChatId = 18;

  const standings = getStandings();
  res.json({ status: 'reset', standings });
});

// Static Files & SPA Fallback
const staticDir = path.resolve(process.cwd(), 'static');
app.use('/static', express.static(staticDir));

app.get('/', (_req, res) => {
  res.sendFile(path.join(staticDir, 'index.html'));
});

// Catch-all for other non-API routes
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/ws')) {
    return next();
  }
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
      if (msg.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong' }));
      } else if (msg.type === 'chat') {
        const payload = msg.payload || {};
        const content = (payload.content || '').trim();
        if (content) {
          const newChat: ChatMessage = {
            id: nextChatId++,
            room: payload.room || 'general',
            author: payload.author || 'Fan',
            author_flair: payload.author_flair || 'Gunner',
            badge_color: payload.badge_color || '#EF4444',
            content,
            created_at: new Date().toISOString()
          };
          chatMessages.push(newChat);
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
    broadcastPresence();
  });

  ws.on('error', () => {
    activeSockets.delete(ws);
  });
});

const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = '0.0.0.0';

server.listen(PORT, HOST, () => {
  console.log(`FanSphere server running at http://${HOST}:${PORT}`);
});
