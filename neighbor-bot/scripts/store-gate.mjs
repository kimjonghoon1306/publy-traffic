import { chromium } from "patchright";
const UA="Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const KW="제주 감귤";
const blk=s=>/접속이 불가|비정상적인 접근|일시적으로 제한/.test(s);
const ctx=await chromium.launchPersistentContext("",{channel:"chrome",headless:false,userAgent:UA,viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:3,locale:"ko-KR"});
const page=await ctx.newPage();
await page.goto(`https://m.search.naver.com/search.naver?query=${encodeURIComponent(KW)}`,{waitUntil:"domcontentloaded",timeout:40000});
await page.waitForTimeout(2500);
for(let i=0;i<3;i++){ await page.mouse.wheel(0,1200); await page.waitForTimeout(800); }
// 진짜 상품 클릭링크 (searchGate = 상품 브릿지)
const gates=await page.$$eval('a[href]', as=>as.map(a=>a.href).filter(h=>h.includes("cr3.shopping.naver.com")&&h.includes("searchGate")).slice(0,5));
console.log(`상품 게이트 링크 ${gates.length}개`);
if(!gates.length){ console.log("❌ 게이트 링크 없음"); await ctx.close(); process.exit(0); }
console.log("클릭: "+gates[0].slice(0,80));
// 새 탭으로 열릴 수 있어 popup 대비
const [popup]=await Promise.all([
  ctx.waitForEvent("page",{timeout:15000}).catch(()=>null),
  page.goto(gates[0],{waitUntil:"domcontentloaded",timeout:40000,referer:"https://m.search.naver.com/"}).catch(()=>{})
]);
const target=popup||page;
await target.waitForTimeout(5000);
const b=await target.evaluate(()=>document.body?.innerText||""); const t=await target.title();
console.log(`\n[상품도착] URL=${target.url().slice(0,60)}`);
console.log(`  차단=${blk(b)?"🚫":"✅"} 로그인=${/NAVER 로그인/.test(t)?"🔒":"✅"} 구매버튼=${/구매하기|장바구니|바로구매|찜하기/.test(b)?"🛒있음!":"없음"} 리뷰=${/리뷰|후기|평점/.test(b)?"⭐":"없음"} len=${b.length} title="${t}"`);
console.log(/구매하기|장바구니|찜하기/.test(b)&&!blk(b)?"\n✅✅✅ 진짜 상품페이지 도달! 레시피 성립!":(blk(b)?"\n🚫 차단":/NAVER 로그인/.test(t)?"\n🔒 로그인벽":"\n△ 애매(len 확인)"));
await target.waitForTimeout(1500); await ctx.close();
