import { 
  fetchAllPostsFromFirestore,
  fetchAllCommentsFromFirestore,
  fetchAllChatMessagesFromFirestore,
  fetchAllRealmsFromFirestore,
  fetchAllSessionsFromFirestore,
  fetchAllUsersFromFirestore,
} from '../firestoreService.js';
import { Post, Comment, ChatMessage, ClubRealm, Session, UserReadState, Team, Match } from '../models/types.js';

export const SESSION_TTL_MS = 2 * 60 * 60 * 1000;
export const ACTIVE_WINDOW_MS = 10 * 60 * 1000;

export const state = {
  posts: [] as Post[],
  comments: [] as Comment[],
  chatMessages: [] as ChatMessage[],
  realms: [] as ClubRealm[],
  teams: [] as Team[],
  matches: [] as Match[],
  userReadStates: new Map<string, Record<string, UserReadState>>(),
  sessions: new Map<string, Session>(),
  users: new Map<string, any>(),
  nextPostId: 1,
  nextCommentId: 1,
  nextChatId: 1,
};

export async function initAppState() {
  try {
    state.posts = await fetchAllPostsFromFirestore();
    state.comments = await fetchAllCommentsFromFirestore();
    state.chatMessages = await fetchAllChatMessagesFromFirestore();
    state.realms = await fetchAllRealmsFromFirestore();
    
    const loadedSessions = await fetchAllSessionsFromFirestore();
    for (const s of loadedSessions) {
      state.sessions.set(s.id, s);
    }
    
    const loadedUsers = await fetchAllUsersFromFirestore();
    for (const u of loadedUsers) {
      state.users.set(u.email, u);
    }
    
    state.nextPostId = Math.max(...state.posts.map(p => p.id), 0) + 1;
    state.nextCommentId = Math.max(...state.comments.map(c => c.id), 0) + 1;
    state.nextChatId = Math.max(...state.chatMessages.map(m => m.id), 0) + 1;
    
    console.log('App state initialized from Firestore');
  } catch (err) {
    console.error('Failed to initialize app state from Firestore:', err);
  }
}
