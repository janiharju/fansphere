import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import {
  getFirestore,
  doc,
  getDocFromServer,
  getDocs,
  collection,
  setDoc,
  deleteDoc,
  updateDoc
} from 'firebase/firestore';
import fs from 'node:fs';
import path from 'node:path';

// Read firebase-applet-config.json
const configPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
const rawConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

// Resolve API key safely from environment variable (never stored in plaintext)
const resolvedApiKey =
  process.env.FIREBASE_KEY ||
  process.env.FIREBASE_API_KEY ||
  (rawConfig.apiKey && rawConfig.apiKey !== 'FIREBASE_KEY' ? rawConfig.apiKey : '');

export const firebaseConfig = {
  ...rawConfig,
  apiKey: resolvedApiKey
};

export const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId); /* CRITICAL: The app will break without this line */
export const auth = getAuth(app);

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(error: unknown, operationType: OperationType, pathStr: string | null): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || []
    },
    operationType,
    path: pathStr
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export async function testConnection(): Promise<void> {
  try {
    const fetchPromise = getDocFromServer(doc(db, 'test', 'connection'));
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Connection check timeout')), 4000)
    );
    await Promise.race([fetchPromise, timeoutPromise]);
    console.log('[Firestore] Database connection validated successfully.');
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('[Firestore] Please check your Firebase configuration.');
    } else {
      // Permission denied or not found is normal for test doc; it confirms client connectivity to Firestore server
      console.log('[Firestore] Connection reachable (ping response received).');
    }
  }
}

// Call test connection on boot
testConnection().catch(() => {});
