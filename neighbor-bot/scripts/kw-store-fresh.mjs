import { chromium } from "playwright";
const UB="c4dc884e452df80c4d6b__cr.kr", PASS="87e53222e36affb7";
const UA="Mozilla/5.0 (Linux; Android 14; SM-S928N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";
const sess=Math.random().toString(36).slice(2,8);
const browser=await chromium.launch({headless:true,args:["--no-sandbox","--disable-blink-features=AutomationControlled"],proxy:{server:"http://gw.dataimpulse.com:10000",username:`${UB};sessid.${sess};sessttl.10`,password:PASS}});
const ctx=await browser.newContext({userAgent:UA,viewport:{width:412,height:915},isMobile:true,hasTouch:true,deviceScaleFactor:3,locale:"ko-KR"});
const page=await ctx.newPage();
// 오늘 성공했던 신선 스토어 상품
const url="https://m.brand.naver.com/bestfruits/products/515936041";
let st="?"; try{const r=await page.goto(url,{waitUntil:"domcontentloaded",timeout:25000});st=r?.status();}catch(e){st="err";}
await page.waitForTimeout(2500);
const title=await page.title().catch(()=>"");
const og=await page.evaluate(()=>document.querySelector('meta[property="og:title"]')?.content||"").catch(()=>"");
console.log(`신선 상품 직접goto → HTTP=${st} title="${title}" og="${og}"`);
await browser.close();
