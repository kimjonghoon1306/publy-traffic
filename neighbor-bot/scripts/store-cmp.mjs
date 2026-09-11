import { chromium } from "playwright";
const UB="c4dc884e452df80c4d6b__cr.kr", PASS="87e53222e36affb7";
const UA="Mozilla/5.0 (Linux; Android 14; SM-S928N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";
const blk=s=>/접속이 불가|비정상적인 접근|일시적으로 제한/.test(s);
async function run(KW, tag){
  const sess=Math.random().toString(36).slice(2,8);
  const browser=await chromium.launch({headless:false,args:["--no-sandbox","--disable-blink-features=AutomationControlled"],proxy:{server:"http://gw.dataimpulse.com:10000",username:`${UB};sessid.${sess};sessttl.10`,password:PASS}});
  const ctx=await browser.newContext({userAgent:UA,viewport:{width:412,height:915},isMobile:true,hasTouch:true,deviceScaleFactor:3,locale:"ko-KR"});
  await ctx.addInitScript(()=>{Object.defineProperty(navigator,"webdriver",{get:()=>undefined});});
  const page=await ctx.newPage();
  await page.goto(`https://m.search.naver.com/search.naver?query=${encodeURIComponent(KW)}`,{waitUntil:"domcontentloaded",timeout:40000});
  await page.waitForTimeout(2200);
  for(let i=0;i<3;i++){ await page.mouse.wheel(0,1200); await page.waitForTimeout(700); }
  // searchGate 브릿지 우선
  const gates=await page.$$eval('a[href]', as=>as.map(a=>a.href).filter(h=>h.includes("cr3.shopping.naver.com")&&h.includes("searchGate")).slice(0,3));
  console.log(`[${tag}] "${KW}" searchGate ${gates.length}개`);
  if(!gates.length){ console.log(`  → 게이트없음`); await browser.close(); return; }
  console.log(`  클릭: ${gates[0].slice(0,70)}`);
  const [popup]=await Promise.all([ctx.waitForEvent("page",{timeout:12000}).catch(()=>null), page.goto(gates[0],{waitUntil:"domcontentloaded",timeout:40000,referer:"https://m.search.naver.com/"}).catch(()=>{})]);
  const tp=popup||page; await tp.waitForTimeout(5000);
  const b=await tp.evaluate(()=>document.body?.innerText||"").catch(()=>""); const t=await tp.title().catch(()=>"");
  console.log(`  도착 URL: ${tp.url().slice(0,55)}`);
  console.log(`  → ${blk(b)?"🚫차단":/NAVER 로그인/.test(t)?"🔒로그인":/구매하기|장바구니|찜하기/.test(b)?"🛒상품!":"△len"+b.length} title="${t.slice(0,25)}"`);
  await browser.close();
}
await run("굴비가게","우리가두들긴것");
await new Promise(r=>setTimeout(r,4000));
await run("제주 감귤","신선한것");
