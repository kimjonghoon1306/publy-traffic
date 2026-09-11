import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../neighbor-bot/package.json', import.meta.url));
const ts = require('typescript');
const compile = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const exports = {};
vm.runInNewContext(compile(fs.readFileSync('neighbor-bot/src/inflow-store.ts', 'utf8')), { exports, URL });
const { isStoreResult, isStoreLanding } = exports;
const target = { type: 'store', storeId: '01074323888', productId: '5249745230', storeUrl: 'https://smartstore.naver.com/01074323888/products/5249745230' };
const home = 'https://m.smartstore.naver.com/01074323888';
const raw = 'https://inflow.pay.naver.com/rd?no=&pType=m&retUrl=https%3A%2F%2Fm.smartstore.naver.com%2F01074323888&tr=ds&vcode=...';
assert.ok(decodeURIComponent(raw).includes('smartstore.naver.com/' + target.storeId), '기존 1회 decode도 실측 href 매칭');
for (const href of [raw, home, target.storeUrl, raw.replace('pType=m', 'pType=pc'), `https://inflow.pay.naver.com/rd?retUrl=${encodeURIComponent(encodeURIComponent(home))}`, `https://cr.shopping.naver.com/adcr?url=${encodeURIComponent(target.storeUrl)}`]) assert.equal(isStoreResult(href, target), true, href);
for (const href of [home + '9', home + '/products/111', 'https://evil.example/5249745230', 'https://smartstore.naver.com.evil.example/01074323888', raw + '&nl-ts-pid=abc', `https://nid.naver.com/nidlogin.login?url=${encodeURIComponent(home)}`, `https://inflow.pay.naver.com/rd?retUrl=${encodeURIComponent(home + '?nl-ts-pid=abc')}`, raw.replace('01074323888', 'namdoseafood'), '%%%']) assert.equal(isStoreResult(href, target), false, href);
assert.equal(isStoreLanding(raw, target), false);
assert.equal(isStoreLanding(home, target), true);
assert.equal(isStoreLanding(home, { ...target, storeId: undefined }), true);
const source = fs.readFileSync('neighbor-bot/src/naver.ts', 'utf8');
const ast = ts.createSourceFile('naver.ts', source, ts.ScriptTarget.Latest, true);
const names = ['inflowFindAndEnter', 'inflowDwellRead', 'inflowActions'];
const functions = ast.statements.filter(n => ts.isFunctionDeclaration(n) && names.includes(n.name?.text)).map(n => n.getText(ast)).join('\n');
const sandbox = { URL, console, isStoreResult, isStoreLanding, inflowRndInt: a => a, inflowRnd: a => a, inflowInterruptibleWait: async () => true, decideDwellSec: () => 3 };
vm.createContext(sandbox);
vm.runInContext(compile(functions), sandbox);
async function scenario({ mobile = true, popup = false, absent = false, landing = home, clickFail = false } = {}) {
  const logs = [], clicks = [], gotos = [];
  let current = `https://${mobile ? 'm.' : ''}search.naver.com/search.naver?query=${encodeURIComponent('굴비가게')}`;
  let scrolls = 0, closed = false, popupUrl = 'about:blank';
  const other = `https://smartstore.naver.com/namdoseafood?nl-ts-pid=abc`;
  const pages = [];
  const child = { url: () => popupUrl, waitForURL: async fn => { popupUrl = landing; if (!fn(new URL(landing))) throw Error('timeout'); }, close: async () => { closed = true; }, mouse: { wheel: async () => { scrolls++; } } };
  const anchors = [other, ...(absent ? [] : [raw])].map(href => ({ href, click: async () => {
    if (clickFail) throw Error('click failed');
    clicks.push(href);
    if (popup) pages.push(child); else current = landing;
  } }));
  sandbox.document = { querySelectorAll: () => anchors };
  const page = {
    url: () => current, context: () => ({ pages: () => pages }),
    mouse: { wheel: async () => { scrolls++; } }, waitForTimeout: async () => {}, waitForNavigation: async () => {},
    waitForURL: async fn => { if (!fn(new URL(current))) throw Error('timeout'); },
    goto: async url => { gotos.push(url); current = url; }, goBack: async () => { current = gotos[0]; },
    $$eval: async (_, fn) => fn(anchors), evaluateHandle: async (fn, arg) => ({ asElement: () => fn(arg) }),
    $: async () => { throw Error('홈에서 상품 옵션 셀렉터를 탐색하면 안 됨'); },
  };
  pages.push(page);
  const entered = await sandbox.inflowFindAndEnter(page, target, msg => logs.push(msg));
  assert.ok(gotos[0].includes(mobile ? 'tab.m_shop.all' : 'tab.nx_shop.all'));
  assert.equal(gotos.length, 1, '검색 쇼핑탭만 goto, 직접 진입 폴백 금지');
  assert.ok(!clicks.includes(other), '경쟁 광고 클릭 금지');
  if (absent || clickFail || landing !== home) {
    assert.equal(entered, null);
    if (absent) { assert.equal(clicks.length, 0); assert.ok(logs.some(s => s.includes('노출 밖'))); }
    if (popup && landing.includes('nid.naver.com')) assert.ok(closed);
  } else {
    assert.equal(entered, popup ? child : page);
    assert.deepEqual(clicks, [raw]);
    const beforeDwell = scrolls;
    await sandbox.inflowDwellRead(entered, msg => logs.push(msg), undefined, 3, 3, 'store');
    assert.ok(scrolls > beforeDwell);
    if (!popup) await sandbox.inflowActions(page, target, { optionView: true, rate: 1 }, msg => logs.push(msg));
    assert.ok(logs.some(s => s.includes('🎯 검색결과에서 대상 발견 → 클릭 진입')));
    assert.ok(logs.some(s => s.includes('스토어 홈(유효 체류)')));
    assert.ok(logs.some(s => s.includes('초 체류')));
  }
}
for (const mobile of [true, false]) for (const popup of [true, false]) await scenario({ mobile, popup });
await scenario({ absent: true });
await scenario({ clickFail: true });
await scenario({ landing: 'https://nid.naver.com/nidlogin.login', popup: true });
await scenario({ landing: 'https://nid.naver.com/nidlogin.login' });
await scenario({ landing: 'https://m.smartstore.naver.com/namdoseafood' });
await scenario({ landing: raw });
await assert.rejects(() => sandbox.inflowDwellRead({ url: () => 'https://nid.naver.com/nidlogin.login' }, () => {}, undefined, 3, 3, 'store'), /로그인창/);
console.log('PASS: 실측 href·중첩 인코딩·오매칭 방지 및 모바일/PC·동일/새 탭 진입→홈 체류, 광고 미클릭·노출 밖·실패/로그인 거부 (로컬 모의 검증)');
