const crypto = require("crypto");

const KEY_PREFIX = "sk-cgpt-";
const KEY_BYTES = 24;
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 32;
const SALT_BYTES = 16;

function generateApiKey() {
  const raw = KEY_PREFIX + crypto.randomBytes(KEY_BYTES).toString("base64url");
  return raw;
}

function keyPrefix(raw) {
  return raw.slice(0, KEY_PREFIX.length + 4);
}

function hashKey(raw) {
  const salt = crypto.randomBytes(SALT_BYTES);
  const derived = crypto.scryptSync(raw, salt, SCRYPT_KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString("base64")}$${derived.toString("base64")}`;
}

function verifyKey(raw, encoded) {
  if (!encoded || typeof encoded !== "string") return false;
  const parts = encoded.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  const salt = Buffer.from(parts[4], "base64");
  const expected = Buffer.from(parts[5], "base64");
  let derived;
  try {
    derived = crypto.scryptSync(raw, salt, expected.length, { N, r, p });
  } catch {
    return false;
  }
  if (derived.length !== expected.length) return false;
  return crypto.timingSafeEqual(derived, expected);
}

module.exports = {
  KEY_PREFIX,
  generateApiKey,
  keyPrefix,
  hashKey,
  verifyKey,
};
