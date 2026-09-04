import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";

const MAGIC = "PUBLY_SESSION_V1";
export const SESSION_DIR = process.env.PUBLY_SESSION_DIR || path.join(os.homedir(), ".publy", "sessions");
const KEY_PATH = path.join(path.dirname(SESSION_DIR), "session.key");

function secureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(dir, 0o700); } catch {}
}

function key(): Buffer {
  secureDir(path.dirname(KEY_PATH));
  if (fs.existsSync(KEY_PATH)) return fs.readFileSync(KEY_PATH);
  const value = crypto.randomBytes(32);
  fs.writeFileSync(KEY_PATH, value, { mode: 0o600, flag: "wx" });
  return value;
}

export function sessionFile(name: string) {
  secureDir(SESSION_DIR);
  return path.join(SESSION_DIR, `${name}.session`);
}

function legacyFile(name: string, legacyDirs: string[]) {
  return legacyDirs.map(dir => path.join(dir, `${name}.json`)).find(file => fs.existsSync(file));
}

export function writeSession(name: string, value: unknown): void {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  const envelope = JSON.stringify({ v: 1, alg: "aes-256-gcm", iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: ciphertext.toString("base64") });
  const target = sessionFile(name);
  const temp = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${MAGIC}\n${envelope}`, { mode: 0o600 });
  fs.renameSync(temp, target);
  try { fs.chmodSync(target, 0o600); } catch {}
}

export function readSession<T>(name: string, legacyDirs: string[] = []): T {
  const target = sessionFile(name);
  if (fs.existsSync(target)) {
    const raw = fs.readFileSync(target, "utf8");
    if (!raw.startsWith(`${MAGIC}\n`)) throw new Error("지원하지 않는 세션 파일 형식");
    const env = JSON.parse(raw.slice(MAGIC.length + 1));
    const decipher = crypto.createDecipheriv("aes-256-gcm", key(), Buffer.from(env.iv, "base64"));
    decipher.setAuthTag(Buffer.from(env.tag, "base64"));
    return JSON.parse(Buffer.concat([decipher.update(Buffer.from(env.data, "base64")), decipher.final()]).toString("utf8"));
  }
  const legacy = legacyFile(name, legacyDirs);
  if (!legacy) throw new Error("세션 없음");
  const value = JSON.parse(fs.readFileSync(legacy, "utf8")) as T & { pw?: unknown; password?: unknown };
  delete value.pw;
  delete value.password;
  writeSession(name, value);
  fs.unlinkSync(legacy);
  return value;
}

export function hasSession(name: string, legacyDirs: string[] = []): boolean {
  if (fs.existsSync(sessionFile(name))) return true;
  const legacy = legacyFile(name, legacyDirs);
  if (!legacy) return false;
  try { readSession(name, legacyDirs); return true; } catch { return false; }
}

export function deleteSession(name: string, legacyDirs: string[] = []): void {
  for (const file of [sessionFile(name), ...legacyDirs.map(dir => path.join(dir, `${name}.json`))]) {
    try { if (fs.existsSync(file)) fs.unlinkSync(file); } catch {}
  }
}
