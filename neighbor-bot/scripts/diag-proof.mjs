import { chromium } from "patchright";
const HOST="http://gw.dataimpulse.com:10000", UB="6f4612398e929e09a365__cr.kr", PASS="d62608f358fe9282";
const UA="Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const KW="수제청국장"; // 신선 키워드(오늘 안 두들김)
const blk=s=>/접속이 불가|비정상적인 접근|일시적으로 제한/.test(s);
const sess=Math.random().toString(36).slice(2,8);
const ctx=await chromium.launchPersistentContext("",{channel:"chrome",headless:false,userAgent:UA,viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:3,locale:"ko-KR",
  proxy:{server:HOST,username:`${UB};sessid.${sess};sessttl.30`,password:PASS}});
const page=await ctx.newPage();
// 1) 검색 (자연 진입)
await page.goto(`https://m.search.naver.com/search.naver?query=${encodeURIComponent(KW)}`,{waitUntil:"domcontentloaded",timeout:40000});
await page.waitForTimeout(3000);
const sb=await page.evaluate(()=>document.body?.innerText||"");
console.log(`[검색] 차단=${blk(sb)?"🚫":"✅"} len=${sb.length}`);
// 2) 검색결과에서 스토어 상품 링크 클릭 (실제 사람처럼)
const link=await page.$('a[href*="cr.shopping.naver"], a[href*="inflow.pay.naver.com"], a[href*="smartstore.naver.com"][href*="/products/"]');
if(!link){ console.log("❌ 검색결과에 스토어 상품 링크 없음"); await ctx.close(); process.exit(0); }
const href=await link.getAttribute("href");
console.log(`클릭할 링크: ${(href||"").slice(0,60)}`);
await Promise.all([page.waitForNavigation({timeout:40000,waitUntil:"domcontentloaded"}).catch(()=>{}), link.click().catch(()=>{})]);
await page.waitForTimeout(5000);
const url=page.url(), b=await page.evaluate(()=>document.body?.innerText||""), t=await page.title();
const buy=/구매하기|장바구니|바로구매|옵션 선택|찜하기/.test(b);
const review=/리뷰|후기|평점/.test(b);
console.log(`[상품도착] URL=${url.slice(0,55)}`);
console.log(`  차단=${blk(b)?"🚫":"✅"} 로그인=${/NAVER 로그인/.test(t)?"🔒":"✅"} 구매버튼=${buy?"🛒있음":"없음"} 리뷰=${review?"⭐있음":"없음"} title="${t}"`);
console.log(buy&&!blk(b)?"\n✅✅✅ 진짜 상품페이지 도달 성공! 이식 가치 있음":"\n🔴 아직 상품페이지 실패 — 이식 이름");
await page.waitForTimeout(2000);
await ctx.close();
