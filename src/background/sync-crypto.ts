/**
 * Sync encryption utilities — pure Web Crypto API (service worker compatible).
 * Used to encrypt sync envelopes before pushing to a remote server.
 */

/** Generate a random 16-byte salt for key derivation */
export function generateSalt(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(16));
}

/**
 * Derive an AES-GCM 256-bit key from a passphrase using PBKDF2.
 * @param passphrase - User-provided passphrase
 * @param salt - Random salt (use generateSalt() to create one)
 */
export async function deriveKey(
  passphrase: string,
  salt: Uint8Array,
): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: salt as BufferSource, iterations: 100_000, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/**
 * Encrypt a plaintext string with AES-GCM.
 * Returns base64(iv + ciphertext) where iv is 12 bytes.
 */
export async function encrypt(
  data: string,
  key: CryptoKey,
): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(data);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoded,
  );
  // Combine IV + ciphertext into a single buffer
  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(ciphertext), iv.length);
  return btoa(String.fromCharCode(...combined));
}

/**
 * Decrypt a base64(iv + ciphertext) string back to plaintext.
 * Expects the 12-byte IV prefix produced by encrypt().
 */
export async function decrypt(
  ciphertext: string,
  key: CryptoKey,
): Promise<string> {
  const raw = Uint8Array.from(atob(ciphertext), (c) => c.charCodeAt(0));
  const iv = raw.slice(0, 12);
  const data = raw.slice(12);
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    data,
  );
  return new TextDecoder().decode(decrypted);
}
