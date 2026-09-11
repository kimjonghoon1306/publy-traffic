import { chromium } from "playwright";
const UB="c4dc884e452df80c4d6b__cr.kr", PASS="87e53222e36affb7";
const UA="Mozilla/5.0 (Linux; Android 14; SM-S928N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";
const blk=s=>/접속이 불가|비정상적인 접근|일시적으로 제한/.test(s);
const sess=Math.random().toString(36).slice(2,8);
const browser=await chromium.launch({headless:true,args:["--no-sandbox","--disable-blink-features=AutomationControlled"],proxy:{server:"http://gw.dataimpulse.com:10000",username:`${UB};sessid.${sess};sessttl.10`,password:PASS}});
const ctx=await browser.newContext({userAgent:UA,viewport:{width:412,height:915},isMobile:true,hasTouch:true,deviceScaleFactor:3,locale:"ko-KR"});
const page=await ctx.newPage();

// 방법: 상호명 "굴비가게"로 검색 → 스토어 링크(nl-query 붙은) 찾아 클릭
await page.goto(`https://m.search.naver.com/search.naver?query=${encodeURIComponent("굴비가게")}`,{waitUntil:"domcontentloaded",timeout:40000});
await page.waitForTimeout(2500);
for(let i=0;i<4;i++){ await page.mouse.wheel(0,1200); await page.waitForTimeout(700); }
// 01074323888 가리키는 링크 다 수집
const links=await page.$$eval('a[href]', as=>as.map(a=>a.href).filter(h=>h.includes("01074323888")||h.includes("smartstore.naver.com")||h.includes("brand.naver")).slice(0,10));
console.log(`굴비가게 관련 링크 ${links.length}개:`);
links.slice(0,5).forEach(l=>console.log("  "+l.slice(0,75)));
if(links.length){
  const target=links.find(h=>h.includes("01074323888"))||links[0];
  console.log(`\n클릭: ${target.slice(0,70)}`);
  const [popup]=await Promise.all([ctx.waitForEvent("page",{timeout:12000}).catch(()=>null), page.goto(target,{waitUntil:"domcontentloaded",timeout:40000,referer:"https://m.search.naver.com/"}).catch(()=>{})]);
  const tp=popup||page; await tp.waitForTimeout(4500);
  const b=await tp.evaluate(()=>document.body?.innerText||"").catch(()=>""); const t=await tp.title().catch(()=>"");
  console.log(`도착: ${tp.url().slice(0,55)}`);
  console.log(`→ ${blk(b)?"🚫차단":/NAVER 로그인/.test(t)?"🔒로그인":/구매하기|장바구니|찜하기/.test(b)?"🛒상품도착!":"△len"+b.length} title="${t.slice(0,25)}"`);
}
await browser.close();
