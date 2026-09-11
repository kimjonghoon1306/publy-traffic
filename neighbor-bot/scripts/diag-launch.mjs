import { chromium as pw } from "playwright";
import { chromium as pr } from "patchright";
const HOST="http://gw.dataimpulse.com:10000", UB="6f4612398e929e09a365__cr.kr", PASS="d62608f358fe9282";
const UA="Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const FRESH="https://m.smartstore.naver.com/main/products/11110194570"; // 신선
const blk=s=>/접속이 불가|비정상적인 접근|일시적으로 제한/.test(s);
async function go(label, engine, useChannel){
  const sess=Math.random().toString(36).slice(2,8);
  const opts={headless:true,args:["--no-sandbox","--disable-blink-features=AutomationControlled"],
    proxy:{server:HOST,username:`${UB};sessid.${sess};sessttl.20`,password:PASS}};
  if(useChannel)opts.channel="chrome";
  let br; try{br=await engine.launch(opts);}catch(e){console.log(`[${label}] launch err:${e.message.slice(0,40)}`);return;}
  const ctx=await br.newContext({userAgent:UA,viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:3,locale:"ko-KR"});
  await ctx.addInitScript(()=>{Object.defineProperty(navigator,"webdriver",{get:()=>undefined});});
  const page=await ctx.newPage();
  let st="?"; try{const r=await page.goto(FRESH,{waitUntil:"domcontentloaded",timeout:40000});st=r?r.status():"no";}catch(e){st="err";}
  await page.waitForTimeout(3500);
  const b=await page.evaluate(()=>document.body?.innerText||"").catch(()=>""); const t=await page.title().catch(()=>"");
  console.log(`[${label}] HTTP=${st} 차단=${blk(b)?"🚫":"✅"} 로그인=${/NAVER 로그인/.test(t)?"🔒":"✅"} len=${b.length} title="${t}"`);
  await br.close();
}
(async()=>{
  await go("일반playwright launch",pw,false);
  await go("patchright launch(채널X)",pr,false);
  await go("patchright launch+chrome채널",pr,true);
})();
