import { chromium } from "patchright";
const HOST="http://gw.dataimpulse.com:10000", UB="6f4612398e929e09a365__cr.kr", PASS="d62608f358fe9282";
const UA="Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const ID="bb9653", PW="Sd4136002!";
const sess=Math.random().toString(36).slice(2,8);
const o={channel:"chrome",headless:false,userAgent:UA,viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:3,locale:"ko-KR",
  proxy:{server:HOST,username:`${UB};sessid.${sess};sessttl.30`,password:PASS}};
const ctx=await chromium.launchPersistentContext("",o); const page=await ctx.newPage();
await page.goto("https://nid.naver.com/nidlogin.login",{waitUntil:"domcontentloaded",timeout:45000});
await page.waitForTimeout(2500);
// 필드 존재 확인
const hasId=await page.$("#id"), hasPw=await page.$("#pw");
console.log(`필드: id=${hasId?"있음":"❌없음"} pw=${hasPw?"있음":"❌없음"} url=${page.url().slice(0,45)}`);
const inputs=await page.$$eval("input",els=>els.map(e=>`${e.id||e.name||e.type}`).slice(0,10)).catch(()=>[]);
console.log("input들:",inputs.join(", "));
if(hasId&&hasPw){
  await page.click("#id"); for(const c of ID) await page.type("#id",c,{delay:130});
  await page.waitForTimeout(600);
  await page.click("#pw"); for(const c of PW) await page.type("#pw",c,{delay:130});
  await page.waitForTimeout(800);
  const btns=await page.$$eval("button",els=>els.map(e=>e.className||e.id||e.textContent?.slice(0,10)).slice(0,8)).catch(()=>[]);
  console.log("버튼들:",btns.join(" | "));
  await page.keyboard.press("Enter");
  await page.waitForTimeout(7000);
  const u=page.url(), b=await page.evaluate(()=>document.body?.innerText||"").slice(0,200).catch(()=>"");
  console.log(`제출후 url=${u.slice(0,55)}`);
  console.log(`본문앞: ${b.replace(/\s+/g," ").slice(0,180)}`);
}
await page.waitForTimeout(3000);
await ctx.close();
