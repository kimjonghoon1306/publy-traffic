import { chromium } from "playwright";
const UB="c4dc884e452df80c4d6b__cr.kr", PASS="87e53222e36affb7";
const UA="Mozilla/5.0 (Linux; Android 14; SM-S928N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";
const KW="굴비";  // 회원이 넣는 씨앗 키워드
const STOREID="01074323888";
const sess=Math.random().toString(36).slice(2,8);
const browser=await chromium.launch({headless:true,args:["--no-sandbox","--disable-blink-features=AutomationControlled"],proxy:{server:"http://gw.dataimpulse.com:10000",username:`${UB};sessid.${sess};sessttl.10`,password:PASS}});
const ctx=await browser.newContext({userAgent:UA,viewport:{width:412,height:915},isMobile:true,hasTouch:true,deviceScaleFactor:3,locale:"ko-KR"});
const page=await ctx.newPage();
await page.goto(`https://m.search.naver.com/search.naver?query=${encodeURIComponent(KW)}`,{waitUntil:"domcontentloaded",timeout:40000});
await page.waitForTimeout(2200);
for(let i=0;i<3;i++){ await page.mouse.wheel(0,1200); await page.waitForTimeout(700); }
// 검색결과 쇼핑블록에서 상품 "제목 텍스트" 여러개 수집(내 스토어것 우선)
const items=await page.$$eval('a[href*="cr3.shopping.naver.com"], a[href*="smartstore"], a[href*="brand.naver"]', as=>as.map(a=>({href:a.href, text:(a.textContent||"").trim().replace(/\s+/g," ").slice(0,50)})).filter(x=>x.text.length>5).slice(0,10));
console.log(`쇼핑 결과 상품 ${items.length}개 (씨앗="${KW}"):`);
items.slice(0,8).forEach(x=>console.log(`  · ${x.text}`));
await browser.close();
