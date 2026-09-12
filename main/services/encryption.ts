import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const ALGORITHM = 'aes-256-cbc';
const KEY_LENGTH = 32;
const IV_LENGTH = 16;

let masterKey: Buffer | null = null;

function getDataDirInternal(): string {
  const appData = process.env.APP_DATA || process.env.FLO_DATA_DIR;
  if (appData) return appData;
  return path.join(os.homedir(), '.flo-desktop');
}

export function getDataDir(): string {
  return getDataDirInternal();
}

function getMasterKeyPath(): string {
  return path.join(getDataDir(), 'master-key.enc');
}

function getMasterKey(): Buffer {
  if (masterKey) return masterKey;

  const keyPath = getMasterKeyPath();

  try {
    const encrypted = fs.readFileSync(keyPath, 'utf8');
    masterKey = Buffer.from(encrypted, 'utf8');
  } catch {
    masterKey = crypto.randomBytes(KEY_LENGTH);
    try {
      const dir = path.dirname(keyPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(keyPath, masterKey.toString('utf8'), { mode: 0o600 });
    } catch {
      // If we can't persist the key, we'll use an in-memory key.
      // Encryption will still work but won't survive restarts.
    }
  }

  return masterKey;
}

export function encryptString(plaintext: string): string {
  const key = getMasterKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return `${iv.toString('base64')}:${encrypted.toString('base64')}`;
}

export function decryptString(ciphertext: string): string {
  const key = getMasterKey();
  const parts = ciphertext.split(':');
  if (parts.length !== 2) throw new Error('Invalid ciphertext format');
  const iv = Buffer.from(parts[0], 'base64');
  const encrypted = Buffer.from(parts[1], 'base64');
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString('utf8');
}

export function isEncryptionAvailable(): boolean {
  try {
    const test = encryptString('test');
    decryptString(test);
    return true;
  } catch {
    return false;
  }
}

export function clearMasterKey(): void {
  masterKey = null;
}