import { measureStoreRank } from "../dist/naver.js";
const log=m=>console.log(m);
(async()=>{
  for(const kw of ["굴비가게","영광굴비","보리굴비"]){
    const r=await measureStoreRank({keyword:kw, storeId:"01074323888", productId:"5251966721", onLog:log});
    console.log(`   결과: ${JSON.stringify(r)}\n`);
    await new Promise(r=>setTimeout(r,2500));
  }
})();
