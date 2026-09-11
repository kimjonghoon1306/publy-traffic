import { chromium } from "patchright";
const UA="Mozilla/5.0 (Linux; Android 14; SM-S928N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";
const KW="제주 감귤";
const blk=s=>/접속이 불가|비정상적인 접근|일시적으로 제한/.test(s);
const ctx=await chromium.launchPersistentContext("",{channel:"chrome",headless:false,userAgent:UA,viewport:{width:412,height:915},isMobile:true,hasTouch:true,deviceScaleFactor:3,locale:"ko-KR"});
const page=await ctx.newPage();
await page.goto(`https://m.search.naver.com/search.naver?query=${encodeURIComponent(KW)}`,{waitUntil:"domcontentloaded",timeout:40000});
await page.waitForTimeout(2500);
for(let i=0;i<3;i++){ await page.mouse.wheel(0,1200); await page.waitForTimeout(800); }
const gates=await page.$$eval('a[href]', as=>as.map(a=>a.href).filter(h=>h.includes("cr3.shopping.naver.com")&&h.includes("searchGate")).slice(0,5));
console.log(`상품 게이트 ${gates.length}개`);
if(!gates.length){ console.log("게이트 없음"); await ctx.close(); process.exit(0); }
const [popup]=await Promise.all([
  ctx.waitForEvent("page",{timeout:12000}).catch(()=>null),
  page.goto(gates[0],{waitUntil:"domcontentloaded",timeout:40000,referer:"https://m.search.naver.com/"}).catch(()=>{})
]);
const tp=popup||page;
await tp.waitForTimeout(6000);
const b=await tp.evaluate(()=>document.body?.innerText||""); const t=await tp.title();
console.log(`[상품도착] URL=${tp.url().slice(0,55)}`);
console.log(`  차단=${blk(b)?"🚫":"✅"} 로그인=${/NAVER 로그인/.test(t)?"🔒":"✅"} 구매=${/구매하기|장바구니|바로구매|찜하기/.test(b)?"🛒있음!":"없음"} 리뷰=${/리뷰|후기|평점/.test(b)?"⭐":"없음"} len=${b.length} title="${t}"`);
console.log(/구매하기|장바구니|찜하기/.test(b)&&!blk(b)?"\n✅✅✅✅ 완전 성공! 진짜 상품페이지 도달! 레시피 완성!":(blk(b)?"\n🚫차단":/NAVER 로그인/.test(t)?"\n🔒로그인벽 남음":"\n△len확인"));
await tp.waitForTimeout(2000); await ctx.close();
