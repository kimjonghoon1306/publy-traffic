import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";

const MAGIC = "PUBLY_SESSION_V1";
export const SESSION_DIR = process.env.PUBLY_SESSION_DIR || path.join(os.homedir(), ".publy", "sessions");
const KEY_PATH = path.join(path.dirname(SESSION_DIR), "session.key");

// ★ 세션을 찾을 후보 디렉터리들(쓰기는 SESSION_DIR에만, 읽기는 아래 전부 확인).
//   버전/환경이 달라져 PUBLY_SESSION_DIR가 바뀌면 예전에 저장한 세션이 다른 폴더에 있을 수 있다.
//   "연결은 됐는데 발행 때 세션 없음"의 주원인 → 후보 폴더를 모두 뒤져 각 폴더의 짝 키로 복호화.
function candidateDirs(): string[] {
  const dirs = [
    SESSION_DIR,
    path.join(os.homedir(), ".publy", "sessions"),
    process.env.APPDATA ? path.join(process.env.APPDATA, "publy", "publy-sessions") : "",
    process.env.APPDATA ? path.join(process.env.APPDATA, "Publy", "publy-sessions") : "",
  ].filter(Boolean);
  return [...new Set(dirs)];
}
function keyPathFor(dir: string) { return path.join(path.dirname(dir), "session.key"); }

function secureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(dir, 0o700); } catch {}
}

// 특정 디렉터리의 짝 키(없으면 SESSION_DIR 기본 키). 쓰기용은 기본 키만 생성한다.
function keyForDir(dir: string): Buffer {
  const kp = keyPathFor(dir);
  if (fs.existsSync(kp)) return fs.readFileSync(kp);
  return key();
}

function key(): Buffer {
  secureDir(path.dirname(KEY_PATH));
  if (fs.existsSync(KEY_PATH)) return fs.readFileSync(KEY_PATH);
  const value = crypto.randomBytes(32);
  try { fs.writeFileSync(KEY_PATH, value, { mode: 0o600, flag: "wx" }); return value; }
  catch { return fs.readFileSync(KEY_PATH); } // 동시 생성 경쟁 → 이미 만들어진 키 사용
}

export function sessionFile(name: string) {
  secureDir(SESSION_DIR);
  return path.join(SESSION_DIR, `${name}.session`);
}

// 후보 폴더들 중 name.session 이 실제로 있는 첫 경로(+그 폴더) 반환.
function findSessionPath(name: string): { file: string; dir: string } | null {
  for (const dir of candidateDirs()) {
    const f = path.join(dir, `${name}.session`);
    if (fs.existsSync(f)) return { file: f, dir };
  }
  return null;
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
  const found = findSessionPath(name);
  if (found) {
    const raw = fs.readFileSync(found.file, "utf8");
    if (!raw.startsWith(`${MAGIC}\n`)) throw new Error("지원하지 않는 세션 파일 형식");
    const env = JSON.parse(raw.slice(MAGIC.length + 1));
    const decipher = crypto.createDecipheriv("aes-256-gcm", keyForDir(found.dir), Buffer.from(env.iv, "base64"));
    decipher.setAuthTag(Buffer.from(env.tag, "base64"));
    const value = JSON.parse(Buffer.concat([decipher.update(Buffer.from(env.data, "base64")), decipher.final()]).toString("utf8"));
    // 다른 폴더에서 찾았으면 기본 폴더로 옮겨써서 다음부턴 바로 찾히게(자가 치유).
    if (found.dir !== SESSION_DIR) { try { writeSession(name, value); } catch {} }
    return value;
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
  if (findSessionPath(name)) return true;
  const legacy = legacyFile(name, legacyDirs);
  if (!legacy) return false;
  try { readSession(name, legacyDirs); return true; } catch { return false; }
}

// 🔍 세션 진단 — "세션 없음" 원인 파악용. 각 후보 폴더에 이 계정 세션이 있는지 + 폴더 안 전체 세션 수.
//   폴더마다 세션 0개면 = 로그인한 적 없음(계정 연결 안 함). 다른 이름으로 있으면 = 경로/이름 문제.
export function sessionDiagnosis(name: string, legacyDirs: string[] = []): string {
  const parts: string[] = [];
  for (const dir of candidateDirs()) {
    let mine = false, total = 0, names: string[] = [];
    try { mine = fs.existsSync(path.join(dir, `${name}.session`)); } catch {}
    try { names = fs.readdirSync(dir).filter(x => x.endsWith(".session")).map(x => x.replace(".session", "")); total = names.length; } catch {}
    parts.push(`${dir.replace(os.homedir(), "~")}=[내계정:${mine ? "O" : "X"}, 세션${total}개${total && total <= 4 ? `(${names.join(",")})` : ""}]`);
  }
  const legacy = legacyFile(name, legacyDirs);
  if (legacy) parts.push(`legacy=${legacy.replace(os.homedir(), "~")}`);
  return parts.join(" | ");
}

export function deleteSession(name: string, legacyDirs: string[] = []): void {
  const files = [
    ...candidateDirs().map(dir => path.join(dir, `${name}.session`)),
    ...legacyDirs.map(dir => path.join(dir, `${name}.json`)),
  ];
  for (const file of files) {
    try { if (fs.existsSync(file)) fs.unlinkSync(file); } catch {}
  }
}
