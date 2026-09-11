import { getAdminBlogSearchKeys } from "../dist/supabase.js";
(async()=>{
  const keys=await getAdminBlogSearchKeys().catch(()=>null);
  if(!keys){ console.log("❌ API 키 없음"); return; }
  console.log("✅ API 키 있음. 쇼핑 검색 API 테스트...\n");
  const KW="반건조 박대";
  // 쇼핑 검색 API — 관련도순 100개
  const url=`https://openapi.naver.com/v1/search/shop.json?query=${encodeURIComponent(KW)}&display=100&start=1&sort=sim`;
  const r=await fetch(url,{headers:{"X-Naver-Client-Id":keys.clientId,"X-Naver-Client-Secret":keys.clientSecret}});
  console.log("HTTP:",r.status);
  const j=await r.json().catch(e=>({err:e.message}));
  if(j.err||j.errorMessage){ console.log("에러:",j.errorMessage||j.err); return; }
  console.log(`총 ${j.total}개 중 ${j.items?.length}개 받음`);
  console.log("\n상위 10개 상품:");
  (j.items||[]).slice(0,10).forEach((it,i)=>{
    const title=it.title.replace(/<[^>]+>/g,"");
    console.log(`  ${i+1}. ${title.slice(0,35)} | ${it.mallName} | ${it.link.slice(0,50)}`);
  });
})();
