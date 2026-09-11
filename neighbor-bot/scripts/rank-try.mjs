import { chromium } from "playwright";
const UB="c4dc884e452df80c4d6b__cr.kr", PASS="87e53222e36affb7";
const UA_PC="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const PRODID="44755477842";
const sess=Math.random().toString(36).slice(2,6);
const browser=await chromium.launch({headless:true,args:["--no-sandbox","--disable-blink-features=AutomationControlled"],proxy:{server:"http://gw.dataimpulse.com:10000",username:`${UB};sessid.${sess};sessttl.10`,password:PASS}});
const ctx=await browser.newContext({userAgent:UA_PC,viewport:{width:1280,height:900},locale:"ko-KR"});
const page=await ctx.newPage();
const KW="반건조 박대";
// ① PC 네이버쇼핑 검색 API (search.shopping)
console.log("① PC 쇼핑 검색 API 시도");
try{
  const r=await page.request.get(`https://search.shopping.naver.com/api/search/all?query=${encodeURIComponent(KW)}&pagingIndex=1&pagingSize=40&productSet=total`,{headers:{"User-Agent":UA_PC,"Referer":"https://search.shopping.naver.com/","Accept":"application/json"},timeout:15000});
  const t=await r.text();
  console.log(`   HTTP=${r.status()} 길이=${t.length} 상품포함=${t.includes("products")?"O":"X"} 내상품=${t.includes(PRODID)?"✅":"X"}`);
  if(t.length<500) console.log("   본문:",t.slice(0,150));
}catch(e){ console.log("   실패:",e.message.slice(0,40)); }
// ② PC 통합검색 쇼핑탭 (많이 보이나)
console.log("② PC 통합검색 쇼핑탭");
await page.goto(`https://search.naver.com/search.naver?where=nexearch&query=${encodeURIComponent(KW)}`,{waitUntil:"domcontentloaded",timeout:30000}).catch(()=>{});
await page.waitForTimeout(2500);
const cnt=await page.$$eval('a[href*="/products/"], a[href*="cr.shopping"]', as=>new Set(as.map(a=>a.href)).size).catch(()=>0);
console.log(`   상품 ${cnt}개`);
await browser.close();
