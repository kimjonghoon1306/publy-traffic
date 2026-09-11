import { chromium } from "patchright";
const UA="Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const KW="제주 감귤";
const blk=s=>/접속이 불가|비정상적인 접근|일시적으로 제한/.test(s);
const ctx=await chromium.launchPersistentContext("",{channel:"chrome",headless:false,userAgent:UA,viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:3,locale:"ko-KR"});
const page=await ctx.newPage();
await page.goto(`https://m.search.naver.com/search.naver?query=${encodeURIComponent(KW)}`,{waitUntil:"domcontentloaded",timeout:40000});
await page.waitForTimeout(3000);
// 통합검색 페이지에서 "실제 상품" 링크만 추출 (쇼핑검색 더보기 링크 제외)
const links=await page.$$eval('a[href]', as=>as.map(a=>a.href).filter(h=>h && (
  h.includes("cr.shopping.naver.com") ||
  h.includes("inflow.pay.naver.com/rd") ||
  (h.includes("smartstore.naver.com") && h.includes("/products/")) ||
  (h.includes("brand.naver.com") && h.includes("/products/"))
) && !h.includes("/search/") ).slice(0,8));
console.log(`상품링크 ${links.length}개:`); links.slice(0,4).forEach(l=>console.log("  "+l.slice(0,70)));
if(!links.length){ console.log("❌ 통합검색에 상품 직접링크 없음"); await ctx.close(); process.exit(0); }
// 첫 상품 링크로 진입 (referer 통합검색)
await page.goto(links[0],{waitUntil:"domcontentloaded",timeout:40000,referer:"https://m.search.naver.com/"});
await page.waitForTimeout(5000);
const b=await page.evaluate(()=>document.body?.innerText||""); const t=await page.title();
console.log(`\n[상품도착] URL=${page.url().slice(0,55)}`);
console.log(`  차단=${blk(b)?"🚫":"✅"} 로그인=${/NAVER 로그인/.test(t)?"🔒":"✅"} 구매버튼=${/구매하기|장바구니|바로구매|찜하기|옵션/.test(b)?"🛒있음!":"없음"} 리뷰=${/리뷰|후기|평점/.test(b)?"⭐":"없음"} len=${b.length} title="${t}"`);
console.log(/구매하기|장바구니|찜하기/.test(b)&&!blk(b)?"\n✅✅✅ 진짜 상품페이지 도달! 레시피 성립":(blk(b)?"\n🚫 차단":/NAVER 로그인/.test(t)?"\n🔒 로그인벽":"\n△ 상품마커 애매"));
await page.waitForTimeout(1500); await ctx.close();
