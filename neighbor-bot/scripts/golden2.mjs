import { getKeywordVolumes } from "../dist/supabase.js";
(async()=>{
  const seeds=["보리굴비","영광굴비","굴비"];
  const vols=await getKeywordVolumes(seeds,40).catch(()=>null); if(!vols)return console.log("API안됨");
  let kws=vols.map(v=>({keyword:v.keyword,vol:v.total,comp:v.comp}));
  const compRank=c=>c==="낮음"?0:c==="중간"?1:c==="높음"?2:1.5;
  const seedWords=seeds.flatMap(s=>s.replace(/\s+/g,"").match(/[가-힣]{2,}/g)||[]);
  const isRel=kw=>{const b=kw.replace(/\s+/g,"");return seedWords.some(w=>b.includes(w)||w.includes(b));};
  const rel=kws.filter(k=>k.vol>0&&isRel(k.keyword));const rest=kws.filter(k=>k.vol>0&&!isRel(k.keyword));
  const sf=(a,b)=>{const cr=compRank(a.comp)-compRank(b.comp);return cr?cr:b.vol-a.vol;};
  kws=[...rel.sort(sf),...rest.sort(sf)];
  console.log("🎯 굴비 골든 키워드 (관련어 우선):\n");
  kws.slice(0,12).forEach((k,i)=>console.log(`  ${i+1}. ${String(k.vol).padStart(6)}회/월  경쟁:${k.comp}  "${k.keyword}"`));
})();
