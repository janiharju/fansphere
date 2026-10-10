import {
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  setDoc,
  updateDoc,
  collection,
  query,
  orderBy,
  limit,
  Firestore
} from 'firebase/firestore';
import {
  db,
  auth,
  OperationType,
  handleFirestoreError,
  testConnection
} from './firebase.js';
import type { FirestoreErrorInfo } from './firebase.js';

export { db, auth, OperationType, handleFirestoreError, testConnection };
export type { FirestoreErrorInfo };

// Firestore Database Operations for Permanent Storage

export async function persistPostToFirestore(post: any) {
  const postPath = `posts/${post.id}`;
  try {
    const postRef = doc(db, 'posts', String(post.id));
    const cleanPost = {
      id: Number(post.id),
      title: String(post.title || '').trim(),
      content: String(post.content || '').trim(),
      author: String(post.author || 'Anonymous').trim(),
      author_flair: String(post.author_flair || 'ArseFinland Official Member').trim(),
      tag: String(post.tag || 'Discussion').trim(),
      upvotes: Number(post.upvotes || 0),
      downvotes: Number(post.downvotes || 0),
      comment_count: Number(post.comment_count || 0),
      image_url: String(post.image_url || '').trim(),
      created_at: String(post.created_at || new Date().toISOString()),
      last_activity_at: String(post.last_activity_at || post.created_at || new Date().toISOString())
    };
    await setDoc(postRef, cleanPost);
  } catch (err) {
    console.warn(`[Firestore] Failed to persist post ${post.id}:`, err);
  }
}

export async function updatePostVoteInFirestore(postId: number, upvotes: number, downvotes: number, lastActivityAt?: string) {
  const postPath = `posts/${postId}`;
  try {
    const postRef = doc(db, 'posts', String(postId));
    const updateData: Record<string, any> = {
      upvotes: Number(upvotes),
      downvotes: Number(downvotes)
    };
    if (lastActivityAt) {
      updateData.last_activity_at = String(lastActivityAt);
    }
    await updateDoc(postRef, updateData);
  } catch (err) {
    console.warn(`[Firestore] Failed to update post votes for ${postId}:`, err);
  }
}

export async function updatePostCommentCountInFirestore(postId: number, count: number, lastActivityAt?: string) {
  const postPath = `posts/${postId}`;
  try {
    const postRef = doc(db, 'posts', String(postId));
    const updateData: Record<string, any> = {
      comment_count: Number(count)
    };
    if (lastActivityAt) {
      updateData.last_activity_at = String(lastActivityAt);
    }
    await updateDoc(postRef, updateData);
  } catch (err) {
    console.warn(`[Firestore] Failed to update comment count for post ${postId}:`, err);
  }
}

export async function loadPostsFromFirestore(): Promise<any[]> {
  const path = 'posts';
  try {
    const snapshot = await getDocs(collection(db, 'posts'));
    const list: any[] = [];
    snapshot.forEach(docSnap => {
      list.push(docSnap.data());
    });
    return list;
  } catch (err) {
    console.warn('[Firestore] Could not load posts collection:', err);
    return [];
  }
}

export async function persistCommentToFirestore(comment: any) {
  const commentPath = `comments/${comment.id}`;
  try {
    const ref = doc(db, 'comments', String(comment.id));
    const cleanComment = {
      id: Number(comment.id),
      post_id: Number(comment.post_id),
      parent_id: comment.parent_id !== null && comment.parent_id !== undefined ? Number(comment.parent_id) : null,
      author: String(comment.author || 'Anonymous').trim(),
      author_flair: String(comment.author_flair || 'ArseFinland Official Member').trim(),
      content: String(comment.content || '').trim(),
      upvotes: Number(comment.upvotes || 0),
      created_at: String(comment.created_at || new Date().toISOString())
    };
    await setDoc(ref, cleanComment);
  } catch (err) {
    console.warn(`[Firestore] Failed to persist comment ${comment.id}:`, err);
  }
}

export async function loadCommentsFromFirestore(): Promise<any[]> {
  try {
    const snapshot = await getDocs(collection(db, 'comments'));
    const list: any[] = [];
    snapshot.forEach(docSnap => {
      list.push(docSnap.data());
    });
    return list;
  } catch (err) {
    console.warn('[Firestore] Could not load comments collection:', err);
    return [];
  }
}

export async function persistChatMessageToFirestore(msg: any) {
  try {
    const ref = doc(db, 'chat_messages', String(msg.id));
    const cleanMsg = {
      id: Number(msg.id),
      room: String(msg.room || 'general').trim(),
      author: String(msg.author || 'Anonymous').trim(),
      author_flair: String(msg.author_flair || 'ArseFinland Official Member').trim(),
      badge_color: String(msg.badge_color || '#EF4444').trim(),
      content: String(msg.content || '').trim(),
      created_at: String(msg.created_at || new Date().toISOString())
    };
    await setDoc(ref, cleanMsg);
  } catch (err) {
    console.warn(`[Firestore] Failed to persist chat message ${msg.id}:`, err);
  }
}

export async function loadChatMessagesFromFirestore(): Promise<any[]> {
  try {
    const snapshot = await getDocs(collection(db, 'chat_messages'));
    const list: any[] = [];
    snapshot.forEach(docSnap => {
      list.push(docSnap.data());
    });
    return list;
  } catch (err) {
    console.warn('[Firestore] Could not load chat messages collection:', err);
    return [];
  }
}

export async function persistSessionToFirestore(session: any) {
  try {
    const ref = doc(db, 'sessions', String(session.id));
    const cleanSession = {
      id: String(session.id),
      nickname: String(session.nickname || '').trim(),
      email: String(session.email || '').trim(),
      flair: String(session.flair || 'ArseFinland Official Member').trim(),
      created_at: String(session.created_at || new Date().toISOString()),
      last_active_at: String(session.last_active_at || new Date().toISOString()),
      expires_at: String(session.expires_at || new Date().toISOString())
    };
    await setDoc(ref, cleanSession);
  } catch (err) {
    console.warn(`[Firestore] Failed to persist session ${session.id}:`, err);
  }
}

export async function loadSessionsFromFirestore(): Promise<any[]> {
  try {
    const snapshot = await getDocs(collection(db, 'sessions'));
    const list: any[] = [];
    snapshot.forEach(docSnap => {
      list.push(docSnap.data());
    });
    return list;
  } catch (err) {
    console.warn('[Firestore] Could not load sessions collection:', err);
    return [];
  }
}

export async function persistRealmToFirestore(realm: any) {
  try {
    const ref = doc(db, 'realms', String(realm.id));
    const cleanRealm = {
      id: String(realm.id),
      name: String(realm.name || '').trim(),
      badge_color: String(realm.badge_color || '#EF4444').trim(),
      icon: String(realm.icon || '🔴').trim(),
      description: String(realm.description || '').trim(),
      is_default: Boolean(realm.is_default),
      created_at: String(realm.created_at || new Date().toISOString())
    };
    await setDoc(ref, cleanRealm);
  } catch (err) {
    console.warn(`[Firestore] Failed to persist realm ${realm.id}:`, err);
  }
}

export async function loadRealmsFromFirestore(): Promise<any[]> {
  try {
    const snapshot = await getDocs(collection(db, 'realms'));
    const list: any[] = [];
    snapshot.forEach(docSnap => {
      list.push(docSnap.data());
    });
    return list;
  } catch (err) {
    console.warn('[Firestore] Could not load realms collection:', err);
    return [];
  }
}

// Aliases for seamless imports
export const fetchAllPostsFromFirestore = loadPostsFromFirestore;
export const savePostToFirestore = persistPostToFirestore;
export const fetchAllCommentsFromFirestore = loadCommentsFromFirestore;
export const saveCommentToFirestore = persistCommentToFirestore;
export const fetchAllChatMessagesFromFirestore = loadChatMessagesFromFirestore;
export const saveChatMessageToFirestore = persistChatMessageToFirestore;
export const fetchAllSessionsFromFirestore = loadSessionsFromFirestore;
export const saveSessionToFirestore = persistSessionToFirestore;
export const fetchAllRealmsFromFirestore = loadRealmsFromFirestore;
export const saveRealmToFirestore = persistRealmToFirestore;

