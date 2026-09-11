import { chromium } from "patchright";
const HOST="http://gw.dataimpulse.com:10000", UB="6f4612398e929e09a365__cr.kr", PASS="d62608f358fe9282";
const UA="Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const ID="bb9653", PW="Sd4136002!";
const FRESH="https://m.smartstore.naver.com/main/products/10073016965"; // 오늘 안건드린 신선 스토어
const blk=s=>/접속이 불가|비정상적인 접근|일시적으로 제한/.test(s);
const sess=Math.random().toString(36).slice(2,8);
const o={channel:"chrome",headless:false,userAgent:UA,viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:3,locale:"ko-KR",
  proxy:{server:HOST,username:`${UB};sessid.${sess};sessttl.30`,password:PASS}};
const ctx=await chromium.launchPersistentContext("",o); const page=await ctx.newPage();
// 로그인
await page.goto("https://nid.naver.com/nidlogin.login",{waitUntil:"domcontentloaded",timeout:45000});
await page.waitForTimeout(2500);
await page.click("#id"); for(const c of ID) await page.type("#id",c,{delay:130});
await page.waitForTimeout(600);
await page.click("#pw"); for(const c of PW) await page.type("#pw",c,{delay:130});
await page.waitForTimeout(800);
await page.keyboard.press("Enter");
await page.waitForTimeout(7000);
const loginOk=!/nidlogin\.login/.test(page.url());
console.log(`로그인: ${loginOk?"✅성공("+page.url().slice(0,30)+")":"🔴실패"}`);
// 신선 스토어 진입
let st="?"; try{const r=await page.goto(FRESH,{waitUntil:"domcontentloaded",timeout:45000});st=r?r.status():"no";}catch(e){st="err";}
await page.waitForTimeout(5000);
const b=await page.evaluate(()=>document.body?.innerText||"").catch(()=>""); const t=await page.title().catch(()=>"");
const buy=/구매하기|장바구니|옵션|배송|찜하기|리뷰/.test(b);
console.log(`[로그인+신선스토어] HTTP=${st} 차단=${blk(b)?"🚫":"✅"} 로그인벽=${/NAVER 로그인/.test(t)?"🔒":"✅"} 상품=${buy?"🛒있음!!":"없음"} title="${t}" len=${b.length}`);
await page.waitForTimeout(2000);
await ctx.close();
