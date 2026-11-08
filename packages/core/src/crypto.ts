import {
  type KeyObject,
  createHash,
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  sign,
  timingSafeEqual,
  verify,
} from 'node:crypto';

export interface KeyPair {
  readonly id: string;
  readonly publicB64: string;
  readonly publicKey: KeyObject;
  readonly privateKey: KeyObject;
}

export const sha256hex = (data: string | Uint8Array): string => createHash('sha256').update(data).digest('hex');

export const keyIdOfPublic = (publicB64: string): string => sha256hex(Buffer.from(publicB64, 'base64')).slice(0, 16);

export function newKeyPair(): KeyPair {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const publicB64 = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
  return { id: keyIdOfPublic(publicB64), publicB64, publicKey, privateKey };
}

export const publicKeyFromB64 = (b64: string): KeyObject =>
  createPublicKey({ key: Buffer.from(b64, 'base64'), format: 'der', type: 'spki' });

export const signString = (privateKey: KeyObject, data: string): string =>
  sign(null, Buffer.from(data), privateKey).toString('base64');

export function verifyString(publicKey: KeyObject, data: string, signatureB64: string): boolean {
  try {
    return verify(null, Buffer.from(data), publicKey, Buffer.from(signatureB64, 'base64'));
  } catch {
    return false;
  }
}

export const randomId = (bytes = 16): string => randomBytes(bytes).toString('hex');

export function constantTimeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
