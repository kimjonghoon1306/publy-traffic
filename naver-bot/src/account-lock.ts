import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";

const LOCK_DIR = process.env.PUBLY_LOCK_DIR || path.join(os.tmpdir(), "publy-account-locks");
const STALE_MS = 12 * 60 * 60 * 1000;

export type AccountLock = { ok: true; release: () => void } | { ok: false; owner: string };

function lockPath(accountId: string): string {
  const key = crypto.createHash("sha256").update(accountId.trim().toLowerCase()).digest("hex");
  return path.join(LOCK_DIR, `${key}.lock`);
}

function processAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

export function acquireAccountLock(accountId: string, owner: string): AccountLock {
  if (!accountId.trim()) return { ok: true, release: () => {} };
  fs.mkdirSync(LOCK_DIR, { recursive: true });
  const file = lockPath(accountId);
  const token = crypto.randomUUID();
  const payload = JSON.stringify({ pid: process.pid, owner, token, createdAt: Date.now() });

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const fd = fs.openSync(file, "wx", 0o600);
      fs.writeFileSync(fd, payload, "utf8");
      fs.closeSync(fd);
      return { ok: true, release: () => {
        try {
          const current = JSON.parse(fs.readFileSync(file, "utf8"));
          if (current.token === token) fs.unlinkSync(file);
        } catch {}
      } };
    } catch (error: any) {
      if (error?.code !== "EEXIST") throw error;
      try {
        const current = JSON.parse(fs.readFileSync(file, "utf8"));
        const stale = Date.now() - Number(current.createdAt || 0) > STALE_MS || !processAlive(Number(current.pid));
        if (stale) { fs.unlinkSync(file); continue; }
        return { ok: false, owner: String(current.owner || "다른 자동화") };
      } catch {
        try { fs.unlinkSync(file); } catch {}
      }
    }
  }
  return { ok: false, owner: "다른 자동화" };
}
