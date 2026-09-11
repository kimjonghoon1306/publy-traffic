import { chromium } from "patchright";
const HOST="http://gw.dataimpulse.com:10000", UB="6f4612398e929e09a365__cr.kr", PASS="d62608f358fe9282";
const UA="Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const URL="https://m.smartstore.naver.com/01074323888/products/5251835713";
const ID="bb9653", PW="Sd4136002!";
const blk=s=>/현재 서비스 접속이 불가|비정상적인 접근|일시적으로 제한/.test(s);
const sess=Math.random().toString(36).slice(2,8);
const o={channel:"chrome",headless:false,userAgent:UA,viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:3,locale:"ko-KR",
  proxy:{server:HOST,username:`${UB};sessid.${sess};sessttl.30`,password:PASS}};
const ctx=await chromium.launchPersistentContext("",o); const page=await ctx.newPage();
// 1) 네이버 로그인 (사람처럼 타이핑)
await page.goto("https://nid.naver.com/nidlogin.login",{waitUntil:"domcontentloaded",timeout:45000});
await page.waitForTimeout(2000);
await page.fill("#id",""); for(const c of ID){ await page.type("#id",c,{delay:120+Math.random()*90}); }
await page.waitForTimeout(800);
for(const c of PW){ await page.type("#pw",c,{delay:120+Math.random()*90}); }
await page.waitForTimeout(1000);
await page.click(".btn_login, #log\\.login, button[type=submit]").catch(()=>{});
await page.waitForTimeout(6000);
const afterUrl=page.url(); const afterBody=await page.evaluate(()=>document.body?.innerText||"").catch(()=>"");
const loginOk=!/nidlogin|로그인/.test(afterUrl) || /로그아웃|MY|내정보/.test(afterBody);
console.log(`[로그인] URL=${afterUrl.slice(0,50)} 성공추정=${loginOk?"✅":"❓"} 캡차/2차=${/캡차|captcha|인증|기기등록|보호/.test(afterBody)?"🔴있음":"없음"}`);
// 2) 로그인 상태로 스토어 상품 진입
let st="?"; try{const r=await page.goto(URL,{waitUntil:"domcontentloaded",timeout:45000});st=r?r.status():"no";}catch(e){st="err:"+(e.message||"").slice(0,25);}
await page.waitForTimeout(4500);
const b=await page.evaluate(()=>document.body?.innerText||"").catch(()=>""); const t=await page.title().catch(()=>"");
const buy=/구매하기|장바구니|옵션|배송|찜하기|리뷰/.test(b);
console.log(`[스토어(로그인후)] HTTP=${st} 차단=${blk(b)?"🚫":"✅"} 상품=${buy?"🛒있음!":"없음"} len=${b.length} title="${t}"`);
await ctx.close();
