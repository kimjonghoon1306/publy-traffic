import { chromium } from "patchright";
const HOST="gw.dataimpulse.com:10000", UB="6f4612398e929e09a365__cr.kr", PASS="d62608f358fe9282";
const UA="Mozilla/5.0 (Linux; Android 14; SM-S928N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";
const KW="제주 감귤";
const blk=s=>/접속이 불가|비정상적인 접근|일시적으로 제한/.test(s);
async function visit(n){
  const sess=Math.random().toString(36).slice(2,8);
  const ctx=await chromium.launchPersistentContext("",{channel:"chrome",headless:false,userAgent:UA,viewport:{width:412,height:915},isMobile:true,hasTouch:true,deviceScaleFactor:3,locale:"ko-KR",
    proxy:{server:"http://"+HOST,username:`${UB};sessid.${sess};sessttl.10`,password:PASS}});
  const page=await ctx.newPage();
  let ip="?"; try{const r=await page.request.get("http://ip-api.com/json/?fields=query",{timeout:12000});ip=(await r.json()).query;}catch{}
  let ok=false, note="";
  try{
    await page.goto(`https://m.search.naver.com/search.naver?query=${encodeURIComponent(KW)}`,{waitUntil:"domcontentloaded",timeout:40000});
    await page.waitForTimeout(2200);
    for(let i=0;i<3;i++){ await page.mouse.wheel(0,1200); await page.waitForTimeout(700); }
    const gates=await page.$$eval('a[href]', as=>as.map(a=>a.href).filter(h=>h.includes("cr3.shopping.naver.com")&&h.includes("searchGate")).slice(0,5));
    if(!gates.length){ note="게이트없음"; }
    else{
      const [popup]=await Promise.all([ctx.waitForEvent("page",{timeout:12000}).catch(()=>null), page.goto(gates[0],{waitUntil:"domcontentloaded",timeout:40000,referer:"https://m.search.naver.com/"}).catch(()=>{})]);
      const tp=popup||page; await tp.waitForTimeout(5000);
      const b=await tp.evaluate(()=>document.body?.innerText||""); const t=await tp.title();
      const buy=/구매하기|장바구니|찜하기/.test(b);
      ok=buy&&!blk(b)&&!/NAVER 로그인/.test(t);
      note=blk(b)?"🚫차단":/NAVER 로그인/.test(t)?"🔒로그인":buy?`🛒상품(${t.slice(0,20)})`:"△len"+b.length;
    }
  }catch(e){ note="err:"+(e.message||"").slice(0,20); }
  console.log(`방문${n}: IP=${ip}  → ${ok?"✅성공":"❌"} ${note}`);
  await ctx.close();
}
await visit(1);
await new Promise(r=>setTimeout(r,3000));
await visit(2);
