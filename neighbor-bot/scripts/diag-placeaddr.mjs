import { crawlPlaceByUrl } from "../dist/naver.js";
const log=m=>console.log("   "+m);
(async()=>{
  const d=await crawlPlaceByUrl({placeUrl:"https://naver.me/FiP2ajet", onLog:log});
  console.log("\n=== 플레이스 상세 필드 전체 ===");
  console.log(JSON.stringify(d, null, 1));
})();
