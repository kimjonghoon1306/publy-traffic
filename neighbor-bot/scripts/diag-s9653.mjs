import { suggestKeywordsFromTarget, crawlPublicPosts } from "../dist/naver.js";
const log=m=>console.log("   "+m);
(async()=>{
  console.log("=== s9653 글 목록 실제로 뭐가 있나 ===");
  const posts=await crawlPublicPosts({blogId:"s9653", count:10, onLog:log});
  console.log(`글 ${posts.length}개:`);
  posts.forEach(p=>console.log("  -", p.title));
  console.log("\n=== s9653 추천 키워드 ===");
  const r=await suggestKeywordsFromTarget({targetType:"blog", blogId:"s9653", onLog:log});
  console.log("→", JSON.stringify(r.seeds));
})();
