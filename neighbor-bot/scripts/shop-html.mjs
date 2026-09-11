import { chromium } from "playwright";
const UB="c4dc884e452df80c4d6b__cr.kr", PASS="87e53222e36affb7";
const UA="Mozilla/5.0 (Linux; Android 14; SM-S928N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";
const PRODID="44755477842";
const sess=Math.random().toString(36).slice(2,6);
const browser=await chromium.launch({headless:true,args:["--no-sandbox","--disable-blink-features=AutomationControlled"],proxy:{server:"http://gw.dataimpulse.com:10000",username:`${UB};sessid.${sess};sessttl.10`,password:PASS}});
const ctx=await browser.newContext({userAgent:UA,viewport:{width:412,height:915},isMobile:true,hasTouch:true,deviceScaleFactor:3,locale:"ko-KR"});
const page=await ctx.newPage();
const KW="반건조 박대";
// 통합검색 쇼핑탭 API (내부) — page.request로 JSON 시도
console.log("① 통합검색 쇼핑탭 내부 API");
try{
  // 먼저 검색페이지 열어 쿠키 확보
  await page.goto(`https://m.search.naver.com/search.naver?ssc=tab.m_shop.all&query=${encodeURIComponent(KW)}`,{waitUntil:"domcontentloaded",timeout:30000});
  await page.waitForTimeout(2000);
  // 페이지 안에서 상품 링크 다 수집 (더보기 눌러가며)
  let items=[];
  for(let i=0;i<8;i++){
    await page.mouse.wheel(0,1800); await page.waitForTimeout(900);
    // 더보기 버튼 있으면 클릭
    const more=await page.$('a:has-text("더보기"), button:has-text("더보기")').catch(()=>null);
    if(more){ await more.click().catch(()=>{}); await page.waitForTimeout(1500); }
  }
  items=await page.$$eval('a[href*="cr"], a[href*="/products/"], a[href*="smartstore"], a[href*="brand.naver"]', as=>as.map(a=>a.href)).catch(()=>[]);
  const uniq=[...new Set(items)];
  const idx=uniq.findIndex(h=>h.includes(PRODID));
  console.log(`   수집 ${uniq.length}개, 내상품 위치: ${idx>=0?idx+1+"번째":"없음"}`);
}catch(e){ console.log("   실패:",e.message.slice(0,40)); }
await browser.close();
