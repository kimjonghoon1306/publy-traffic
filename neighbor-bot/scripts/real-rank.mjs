import { chromium } from "playwright";
const UB="c4dc884e452df80c4d6b__cr.kr", PASS="87e53222e36affb7";
const UA="Mozilla/5.0 (Linux; Android 14; SM-S928N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";
const STOREID="narizio", PRODID="44755477842"; // 테리 박대 상품
async function tryRank(KW){
  const sess=Math.random().toString(36).slice(2,6);
  const browser=await chromium.launch({headless:true,args:["--no-sandbox","--disable-blink-features=AutomationControlled"],proxy:{server:"http://gw.dataimpulse.com:10000",username:`${UB};sessid.${sess};sessttl.10`,password:PASS}});
  const ctx=await browser.newContext({userAgent:UA,viewport:{width:412,height:915},isMobile:true,hasTouch:true,deviceScaleFactor:3,locale:"ko-KR"});
  const page=await ctx.newPage();
  // 네이버쇼핑 모바일 검색결과 페이지 직접 (더 많은 상품)
  await page.goto(`https://msearch.shopping.naver.com/search/all?query=${encodeURIComponent(KW)}&pagingIndex=1&pagingSize=40`,{waitUntil:"domcontentloaded",timeout:30000}).catch(()=>{});
  await page.waitForTimeout(3000);
  const blocked=await page.evaluate(()=>/접속이 불가|일시적으로/.test(document.body?.innerText||""));
  const found=await page.evaluate((id)=>document.body.innerHTML.includes(id), PRODID);
  const total=await page.$$eval('a[href*="/products/"]', as=>new Set(as.map(a=>a.href)).size).catch(()=>0);
  console.log(`"${KW}" → 차단:${blocked?"🚫":"✅"} 상품수집:${total}개 내상품:${found?"✅발견":"❌없음"}`);
  await browser.close();
}
for(const kw of ["반건조 박대","박대","군산 박대"]){ await tryRank(kw); await new Promise(r=>setTimeout(r,2500)); }
