import { suggestKeywordsFromTarget } from "../dist/naver.js";
const log = m => console.log("   "+m);
(async()=>{
  console.log("=== ① 블로그 아이디만 (준영이 블로그) ===");
  const a = await suggestKeywordsFromTarget({ targetType:"blog", blogId:"ojy8404", onLog:log });
  console.log("→ seeds:", a.seeds, "| source:", a.source);

  console.log("\n=== ② 스토어 상품 (테리 굴비가게) ===");
  const b = await suggestKeywordsFromTarget({ targetType:"store", url:"https://smartstore.naver.com/01074323888/products/5251835713", storeId:"01074323888", productId:"5251835713", onLog:log });
  console.log("→ seeds:", b.seeds, "| source:", b.source);
})();
