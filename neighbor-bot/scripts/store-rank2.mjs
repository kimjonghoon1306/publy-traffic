import { chromium } from "playwright";
const UB="c4dc884e452df80c4d6b__cr.kr", PASS="87e53222e36affb7";
const UA="Mozilla/5.0 (Linux; Android 14; SM-S928N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";
const STOREID="01074323888";
async function rank(KW){
  const sess=Math.random().toString(36).slice(2,8);
  const browser=await chromium.launch({headless:true,args:["--no-sandbox","--disable-blink-features=AutomationControlled"],proxy:{server:"http://gw.dataimpulse.com:10000",username:`${UB};sessid.${sess};sessttl.10`,password:PASS}});
  const ctx=await browser.newContext({userAgent:UA,viewport:{width:412,height:915},isMobile:true,hasTouch:true,deviceScaleFactor:3,locale:"ko-KR"});
  const page=await ctx.newPage();
  await page.goto(`https://m.search.naver.com/search.naver?ssc=tab.m_shop.all&query=${encodeURIComponent(KW)}`,{waitUntil:"domcontentloaded",timeout:40000});
  await page.waitForTimeout(2500);
  // 스크롤하며 상품 링크를 순서대로 수집 → 내 상품 위치=순위
  const seen=new Set(); let myRank=null; let total=0;
  for(let i=0;i<25;i++){
    const items=await page.$$eval('a[href*="cr3.shopping.naver.com"], a[href*="smartstore.naver.com/main/products"], a[href*="brand.naver.com"][href*="products"]', as=>as.map(a=>a.href));
    for(const h of items){ if(seen.has(h))continue; seen.add(h); total++; if(h.includes(STOREID)&&myRank==null){ myRank=total; } }
    if(myRank) break;
    await page.mouse.wheel(0,1600); await page.waitForTimeout(850);
  }
  console.log(`"${KW}" → 수집상품 ${total}개 중 내 순위: ${myRank?myRank+"위":"200위+ (안보임)"}`);
  await browser.close();
}
for(const kw of ["영광굴비","보리굴비"]){ await rank(kw); await new Promise(r=>setTimeout(r,2500)); }
