// Encrypts secrets (godown passwords, tokens) at rest with AES-256-GCM.
import crypto from 'node:crypto';

function getKey(hex = process.env.CREDENTIAL_ENC_KEY): Buffer {
  if (!hex || !/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error('CREDENTIAL_ENC_KEY must be 64 hex characters (32 bytes)');
  }
  return Buffer.from(hex, 'hex');
}

/** Output format: base64(iv[12] | tag[16] | ciphertext) */
export function sealSecret(plain: string, hex?: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', getKey(hex), iv);
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64');
}

export function openSecret(sealed: string, hex?: string): string {
  const raw = Buffer.from(sealed, 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', getKey(hex), raw.subarray(0, 12));
  d.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8');
}
