import { getAdminBlogSearchKeys } from "../dist/supabase.js";
(async()=>{
  const keys=await getAdminBlogSearchKeys();
  const H={"X-Naver-Client-Id":keys.clientId,"X-Naver-Client-Secret":keys.clientSecret};
  const KW=encodeURIComponent("반건조 박대");
  // 여러 엔드포인트 형식 시도
  const urls=[
    ["shop.json", `https://openapi.naver.com/v1/search/shop.json?query=${KW}&display=10`],
    ["shop.xml", `https://openapi.naver.com/v1/search/shop.xml?query=${KW}&display=10`],
    ["shop(구주소)", `https://openapi.naver.com/v1/search/shop?query=${KW}&display=10`],
  ];
  for(const [name,url] of urls){
    try{
      const r=await fetch(url,{headers:H});
      const t=await r.text();
      console.log(`${name}: HTTP=${r.status} ${t.slice(0,80).replace(/\n/g," ")}`);
    }catch(e){ console.log(`${name}: 실패 ${e.message}`); }
  }
})();
