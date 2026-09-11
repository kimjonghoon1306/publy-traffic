import { chromium } from "patchright";
// ★엔진과 일치하는 안드로이드 크롬 UA (patchright 실엔진=Chromium)
const UA="Mozilla/5.0 (Linux; Android 14; SM-S928N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";
const URL="https://m.smartstore.naver.com/bestfruits/products/515936041"; // 방금 그 신선 스토어
const blk=s=>/접속이 불가|비정상적인 접근|일시적으로 제한/.test(s);
const ctx=await chromium.launchPersistentContext("",{channel:"chrome",headless:false,userAgent:UA,viewport:{width:412,height:915},isMobile:true,hasTouch:true,deviceScaleFactor:3,locale:"ko-KR"});
const page=await ctx.newPage();
let st="?"; try{const r=await page.goto(URL,{waitUntil:"domcontentloaded",timeout:40000});st=r?r.status():"no";}catch(e){st="err";}
await page.waitForTimeout(5000);
const b=await page.evaluate(()=>document.body?.innerText||""); const t=await page.title();
console.log(`[안드로이드 크롬 UA] HTTP=${st} 차단=${blk(b)?"🚫":"✅"} 로그인=${/NAVER 로그인/.test(t)?"🔒":"✅"} 구매=${/구매하기|장바구니|찜하기/.test(b)?"🛒있음!":"없음"} len=${b.length} title="${t}"`);
console.log(/구매하기|장바구니|찜하기/.test(b)&&!blk(b)?"\n✅✅✅ UA일치로 뚫림!":(blk(b)?"\n🚫 여전히 차단(UA문제 아님)":"\n△"));
await page.waitForTimeout(1500); await ctx.close();
