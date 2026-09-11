import { chromium } from "playwright";
const UB="c4dc884e452df80c4d6b__cr.kr", PASS="87e53222e36affb7";
const UA="Mozilla/5.0 (Linux; Android 14; SM-S928N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";
const STOREID="01074323888";
async function check(KW){
  const sess=Math.random().toString(36).slice(2,8);
  const browser=await chromium.launch({headless:true,args:["--no-sandbox","--disable-blink-features=AutomationControlled"],proxy:{server:"http://gw.dataimpulse.com:10000",username:`${UB};sessid.${sess};sessttl.10`,password:PASS}});
  const ctx=await browser.newContext({userAgent:UA,viewport:{width:412,height:915},isMobile:true,hasTouch:true,deviceScaleFactor:3,locale:"ko-KR"});
  const page=await ctx.newPage();
  await page.goto(`https://m.search.naver.com/search.naver?query=${encodeURIComponent(KW)}`,{waitUntil:"domcontentloaded",timeout:40000});
  await page.waitForTimeout(2200);
  for(let i=0;i<4;i++){ await page.mouse.wheel(0,1200); await page.waitForTimeout(700); }
  // 굴비가게(01074323888) 상품이 검색결과에 있나
  const found=await page.evaluate((sid)=>{
    const html=document.body.innerHTML;
    return { hasStore: html.includes(sid), gateCount: document.querySelectorAll('a[href*="cr3.shopping.naver.com"]').length };
  }, STOREID);
  console.log(`"${KW}" → 굴비가게상품 노출:${found.hasStore?"✅있음":"❌없음"} · searchGate:${found.gateCount}개`);
  await browser.close();
}
for(const kw of ["굴비가게","영광굴비","보리굴비","굴비선물세트","법성포굴비"]){ await check(kw); await new Promise(r=>setTimeout(r,2500)); }
