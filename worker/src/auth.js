// Keys, tokens and the PIN (docs/API.md "Keys"). Status and photo keys are 144 random bits, stored as is. Staff session
// tokens and upload tokens are stored only as SHA-256. The PIN is PBKDF2-SHA256, 100 000 iterations, random salt.

export const PIN_ITERATIONS = 100000

const b64 = bytes => btoa(String.fromCharCode(...bytes))
const fromB64 = s => Uint8Array.from(atob(s), ch => ch.charCodeAt(0))
const b64url = bytes => b64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

/** base64url of `bytes` random bytes (18 bytes = 144 bits = 24 characters). */
export const randomKey = (bytes = 18) => b64url(crypto.getRandomValues(new Uint8Array(bytes)))

export async function sha256Hex (text) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(d)].map(x => x.toString(16).padStart(2, '0')).join('')
}

async function pbkdf2 (pin, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits'])
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256))
}

/** { pin_hash, pin_salt, pin_iterations } for the settings row. */
export async function hashPin (pin) {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  return { pin_hash: b64(await pbkdf2(pin, salt, PIN_ITERATIONS)), pin_salt: b64(salt), pin_iterations: PIN_ITERATIONS }
}

export async function verifyPin (pin, { pin_hash: hash, pin_salt: salt, pin_iterations: iterations }) {
  if (typeof pin !== 'string' || !pin) return false
  const got = await pbkdf2(pin, fromB64(salt), iterations)
  const want = fromB64(hash)
  if (got.length !== want.length) return false
  let diff = 0
  for (let i = 0; i < got.length; i++) diff |= got[i] ^ want[i]
  return diff === 0
}

export const isUuidV4 = s => typeof s === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s)
