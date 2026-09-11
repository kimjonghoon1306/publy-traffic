import { chromium } from "patchright";
const UA="Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const KW="제주 감귤"; // 오늘 한번도 안 건드린 신선 키워드
const blk=s=>/접속이 불가|비정상적인 접근|일시적으로 제한/.test(s);
const ctx=await chromium.launchPersistentContext("",{channel:"chrome",headless:false,userAgent:UA,viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:3,locale:"ko-KR"});
const page=await ctx.newPage();
// 1) 모바일 통합검색 (사람이 먼저 검색)
await page.goto(`https://m.search.naver.com/search.naver?query=${encodeURIComponent(KW)}`,{waitUntil:"domcontentloaded",timeout:40000});
await page.waitForTimeout(3000);
const s1=await page.evaluate(()=>document.body?.innerText||"");
console.log(`[1.검색] 차단=${blk(s1)?"🚫":"✅"} len=${s1.length}`);
// 2) 검색결과에서 쇼핑 링크 찾기 (자연 클릭)
const link=await page.$('a[href*="cr.shopping.naver"], a[href*="inflow.pay.naver.com"], a[href*="smartstore.naver.com"], a[href*="msearch.shopping"]');
if(link){
  const href=await link.getAttribute("href");
  console.log(`[2.링크발견] ${(href||"").slice(0,55)}`);
  await Promise.all([page.waitForNavigation({timeout:40000,waitUntil:"domcontentloaded"}).catch(()=>{}), link.click().catch(()=>{})]);
  await page.waitForTimeout(4000);
} else {
  console.log("[2.링크] 통합검색에 쇼핑링크 없음 → 쇼핑탭으로");
  await page.goto(`https://msearch.shopping.naver.com/search/all?query=${encodeURIComponent(KW)}`,{waitUntil:"domcontentloaded",timeout:40000});
  await page.waitForTimeout(3500);
}
const s2=await page.evaluate(()=>document.body?.innerText||""); const t=await page.title();
console.log(`[3.도착] URL=${page.url().slice(0,50)}`);
console.log(`   차단=${blk(s2)?"🚫":"✅"} 로그인=${/NAVER 로그인/.test(t)?"🔒":"✅"} 상품=${/구매하기|장바구니|찜|리뷰|옵션/.test(s2)?"🛒있음":"없음"} len=${s2.length} title="${t}"`);
await page.waitForTimeout(1500); await ctx.close();
