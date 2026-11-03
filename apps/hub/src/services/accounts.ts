import { timingSafeEqual } from "node:crypto";
import type { AccountUser } from "@spectra/contracts";
import {
  createAccountToken,
  generateRecoveryCode,
  hashRecoveryCode,
  hashPassword,
  hashSecretToken,
  newId,
  verifyPassword,
} from "../crypto.js";
import type { Db } from "../db.js";
import type { HubEnv } from "../env.js";

export class AccountError extends Error {
  constructor(public readonly code: "username_taken" | "invalid_credentials" | "invalid_recovery_code") {
    super(code);
    this.name = "AccountError";
  }
}

interface AccountRow {
  id: string;
  display_name: string;
  username_key: string | null;
  password_hash: string | null;
  recovery_code_hash: string | null;
  recovery_code_confirmed: number;
}

interface AccountSession {
  secret_token: string;
  user: AccountUser;
}

interface AccountSessionWithRecovery extends AccountSession {
  recovery_code: string;
}

export class AccountService {
  constructor(private readonly db: Db, private readonly env: HubEnv) {}

  async register(nickname: string, password: string): Promise<AccountSessionWithRecovery> {
    const userId = newId();
    const secretToken = createAccountToken(userId, this.env.livekitApiSecret);
    const recoveryCode = generateRecoveryCode();
    const usernameKey = this.normalizeNickname(nickname);
    const passwordHash = await hashPassword(password);
    try {
      this.db.raw
        .prepare(
          `INSERT INTO users (
             id, identity, display_name, secret_token_hash, username_key, password_hash,
             recovery_code_hash, recovery_code_confirmed, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)`,
        )
        .run(
          userId,
          `u-${userId}`,
          nickname.trim(),
          hashSecretToken(secretToken, this.env.livekitApiSecret),
          usernameKey,
          passwordHash,
          hashRecoveryCode(recoveryCode, this.env.livekitApiSecret),
          Date.now(),
        );
    } catch (error) {
      if (error instanceof Error && error.message.includes("UNIQUE constraint failed: users.username_key")) {
        throw new AccountError("username_taken");
      }
      throw error;
    }
    return {
      secret_token: secretToken,
      recovery_code: recoveryCode,
      user: { id: userId, display_name: nickname.trim() },
    };
  }

  async login(nickname: string, password: string): Promise<AccountSession & { recovery_code?: string }> {
    const account = this.db.raw
      .prepare("SELECT * FROM users WHERE username_key = ?")
      .get(this.normalizeNickname(nickname)) as AccountRow | undefined;
    if (account?.password_hash === null || account?.password_hash === undefined) {
      throw new AccountError("invalid_credentials");
    }
    if (!(await verifyPassword(password, account.password_hash))) {
      throw new AccountError("invalid_credentials");
    }

    const recoveryCode = this.db.raw.transaction(() => {
      const current = this.db.raw
        .prepare("SELECT recovery_code_confirmed FROM users WHERE id = ?")
        .get(account.id) as { recovery_code_confirmed: number } | undefined;
      if (current === undefined) throw new AccountError("invalid_credentials");
      if (current.recovery_code_confirmed === 1) return undefined;

      const code = generateRecoveryCode();
      this.db.raw
        .prepare("UPDATE users SET recovery_code_hash = ? WHERE id = ?")
        .run(hashRecoveryCode(code, this.env.livekitApiSecret), account.id);
      return code;
    })();

    return {
      secret_token: createAccountToken(account.id, this.env.livekitApiSecret),
      user: { id: account.id, display_name: account.display_name },
      ...(recoveryCode === undefined ? {} : { recovery_code: recoveryCode }),
    };
  }

  async recoverPassword(
    nickname: string,
    recoveryCode: string,
    newPassword: string,
  ): Promise<AccountSessionWithRecovery> {
    const account = this.db.raw
      .prepare("SELECT id, display_name, recovery_code_hash FROM users WHERE username_key = ?")
      .get(this.normalizeNickname(nickname)) as Pick<AccountRow, "id" | "display_name" | "recovery_code_hash"> | undefined;
    const candidateHash = hashRecoveryCode(recoveryCode, this.env.livekitApiSecret);
    if (account?.recovery_code_hash === null || account?.recovery_code_hash === undefined) {
      throw new AccountError("invalid_recovery_code");
    }
    const candidate = Buffer.from(candidateHash, "hex");
    const stored = Buffer.from(account.recovery_code_hash, "hex");
    if (candidate.length !== stored.length || !timingSafeEqual(candidate, stored)) {
      throw new AccountError("invalid_recovery_code");
    }

    const passwordHash = await hashPassword(newPassword);
    const nextRecoveryCode = generateRecoveryCode();
    const result = this.db.raw
      .prepare(
        `UPDATE users
            SET password_hash = ?, recovery_code_hash = ?, recovery_code_confirmed = 0
          WHERE id = ? AND recovery_code_hash = ?`,
      )
      .run(
        passwordHash,
        hashRecoveryCode(nextRecoveryCode, this.env.livekitApiSecret),
        account.id,
        account.recovery_code_hash,
      );
    if (result.changes !== 1) throw new AccountError("invalid_recovery_code");

    return {
      secret_token: createAccountToken(account.id, this.env.livekitApiSecret),
      recovery_code: nextRecoveryCode,
      user: { id: account.id, display_name: account.display_name },
    };
  }

  acknowledgeRecoveryCode(secretToken: string, recoveryCode: string): boolean {
    const result = this.db.raw
      .prepare(
        `UPDATE users
            SET recovery_code_confirmed = 1
          WHERE secret_token_hash = ?
            AND recovery_code_hash = ?
            AND recovery_code_confirmed = 0`,
      )
      .run(
        hashSecretToken(secretToken, this.env.livekitApiSecret),
        hashRecoveryCode(recoveryCode, this.env.livekitApiSecret),
      );
    return result.changes === 1;
  }

  resolve(secretToken: string): AccountUser | undefined {
    const row = this.db.raw
      .prepare(
        `SELECT id, display_name, username_key, password_hash
           FROM users
          WHERE secret_token_hash = ?`,
      )
      .get(hashSecretToken(secretToken, this.env.livekitApiSecret)) as AccountRow | undefined;
    if (row?.username_key === null || row?.password_hash === null || row === undefined) return undefined;
    return { id: row.id, display_name: row.display_name };
  }

  resume(secretToken: string): { user: AccountUser; recovery_code?: string } | undefined {
    const tokenHash = hashSecretToken(secretToken, this.env.livekitApiSecret);
    const row = this.db.raw
      .prepare(
        `SELECT id, display_name, username_key, password_hash, recovery_code_confirmed
           FROM users
          WHERE secret_token_hash = ?`,
      )
      .get(tokenHash) as (AccountRow & { recovery_code_confirmed: number }) | undefined;
    if (row?.username_key === null || row?.password_hash === null || row === undefined) return undefined;

    if (row.recovery_code_confirmed === 1) {
      return { user: { id: row.id, display_name: row.display_name } };
    }

    const recoveryCode = generateRecoveryCode();
    const result = this.db.raw
      .prepare(
        `UPDATE users
            SET recovery_code_hash = ?
          WHERE id = ? AND recovery_code_confirmed = 0`,
      )
      .run(hashRecoveryCode(recoveryCode, this.env.livekitApiSecret), row.id);
    if (result.changes !== 1) return { user: { id: row.id, display_name: row.display_name } };
    return {
      user: { id: row.id, display_name: row.display_name },
      recovery_code: recoveryCode,
    };
  }

  private normalizeNickname(nickname: string): string {
    return nickname.trim().normalize("NFKC").toLocaleLowerCase("pt-BR");
  }
}
