import { chromium } from "patchright";
const HOST="http://gw.dataimpulse.com:10000", UB="6f4612398e929e09a365__cr.kr", PASS="d62608f358fe9282";
const UA="Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const ID="bb9653", PW="Sd4136002!";
const sess=Math.random().toString(36).slice(2,8);
const o={channel:"chrome",headless:false,userAgent:UA,viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:3,locale:"ko-KR",
  proxy:{server:HOST,username:`${UB};sessid.${sess};sessttl.30`,password:PASS}};
const ctx=await chromium.launchPersistentContext("",o); const page=await ctx.newPage();
await page.goto("https://nid.naver.com/nidlogin.login",{waitUntil:"domcontentloaded",timeout:45000});
await page.waitForTimeout(2500);
await page.click("#id"); for(const c of ID) await page.type("#id",c,{delay:130+Math.random()*80});
await page.waitForTimeout(700);
await page.click("#pw"); for(const c of PW) await page.type("#pw",c,{delay:130+Math.random()*80});
await page.waitForTimeout(900);
// 로그인 버튼 명시적 클릭
await page.click("button.btn_login, .btn_login, #submit_btn, button[type=submit]").catch(async()=>{ await page.keyboard.press("Enter"); });
await page.waitForTimeout(8000);
const u=page.url();
const bodyText=await page.evaluate(()=>document.body?.innerText||"").catch(()=>"");
const stillLogin=/nidlogin\.login/.test(u);
const has2fa=/기기 등록|자주 사용하는|캡차|보안 문자|자동입력 방지|인증|본인 확인|의심되는/.test(bodyText);
console.log(`로그인후 URL: ${u.slice(0,60)}`);
console.log(`아직 로그인페이지: ${stillLogin?"🔴예(실패/추가절차)":"✅아니오(성공가능)"}`);
console.log(`추가인증/캡차: ${has2fa?"🔴있음":"없음"}`);
console.log(`본문앞200: ${bodyText.replace(/\s+/g," ").slice(0,200)}`);
// 스토어 시도
try{ await page.goto("https://m.smartstore.naver.com/01074323888/products/5251835713",{waitUntil:"domcontentloaded",timeout:45000}); }catch(e){}
await page.waitForTimeout(4500);
const sb=await page.evaluate(()=>document.body?.innerText||"").catch(()=>""); const stt=await page.title().catch(()=>"");
console.log(`\n[스토어] title="${stt}" 차단=${/접속이 불가/.test(sb)?"🚫":"✅"} 상품=${/구매하기|장바구니|리뷰/.test(sb)?"🛒있음!":"없음"}`);
await page.waitForTimeout(2000);
await ctx.close();
