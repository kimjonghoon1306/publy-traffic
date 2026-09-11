import { chromium } from "patchright";
const HOST="http://gw.dataimpulse.com:10000", UB="6f4612398e929e09a365__cr.kr", PASS="d62608f358fe9282";
const UA="Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const KW="수제청국장";
const blk=s=>/접속이 불가|비정상적인 접근|일시적으로 제한/.test(s);
const sess=Math.random().toString(36).slice(2,8);
const ctx=await chromium.launchPersistentContext("",{channel:"chrome",headless:false,userAgent:UA,viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:3,locale:"ko-KR",
  proxy:{server:HOST,username:`${UB};sessid.${sess};sessttl.30`,password:PASS}});
const page=await ctx.newPage();
// 통합검색 쇼핑탭(봇 실제 경로) — 쿠키 워밍 겸
await page.goto(`https://search.naver.com/search.naver?where=m_shop&query=${encodeURIComponent(KW)}`,{waitUntil:"domcontentloaded",timeout:40000});
await page.waitForTimeout(3500);
const sb=await page.evaluate(()=>document.body?.innerText||"");
console.log(`[쇼핑검색] 차단=${blk(sb)?"🚫":"✅"} len=${sb.length}`);
// 스토어 상품 링크 수집
const links=await page.$$eval('a[href]', as=>as.map(a=>a.href).filter(h=>h&&(h.includes("cr.shopping.naver")||h.includes("inflow.pay.naver.com")||(h.includes("smartstore.naver.com")&&h.includes("/products/")))).slice(0,5));
console.log(`상품링크 ${links.length}개: ${links.slice(0,2).map(l=>l.slice(0,50)).join(" | ")}`);
if(!links.length){ console.log("❌ 링크없음"); await ctx.close(); process.exit(0); }
// 첫 링크 실제 진입
await page.goto(links[0],{waitUntil:"domcontentloaded",timeout:40000,referer:"https://search.naver.com/"});
await page.waitForTimeout(5000);
const url=page.url(), b=await page.evaluate(()=>document.body?.innerText||""), t=await page.title();
const buy=/구매하기|장바구니|바로구매|옵션 선택|찜하기/.test(b);
console.log(`[상품도착] URL=${url.slice(0,55)} 차단=${blk(b)?"🚫":"✅"} 로그인=${/NAVER 로그인/.test(t)?"🔒":"✅"} 구매=${buy?"🛒":"없음"} 리뷰=${/리뷰|후기|평점/.test(b)?"⭐":"없음"} title="${t}"`);
console.log(buy&&!blk(b)?"\n✅✅✅ 성공! 이식 가치 있음":"\n🔴 실패");
await page.waitForTimeout(1500); await ctx.close();
