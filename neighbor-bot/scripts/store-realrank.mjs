import { chromium } from "playwright";
const UB="c4dc884e452df80c4d6b__cr.kr", PASS="87e53222e36affb7";
const UA="Mozilla/5.0 (Linux; Android 14; SM-S928N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";
const STOREID="01074323888";
const sess=Math.random().toString(36).slice(2,8);
const browser=await chromium.launch({headless:true,args:["--no-sandbox","--disable-blink-features=AutomationControlled"],proxy:{server:"http://gw.dataimpulse.com:10000",username:`${UB};sessid.${sess};sessttl.10`,password:PASS}});
const ctx=await browser.newContext({userAgent:UA,viewport:{width:412,height:915},isMobile:true,hasTouch:true,deviceScaleFactor:3,locale:"ko-KR"});
const page=await ctx.newPage();
// 네이버쇼핑 검색 API (m.shopping) - 페이지별 상품 리스트
const KW="영광굴비";
let myRank=null, scanned=0;
for(let pg=1;pg<=5&&!myRank;pg++){
  const url=`https://msearch.shopping.naver.com/api/search/all?sort=rel&pagingIndex=${pg}&pagingSize=40&query=${encodeURIComponent(KW)}&productSet=total`;
  let json=null;
  try{ const r=await page.request.get(url,{headers:{"User-Agent":UA,"Referer":"https://msearch.shopping.naver.com/"},timeout:15000}); json=await r.json().catch(()=>null); }catch{}
  if(!json){ console.log(`  page${pg}: API 실패(차단?)`); break; }
  const list=json?.shoppingResult?.products||json?.products||[];
  console.log(`  page${pg}: ${list.length}개`);
  for(const p of list){ scanned++; const s=JSON.stringify(p); if(s.includes(STOREID)&&!myRank){ myRank=scanned; } }
  await page.waitForTimeout(1200);
}
console.log(`\n"${KW}" → 스캔 ${scanned}개, 내 순위: ${myRank||"200위+"}`);
await browser.close();
