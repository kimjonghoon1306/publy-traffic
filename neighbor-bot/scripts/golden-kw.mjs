import { getKeywordVolumes } from "../dist/supabase.js";
(async()=>{
  const seeds=["보리굴비","영광굴비","굴비","참굴비","조기"];
  const vols=await getKeywordVolumes(seeds, 40).catch(()=>null);
  if(!vols){ console.log("API 안됨"); return; }
  let kws=vols.map(v=>({keyword:v.keyword, vol:v.total, comp:v.comp}));
  const compRank=c=>c==="낮음"?0:c==="중간"?1:c==="높음"?2:1.5;
  kws=kws.filter(k=>k.vol>0).sort((a,b)=>{const cr=compRank(a.comp)-compRank(b.comp);if(cr)return cr;return b.vol-a.vol;});
  console.log("🎯 굴비 골든 키워드 (경쟁 낮음/중간 + 검색량 있음 우선):\n");
  kws.slice(0,15).forEach((k,i)=>console.log(`  ${i+1}. ${String(k.vol).padStart(6)}회/월  경쟁:${k.comp}  "${k.keyword}"`));
})();
