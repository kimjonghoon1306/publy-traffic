import { getKeywordVolumes } from "../dist/supabase.js";
(async()=>{
  const kws=["영광굴비","보리굴비","굴비선물세트","법성포굴비","찐보리굴비","영광참굴비","추석굴비"];
  console.log("굴비 키워드 월 검색량(검색광고 API):\n");
  const vols=await getKeywordVolumes(kws, 30).catch(e=>{console.log("에러:",e.message);return null;});
  if(!vols){ console.log("검색량 API 안됨(키 미설정?)"); return; }
  vols.slice(0,20).forEach(v=>console.log(`  ${String(v.total).padStart(7)}회/월  경쟁:${v.comp||"?"}  "${v.keyword}"`));
})();
