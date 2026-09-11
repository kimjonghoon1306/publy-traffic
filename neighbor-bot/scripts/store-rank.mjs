import { chromium } from "playwright";
const UB="c4dc884e452df80c4d6b__cr.kr", PASS="87e53222e36affb7";
const UA="Mozilla/5.0 (Linux; Android 14; SM-S928N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";
const STOREID="01074323888";
async function findRank(KW){
  const sess=Math.random().toString(36).slice(2,8);
  const browser=await chromium.launch({headless:true,args:["--no-sandbox","--disable-blink-features=AutomationControlled"],proxy:{server:"http://gw.dataimpulse.com:10000",username:`${UB};sessid.${sess};sessttl.10`,password:PASS}});
  const ctx=await browser.newContext({userAgent:UA,viewport:{width:412,height:915},isMobile:true,hasTouch:true,deviceScaleFactor:3,locale:"ko-KR"});
  const page=await ctx.newPage();
  await page.goto(`https://m.search.naver.com/search.naver?ssc=tab.m_shop.all&query=${encodeURIComponent(KW)}`,{waitUntil:"domcontentloaded",timeout:40000});
  await page.waitForTimeout(2500);
  let found=false;
  // 최대 20번 스크롤하며 우리 상품 나오나
  for(let i=0;i<20&&!found;i++){
    await page.mouse.wheel(0,1500); await page.waitForTimeout(900);
    found=await page.evaluate(sid=>document.body.innerHTML.includes(sid), STOREID);
    if(found){ console.log(`"${KW}" → ✅ ${i+1}번 스크롤에서 굴비가게 발견`); break; }
  }
  if(!found) console.log(`"${KW}" → ❌ 20스크롤 안에 안 보임(순위 매우 낮음)`);
  await browser.close();
}
for(const kw of ["영광굴비","보리굴비","굴비선물세트"]){ await findRank(kw); await new Promise(r=>setTimeout(r,2500)); }
