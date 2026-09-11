import { measureStoreRank } from "../dist/naver.js";
(async()=>{
  const kws=["법성포 영광굴비 선물세트","보리굴비 선물세트","찐 보리굴비","영광 참굴비","추석 굴비 선물세트","굴비 이바지","보리굴비 특대","법성포 굴비"];
  console.log("굴비가게(01074323888)가 1페이지 드는 키워드 찾기:\n");
  for(const kw of kws){
    const r=await measureStoreRank({keyword:kw, storeId:"01074323888", productId:"5251966721", onLog:()=>{}});
    const mark = r.onFirstPage ? `✅ 1페이지 ${r.rank}위` : "❌ 밖";
    console.log(`  ${mark}  "${kw}"`);
    await new Promise(x=>setTimeout(x,2500));
  }
})();
