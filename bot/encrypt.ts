/**
 * Zbot — AES-256-GCM Encryptor
 * File format: [salt:32B][iv:12B][ciphertext:N B][authTag:16B]
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PASSPHRASE = process.env.ZBOT_BUNDLE_KEY || 'Zbot2026SecureKey!@#xBot';
const SALT_LENGTH = 32;
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const PBKDF2_ITERATIONS = 100_000;
const KEY_LENGTH = 32;

function deriveKey(passphrase: string, salt: Buffer): Buffer {
  return crypto.pbkdf2Sync(passphrase, salt, PBKDF2_ITERATIONS, KEY_LENGTH, 'sha256');
}

function encrypt(plaintext: Buffer, passphrase: string): Buffer {
  const salt = crypto.randomBytes(SALT_LENGTH);
  const iv = crypto.randomBytes(IV_LENGTH);
  const key = deriveKey(passphrase, salt);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv, { authTagLength: AUTH_TAG_LENGTH });
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([salt, iv, encrypted, authTag]);
}

function main(): void {
  const inPath = path.resolve(__dirname, 'dist/bot.bundle.js');
  const outPath = path.resolve(__dirname, 'dist/bot.bundle.enc');

  if (!fs.existsSync(inPath)) {
    console.error('Input not found:', inPath);
    process.exit(1);
  }

  console.log('=== Zbot Encryptor (AES-256-GCM) ===');
  const plaintext = fs.readFileSync(inPath);
  console.log('Plaintext:', plaintext.length, 'bytes');
  const encrypted = encrypt(plaintext, PASSPHRASE);
  console.log('Encrypted:', encrypted.length, 'bytes (overhead: ' + (encrypted.length - plaintext.length) + ')');
  fs.writeFileSync(outPath, encrypted);
  console.log('Written to:', outPath);
}

main();
