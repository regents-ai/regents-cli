import fs from "node:fs/promises";

import { AuthError } from "../errors.js";

const PRIVATE_KEY_REGEX = /^0x[0-9a-fA-F]{64}$/;

export interface WalletSecretSource {
  getPrivateKeyHex(): Promise<`0x${string}`>;
}

export class EnvWalletSecretSource implements WalletSecretSource {
  readonly envVarName: string;

  constructor(envVarName: string) {
    this.envVarName = envVarName;
  }

  async getPrivateKeyHex(): Promise<`0x${string}`> {
    const value = process.env[this.envVarName];
    if (!value) {
      throw new AuthError(
        "wallet_private_key_missing",
        `environment variable ${this.envVarName} is not set`,
      );
    }

    if (!PRIVATE_KEY_REGEX.test(value)) {
      throw new AuthError(
        "wallet_private_key_invalid",
        `environment variable ${this.envVarName} does not contain a valid 32-byte hex private key`,
      );
    }

    return value as `0x${string}`;
  }
}

export interface PlaintextKeystoreFile {
  privateKey: `0x${string}`;
}

export class FileWalletSecretSource implements WalletSecretSource {
  readonly filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  async getPrivateKeyHex(): Promise<`0x${string}`> {
    let raw = "";
    try {
      raw = await fs.readFile(this.filePath, "utf8");
    } catch (error) {
      throw new AuthError(
        "wallet_keystore_missing",
        `wallet keystore file not found at ${this.filePath}`,
        error,
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new AuthError(
        "wallet_keystore_invalid",
        `wallet keystore file at ${this.filePath} is not valid JSON`,
        error,
      );
    }

    const candidate = (parsed as Partial<PlaintextKeystoreFile>).privateKey;
    if (!candidate || !PRIVATE_KEY_REGEX.test(candidate)) {
      throw new AuthError(
        "wallet_keystore_invalid",
        `wallet keystore file at ${this.filePath} does not contain a valid plaintext privateKey`,
      );
    }

    return candidate;
  }
}
