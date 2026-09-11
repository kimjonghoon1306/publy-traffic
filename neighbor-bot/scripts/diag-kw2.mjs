import { suggestKeywordsFromTarget } from "../dist/naver.js";
const log = m => console.log("   "+m);
(async()=>{
  console.log("=== 스토어(429 방어 확인) ===");
  const b = await suggestKeywordsFromTarget({ targetType:"store", url:"https://smartstore.naver.com/01074323888/products/5251835713", storeId:"01074323888", productId:"5251835713", onLog:log });
  console.log("→ seeds:", JSON.stringify(b.seeds), "| source:", b.source, b.seeds.includes("에러페이지")?"🔴쓰레기 여전":"✅쓰레기 없음");

  console.log("\n=== 플레이스(테리 매장 naver.me/FiP2ajet) ===");
  const p = await suggestKeywordsFromTarget({ targetType:"place", url:"https://naver.me/FiP2ajet", onLog:log });
  console.log("→ seeds:", JSON.stringify(p.seeds), "| source:", p.source);
})();
