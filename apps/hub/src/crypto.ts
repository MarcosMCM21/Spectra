/**
 * Camada de criptografia do Hub — exclusivamente `node:crypto` (DEC-09), sem
 * dependências nativas adicionais (`argon2`, `bcryptjs`).
 *
 * - Senhas e Chave de Criador Persistente: `scrypt` com salt aleatório.
 * - Código de acesso temporário: HMAC determinístico derivado do segredo do Hub,
 *   permitindo comparação em O(1) diretamente sobre o hash armazenado na sala.
 */
import { createHmac, randomBytes, randomUUID, scrypt, scryptSync, timingSafeEqual } from "node:crypto";

const SCRYPT_COST = 16384;
const SCRYPT_BLOCK_SIZE = 8;
const SCRYPT_PARALLELISM = 1;
const KEY_LENGTH = 64;
const SALT_BYTES = 16;

/** Charset sem caracteres ambíguos (I/O/0/1) — espelha `AccessCodeSchema`. */
const ACCESS_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const ACCESS_CODE_LENGTH = 8;
const ROOM_CODE_LENGTH = 10;

/** Código permanente compartilhável da sala, separado dos convites temporários. */
export function generateRoomCode(): string {
  const bytes = randomBytes(ROOM_CODE_LENGTH);
  return Array.from(bytes, (byte) => ACCESS_CODE_ALPHABET[byte & 31]).join("");
}

function deriveKey(password: string, salt: Buffer): Buffer {
  return scryptSync(password.normalize("NFKC"), salt, KEY_LENGTH, {
    N: SCRYPT_COST,
    r: SCRYPT_BLOCK_SIZE,
    p: SCRYPT_PARALLELISM,
  });
}

function encodeScrypt(digest: Buffer, salt: Buffer): string {
  return `scrypt$${SCRYPT_COST}$${SCRYPT_BLOCK_SIZE}$${SCRYPT_PARALLELISM}$${salt.toString("base64")}$${digest.toString("base64")}`;
}

/** Gera o hash autocontido (algoritmo + parâmetros + salt) de uma senha. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  return encodeScrypt(deriveKey(password, salt), salt);
}

/** Comparação em tempo constante de uma senha candidata contra o hash armazenado. */
export async function verifyPassword(password: string, storedHash: string | null): Promise<boolean> {
  if (storedHash === null) return false;
  const parts = storedHash.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, costRaw, blockSizeRaw, parallelismRaw, saltRaw, digestRaw] = parts as [
    string,
    string,
    string,
    string,
    string,
    string,
  ];
  const cost = Number(costRaw);
  const blockSize = Number(blockSizeRaw);
  const parallelism = Number(parallelismRaw);
  if (!Number.isInteger(cost) || !Number.isInteger(blockSize) || !Number.isInteger(parallelism)) {
    return false;
  }
  const salt = Buffer.from(saltRaw, "base64");
  const expected = Buffer.from(digestRaw, "base64");
  if (salt.length === 0 || expected.length !== KEY_LENGTH) return false;

  const derived = await new Promise<Buffer | null>((resolve, reject) => {
    scrypt(
      password.normalize("NFKC"),
      salt,
      expected.length,
      { N: cost, r: blockSize, p: parallelism },
      (error, value) => (error ? reject(error) : resolve(value)),
    );
  });
  if (derived === null || derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}

/** Nova Chave de Criador Persistente (`secret_token`) exibida ao criador. */
export function generateSecretToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Código de recuperação de 256 bits, exibido ao usuário apenas até a confirmação. */
export function generateRecoveryCode(): string {
  return randomBytes(32).toString("base64url");
}

/** Identidade estável de usuário autenticado: `u-<uuid>`. */
export function userIdentity(userId: string): string {
  return `u-${userId}`;
}

/** Identidade exclusiva por conexão para permitir Web e Desktop na mesma sala. */
export function livekitSessionIdentity(identity: string): string {
  return identity.startsWith("u-")
    ? `${identity}:${randomBytes(9).toString("base64url")}`
    : identity;
}

/**
 * Identidade de convidado sem conta (DEC-17 / `guest_sessions`):
 * `g-<slug8>-<rand12>` — permite rastrear bans mesmo sem Chave de Criador.
 */
export function guestIdentity(slug: string): string {
  const slugPart = slug.replace(/[^a-z0-9]/gi, "").slice(0, 8).toLowerCase() || "room";
  return `g-${slugPart}-${randomBytes(9).toString("base64url")}`;
}

/** Identificador interno (UUID v4) para linhas do SQLite. */
export function newId(): string {
  return randomUUID();
}

/** Código de acesso temporário legível (8 caracteres, sem ambiguidade). */
export function generateAccessCode(): string {
  const bytes = randomBytes(ACCESS_CODE_LENGTH);
  let code = "";
  for (let index = 0; index < ACCESS_CODE_LENGTH; index += 1) {
    const byte = bytes[index] ?? 0;
    // Rejeita amostras que introduzem viés de módulo no charset.
    if (byte >= 256 - (256 % ACCESS_CODE_ALPHABET.length)) {
      index -= 1;
      continue;
    }
    code += ACCESS_CODE_ALPHABET.charAt(byte % ACCESS_CODE_ALPHABET.length);
  }
  return code;
}

/** Hash estável da Chave de Criador Persistente (`secret_token_hash`). */
export function hashSecretToken(secretToken: string, hubSecret: string): string {
  return new AccessCodeHasher(hubSecret).hash(secretToken);
}

export function createAccountToken(userId: string, hubSecret: string): string {
  const encodedId = Buffer.from(userId, "utf8").toString("base64url");
  const signature = createHmac("sha256", hubSecret).update(`spectra-account:${userId}`).digest("base64url");
  return `${encodedId}_${signature}`;
}

export function hashRecoveryCode(recoveryCode: string, hubSecret: string): string {
  return createHmac("sha256", hubSecret).update(`spectra-recovery:${recoveryCode}`).digest("hex");
}

export function verifyAccountToken(token: string, hubSecret: string): string | undefined {
  const separator = token.indexOf("_");
  if (separator <= 0) return undefined;
  const encodedId = token.slice(0, separator);
  const signature = token.slice(separator + 1);
  let userId: string;
  try {
    userId = Buffer.from(encodedId, "base64url").toString("utf8");
  } catch {
    return undefined;
  }
  if (!/^[0-9a-f-]{36}$/i.test(userId)) return undefined;
  const expected = createHmac("sha256", hubSecret).update(`spectra-account:${userId}`).digest();
  const candidate = Buffer.from(signature, "base64url");
  if (candidate.length !== expected.length || !timingSafeEqual(candidate, expected)) return undefined;
  return userId;
}

/** Gerador HMAC determinístico a partir do segredo do Hub. */
export class AccessCodeHasher {
  constructor(private readonly secret: string) {}

  /** Hash comparável armazenado em `rooms.access_code_hash`. */
  hash(accessCode: string): string {
    return createHmac("sha256", this.secret).update(accessCode.toUpperCase()).digest("hex");
  }

  /** Comparação em tempo constante entre código candidato e hash vigente. */
  matches(accessCode: string, storedHash: string | null): boolean {
    if (storedHash === null) return false;
    const candidate = Buffer.from(this.hash(accessCode), "utf8");
    const expected = Buffer.from(storedHash, "utf8");
    if (candidate.length !== expected.length) return false;
    return timingSafeEqual(candidate, expected);
  }
}
