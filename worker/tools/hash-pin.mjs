// Prints a PBKDF2-SHA256 hash and salt for a PIN, in the columns settings uses. Used once to write migrations/0002_sample.sql.
// Run: node tools/hash-pin.mjs 3690
import { hashPin } from '../src/auth.js'

const pin = process.argv[2]
if (!/^\d{4,8}$/.test(pin || '')) { console.error('usage: node tools/hash-pin.mjs <4 to 8 digits>'); process.exit(1) }
console.log(JSON.stringify(await hashPin(pin), null, 2))
