import { suggestKeywordsFromTarget } from "../dist/naver.js";
const log=m=>console.log("   "+m);
(async()=>{
  console.log("=== 스토어 추천 (테리 굴비가게) ===");
  const r=await suggestKeywordsFromTarget({targetType:"store", url:"https://smartstore.naver.com/01074323888/products/5251966721", storeId:"01074323888", productId:"5251966721", onLog:log});
  console.log("→ seeds:", JSON.stringify(r.seeds), "| source:", r.source);
})();
