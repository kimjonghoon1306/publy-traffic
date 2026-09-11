import { chromium } from "patchright";
const HOST="http://gw.dataimpulse.com:10000", UB="6f4612398e929e09a365__cr.kr", PASS="d62608f358fe9282";
const UA="Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const urls=[
 "https://m.smartstore.naver.com/main/products/10073016965",
 "https://m.smartstore.naver.com/main/products/10344727568",
 "https://m.smartstore.naver.com/main/products/11110194570",
];
const blk=s=>/현재 서비스 접속이 불가|비정상적인 접근|일시적으로 제한/.test(s);
for(const URL of urls){
  const sess=Math.random().toString(36).slice(2,8);
  const o={channel:"chrome",headless:false,userAgent:UA,viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:3,locale:"ko-KR",
    proxy:{server:HOST,username:`${UB};sessid.${sess};sessttl.20`,password:PASS}};
  const ctx=await chromium.launchPersistentContext("",o); const page=await ctx.newPage();
  let st="?"; try{const r=await page.goto(URL,{waitUntil:"domcontentloaded",timeout:40000});st=r?r.status():"no";}catch(e){st="err";}
  await page.waitForTimeout(4000);
  const b=await page.evaluate(()=>document.body?.innerText||"").catch(()=>""); const t=await page.title().catch(()=>"");
  const buy=/구매하기|장바구니|옵션|배송|찜|리뷰/.test(b);
  console.log(`${URL.slice(-10)} → HTTP=${st} 차단=${blk(b)?"🚫":"✅"} 로그인=${/NAVER 로그인/.test(t)?"🔒":"✅"} 상품=${buy?"🛒있음!":"없음"} title="${t}"`);
  await ctx.close();
}
