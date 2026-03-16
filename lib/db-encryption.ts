import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

const ENCRYPTION_PREFIX = 'enc:v1';
const ALGORITHM = 'aes-256-gcm';

function getKey() {
  const secret = process.env.DATABASE_ENCRYPTION_KEY || '';

  if (!secret) {
    throw new Error('DATABASE_ENCRYPTION_KEY is not set');
  }

  // Derive a stable 32-byte key from the configured secret.
  return createHash('sha256').update(secret, 'utf8').digest();
}

export function encryptValue(value: string | null | undefined) {
  if (value === null || value === undefined) {
    return null;
  }

  if (value.startsWith(`${ENCRYPTION_PREFIX}:`)) {
    return value;
  }

  const key = getKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `${ENCRYPTION_PREFIX}:${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted.toString('base64')}`;
}

export function decryptValue(value: string | null | undefined) {
  if (value === null || value === undefined) {
    return null;
  }

  if (!value.startsWith(`${ENCRYPTION_PREFIX}:`)) {
    return value;
  }

  const [, , ivB64, authTagB64, payloadB64] = value.split(':');

  if (!ivB64 || !authTagB64 || !payloadB64) {
    throw new Error('Encrypted value has invalid format');
  }

  const key = getKey();
  const iv = Buffer.from(ivB64, 'base64');
  const authTag = Buffer.from(authTagB64, 'base64');
  const payload = Buffer.from(payloadB64, 'base64');

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([decipher.update(payload), decipher.final()]);
  return decrypted.toString('utf8');
}

export function encryptFields<T extends Record<string, unknown>, K extends keyof T>(
  row: T,
  fields: K[]
): T {
  const next = { ...row };

  for (const field of fields) {
    const currentValue = next[field];

    if (typeof currentValue === 'string' || currentValue === null || currentValue === undefined) {
      next[field] = encryptValue(currentValue as string | null | undefined) as T[K];
    }
  }

  return next;
}

export function decryptFields<T extends Record<string, unknown>, K extends keyof T>(
  row: T,
  fields: K[]
): T {
  const next = { ...row };

  for (const field of fields) {
    const currentValue = next[field];

    if (typeof currentValue === 'string' || currentValue === null || currentValue === undefined) {
      next[field] = decryptValue(currentValue as string | null | undefined) as T[K];
    }
  }

  return next;
}
