import { chromium } from "patchright";
const UA="Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
// 네 폰에서 로그인없이 열렸던 진짜 형식(서브패스) — 새 폰IP로 딱 1번
const URL="https://m.smartstore.naver.com/01074323888/products/5251835713";
const blk=s=>/접속이 불가|비정상적인 접근|일시적으로 제한/.test(s);
const ctx=await chromium.launchPersistentContext("",{channel:"chrome",headless:false,userAgent:UA,viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:3,locale:"ko-KR"});
const page=await ctx.newPage();
let st="?"; try{const r=await page.goto(URL,{waitUntil:"domcontentloaded",timeout:40000});st=r?r.status():"no";}catch(e){st="err:"+(e.message||"").slice(0,25);}
await page.waitForTimeout(5000);
const b=await page.evaluate(()=>document.body?.innerText||"").catch(()=>""); const t=await page.title().catch(()=>"");
const buy=/구매하기|장바구니|바로구매|옵션|찜하기/.test(b);
console.log(`[네 폰IP + 진짜형식 서브패스] HTTP=${st}`);
console.log(`  차단=${blk(b)?"🚫":"✅"} 로그인=${/NAVER 로그인/.test(t)?"🔒":"✅"} 구매버튼=${buy?"🛒있음!":"없음"} 리뷰=${/리뷰|후기|평점/.test(b)?"⭐":"없음"} len=${b.length}`);
console.log(`  title="${t}"`);
console.log(buy&&!blk(b)?"\n✅✅✅ 진짜 상품페이지 열림!":(/NAVER 로그인/.test(t)?"\n🔒 로그인창":"🚫 차단"));
await page.waitForTimeout(1500); await ctx.close();
