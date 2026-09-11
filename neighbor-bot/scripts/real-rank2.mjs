import { chromium } from "playwright";
const UB="c4dc884e452df80c4d6b__cr.kr", PASS="87e53222e36affb7";
const UA="Mozilla/5.0 (Linux; Android 14; SM-S928N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";
const PRODID="44755477842";
const sess=Math.random().toString(36).slice(2,6);
const browser=await chromium.launch({headless:true,args:["--no-sandbox","--disable-blink-features=AutomationControlled"],proxy:{server:"http://gw.dataimpulse.com:10000",username:`${UB};sessid.${sess};sessttl.10`,password:PASS}});
const ctx=await browser.newContext({userAgent:UA,viewport:{width:412,height:915},isMobile:true,hasTouch:true,deviceScaleFactor:3,locale:"ko-KR"});
const page=await ctx.newPage();
const KW="반건조 박대";
await page.goto(`https://msearch.shopping.naver.com/search/all?query=${encodeURIComponent(KW)}`,{waitUntil:"networkidle",timeout:40000}).catch(()=>{});
await page.waitForTimeout(3500);
// 렌더 후 스크롤하며 상품 로드 (네이버쇼핑은 무한스크롤)
let prev=0;
for(let i=0;i<15;i++){ await page.mouse.wheel(0,2000); await page.waitForTimeout(1000);
  const cnt=await page.$$eval('a[href*="/products/"], a[href*="cr.shopping"]', as=>new Set(as.map(a=>a.href)).size).catch(()=>0);
  const found=await page.evaluate(id=>document.body.innerHTML.includes(id),PRODID);
  if(found){ console.log(`✅ ${i+1}스크롤에서 발견! 수집 ${cnt}개`); break; }
  if(cnt===prev && i>3){ console.log(`더 안 로드됨(${cnt}개에서 멈춤) — 내상품 없음`); break; } prev=cnt;
}
const total=await page.$$eval('a[href*="/products/"]', as=>new Set(as.map(a=>a.href)).size).catch(()=>0);
const found=await page.evaluate(id=>document.body.innerHTML.includes(id),PRODID);
console.log(`최종: 상품 ${total}개, 내상품 ${found?"발견":"없음"}`);
await browser.close();
