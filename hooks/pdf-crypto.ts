// Copyright (c) 2026 Parag Pandya. MIT License, see LICENSE.
// Lazy Panda Panel: https://github.com/paragpandyareal/lazy-panda-panel

/**
 * Opens PDFs "encrypted" with an empty user password, which many are, only
 * to set permissions. That's the PDF standard security handler: RC4 and
 * AES-128 (revisions 2 to 4) and AES-256 (revisions 5 and 6). A PDF that
 * needs a real password is reported as protected. MD5, RC4 and AES are
 * written out here; SHA comes from the environment's crypto.subtle.
 */

const PAD = new Uint8Array([
  0x28, 0xbf, 0x4e, 0x5e, 0x4e, 0x75, 0x8a, 0x41, 0x64, 0x00, 0x4e, 0x56, 0xff, 0xfa, 0x01, 0x08, 0x2e, 0x2e, 0x00, 0xb6, 0xd0, 0x68, 0x3e, 0x80, 0x2f, 0x0c,
  0xa9, 0xfe, 0x64, 0x53, 0x69, 0x7a,
])

const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

// ── MD5 (RFC 1321) ──

const S = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21]
const K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0)

export function md5(data: Uint8Array): Uint8Array {
  const length = data.length
  const padded = new Uint8Array((((length + 8) >> 6) + 1) << 6)
  padded.set(data)
  padded[length] = 0x80
  const view = new DataView(padded.buffer)
  view.setUint32(padded.length - 8, (length * 8) >>> 0, true)
  view.setUint32(padded.length - 4, Math.floor((length * 8) / 2 ** 32), true)
  let a0 = 0x67452301
  let b0 = 0xefcdab89
  let c0 = 0x98badcfe
  let d0 = 0x10325476
  const m = new Uint32Array(16)
  for (let off = 0; off < padded.length; off += 64) {
    for (let k = 0; k < 16; k += 1) m[k] = view.getUint32(off + k * 4, true)
    let a = a0
    let b = b0
    let c = c0
    let d = d0
    for (let i = 0; i < 64; i += 1) {
      let f: number
      let g: number
      if (i < 16) {
        f = (b & c) | (~b & d)
        g = i
      } else if (i < 32) {
        f = (d & b) | (~d & c)
        g = (5 * i + 1) % 16
      } else if (i < 48) {
        f = b ^ c ^ d
        g = (3 * i + 5) % 16
      } else {
        f = c ^ (b | ~d)
        g = (7 * i) % 16
      }
      const t = d
      d = c
      c = b
      const x = (a + f + K[i]! + m[g]!) >>> 0
      b = (b + ((x << S[i]!) | (x >>> (32 - S[i]!)))) >>> 0
      a = t
    }
    a0 = (a0 + a) >>> 0
    b0 = (b0 + b) >>> 0
    c0 = (c0 + c) >>> 0
    d0 = (d0 + d) >>> 0
  }
  const out = new Uint8Array(16)
  const ov = new DataView(out.buffer)
  ;[a0, b0, c0, d0].forEach((v, k) => ov.setUint32(k * 4, v, true))
  return out
}

// ── RC4 ──

export function rc4(key: Uint8Array, data: Uint8Array): Uint8Array {
  const s = new Uint8Array(256)
  for (let i = 0; i < 256; i += 1) s[i] = i
  for (let i = 0, j = 0; i < 256; i += 1) {
    j = (j + s[i]! + key[i % key.length]!) & 0xff
    ;[s[i], s[j]] = [s[j]!, s[i]!]
  }
  const out = new Uint8Array(data.length)
  for (let k = 0, i = 0, j = 0; k < data.length; k += 1) {
    i = (i + 1) & 0xff
    j = (j + s[i]!) & 0xff
    ;[s[i], s[j]] = [s[j]!, s[i]!]
    out[k] = data[k]! ^ s[(s[i]! + s[j]!) & 0xff]!
  }
  return out
}

// ── AES (FIPS 197), written out: the environment's crypto.subtle has digest only ──

const SBOX = new Uint8Array(256)
const INV_SBOX = new Uint8Array(256)
;(() => {
  // The S-box from the multiplicative inverse in GF(2^8) and the affine map.
  let p = 1
  let q = 1
  do {
    p = p ^ ((p << 1) & 0xff) ^ (p & 0x80 ? 0x1b : 0)
    q ^= q << 1
    q ^= q << 2
    q ^= q << 4
    q &= 0xff
    if (q & 0x80) q ^= 0x09
    const x = q ^ ((q << 1) | (q >> 7)) ^ ((q << 2) | (q >> 6)) ^ ((q << 3) | (q >> 5)) ^ ((q << 4) | (q >> 4))
    SBOX[p] = (x ^ 0x63) & 0xff
  } while (p !== 1)
  SBOX[0] = 0x63
  for (let i = 0; i < 256; i += 1) INV_SBOX[SBOX[i]!] = i
})()

const xtime = (b: number) => ((b << 1) ^ (b & 0x80 ? 0x1b : 0)) & 0xff
const mul = (a: number, b: number) => {
  let r = 0
  for (; b; b >>= 1, a = xtime(a)) if (b & 1) r ^= a
  return r
}

/** The round keys for a 16- or 32-byte key: (rounds + 1) × 16 bytes. */
function expandKey(key: Uint8Array): Uint8Array {
  const nk = key.length / 4
  const rounds = nk + 6
  const w = new Uint8Array(16 * (rounds + 1))
  w.set(key)
  let rcon = 1
  for (let i = nk; i < 4 * (rounds + 1); i += 1) {
    let t = w.slice((i - 1) * 4, i * 4)
    if (i % nk === 0) {
      t = new Uint8Array([SBOX[t[1]!]! ^ rcon, SBOX[t[2]!]!, SBOX[t[3]!]!, SBOX[t[0]!]!])
      rcon = xtime(rcon)
    } else if (nk > 6 && i % nk === 4) {
      t = t.map(b => SBOX[b]!)
    }
    for (let j = 0; j < 4; j += 1) w[i * 4 + j] = w[(i - nk) * 4 + j]! ^ t[j]!
  }
  return w
}

function encryptBlock(w: Uint8Array, input: Uint8Array): Uint8Array {
  const rounds = w.length / 16 - 1
  const s = input.slice(0, 16)
  for (let i = 0; i < 16; i += 1) s[i]! ^= w[i]!
  for (let round = 1; round <= rounds; round += 1) {
    for (let i = 0; i < 16; i += 1) s[i] = SBOX[s[i]!]!
    // ShiftRows: row r moves left by r (the state is column-major).
    const t = s.slice()
    for (let c = 0; c < 4; c += 1) for (let r = 0; r < 4; r += 1) s[c * 4 + r] = t[((c + r) % 4) * 4 + r]!
    if (round < rounds) {
      for (let c = 0; c < 4; c += 1) {
        const [a0, a1, a2, a3] = [s[c * 4]!, s[c * 4 + 1]!, s[c * 4 + 2]!, s[c * 4 + 3]!]
        s[c * 4] = xtime(a0) ^ xtime(a1) ^ a1 ^ a2 ^ a3
        s[c * 4 + 1] = a0 ^ xtime(a1) ^ xtime(a2) ^ a2 ^ a3
        s[c * 4 + 2] = a0 ^ a1 ^ xtime(a2) ^ xtime(a3) ^ a3
        s[c * 4 + 3] = xtime(a0) ^ a0 ^ a1 ^ a2 ^ xtime(a3)
      }
    }
    for (let i = 0; i < 16; i += 1) s[i]! ^= w[round * 16 + i]!
  }
  return s
}

function decryptBlock(w: Uint8Array, input: Uint8Array): Uint8Array {
  const rounds = w.length / 16 - 1
  const s = input.slice(0, 16)
  for (let i = 0; i < 16; i += 1) s[i]! ^= w[rounds * 16 + i]!
  for (let round = rounds - 1; round >= 0; round -= 1) {
    const t = s.slice()
    for (let c = 0; c < 4; c += 1) for (let r = 0; r < 4; r += 1) s[((c + r) % 4) * 4 + r] = t[c * 4 + r]!
    for (let i = 0; i < 16; i += 1) s[i] = INV_SBOX[s[i]!]!
    for (let i = 0; i < 16; i += 1) s[i]! ^= w[round * 16 + i]!
    if (round > 0) {
      for (let c = 0; c < 4; c += 1) {
        const [a0, a1, a2, a3] = [s[c * 4]!, s[c * 4 + 1]!, s[c * 4 + 2]!, s[c * 4 + 3]!]
        s[c * 4] = mul(a0, 14) ^ mul(a1, 11) ^ mul(a2, 13) ^ mul(a3, 9)
        s[c * 4 + 1] = mul(a0, 9) ^ mul(a1, 14) ^ mul(a2, 11) ^ mul(a3, 13)
        s[c * 4 + 2] = mul(a0, 13) ^ mul(a1, 9) ^ mul(a2, 14) ^ mul(a3, 11)
        s[c * 4 + 3] = mul(a0, 11) ^ mul(a1, 13) ^ mul(a2, 9) ^ mul(a3, 14)
      }
    }
  }
  return s
}

/** AES-CBC encryption without padding: `data` is a whole number of blocks. */
export function aesEncryptRaw(key: Uint8Array, iv: Uint8Array, data: Uint8Array): Uint8Array {
  const w = expandKey(key)
  const out = new Uint8Array(data.length)
  let previous = iv
  for (let at = 0; at + 16 <= data.length; at += 16) {
    const block = data.slice(at, at + 16)
    for (let i = 0; i < 16; i += 1) block[i]! ^= previous[i]!
    previous = encryptBlock(w, block)
    out.set(previous, at)
  }
  return out
}

/** AES-CBC decryption without removing padding. */
export function aesDecryptRaw(key: Uint8Array, iv: Uint8Array, data: Uint8Array): Uint8Array {
  const w = expandKey(key)
  const out = new Uint8Array(data.length - (data.length % 16))
  let previous = iv
  for (let at = 0; at + 16 <= data.length; at += 16) {
    const block = data.subarray(at, at + 16)
    const plain = decryptBlock(w, block)
    for (let i = 0; i < 16; i += 1) out[at + i] = plain[i]! ^ previous[i]!
    previous = block
  }
  return out
}

/** An AES-encrypted string or stream: the first 16 bytes are the IV, then the data with PKCS#7 padding. */
function aesDecrypt(key: Uint8Array, data: Uint8Array): Uint8Array {
  if (data.length < 32 || data.length % 16 !== 0) return new Uint8Array(0)
  const plain = aesDecryptRaw(key, data.subarray(0, 16), data.subarray(16))
  const pad = plain[plain.length - 1]!
  return pad >= 1 && pad <= 16 ? plain.subarray(0, plain.length - pad) : plain
}

const sha = async (name: 'SHA-256' | 'SHA-384' | 'SHA-512', data: Uint8Array) => new Uint8Array(await crypto.subtle.digest(name, data))

/** Revision 6's hash (ISO 32000-2, algorithm 2.B), for the empty password. */
async function hashR6(input: Uint8Array): Promise<Uint8Array> {
  let k = await sha('SHA-256', input)
  for (let i = 0; ; i += 1) {
    const k1 = concat(...Array.from({ length: 64 }, () => k))
    const e = aesEncryptRaw(k.subarray(0, 16), k.subarray(16, 32), k1)
    let sum = 0
    for (let j = 0; j < 16; j += 1) sum += e[j]!
    k = await sha((['SHA-256', 'SHA-384', 'SHA-512'] as const)[sum % 3]!, e)
    if (i >= 63 && e[e.length - 1]! <= i - 32) break
    if (i > 1000) break
  }
  return k.subarray(0, 32)
}

export type EncryptInfo = {
  V: number
  R: number
  length: number
  O: Uint8Array
  U: Uint8Array
  UE?: Uint8Array
  P: number
  id: Uint8Array
  encryptMetadata: boolean
  /** The crypt filter method for strings and streams: 'RC4', 'AES' or 'None'. */
  method: 'RC4' | 'AES' | 'None'
}

/** Decrypts one string or stream of object `num gen`. */
export type Decrypter = (data: Uint8Array, num: number, gen: number) => Promise<Uint8Array>

/** The decrypter for the empty user password, or null when the PDF needs a real one. */
export async function openEncrypted(info: EncryptInfo): Promise<Decrypter | null> {
  if (info.method === 'None') return async data => data
  if (info.R >= 5) {
    const validation = info.U.subarray(32, 40)
    const keySalt = info.U.subarray(40, 48)
    const check = info.R === 5 ? await sha('SHA-256', validation) : await hashR6(validation)
    if (!equal(check, info.U.subarray(0, 32)) || !info.UE) return null
    const intermediate = info.R === 5 ? await sha('SHA-256', keySalt) : await hashR6(keySalt)
    const fileKey = aesDecryptRaw(intermediate, new Uint8Array(16), info.UE).subarray(0, 32)
    return async data => aesDecrypt(fileKey, data)
  }
  const n = info.R === 2 ? 5 : Math.max(5, Math.min(16, info.length / 8))
  const p = new Uint8Array(4)
  new DataView(p.buffer).setInt32(0, info.P, true)
  let key = md5(concat(PAD, info.O.subarray(0, 32), p, info.id, info.R >= 4 && !info.encryptMetadata ? new Uint8Array([255, 255, 255, 255]) : new Uint8Array(0)))
  if (info.R >= 3) for (let k = 0; k < 50; k += 1) key = md5(key.subarray(0, n))
  key = key.subarray(0, n)
  // The empty password is right when it reproduces /U.
  let isRight: boolean
  if (info.R === 2) {
    isRight = equal(rc4(key, PAD), info.U.subarray(0, 32))
  } else {
    let x = rc4(key, md5(concat(PAD, info.id)))
    for (let i = 1; i <= 19; i += 1) x = rc4(key.map(b => b ^ i), x)
    isRight = equal(x, info.U.subarray(0, 16))
  }
  if (!isRight) return null
  const isAes = info.method === 'AES'
  return async (data, num, gen) => {
    const extra = new Uint8Array([num & 0xff, (num >> 8) & 0xff, (num >> 16) & 0xff, gen & 0xff, (gen >> 8) & 0xff])
    const objectKey = md5(concat(key, extra, isAes ? new Uint8Array([0x73, 0x41, 0x6c, 0x54]) : new Uint8Array(0))).subarray(0, Math.min(n + 5, 16))
    return isAes ? aesDecrypt(objectKey, data) : rc4(objectKey, data)
  }
}

function equal(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let k = 0; k < a.length; k += 1) if (a[k] !== b[k]) return false
  return true
}
