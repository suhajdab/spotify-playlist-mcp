import { chmod, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";

const TokenRecordSchema = z.object({
  refreshToken: z.string().min(1),
  accessToken: z.string().min(1).optional(),
  accessTokenExpiresAt: z.number().int().nonnegative().optional(),
  authorizedAt: z.number().int().nonnegative(),
  scope: z.string(),
});

export type TokenRecord = z.infer<typeof TokenRecordSchema>;

export interface TokenStore {
  read(): Promise<TokenRecord | null>;
  write(token: TokenRecord): Promise<void>;
}
export class FileTokenStore implements TokenStore {
  constructor(private readonly path: string) {}

  async read(): Promise<TokenRecord | null> {
    let raw: string;
    try {
      raw = await readFile(this.path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw new Error("Unable to read the Spotify token file");
    }

    try {
      return TokenRecordSchema.parse(JSON.parse(raw));
    } catch {
      throw new Error("Spotify token file is invalid; run the auth bootstrap again");
    }
  }

  async write(token: TokenRecord): Promise<void> {
    const validated = TokenRecordSchema.parse(token);
    const directory = dirname(this.path);
    const temporaryPath = `${this.path}.${randomUUID()}.tmp`;
    await mkdir(directory, { recursive: true, mode: 0o700 });
    try {
      await writeFile(temporaryPath, `${JSON.stringify(validated, null, 2)}\n`, {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      });
      await rename(temporaryPath, this.path);
      await chmod(this.path, 0o600);
    } catch (error) {
      await unlink(temporaryPath).catch(() => undefined);
      throw error;
    }
  }
}
