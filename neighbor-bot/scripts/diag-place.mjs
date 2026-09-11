import { suggestKeywordsFromTarget } from "../dist/naver.js";
const log=m=>console.log("   "+m);
(async()=>{
  console.log("=== 플레이스 (테리 매장 naver.me/FiP2ajet) ===");
  const p=await suggestKeywordsFromTarget({targetType:"place", url:"https://naver.me/FiP2ajet", onLog:log});
  console.log("→ 추천:", JSON.stringify(p.seeds), "| 출처:", p.source);
})();
