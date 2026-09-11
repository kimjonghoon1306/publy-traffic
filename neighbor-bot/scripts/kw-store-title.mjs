import { chromium } from "playwright";
const UB="c4dc884e452df80c4d6b__cr.kr", PASS="87e53222e36affb7";
const UA="Mozilla/5.0 (Linux; Android 14; SM-S928N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";
const KW="굴비";
const sess=Math.random().toString(36).slice(2,8);
const browser=await chromium.launch({headless:true,args:["--no-sandbox","--disable-blink-features=AutomationControlled"],proxy:{server:"http://gw.dataimpulse.com:10000",username:`${UB};sessid.${sess};sessttl.10`,password:PASS}});
const ctx=await browser.newContext({userAgent:UA,viewport:{width:412,height:915},isMobile:true,hasTouch:true,deviceScaleFactor:3,locale:"ko-KR"});
const page=await ctx.newPage();
await page.goto(`https://m.search.naver.com/search.naver?query=${encodeURIComponent(KW)}`,{waitUntil:"domcontentloaded",timeout:40000});
await page.waitForTimeout(2500);
for(let i=0;i<4;i++){ await page.mouse.wheel(0,1200); await page.waitForTimeout(800); }
// searchGate 링크의 상품명 = 보통 부모/형제 요소 텍스트. 페이지에서 '상품 제목'스러운 텍스트 수집
const titles=await page.evaluate(()=>{
  const out=[];
  // searchGate 앵커 주변 텍스트
  document.querySelectorAll('a[href*="cr3.shopping.naver.com"]').forEach(a=>{
    let t=(a.textContent||"").trim().replace(/\s+/g," ");
    if(t.length<5){ // 앵커 텍스트 비면 부모 탐색
      let p=a.parentElement; for(let i=0;i<3&&p;i++){ const pt=(p.textContent||"").trim().replace(/\s+/g," "); if(pt.length>=8){t=pt.slice(0,60);break;} p=p.parentElement; }
    }
    if(t.length>=5) out.push(t.slice(0,60));
  });
  return [...new Set(out)].slice(0,10);
});
console.log(`검색 "${KW}" 쇼핑 상품명 ${titles.length}개:`);
titles.forEach(t=>console.log("  · "+t));
await browser.close();
