import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const lockDir = fs.mkdtempSync(path.join(os.tmpdir(), "publy-lock-test-"));
process.env.PUBLY_LOCK_DIR = lockDir;

const naver = await import(pathToFileURL(path.resolve("naver-bot/dist/account-lock.js")));
const neighbor = await import(pathToFileURL(path.resolve("neighbor-bot/dist/account-lock.js")));

try {
  const first = naver.acquireAccountLock("same-account", "글 발행");
  assert.equal(first.ok, true, "첫 작업은 계정 잠금을 얻어야 합니다");

  const blocked = neighbor.acquireAccountLock("same-account", "공감·댓글");
  assert.equal(blocked.ok, false, "다른 봇의 동일 계정 작업은 차단되어야 합니다");

  if (first.ok) first.release();
  const afterRelease = neighbor.acquireAccountLock("same-account", "공감·댓글");
  assert.equal(afterRelease.ok, true, "작업 종료 후 같은 계정을 다시 사용할 수 있어야 합니다");

  const otherAccount = naver.acquireAccountLock("other-account", "글 발행");
  assert.equal(otherAccount.ok, true, "다른 계정은 동시에 사용할 수 있어야 합니다");

  if (afterRelease.ok) afterRelease.release();
  if (otherAccount.ok) otherAccount.release();
  console.log("account-lock safety test: PASS");
} finally {
  fs.rmSync(lockDir, { recursive: true, force: true });
}
