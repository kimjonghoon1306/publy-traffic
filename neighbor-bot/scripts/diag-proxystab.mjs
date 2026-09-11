import { chromium } from "patchright";
const HOST="http://gw.dataimpulse.com:10000", UB="6f4612398e929e09a365__cr.kr", PASS="d62608f358fe9282";
const UA="Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
let ok=0, fail=0;
for(let i=0;i<5;i++){
  const sess=Math.random().toString(36).slice(2,8);
  try{
    const ctx=await chromium.launchPersistentContext("",{channel:"chrome",headless:true,userAgent:UA,viewport:{width:390,height:844},isMobile:true,hasTouch:true,locale:"ko-KR",
      proxy:{server:HOST,username:`${UB};sessid.${sess};sessttl.30`,password:PASS}});
    const page=await ctx.newPage();
    const r=await page.goto("https://m.search.naver.com/search.naver?query=%EA%B5%B4%EB%B9%84",{waitUntil:"domcontentloaded",timeout:30000});
    console.log(`시도${i+1}: ✅ HTTP ${r?.status()}`); ok++;
    await ctx.close();
  }catch(e){ console.log(`시도${i+1}: 🔴 ${(e.message||"").split("\n")[0].slice(0,45)}`); fail++; }
}
console.log(`\n성공 ${ok}/5, 실패 ${fail}/5`);
