import { suggestKeywordsFromTarget } from "../dist/naver.js";
const log=m=>console.log("   "+m);
(async()=>{
  // 테리가 실제 넣을 만한 블로그들 테스트
  for(const bid of ["ojy8404"]){
    console.log(`\n=== 블로그 아이디: ${bid} ===`);
    const r=await suggestKeywordsFromTarget({targetType:"blog", blogId:bid, onLog:log});
    console.log("→ 추출 키워드:", JSON.stringify(r.seeds, null, 0));
    console.log("  출처:", r.source);
  }
})();
