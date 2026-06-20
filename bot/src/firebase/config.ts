/**
 * Zbot — Firebase Configuration (REAL, VERIFIED)
 */

export const firebaseConfig = {
  apiKey: 'AIzaSyBktNHjRK5_RI4trEZastvKR7dDPHv0O3Y',
  authDomain: 'zbot-e39f8.firebaseapp.com',
  databaseURL: 'https://zbot-e39f8-default-rtdb.asia-southeast1.firebasedatabase.app',
  projectId: 'zbot-e39f8',
  storageBucket: 'zbot-e39f8.firebasestorage.app',
  messagingSenderId: '569996077528',
  appId: '1:569996077528:web:4173b9701e77304dfaeaad',
};

export const ADMIN_UIDS = [
  'mBJdBiyAQ1Xsy301Ndu5teFnjUr1',
];

/** Admin PIN for hidden admin panel unlock (used by Android Kotlin side) */
export const ADMIN_PANEL_PIN = '4390';

export const RTDB_PATHS = {
  status: (deviceId: string) => `status/${deviceId}`,
  heartbeat: (deviceId: string) => `heartbeat/${deviceId}`,
  presence: (deviceId: string) => `presence/${deviceId}`,
  commandProgress: (cmdId: string) => `commandProgress/${cmdId}`,
  commandProgressDevice: (cmdId: string, deviceId: string) =>
    `commandProgress/${cmdId}/devices/${deviceId}`,
  configOverrides: (deviceId: string) => `configOverrides/${deviceId}`,
  // v2.1.6 FIX (M8): renamed from scamperEvidence (typo)
  scammerEvidence: (scammerPhone: string, evidenceId: string) =>
    `scammers/${scammerPhone}/evidence/${evidenceId}`,
} as const;

export const FS_COLLECTIONS = {
  numbers: 'numbers',
  scammers: 'scammers',
  commands: 'commands',
  commandResults: 'commandResults',
  configs: 'configs',
  adminLogs: 'adminLogs',
  meta: 'meta',
  archivedEvidence: 'archivedEvidence',
} as const;
