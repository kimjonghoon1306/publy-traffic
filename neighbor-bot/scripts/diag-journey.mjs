import { chromium } from "patchright";
const UA="Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const KW="유기농 아로니아즙"; // 오늘 한번도 안 건드린 신선 키워드
const blk=s=>/접속이 불가|비정상적인 접근|일시적으로 제한/.test(s);
const ctx=await chromium.launchPersistentContext("",{channel:"chrome",headless:false,userAgent:UA,viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:3,locale:"ko-KR"});
const page=await ctx.newPage();
// 1) 쇼핑 검색 (사람 흐름)
await page.goto(`https://msearch.shopping.naver.com/search/all?query=${encodeURIComponent(KW)}`,{waitUntil:"domcontentloaded",timeout:40000});
await page.waitForTimeout(4000);
const sb=await page.evaluate(()=>document.body?.innerText||"");
console.log(`[쇼핑검색] 차단=${blk(sb)?"🚫":"✅"} len=${sb.length}`);
// 2) 렌더된 페이지에서 스토어 상품 링크 찾기
const links=await page.$$eval('a[href]', as=>as.map(a=>a.href).filter(h=>h&&h.includes("smartstore.naver.com")&&h.includes("/products/")).slice(0,6));
console.log(`상품링크 ${links.length}개`);
links.slice(0,3).forEach(l=>console.log("  "+l.slice(0,75)));
if(!links.length){ console.log("❌ 링크없음(JS구조 바뀜)"); await ctx.close(); process.exit(0); }
// 3) 서브패스 형식 링크 우선 (main 아닌 것)
const target=links.find(l=>!l.includes("/main/"))||links[0];
console.log(`\n진입: ${target.slice(0,70)}`);
await page.goto(target,{waitUntil:"domcontentloaded",timeout:40000,referer:"https://msearch.shopping.naver.com/"});
await page.waitForTimeout(5000);
const b=await page.evaluate(()=>document.body?.innerText||""), t=await page.title();
const buy=/구매하기|장바구니|바로구매|옵션|찜하기/.test(b);
console.log(`[착지] HTTP상태 차단=${blk(b)?"🚫":"✅"} 로그인=${/NAVER 로그인/.test(t)?"🔒":"✅"} 구매=${buy?"🛒있음!":"없음"} 리뷰=${/리뷰|후기|평점/.test(b)?"⭐":"없음"} len=${b.length} URL=${page.url().slice(0,55)}`);
console.log(buy&&!blk(b)?"\n✅✅✅ 상품페이지 열림! 레시피 성립":"\n🔴 아직 실패");
await page.waitForTimeout(1500); await ctx.close();
