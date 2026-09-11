import { chromium as pw } from "playwright";
import { chromium as pr } from "patchright";
const UA="Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const FRESH="https://m.smartstore.naver.com/main/products/10073016965"; // 신선(curl 200)
const blk=s=>/접속이 불가|비정상적인 접근|일시적으로 제한/.test(s);
async function go(label, engine, channel){
  const o={headless:true,args:["--no-sandbox","--disable-blink-features=AutomationControlled"]};
  if(channel)o.channel="chrome";
  let br; try{br=await engine.launch(o);}catch(e){console.log(`[${label}] launch err`);return;}
  const ctx=await br.newContext({userAgent:UA,viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:3,locale:"ko-KR"});
  await ctx.addInitScript(()=>{Object.defineProperty(navigator,"webdriver",{get:()=>undefined});});
  const page=await ctx.newPage();
  let st="?"; try{const r=await page.goto(FRESH,{waitUntil:"domcontentloaded",timeout:40000});st=r?r.status():"no";}catch(e){st="err";}
  await page.waitForTimeout(3500);
  const b=await page.evaluate(()=>document.body?.innerText||"").catch(()=>""); const t=await page.title().catch(()=>"");
  console.log(`[${label}] HTTP=${st} 차단=${blk(b)?"🚫":"✅"} 로그인=${/NAVER 로그인/.test(t)?"🔒":"✅"} title="${t}"`);
  await br.close();
}
(async()=>{
  console.log("=== 폰 통신사 IP(테더링) + 브라우저 ===");
  await go("일반 playwright(우리봇 현재)", pw, false);
  await go("patchright(안티디텍트)", pr, true);
})();
