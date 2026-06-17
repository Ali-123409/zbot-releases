/**
 * Zbot — Firebase Init (Anonymous Auth with inMemoryPersistence)
 */

import { initializeApp, type FirebaseApp } from 'firebase/app';
import {
  getAuth,
  signInAnonymously,
  onAuthStateChanged,
  setPersistence,
  inMemoryPersistence,
  type User,
  type Auth,
} from 'firebase/auth';
import { getFirestore, type Firestore } from 'firebase/firestore';
import { getDatabase, type Database } from 'firebase/database';
import { firebaseConfig } from './config';

let _app: FirebaseApp | null = null;
let _auth: Auth | null = null;
let _db: Firestore | null = null;
let _rtdb: Database | null = null;
let _deviceId: string | null = null;

export function initFirebase(): { app: FirebaseApp; auth: Auth; db: Firestore; rtdb: Database } {
  if (_app && _auth && _db && _rtdb) {
    return { app: _app, auth: _auth, db: _db, rtdb: _rtdb };
  }
  _app = initializeApp(firebaseConfig);
  _auth = getAuth(_app);
  _db = getFirestore(_app);
  _rtdb = getDatabase(_app);
  return { app: _app, auth: _auth, db: _db, rtdb: _rtdb };
}

export async function signInAnonymous(): Promise<string> {
  const { auth } = initFirebase();
  try {
    await setPersistence(auth, inMemoryPersistence);
  } catch (err) {
    console.warn('[FIREBASE] setPersistence failed:', (err as Error).message);
  }

  return new Promise((resolve, reject) => {
    const unsubscribe = onAuthStateChanged(auth, async (user: User | null) => {
      if (user) {
        _deviceId = user.uid;
        unsubscribe();
        console.log('[FIREBASE] Anonymous auth OK, deviceId:', _deviceId);
        resolve(_deviceId);
      } else {
        try {
          await signInAnonymously(auth);
        } catch (err: unknown) {
          const e = err as Error;
          console.error('[FIREBASE] Anonymous sign-in failed:', e.message);
          unsubscribe();
          reject(e);
        }
      }
    });
  });
}

export function getDeviceId(): string {
  if (!_deviceId) throw new Error('Not signed in. Call signInAnonymous() first.');
  return _deviceId;
}

export function getDb(): Firestore {
  if (!_db) throw new Error('Firebase not initialized.');
  return _db;
}

export function getRtdb(): Database {
  if (!_rtdb) throw new Error('Firebase not initialized.');
  return _rtdb;
}

export function getAuthInstance(): Auth {
  if (!_auth) throw new Error('Firebase not initialized.');
  return _auth;
}
