import bcrypt from 'bcryptjs';

const SALT_ROUNDS = 10;
const CODE_DIGITS = 6;
const CODE_MOD = 10 ** CODE_DIGITS;

// Web Crypto is available in both Convex's V8 isolate and Node 19+.
// Using a Uint32Array of size 2 gives 8 bytes of entropy — well over the
// ~20 bits needed for a 6-digit modulus, and avoids the modulo-bias
// concern at 4-byte width (a 6-digit modulus over UInt32_max introduces
// only ~0.024% bias, but two words eliminates even that).
export function generate6DigitCode(): string {
  const buf = new Uint32Array(2);
  crypto.getRandomValues(buf);
  const combined = buf[0]! + buf[1]! * 0x1_0000_0000;
  return (combined % CODE_MOD).toString().padStart(CODE_DIGITS, '0');
}

export async function hashCode(plaintext: string): Promise<string> {
  return bcrypt.hash(plaintext, SALT_ROUNDS);
}

// bcrypt.compare is constant-time on the hash length, so comparing two
// fixed-cost-factor hashes does not leak position-of-mismatch via timing.
export async function verifyCodeHash(
  plaintext: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(plaintext, hash);
}
