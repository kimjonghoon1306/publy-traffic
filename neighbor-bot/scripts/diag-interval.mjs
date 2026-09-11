import { chromium } from "patchright";
const HOST="http://gw.dataimpulse.com:10000", UB="6f4612398e929e09a365__cr.kr", PASS="d62608f358fe9282";
const UA="Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function one(){
  const sess=Math.random().toString(36).slice(2,8);
  try{
    const ctx=await chromium.launchPersistentContext("",{channel:"chrome",headless:true,userAgent:UA,viewport:{width:390,height:844},isMobile:true,hasTouch:true,locale:"ko-KR",
      proxy:{server:HOST,username:`${UB};sessid.${sess};sessttl.30`,password:PASS}});
    const page=await ctx.newPage();
    const r=await page.goto("https://m.search.naver.com/search.naver?query=%EA%B5%B4%EB%B9%84",{waitUntil:"domcontentloaded",timeout:30000});
    const st=r?.status(); await ctx.close(); return st===200;
  }catch(e){ return false; }
}
async function run(label, gapSec){
  let ok=0;
  for(let i=0;i<5;i++){ const s=await one(); if(s)ok++; process.stdout.write(s?"✅":"🔴"); if(i<4) await sleep(gapSec*1000); }
  console.log(`  [${label}] 성공 ${ok}/5`);
}
(async()=>{
  console.log("간격별 프록시 성공률 (봇은 사람아님 → 안 몰리는 간격 찾기):");
  await run("간격 0초(연속·몰아치기)", 0);
  await run("간격 15초", 15);
  await run("간격 40초(봇 기본 텀)", 40);
})();
