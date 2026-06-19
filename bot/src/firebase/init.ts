/**
 * Zbot — Firebase Init (LAZY initialization)
 *
 * CRITICAL FIX: Firestore and RTDB are NOT initialized during bootstrap.
 * They are lazily initialized ONLY when getDb()/getRtdb() is first called,
 * which happens AFTER WhatsApp connection opens.
 *
 * This prevents gRPC connections from blocking the event loop during pairing.
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
let _db: Firestore | null = null;      // LAZY — not initialized until getDb()
let _rtdb: Database | null = null;      // LAZY — not initialized until getRtdb()
let _deviceId: string | null = null;

/**
 * Initialize Firebase App + Auth ONLY.
 * Does NOT initialize Firestore or RTDB — those are lazy.
 */
export function initFirebase(): { app: FirebaseApp; auth: Auth } {
  if (_app && _auth) {
    return { app: _app, auth: _auth };
  }
  _app = initializeApp(firebaseConfig);
  _auth = getAuth(_app);
  // NOTE: Do NOT call getFirestore() or getDatabase() here!
  // They establish gRPC connections that block the event loop during pairing.
  return { app: _app, auth: _auth };
}

/**
 * Sign in anonymously. Returns the UID (deviceId).
 */
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

/**
 * LAZY: Initialize Firestore on first call.
 * This is called AFTER WhatsApp connection opens (from socket.ts).
 */
export function getDb(): Firestore {
  if (!_db) {
    if (!_app) throw new Error('Firebase not initialized. Call initFirebase() first.');
    console.log('[FIREBASE] Initializing Firestore (lazy)...');
    _db = getFirestore(_app);
  }
  return _db;
}

/**
 * LAZY: Initialize RTDB on first call.
 * This is called AFTER WhatsApp connection opens (from socket.ts).
 */
export function getRtdb(): Database {
  if (!_rtdb) {
    if (!_app) throw new Error('Firebase not initialized. Call initFirebase() first.');
    console.log('[FIREBASE] Initializing RTDB (lazy)...');
    _rtdb = getDatabase(_app);
  }
  return _rtdb;
}

export function getAuthInstance(): Auth {
  if (!_auth) throw new Error('Firebase not initialized.');
  return _auth;
}
