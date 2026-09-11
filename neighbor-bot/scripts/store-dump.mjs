import { chromium } from "patchright";
const UA="Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const KW="제주 감귤";
const ctx=await chromium.launchPersistentContext("",{channel:"chrome",headless:false,userAgent:UA,viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:3,locale:"ko-KR"});
const page=await ctx.newPage();
await page.goto(`https://m.search.naver.com/search.naver?query=${encodeURIComponent(KW)}`,{waitUntil:"domcontentloaded",timeout:40000});
await page.waitForTimeout(2500);
// 쇼핑 블록 로드 위해 스크롤
for(let i=0;i<4;i++){ await page.mouse.wheel(0,1200); await page.waitForTimeout(900); }
// 링크 호스트 패턴 집계
const hosts=await page.$$eval('a[href]', as=>{ const m={}; as.forEach(a=>{ try{ const h=new URL(a.href).hostname; m[h]=(m[h]||0)+1; }catch{} }); return m; });
console.log("=== 링크 호스트 분포 ==="); Object.entries(hosts).sort((a,b)=>b[1]-a[1]).slice(0,15).forEach(([h,c])=>console.log(`  ${c}  ${h}`));
// 쇼핑/상품 관련 링크 샘플
const shop=await page.$$eval('a[href]', as=>as.map(a=>a.href).filter(h=>/shopping|smartstore|brand\.naver|products|inflow\.pay|pay\.naver/.test(h)).slice(0,10));
console.log("\n=== 쇼핑/상품 관련 링크 샘플 ==="); shop.forEach(l=>console.log("  "+l.slice(0,90)));
await page.waitForTimeout(1000); await ctx.close();
