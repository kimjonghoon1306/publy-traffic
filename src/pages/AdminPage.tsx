import React, { useState, useEffect, useCallback, useRef } from "react";
import GoogleFlowCard from "../GoogleFlowCard";
import CrawlCenter from "../components/CrawlCenter";
import InflowCenter from "../components/InflowCenter";
import Place360 from "../components/Place360";
import Place360AdminManager from "../components/Place360AdminManager";
import PlaceReview from "../components/PlaceReview";
import UsageGuide from "../components/UsageGuide";
import { supabase, getAccounts, upsertAccount, PublyAccount, getHistory, getHistoryContent, PublyHistory, addHistory, deleteHistory, deleteAllHistory, setAdminPassword, saveAdminNaverApiKeys, getNaverApiKeys, NaverApiKeys, getNaverDailyUsage, NAVER_DAILY_LIMIT, checkNaverQuota, incrementNaverQuota, getUserNaverApiKeys, getReferrals, getErrorLogs, getUnreadErrorCount, markErrorsAsRead, logError, PLAN_CONFIG, getAllNeighborHistory, NeighborHistory, getAllEngageHistory, EngageHistory, InstaDmTarget, InstaDmHistory, InstaDmQuota, getInstaDmTargets, addInstaDmTarget, updateInstaDmTargetStatus, deleteInstaDmTarget, getInstaDmHistory, addInstaDmHistory, getAllInstaDmHistory, getInstaDmQuota, upsertInstaDmQuota, getAllInstaDmQuotas, INSTA_DM_DAILY_LIMIT, PublyBugReport, getBugReports, updateBugReportStatus, deleteBugReport, resetDailyPublish, getAllDailyUsageToday, DailyUsageRow, getAllReplyHistory, ReplyHistory, getAllPlaceReplyHistory, PlaceReplyHistory, getAllBlogscoreHistory, BlogscoreHistory, NEIGHBOR_DAILY_LIMIT, ENGAGE_DAILY_LIMIT, REPLY_DAILY_LIMIT, PLACE_REPLY_DAILY_LIMIT, BLOGSCORE_DAILY_LIMIT, PUMASI_ACCOUNT_LIMIT, PUMASI_POSTS_LIMIT, CRAWL_DAILY_LIMIT, INFLOW_DAILY_LIMIT, EMAIL_DAILY_LIMIT, COMMENT_DAILY_LIMIT, PLACE_BLOGGER_LIMIT, PLACE360_STORE_LIMIT, PLACE360_DAILY_DIAGNOSIS_LIMIT, PLACE360_HISTORY_DAYS, PublyProxy, getProxies, addProxy, updateProxy, deleteProxy, getProxyUsageToday, getProxyUsageHistory, getDataImpulseToken, saveDataImpulseToken, fetchDataImpulseBalance, getProxyAssignments, assignAccountToProxy, unassignAccount, setAccountFeatures, ProxyAssign, PROXY_FEATURES, checkProxyHealth, getLiveLog, getRunningLiveLogs, LiveLogRow } from "../lib/supabase";
import NeighborPage from "./NeighborPage";
import { botFetch, BotEventStream } from "../lib/botApi";
import { PLACE360_RANK_DAILY_LIMIT, PLACE_DETAIL_DAILY_LIMIT } from "../lib/supabase";
import { markTitleChanged, REVIVE_DAILY_LIMIT, checkReviveQuota, incrementReviveQuota } from "../lib/supabase";

interface Props {
  onBack: () => void;
  onDashboard: () => void;
  theme: "dark" | "light";
  onThemeToggle: () => void;
}

interface UserFull {
  id:string; email:string; name:string; plan:string; is_active:boolean; crawl_enabled?:boolean; place360_enabled?:boolean; inflow_enabled?:boolean; inflow_review_enabled?:boolean; allow_multi_device?:boolean; created_at:string; phone?:string; memo?:string; last_seen?:string;
  quota?: { total_quota:number; used_quota:number; remaining_quota:number; reset_date:string; };
  payments?: any[]; notes?: any[]; history_count?: number;
}

import { AEO_RULES, AEO_FAQ_FORMAT, AEO_TITLE_RULE, ensureAeoIntroSummary } from "../lib/aeo";
const BOT = "http://127.0.0.1:3363";
const INSTA_BOT = "http://127.0.0.1:3365";
const ADM_UID = "admin-publy";
const OT_KW_CATS = ["맛집","여행","재테크·부업","건강·운동","육아","뷰티","패션","인테리어","IT·가전","정책자금","반려동물","자기계발","음식·레시피","문화·연예","스포츠","자동차","교육","부동산"];
// 발행기록(publy_history)은 publy_users.id(uuid)에 FK로 묶여 있어 실제 회원계정 uuid여야 한다.
// 관리자 페이지 발행은 "관리자 본인 회원계정(s9653)"에 기록 → 회원 대시보드와 동일 기록 공유(테리 확정).
// ※ 봇 발행요청·계정·세션은 계속 ADM_UID("admin-publy")를 쓴다(관리자 봇세션 식별용). 여기 uuid는 DB 기록 전용.
const ADM_HISTORY_UID = "41377589-d3d0-473b-8677-8c22a988045a"; // s9653@naver.com
// ★실검증(2026-08-24): 2.0·1.5 계열은 폐기(404). 살아있는 모델만.
const GEMINI_MODELS_ADM = ["gemini-2.5-flash","gemini-2.5-flash-lite","gemini-flash-latest","gemini-flash-lite-latest"];
const BATCH = 30;
const MAX_TITLES = 90;
const MAX_KW = 90;

const ADM_WRITE_AI = [
  {id:"gemini",label:"Gemini Flash",sub:"무료",placeholder:"AIza...",storageKey:"publy_adm_gemini_key",link:"https://aistudio.google.com/app/apikey",color:"#4285F4",logo:"G",free:true},
  {id:"groq",label:"Groq Llama 3",sub:"무료",placeholder:"gsk_...",storageKey:"publy_adm_groq_key",link:"https://console.groq.com/keys",color:"#F55036",logo:"L",free:true},
  {id:"openai",label:"GPT-4o",sub:"유료",placeholder:"sk-...",storageKey:"publy_adm_openai_key",link:"https://platform.openai.com/api-keys",color:"#10A37F",logo:"O",free:false},
];
const ADM_IMAGE_AI = [
  {id:"openai_img",label:"DALL-E 3",sub:"유료",placeholder:"sk-...",storageKey:"publy_adm_openai_key",link:"https://platform.openai.com/api-keys",color:"#10A37F",logo:"O"},
  {id:"replicate",label:"Flux (Replicate)",sub:"유료",placeholder:"r8_...",storageKey:"publy_adm_replicate_key",link:"https://replicate.com/account",color:"#8B5CF6",logo:"R"},
];
const PLAN_QUOTA: Record<string,number> = {
  free:  PLAN_CONFIG.free.dailyPublish,
  basic: PLAN_CONFIG.basic.dailyPublish,
  pro:   PLAN_CONFIG.pro.dailyPublish,
  unlimited: PLAN_CONFIG.unlimited.dailyPublish,
  admin: PLAN_CONFIG.admin.dailyPublish,
};
const PLAN_LABELS: Record<string,string> = {free:"FREE", basic:"BASIC", pro:"PRO", unlimited:"무제한", admin:"ADMIN"};
// 마지막 접속을 "방금 전 / N분 전 / N시간 전 / N일 전 / 날짜"로 보기 쉽게.
function timeAgo(iso?: string): string {
  if (!iso) return "기록 없음";
  const t = new Date(iso).getTime();
  if (isNaN(t)) return "기록 없음";
  const s = Math.floor((Date.now() - t) / 1000);
  if (s < 60) return "방금 전";
  if (s < 3600) return `${Math.floor(s/60)}분 전`;
  if (s < 86400) return `${Math.floor(s/3600)}시간 전`;
  if (s < 86400*7) return `${Math.floor(s/86400)}일 전`;
  return new Date(iso).toLocaleDateString("ko-KR", { month:"numeric", day:"numeric" });
}

// ── AdmKeyInput (건드리지 않음) ─────────────────────────
function AdmKeyInput({k}:{k:any; [x:string]:any}) {
  const [val,setVal] = useState(()=>localStorage.getItem(k.storageKey)||"");
  const [show,setShow] = useState(false);
  const [saved,setSaved] = useState(false);
  const [testing,setTesting] = useState(false);
  const [testMsg,setTestMsg] = useState("");

  function save() {
    if (!val.trim()) return;
    localStorage.setItem(k.storageKey, val.trim());
    setSaved(true); setTestMsg("✅ 저장됨");
    setTimeout(()=>{setSaved(false);setTestMsg("");}, 3000);
  }

  async function testKey() {
    if (!val.trim()) { setTestMsg("❌ 키 입력 필요"); return; }
    setTesting(true); setTestMsg("");
    try {
      if (k.id === "gemini") {
        for (const model of GEMINI_MODELS_ADM) {
          const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${val.trim()}`,
            {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({contents:[{parts:[{text:"hi"}]}],generationConfig:{maxOutputTokens:10}}),signal:AbortSignal.timeout(8000)});
          if (r.ok) { setTestMsg(`✅ 성공 (${model})`); break; }
          if (r.status===401||r.status===403) { setTestMsg("❌ API 키 오류"); break; }
        }
      } else if (k.id === "groq") {
        const r = await fetch("https://api.groq.com/openai/v1/models",{headers:{"Authorization":`Bearer ${val.trim()}`},signal:AbortSignal.timeout(8000)});
        setTestMsg(r.ok ? "✅ Groq 연결 성공" : "❌ 연결 실패");
      } else if (k.id === "openai" || k.id === "openai_img") {
        const r = await fetch("https://api.openai.com/v1/models",{headers:{"Authorization":`Bearer ${val.trim()}`},signal:AbortSignal.timeout(8000)});
        setTestMsg(r.ok ? "✅ OpenAI 연결 성공" : "❌ 연결 실패");
      } else {
        setTestMsg("저장 후 생성으로 테스트");
      }
    } catch(e:any) { setTestMsg("❌ " + e.message); }
    finally { setTesting(false); }
  }

  return (
    <div className="key-row">
      <div className="key-row-header">
        <div className="key-logo" style={{background:`${k.color}20`,color:k.color}}>{k.logo}</div>
        <span className="key-label">{k.label}</span>
        <span className="key-tag">{k.sub}</span>
        <a href={k.link} target="_blank" rel="noopener noreferrer" className="key-link">키 발급 →</a>
      </div>
      <div className="key-row-input">
        <input className="inp" type={show?"text":"password"} placeholder={k.placeholder}
          value={val} onChange={e=>setVal(e.target.value)}/>
        <button className="btn-ghost" onClick={()=>setShow(s=>!s)}>{show?"숨김":"표시"}</button>
        <button className="btn-ghost" onClick={testKey} disabled={testing}>
          {testing ? "테스트 중..." : "테스트"}
        </button>
        <button className="btn-save" onClick={save} style={{background:saved?"#00c875":undefined}}>
          {saved?"✓":"저장"}
        </button>
      </div>
      {testMsg && <div style={{fontSize:12,marginTop:5,fontWeight:600,color:testMsg.includes("✅")?"var(--success)":"var(--danger)"}}>{testMsg}</div>}
    </div>
  );
}

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;600;700;800;900&family=JetBrains+Mono:wght@400;500&display=swap');
*{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent;}
@keyframes fadeUp{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}}
@keyframes spin{to{transform:rotate(360deg)}}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}
@keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}

.app.dark{
  --bg:#0d1117;--bg2:#161b22;--card:#1c2128;--card-hover:#21262d;
  --border:#30363d;--border-focus:#58a6ff;
  --text:#e6edf3;--text2:#b0c4d8;--text3:#ff9ec4;
  --accent:#00ff88;--accent-bg:rgba(0,255,136,.1);--accent-border:rgba(0,255,136,.3);--accent-text:#00ff88;
  --naver:#03C75A;--tistory:#FF6B35;
  --danger:#f85149;--warn:#f0883e;--info:#58a6ff;--success:#3fb950;
  --header-bg:rgba(13,17,23,.95);--shadow:0 8px 32px rgba(0,0,0,.4);
}
.app.light{
  --bg:#f6f8fa;--bg2:#ffffff;--card:#ffffff;--card-hover:#f6f8fa;
  --border:#d0d7de;--border-focus:#0969da;
  --text:#24292f;--text2:#57606a;--text3:#8c959f;
  --accent:#1a7f37;--accent-bg:rgba(26,127,55,.08);--accent-border:rgba(26,127,55,.3);--accent-text:#1a7f37;
  --naver:#03C75A;--tistory:#FF6B35;
  --danger:#cf222e;--warn:#9a6700;--info:#0969da;--success:#1a7f37;
  --header-bg:rgba(246,248,250,.95);--shadow:0 4px 16px rgba(0,0,0,.1);
}

.app{width:100vw;height:100dvh;font-family:'Noto Sans KR',sans-serif;color:var(--text);background:var(--bg);display:flex;flex-direction:column;transition:background .2s,color .2s;overflow:hidden;}
*::-webkit-scrollbar{width:5px;}*::-webkit-scrollbar-thumb{background:var(--border);border-radius:99px;}

.header{height:60px;flex-shrink:0;display:flex;align-items:center;padding:0 16px;gap:12px;background:var(--header-bg);border-bottom:1px solid var(--border);backdrop-filter:blur(20px);position:sticky;top:0;z-index:100;}
.logo{display:flex;align-items:center;gap:8px;text-decoration:none;}
.logo-ico{width:32px;height:32px;border-radius:8px;background:linear-gradient(135deg,#f0417a,#ff8a4c);display:flex;align-items:center;justify-content:center;flex-shrink:0;}
.logo-text{font-size:17px;font-weight:900;letter-spacing:.15em;color:var(--danger);}
.header-mid{display:flex;align-items:center;gap:8px;flex:1;justify-content:center;}
.plat-toggle{display:flex;align-items:center;gap:5px;flex-shrink:0;}
.plat-hdr-btn{padding:5px 12px;border-radius:99px;border:1.5px solid;font-size:11px;font-weight:700;cursor:pointer;font-family:'Noto Sans KR',sans-serif;transition:all .15s;white-space:nowrap;}
.header-right{display:flex;align-items:center;gap:6px;margin-left:auto;}
.server-badge{display:flex;align-items:center;gap:5px;padding:5px 12px;border-radius:99px;font-size:12px;font-weight:700;border:1px solid;white-space:nowrap;}
.server-on{background:rgba(63,185,80,.1);color:var(--success);border-color:rgba(63,185,80,.3);}
.server-off{background:rgba(120,120,120,.08);color:var(--text2);border-color:var(--border);}
.dot{width:7px;height:7px;border-radius:50%;flex-shrink:0;}
.dot-on{background:var(--success);box-shadow:0 0 6px var(--success);animation:pulse 1.5s ease-in-out infinite;}
.dot-off{background:var(--text3);}
.icon-btn{width:36px;height:36px;border-radius:8px;display:flex;align-items:center;justify-content:center;border:1px solid var(--border);background:transparent;color:var(--text2);cursor:pointer;font-size:15px;transition:all .15s;}
.icon-btn:hover{background:var(--card-hover);color:var(--text);border-color:var(--border-focus);}
.icon-btn:active{transform:scale(.9);}
@keyframes publySpin{to{transform:rotate(360deg);}}
.back-btn{display:flex;align-items:center;gap:6px;padding:7px 14px;border-radius:8px;border:1px solid var(--border);background:transparent;color:var(--text2);cursor:pointer;font-size:13px;font-weight:600;font-family:'Noto Sans KR',sans-serif;transition:all .15s;white-space:nowrap;}
.back-btn:hover{background:var(--card-hover);color:var(--text);border-color:var(--border-focus);}
.adm-badge{padding:5px 12px;border-radius:99px;font-size:11px;font-weight:800;background:rgba(248,81,73,.1);color:var(--danger);border:1px solid rgba(248,81,73,.3);letter-spacing:.05em;}

.layout{flex:1;display:flex;overflow:hidden;min-height:0;padding-left:210px;}
.sidebar{position:fixed;left:0;top:60px;bottom:0;z-index:50;width:210px;background:var(--bg2);border-right:1px solid var(--border);display:flex;flex-direction:column;padding:12px 8px;gap:2px;overflow-y:auto;}
.ot-logdock{position:fixed;left:222px;right:16px;bottom:14px;z-index:180;background:var(--card);border:1.5px solid rgba(124,58,237,.42);border-radius:16px;box-shadow:0 12px 46px rgba(0,0,0,.32);display:flex;flex-direction:column;overflow:hidden;}
.ot-logdock-head{display:flex;align-items:center;gap:8px;padding:11px 15px;border-bottom:1px solid var(--border);background:linear-gradient(135deg,rgba(124,58,237,.14),rgba(192,38,211,.06));flex-wrap:wrap;}
.ot-logdock-body{overflow-y:auto;padding:14px 17px;font-size:13px;line-height:1.75;white-space:pre-wrap;word-break:break-word;font-family:ui-monospace,'SF Mono',Menlo,monospace;color:var(--text);background:var(--bg);}
.ot-logdock-btn{font-size:12px;padding:6px 12px;border-radius:9px;border:1px solid var(--border);background:var(--bg2);color:var(--text2);cursor:pointer;font-weight:800;font-family:inherit;transition:all .15s;}
.ot-logdock-btn:hover{border-color:#7c3aed;color:#7c3aed;}
@media(max-width:900px){.ot-logdock{left:10px;right:10px;bottom:70px;}}
.nav-section{font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--text3);padding:4px 10px 6px;margin-top:4px;}
/* 플레이스 세트: 플레이스365+리뷰답글 테두리 묶음 (회원 대시보드와 동일) */
.nav-box{margin:8px 4px;padding:6px 5px 7px;border:1.5px solid rgba(22,133,107,.35);border-radius:12px;background:linear-gradient(180deg,rgba(22,133,107,.06),rgba(22,133,107,.02));}
.nav-box-lbl{font-size:10px;font-weight:800;letter-spacing:.08em;color:#16856b;padding:2px 6px 6px;display:flex;align-items:center;gap:4px;}
.nav-box-lbl::before{content:"🏪";font-size:11px;}
.dark .nav-box{border-color:rgba(34,168,128,.4);background:linear-gradient(180deg,rgba(34,168,128,.08),rgba(34,168,128,.02));}
.dark .nav-box-lbl{color:#5fd3ac;}
.nav-item{display:flex;align-items:center;gap:10px;padding:11px 12px;border-radius:8px;border:none;cursor:pointer;width:100%;font-size:13px;font-weight:500;font-family:'Noto Sans KR',sans-serif;color:var(--text2);background:transparent;transition:all .15s;text-align:left;position:relative;}
.nav-item:hover{background:var(--card-hover);color:var(--text);}
.nav-item.active{background:rgba(248,81,73,.08);color:var(--danger);font-weight:700;}
.nav-item.active::before{content:'';position:absolute;left:0;top:25%;bottom:25%;width:3px;border-radius:99px;background:var(--danger);}
.nav-ico{font-size:16px;flex-shrink:0;}
.nav-badge{margin-left:auto;font-size:10px;font-weight:800;padding:2px 7px;border-radius:99px;background:rgba(248,81,73,.1);color:var(--danger);border:1px solid rgba(248,81,73,.25);}
.nav-item.nav-shine{position:relative;background:linear-gradient(100deg,rgba(255,196,0,.14),rgba(255,146,10,.10),rgba(255,196,0,.14));background-size:220% 100%;animation:navShineFlow 2.6s linear infinite;border:1px solid rgba(255,180,0,.35);border-radius:10px;overflow:hidden;}
.nav-item.nav-shine::after{content:"";position:absolute;top:0;left:-60%;width:45%;height:100%;background:linear-gradient(90deg,transparent,rgba(255,255,255,.55),transparent);transform:skewX(-20deg);animation:navShineSweep 2.6s ease-in-out infinite;}
@keyframes navShineFlow{0%{background-position:0% 0}100%{background-position:220% 0}}
@keyframes navShineSweep{0%{left:-60%}45%,100%{left:130%}}
.nav-hot{margin-left:auto;font-size:9px;font-weight:900;letter-spacing:.5px;color:#3a2500;background:linear-gradient(135deg,#ffd85e,#ffab2e);padding:2px 7px;border-radius:99px;box-shadow:0 0 8px rgba(255,180,0,.6);animation:navHotGlow 1.6s ease-in-out infinite;}
@keyframes navHotGlow{0%,100%{box-shadow:0 0 6px rgba(255,180,0,.5);transform:scale(1)}50%{box-shadow:0 0 14px rgba(255,180,0,.9);transform:scale(1.06)}}
.sidebar-stats{margin-top:auto;padding:12px 8px 4px;border-top:1px solid var(--border);display:grid;grid-template-columns:1fr 1fr;gap:6px;}
.stat-box{padding:10px 12px;border-radius:10px;background:var(--card);border:1px solid var(--border);}
.stat-num{font-size:22px;font-weight:900;color:var(--text);line-height:1;}
.stat-lbl{font-size:9px;color:var(--text2);margin-top:3px;font-weight:600;}

.main{flex:1;overflow-y:auto;padding:20px;min-width:0;}
.pub-sticky-bar{position:sticky;top:0;z-index:30;background:var(--card);border-bottom:1px solid var(--border);padding:10px 16px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;backdrop-filter:blur(12px);}
.pub-ready{display:flex;align-items:center;gap:6px;flex-wrap:wrap;}
.pub-ready-chip{display:flex;align-items:center;gap:4px;padding:4px 10px;border-radius:99px;font-size:11px;font-weight:700;border:1px solid;}
.pub-ready-ok{background:rgba(63,185,80,.1);color:var(--success);border-color:rgba(63,185,80,.25);}
.pub-ready-no{background:rgba(248,81,73,.08);color:var(--danger);border-color:rgba(248,81,73,.2);}
@media(max-width:900px){.right-panel{display:none;}.pub-ready{display:none;}.pub-sticky-bar{flex-wrap:wrap;gap:6px;}}

.card{background:var(--card);border:1px solid var(--border);border-radius:14px;padding:20px 22px;margin-bottom:14px;transition:border-color .15s;}
.card:hover{border-color:var(--border-focus);}
.card-title{font-size:12px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:var(--text2);margin-bottom:14px;display:flex;align-items:center;gap:7px;}

.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;padding:11px 20px;border-radius:8px;border:none;font-size:14px;font-weight:700;font-family:'Noto Sans KR',sans-serif;cursor:pointer;transition:all .15s;white-space:nowrap;}
.btn:disabled{opacity:.45;cursor:not-allowed;}
.btn-primary{background:var(--accent);color:#000;}
.btn-primary:hover:not(:disabled){filter:brightness(1.1);}
.btn-danger-fill{background:var(--danger);color:#fff;}
.btn-danger-fill:hover:not(:disabled){filter:brightness(1.1);}
.btn-secondary{background:var(--card);color:var(--text);border:1px solid var(--border);}
.btn-secondary:hover:not(:disabled){background:var(--card-hover);border-color:var(--border-focus);}
.btn-full{width:100%;}
.btn-xl{padding:16px 28px;font-size:16px;border-radius:12px;}
.btn-sm{padding:7px 14px;font-size:12px;}
.btn-ghost{padding:8px 12px;border-radius:7px;border:1px solid var(--border);background:transparent;color:var(--text2);cursor:pointer;font-size:12px;font-family:'Noto Sans KR',sans-serif;transition:all .15s;}
.btn-ghost:hover{background:var(--card-hover);color:var(--text);}
.btn-ghost:disabled{opacity:.5;}
.btn-save{padding:8px 16px;border-radius:7px;border:none;background:var(--accent);color:#000;cursor:pointer;font-size:12px;font-weight:700;font-family:'Noto Sans KR',sans-serif;transition:all .2s;white-space:nowrap;}

.inp{width:100%;padding:12px 14px;border-radius:8px;border:1.5px solid var(--border);background:var(--bg);color:var(--text);font-size:14px;font-family:'Noto Sans KR',sans-serif;outline:none;transition:all .15s;}
.inp:focus{border-color:var(--border-focus);box-shadow:0 0 0 3px rgba(88,166,255,.15);}
.inp::placeholder{color:var(--text3);}
.inp.lg{font-size:16px;padding:14px 16px;}
select.inp{cursor:pointer;appearance:auto;}
.dark select.inp{color-scheme:dark;}.light select.inp{color-scheme:light;}
textarea.inp{resize:vertical;min-height:80px;line-height:1.7;}
.inp-label{font-size:12px;font-weight:700;color:var(--text2);display:block;margin-bottom:6px;}

.spinner{width:16px;height:16px;border-radius:50%;border:2.5px solid rgba(0,0,0,.15);border-top-color:#000;animation:spin .8s linear infinite;display:inline-block;flex-shrink:0;}
.spinner-white{border-color:rgba(255,255,255,.2);border-top-color:#fff;}

.alert{padding:13px 16px;border-radius:10px;font-size:13px;margin-bottom:14px;display:flex;align-items:flex-start;gap:10px;line-height:1.6;font-weight:500;}
.alert-warn{background:rgba(240,136,62,.08);border:1px solid rgba(240,136,62,.25);color:var(--warn);}
.alert-danger{background:rgba(248,81,73,.08);border:1px solid rgba(248,81,73,.25);color:var(--danger);}
.alert-info{background:rgba(88,166,255,.08);border:1px solid rgba(88,166,255,.25);color:var(--info);}
.alert-success{background:rgba(63,185,80,.08);border:1px solid rgba(63,185,80,.25);color:var(--success);}

.plat-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;}
.plat-btn{padding:16px;border-radius:12px;border:2px solid var(--border);background:var(--bg);cursor:pointer;text-align:left;font-family:'Noto Sans KR',sans-serif;transition:all .2s;display:flex;align-items:center;gap:12px;}
.plat-btn.naver-sel{border-color:var(--naver);background:rgba(3,199,90,.07);}
.plat-btn.tistory-sel{border-color:var(--tistory);background:rgba(255,107,53,.07);}
.plat-ico{font-size:28px;flex-shrink:0;}
.plat-name{font-size:14px;font-weight:700;color:var(--text);}
.plat-sub{font-size:11px;color:var(--text2);margin-top:2px;}
.plat-check{margin-left:auto;font-size:18px;}

.adtype-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px;}
.adtype-btn{padding:14px 16px;border-radius:12px;border:2px solid var(--border);background:var(--bg);cursor:pointer;text-align:left;font-family:'Noto Sans KR',sans-serif;transition:all .2s;}
.adtype-btn.adpost-sel{border-color:var(--naver);background:rgba(3,199,90,.07);}
.adtype-btn.adsense-sel{border-color:var(--info);background:rgba(88,166,255,.07);}
.adtype-label{font-size:13px;font-weight:700;color:var(--text);margin-bottom:3px;}
.adtype-sub{font-size:11px;color:var(--text2);}

.steps{display:flex;align-items:center;gap:0;margin-bottom:20px;overflow:hidden;border-radius:12px;border:1px solid var(--border);}
.step{flex:1;padding:11px 8px;text-align:center;font-size:12px;font-weight:600;color:var(--text2);background:var(--card);border-right:1px solid var(--border);transition:all .2s;}
.step:last-child{border-right:none;}
.step.active{background:rgba(248,81,73,.08);color:var(--danger);font-weight:800;}
.step.done{background:rgba(63,185,80,.06);color:var(--success);}
.step-num{font-size:10px;display:block;margin-bottom:1px;opacity:.7;}

.toggle-group{display:flex;gap:6px;flex-wrap:wrap;}
.toggle-btn{padding:8px 16px;border-radius:99px;border:1.5px solid var(--border);background:transparent;color:var(--text2);cursor:pointer;font-size:12px;font-weight:600;font-family:'Noto Sans KR',sans-serif;transition:all .15s;}
.toggle-btn.active{border-color:var(--accent);background:var(--accent-bg);color:var(--accent-text);}

.title-grid{display:grid;gap:8px;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));max-height:400px;overflow-y:auto;padding-right:4px;}
.title-card{padding:14px 16px;border-radius:10px;border:1.5px solid var(--border);background:var(--bg);cursor:pointer;text-align:left;font-family:'Noto Sans KR',sans-serif;transition:all .15s;position:relative;}
.title-card:hover{border-color:var(--border-focus);background:var(--card-hover);}
.title-card.selected{border-color:var(--accent);background:var(--accent-bg);}
.title-num{font-size:10px;color:var(--text3);margin-bottom:5px;font-family:'JetBrains Mono',monospace;}
.title-card.selected .title-num{color:var(--accent-text);}
.title-text{font-size:13px;font-weight:600;color:var(--text);line-height:1.55;}
.title-card.selected .title-text{color:var(--accent-text);}
.title-check{position:absolute;top:10px;right:10px;width:20px;height:20px;border-radius:50%;background:var(--accent);display:flex;align-items:center;justify-content:center;font-size:10px;color:#000;font-weight:900;}

.selected-banner{padding:13px 16px;border-radius:10px;background:var(--accent-bg);border:1.5px solid var(--accent-border);margin-bottom:14px;}
.selected-banner-label{font-size:11px;color:var(--accent-text);font-weight:700;margin-bottom:3px;}
.selected-banner-text{font-size:14px;font-weight:800;color:var(--text);}

.img-grid{display:flex;gap:8px;flex-wrap:wrap;}
.img-thumb-wrap{position:relative;}
.img-thumb{width:90px;height:90px;object-fit:cover;border-radius:10px;border:2px solid var(--border);display:block;}
.img-thumb.thumb-first{border-color:var(--accent);}
.img-thumb-badge{position:absolute;top:-7px;left:-4px;font-size:9px;font-weight:800;padding:2px 6px;border-radius:99px;background:var(--accent);color:#000;}
.img-thumb-del{position:absolute;top:-6px;right:-6px;width:18px;height:18px;border-radius:50%;background:var(--danger);border:none;color:#fff;cursor:pointer;font-size:10px;display:flex;align-items:center;justify-content:center;}

.char-badge{padding:4px 12px;border-radius:99px;font-size:12px;font-weight:700;background:var(--accent-bg);color:var(--accent-text);border:1px solid var(--accent-border);}
.preview-btn{padding:7px 14px;border-radius:8px;border:1px solid var(--accent-border);background:var(--accent-bg);color:var(--accent-text);cursor:pointer;font-size:12px;font-weight:700;font-family:'Noto Sans KR',sans-serif;transition:all .15s;}
.preview-modal{position:fixed;inset:0;z-index:500;background:rgba(0,0,0,.85);display:flex;align-items:center;justify-content:center;padding:16px;}
.preview-inner{width:100%;max-width:700px;max-height:90vh;overflow-y:auto;background:#fff;border-radius:16px;padding:32px 28px;}

/* 회원 목록 */
.user-table{border:1px solid var(--border);border-radius:12px;overflow:hidden;}
.user-row{display:flex;align-items:center;gap:12px;padding:14px 16px;border-bottom:1px solid var(--border);transition:background .15s;cursor:pointer;}
.user-row:last-child{border-bottom:none;}
.user-row:hover{background:var(--card-hover);}
.user-row.selected-row{background:rgba(88,166,255,.06);border-left:3px solid var(--info);}
.user-avatar{width:36px;height:36px;border-radius:10px;background:var(--accent-bg);border:1px solid var(--accent-border);display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:800;color:var(--accent-text);flex-shrink:0;}
.user-info{flex:1;min-width:0;}
.user-name-row{font-size:14px;font-weight:700;color:var(--text);display:flex;align-items:center;gap:6px;}
.user-email-row{font-size:11px;color:var(--text2);margin-top:2px;font-family:'JetBrains Mono',monospace;}
.plan-chip{font-size:10px;font-weight:800;padding:2px 8px;border-radius:99px;}
.plan-free{background:rgba(120,120,120,.12);color:var(--text2);border:1px solid var(--border);}
.plan-basic{background:rgba(88,166,255,.12);color:var(--info);border:1px solid rgba(88,166,255,.25);}
.plan-pro{background:rgba(63,185,80,.12);color:var(--success);border:1px solid rgba(63,185,80,.25);}
.inactive-chip{font-size:10px;font-weight:700;padding:2px 8px;border-radius:99px;background:rgba(248,81,73,.1);color:var(--danger);border:1px solid rgba(248,81,73,.25);}
.quota-mini{font-size:11px;color:var(--text2);font-family:'JetBrains Mono',monospace;}

/* 유저 상세 패널 */
.detail-panel{background:var(--card);border:1px solid var(--border);border-radius:14px;padding:20px;margin-top:14px;animation:fadeUp .2s ease both;}
.detail-header{display:flex;align-items:center;gap:12px;margin-bottom:18px;flex-wrap:wrap;}
.detail-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px;}
.adm-img-split{display:grid;grid-template-columns:280px 1fr;gap:14px;align-items:start;}
.pub-grid{display:grid;grid-template-columns:1fr 320px;gap:16px;align-items:start;}
.pub-panel-desktop{display:flex;flex-direction:column;gap:12px;}
.pub-mobile-bar{display:none;}
.lg-hidden{display:none;}
.pub-submit-btn{display:block;}
@media(max-width:900px){
  .pub-grid{grid-template-columns:1fr !important;}
  .pub-panel-desktop{display:none !important;}
  .pub-mobile-bar{display:flex !important;}
  .lg-hidden{display:block !important;}
  .pub-submit-btn{display:none !important;}
}
.detail-field{display:flex;flex-direction:column;gap:5px;}
.field-label{font-size:11px;font-weight:700;color:var(--text2);}
.field-inp{padding:9px 12px;border-radius:8px;border:1.5px solid var(--border);background:var(--bg);color:var(--text);font-size:13px;font-family:'Noto Sans KR',sans-serif;outline:none;transition:border-color .15s;}
.field-inp:focus{border-color:var(--border-focus);}
select.field-inp{cursor:pointer;appearance:auto;}
.dark select.field-inp{color-scheme:dark;}.light select.field-inp{color-scheme:light;}

/* 통계 */
.stats-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:12px;margin-bottom:16px;}
.stats-card{padding:18px 16px;border-radius:12px;background:var(--card);border:1px solid var(--border);}
.stats-num{font-size:28px;font-weight:900;color:var(--text);line-height:1;}
.stats-label{font-size:11px;color:var(--text2);margin-top:4px;font-weight:600;}
.stats-sub{font-size:10px;color:var(--text3);margin-top:2px;}

/* 계정 카드 */
.acc-card{display:flex;align-items:center;gap:12px;padding:14px 16px;border-radius:12px;border:1.5px solid var(--border);background:var(--card);margin-bottom:10px;animation:fadeUp .25s ease both;transition:border-color .2s;}
.acc-card.connected-naver{border-color:rgba(3,199,90,.3);}
.acc-card.connected-tistory{border-color:rgba(255,107,53,.3);}

/* AI 카드 */
.ai-grid{display:flex;gap:10px;margin-bottom:18px;flex-wrap:wrap;}
.ai-card{flex:1;min-width:120px;padding:14px 12px;border-radius:12px;border:2px solid var(--border);background:var(--bg);cursor:pointer;text-align:left;font-family:'Noto Sans KR',sans-serif;transition:all .2s;position:relative;}
.ai-card.selected{transform:translateY(-2px);}
.ai-card-top{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;}
.ai-logo{width:28px;height:28px;border-radius:7px;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:900;}
.ai-name{font-size:12px;font-weight:700;color:var(--text);}
.ai-sub{font-size:10px;color:var(--text2);margin-top:2px;}
.ai-sel-badge{font-size:9px;font-weight:800;padding:2px 7px;border-radius:99px;color:#000;}
.ai-free-badge{font-size:9px;font-weight:800;padding:2px 7px;border-radius:99px;background:rgba(63,185,80,.12);color:var(--success);}
.ai-paid-badge{font-size:9px;font-weight:800;padding:2px 7px;border-radius:99px;background:rgba(240,136,62,.12);color:var(--warn);}

/* 키 섹션 */
.key-section{padding:16px 18px;border-radius:12px;border:1px solid var(--border);margin-bottom:12px;}
.key-section-title{font-size:11px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:var(--text2);margin-bottom:12px;display:flex;align-items:center;gap:7px;}
.key-row{margin-bottom:10px;}
.key-row:last-child{margin-bottom:0;}
.key-row-header{display:flex;align-items:center;gap:7px;margin-bottom:7px;}
.key-logo{width:22px;height:22px;border-radius:5px;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:900;flex-shrink:0;}
.key-label{font-size:12px;font-weight:700;color:var(--text);}
.key-tag{font-size:10px;color:var(--text2);}
.key-link{margin-left:auto;font-size:11px;color:var(--accent-text);text-decoration:none;font-weight:600;}
.key-row-input{display:flex;gap:6px;}
.key-row-input .inp{flex:1;font-size:13px;padding:9px 12px;}

.info-table{border:1px solid var(--border);border-radius:10px;overflow:hidden;}
.info-row{display:flex;align-items:center;justify-content:space-between;padding:13px 16px;border-bottom:1px solid var(--border);}
.info-row:last-child{border-bottom:none;}
.info-row:hover{background:var(--card-hover);}
.info-key{font-size:13px;color:var(--text2);}
.info-val{font-size:14px;font-weight:700;color:var(--text);}

.empty{text-align:center;padding:60px 24px;animation:fadeUp .3s ease both;}
.empty-ico{font-size:56px;margin-bottom:16px;animation:float 3s ease-in-out infinite;}
.empty-title{font-size:18px;font-weight:800;color:var(--text);margin-bottom:8px;}
.empty-sub{font-size:14px;color:var(--text2);margin-bottom:24px;line-height:1.6;}

.mob-tabs{display:none;position:fixed;bottom:0;left:0;right:0;z-index:200;background:var(--header-bg);border-top:1px solid var(--border);backdrop-filter:blur(20px);padding:8px 4px max(14px,env(safe-area-inset-bottom));overflow-x:auto;overflow-y:hidden;flex-wrap:nowrap;-webkit-overflow-scrolling:touch;scrollbar-width:none;}
.mob-tabs::-webkit-scrollbar{display:none;}
.mob-tab{flex:0 0 auto;min-width:64px;display:flex;flex-direction:column;align-items:center;gap:3px;padding:6px 8px;border:none;background:transparent;cursor:pointer;font-family:'Noto Sans KR',sans-serif;transition:all .15s;min-height:52px;}
.mob-tab-ico{font-size:22px;}
.mob-tab-lbl{font-size:11px;font-weight:600;color:var(--text2);}
.mob-tab.active{background:rgba(248,81,73,.08);border-radius:10px;}
.mob-tab.active .mob-tab-lbl{color:var(--danger);}

@media(max-width:900px){
  .sidebar{display:none;}
  .mob-tabs{display:flex;}
  .main{padding-bottom:130px;}
  .layout{padding-left:0;}
}
@media(max-width:768px){
  .header-mid{display:none;}.server-badge{display:none;}.adm-badge{display:none;}
  .header{height:auto;min-height:60px;padding:8px;gap:6px;overflow:hidden;}.logo-text{font-size:13px;letter-spacing:.08em;}.header-right{min-width:0;margin-left:auto;gap:4px;overflow-x:auto;scrollbar-width:none;}.header-right::-webkit-scrollbar{display:none}.adm-guide-text,.back-text{display:none}.adm-guide-btn,.back-btn,.icon-btn{flex-shrink:0;padding:8px 10px;}
  .main{padding:14px 12px calc(84px + env(safe-area-inset-bottom));}
  .plat-grid{grid-template-columns:1fr 1fr;}
  .title-grid{grid-template-columns:1fr;}
  .adtype-grid{grid-template-columns:1fr;}
  .detail-grid{grid-template-columns:1fr;}
  .stats-grid{grid-template-columns:1fr 1fr;}
  .adm-img-split{grid-template-columns:1fr !important;}
  .card{padding:16px 14px;}
  .btn{font-size:15px;padding:13px 20px;}
  .btn-xl{padding:17px 24px;font-size:17px;}
  .btn-sm{font-size:13px;padding:10px 16px;}
  .inp{font-size:16px;padding:14px 14px;}
  .inp-label{font-size:14px;}
  .card-title{font-size:13px;}
  .title-card{padding:16px;}
  .title-text{font-size:15px;}
  .title-num{font-size:12px;}
  .adtype-label{font-size:15px;}
  .adtype-sub{font-size:13px;}
  .toggle-btn{font-size:14px;padding:11px 18px;}
  .step{font-size:13px;padding:13px 8px;}
  .stat-num{font-size:26px;}
  .mob-tab-lbl{font-size:12px;}
  .mob-tab-ico{font-size:24px;}
  .user-row{padding:14px 12px;}
  .acc-card{flex-wrap:wrap;}
  /* 캘린더 모바일 */
  .cal-grid{grid-template-columns:1fr !important;}
  /* 서이추 모바일 */
  .neighbor-grid{grid-template-columns:1fr !important;}
  .neighbor-counter{grid-template-columns:repeat(3,1fr) !important;}
  .main,.card,.detail-panel,.user-table,.info-table{min-width:0;max-width:100%;overflow-wrap:anywhere;}.user-row,.info-row,.detail-header{flex-wrap:wrap}.user-email-row{white-space:normal;word-break:break-all}.key-row-input{flex-wrap:wrap}.key-row-input .inp{min-width:0}.preview-inner{width:calc(100vw - 20px);padding:20px 14px}.stats-grid{grid-template-columns:repeat(2,minmax(0,1fr))}
}
@media(max-width:480px){
  .header{padding:0 8px;gap:4px;}
  .plat-grid{grid-template-columns:1fr;}
  .adtype-grid{grid-template-columns:1fr;}
  .key-row-input{flex-wrap:wrap;}
  .key-row-input .inp{width:100%;}
  /* 모바일 헤더 - 텍스트 숨기고 이모지만 */
  .adm-guide-text{display:none;}
  .adm-guide-btn{padding:8px 10px;}
  .back-text{display:none;}
  .back-btn{padding:7px 9px;}
  /* 회원 목록 모바일 짤림 방지 */
  .user-row{min-width:0;overflow:hidden;}
  .user-info{overflow:hidden;}
  .user-name-row{flex-wrap:wrap;}
  .user-email-row{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:180px;}
}

/* ── 관리자 사용설명서 ───────────────────────── */
@keyframes guideIn{from{opacity:0;transform:scale(.93) translateY(18px)}to{opacity:1;transform:scale(1) translateY(0)}}
@keyframes admGuideFloat{0%,100%{transform:translateY(0)}50%{transform:translateY(-4px)}}
.guide-overlay{position:fixed;inset:0;z-index:999;background:rgba(0,0,0,.78);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;padding:max(12px,env(safe-area-inset-top)) 12px max(12px,env(safe-area-inset-bottom));}
.guide-modal{width:100%;max-width:580px;max-height:calc(100dvh - 24px - env(safe-area-inset-top) - env(safe-area-inset-bottom));border-radius:24px;overflow:hidden;display:flex;flex-direction:column;animation:guideIn .32s cubic-bezier(.34,1.56,.64,1) both;box-shadow:0 32px 80px rgba(0,0,0,.6);position:relative;}
.guide-header{padding:22px 22px 0;background:linear-gradient(135deg,#2a0a0a 0%,#1a0505 100%);flex-shrink:0;border-bottom:1px solid rgba(255,255,255,.06);}
.guide-logo-row{display:flex;align-items:center;gap:10px;margin-bottom:14px;}
.guide-logo-ico{width:40px;height:40px;border-radius:12px;background:linear-gradient(135deg,#ff6b6b,#ff3333);display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0;}
.guide-title{font-size:21px;font-weight:900;color:#fff;line-height:1.2;}
.guide-subtitle{font-size:12px;color:rgba(255,255,255,.5);margin-top:3px;}
.guide-tabs{display:flex;gap:0;overflow-x:auto;scrollbar-width:none;}
.guide-tabs::-webkit-scrollbar{display:none;}
.guide-tab{padding:11px 16px;border:none;background:transparent;font-size:12px;font-weight:700;color:rgba(255,255,255,.4);cursor:pointer;font-family:'Noto Sans KR',sans-serif;white-space:nowrap;border-bottom:3px solid transparent;transition:all .15s;flex-shrink:0;}
.guide-tab.active{color:#FFD93D;border-bottom-color:#FFD93D;}
.guide-tab:hover:not(.active){color:rgba(255,255,255,.7);}
.guide-body{flex:1;overflow-y:auto;background:#150505;padding:18px 18px 22px;min-height:0;}
.guide-body::-webkit-scrollbar{width:4px;}
.guide-body::-webkit-scrollbar-thumb{background:rgba(255,255,255,.1);border-radius:99px;}
.guide-close{position:absolute;top:14px;right:16px;width:32px;height:32px;border-radius:99px;background:rgba(255,255,255,.12);border:none;color:#fff;cursor:pointer;font-size:15px;display:flex;align-items:center;justify-content:center;transition:background .15s;z-index:10;}
.guide-close:hover{background:rgba(255,255,255,.22);}
.g-step{border-radius:16px;padding:16px 16px;margin-bottom:10px;border:1.5px solid;position:relative;}
.g-step-num{font-size:10px;font-weight:900;letter-spacing:.1em;text-transform:uppercase;margin-bottom:5px;display:flex;align-items:center;gap:6px;}
.g-step-title{font-size:16px;font-weight:900;margin-bottom:6px;line-height:1.3;}
.g-step-desc{font-size:14px;line-height:1.85;color:rgba(255,255,255,.82);}
.g-step-desc b{font-weight:900;color:#fff;}
.g-tip{margin-top:10px;padding:10px 13px;border-radius:10px;background:rgba(255,255,255,.06);font-size:13px;line-height:1.75;color:rgba(255,255,255,.75);}
.g-tip b{font-weight:800;color:#FFD93D;}
.g-btn{display:inline-flex;align-items:center;gap:7px;padding:11px 20px;border-radius:99px;border:none;font-size:13px;font-weight:800;font-family:'Noto Sans KR',sans-serif;cursor:pointer;margin-top:12px;transition:all .15s;}
.g-btn:hover{filter:brightness(1.1);transform:translateY(-1px);}
.guide-footer{padding:12px 18px;background:#100303;border-top:1px solid rgba(255,255,255,.07);display:flex;align-items:center;justify-content:space-between;flex-shrink:0;gap:10px;flex-wrap:wrap;}
.guide-nav-btn{padding:9px 20px;border-radius:99px;border:1.5px solid;font-size:13px;font-weight:700;font-family:'Noto Sans KR',sans-serif;cursor:pointer;transition:all .15s;}
.guide-page{font-size:12px;color:rgba(255,255,255,.35);font-weight:600;}
.adm-guide-btn{display:inline-flex;align-items:center;gap:6px;padding:8px 15px;border-radius:99px;border:none;background:linear-gradient(135deg,#FFD93D,#FFA500);color:#000;font-size:12px;font-weight:800;font-family:'Noto Sans KR',sans-serif;cursor:pointer;animation:admGuideFloat 2.8s ease-in-out infinite;white-space:nowrap;flex-shrink:0;box-shadow:0 4px 16px rgba(255,165,0,.4);transition:filter .15s;}
.adm-guide-btn:hover{filter:brightness(1.1);}

@media(max-width:768px){
  .guide-modal{max-width:100%;max-height:calc(100dvh - 20px - env(safe-area-inset-top) - env(safe-area-inset-bottom));border-radius:20px;}
  .guide-header{padding:16px 16px 0;}
  .guide-title{font-size:17px;}
  .guide-body{padding:14px 14px 18px;}
  .g-step{padding:13px 13px;}
  .g-step-title{font-size:15px;}
  .g-step-desc{font-size:13px;}
  .guide-footer{padding:10px 14px;}
}
@media(max-width:480px){
  .guide-overlay{padding:6px;}
  .guide-modal{max-height:calc(100dvh - 12px - env(safe-area-inset-top) - env(safe-area-inset-bottom));border-radius:16px;}
  .guide-tab{font-size:11px;padding:9px 11px;}
}

/* ── 이미지 탭 추가 클래스 ── */
.flow-nav{display:flex;align-items:center;justify-content:center;gap:10px;margin:16px 0 4px;flex-wrap:wrap;}
.flow-btn{display:inline-flex;align-items:center;gap:8px;padding:14px 26px;border-radius:99px;border:none;font-size:15px;font-weight:800;font-family:'Noto Sans KR',sans-serif;cursor:pointer;transition:all .18s;}
.flow-btn:hover:not(:disabled){transform:translateY(-2px);}
.flow-btn:disabled{opacity:.4;cursor:not-allowed;}
.flow-btn-g{background:linear-gradient(135deg,var(--accent),#00cc80);color:#000;box-shadow:0 4px 20px rgba(0,255,136,.25);}
.flow-btn-skip{background:var(--card);color:var(--text2);border:1px solid var(--border);}
.btn-stop{background:rgba(248,81,73,.1);color:var(--danger);border:1.5px solid rgba(248,81,73,.35);padding:9px 18px;border-radius:99px;font-size:13px;font-weight:800;font-family:'Noto Sans KR',sans-serif;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:7px;transition:all .15s;width:100%;}
.btn-stop:hover{background:rgba(248,81,73,.2);}
.img-caption-inp{width:100%;padding:6px 9px;border-radius:8px;border:1px solid var(--border);background:var(--bg2);color:var(--text);font-size:12px;font-family:'Noto Sans KR',sans-serif;outline:none;transition:border-color .15s;}
.img-caption-inp:focus{border-color:var(--border-focus);}
.img-caption-inp::placeholder{color:var(--text3);}
@media(max-width:768px){
  .flow-nav{flex-direction:column;align-items:stretch;}
  .flow-btn{justify-content:center;font-size:16px;padding:16px 22px;}
.app.large{font-size:16px;}
.app.large .nav-item{font-size:15px;padding:13px 12px;}
.app.large .card-title{font-size:14px;}
.app.large .inp{font-size:16px;padding:13px 14px;}
.app.large .inp-label{font-size:14px;}
.app.large .btn{font-size:15px;padding:13px 22px;}
.app.large .btn-sm{font-size:13px;padding:10px 16px;}
}
.toast-wrap{position:fixed;bottom:28px;right:24px;z-index:9999;display:flex;flex-direction:column;gap:8px;pointer-events:none;}
.toast{padding:12px 18px;border-radius:12px;font-size:13px;font-weight:700;font-family:'Noto Sans KR',sans-serif;box-shadow:0 4px 24px rgba(0,0,0,.35);animation:toastIn .25s ease;pointer-events:all;display:flex;align-items:center;gap:8px;max-width:320px;}
.toast-success{background:#1a2e1a;color:#4ade80;border:1px solid rgba(74,222,128,.25);}
.toast-error{background:#2e1a1a;color:#f87171;border:1px solid rgba(248,113,113,.25);}
.toast-info{background:#1a1f2e;color:#93c5fd;border:1px solid rgba(147,197,253,.25);}
@keyframes toastIn{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
/* ── 사진 글쓰기 꽃밭 테마 ── */
.photo-root{padding:20px;max-width:860px;margin:0 auto;}
.photo-story{display:flex;gap:0;margin-bottom:28px;border-radius:20px;overflow:hidden;box-shadow:0 4px 24px rgba(255,107,157,.15);}
.photo-story-step{flex:1;padding:20px 16px;text-align:center;position:relative;}
.photo-story-step.s1{background:linear-gradient(135deg,#FF6B9D22,#FF9E6C22);}
.photo-story-step.s2{background:linear-gradient(135deg,#C77DFF22,#FF6B9D22);}
.photo-story-step.s3{background:linear-gradient(135deg,#80FFDB22,#C77DFF22);}
.photo-story-ico{font-size:32px;margin-bottom:8px;display:block;}
.photo-story-num{font-size:10px;font-weight:900;letter-spacing:.1em;color:#FF6B9D;margin-bottom:4px;}
.photo-story-title{font-size:13px;font-weight:800;color:var(--text);margin-bottom:4px;}
.photo-story-desc{font-size:11px;color:var(--text3);line-height:1.5;}
.photo-story-arrow{position:absolute;right:-10px;top:50%;transform:translateY(-50%);font-size:18px;color:#FF6B9D;z-index:2;}
.photo-drop{border:2.5px dashed #FF6B9D55;border-radius:20px;padding:32px 20px;text-align:center;cursor:pointer;transition:all .2s;background:var(--bg);margin-bottom:16px;}
.photo-drop.drag-over,.photo-drop:hover{border-color:#FF6B9D;background:linear-gradient(135deg,#FF6B9D11,#C77DFF11);}
.photo-drop-ico{font-size:48px;margin-bottom:12px;}
.photo-drop-title{font-size:16px;font-weight:800;color:#FF6B9D;margin-bottom:6px;}
.photo-drop-desc{font-size:12px;color:var(--text3);}
.photo-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(100px,1fr));gap:8px;margin-bottom:16px;}
.photo-thumb{position:relative;aspect-ratio:1;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.12);}
.photo-thumb img{width:100%;height:100%;object-fit:cover;}
.photo-thumb-del{position:absolute;top:4px;right:4px;width:22px;height:22px;border-radius:50%;background:rgba(0,0,0,.6);color:#fff;border:none;cursor:pointer;font-size:12px;display:flex;align-items:center;justify-content:center;font-weight:700;}
.photo-keypoints{width:100%;min-height:80px;padding:14px;border-radius:14px;border:1.5px solid #C77DFF44;background:var(--bg);color:var(--text);font-size:14px;font-family:inherit;resize:vertical;outline:none;transition:border .2s;line-height:1.7;}
.photo-keypoints:focus{border-color:#C77DFF;}
.photo-keypoints::placeholder{color:var(--text3);}
.photo-gen-btn{width:100%;padding:18px;border-radius:16px;border:none;cursor:pointer;font-size:16px;font-weight:900;font-family:inherit;transition:all .2s;background:linear-gradient(135deg,#FF6B9D,#C77DFF);color:#fff;box-shadow:0 4px 20px rgba(255,107,157,.4);margin-top:8px;}
.photo-gen-btn:hover{transform:translateY(-2px);box-shadow:0 8px 28px rgba(255,107,157,.5);}
.photo-gen-btn:disabled{opacity:.6;cursor:not-allowed;transform:none;}
.photo-guide-btn{position:fixed;bottom:80px;right:16px;padding:10px 16px;border-radius:99px;background:linear-gradient(135deg,#FF6B9D,#C77DFF);border:none;cursor:pointer;box-shadow:0 4px 16px rgba(255,107,157,.5);font-size:13px;font-weight:800;color:#fff;display:flex;align-items:center;gap:6px;z-index:100;transition:all .2s;white-space:nowrap;font-family:inherit;}
.photo-guide-btn:hover{transform:scale(1.1);}
@keyframes flowerFloat{0%,100%{transform:translateY(0) rotate(0deg);}50%{transform:translateY(-6px) rotate(3deg);}}
.flower-deco{animation:flowerFloat 3s ease-in-out infinite;display:inline-block;}
`;

const WRITE_STYLES = [
  {id:"감성일기", i:"📔", desc:"감성·경험 중심 에세이체"},
  {id:"정보글",  i:"📋", desc:"SEO 최적화 정보 전달"},
  {id:"맛집후기",i:"🍽️", desc:"음식·분위기·가격 묘사"},
  {id:"여행기",  i:"✈️", desc:"일정·팁·감성 여행 스토리"},
] as const;
type WriteStyle = typeof WRITE_STYLES[number]["id"];
const WRITE_STYLE_GUIDE: Record<WriteStyle,string> = {
  "감성일기":"[스타일] 개인 감정·경험 중심의 따뜻한 에세이체. 독자에게 말 걸듯 친근하게. 경험 흐름 사이 본문 중간에 가격·시간·이용법·선택 팁 중 맞는 정보 3개를 짧게 섞고, 정보만 글 끝에 몰지 않기.",
  "정보글":  "[스타일] 명확한 정보 전달. 번호 목록·수치·비교 표현 적극 활용. SEO 키워드 자연스럽게 반복.",
  "맛집후기":"[스타일] 맛·향·식감 생생하게 묘사. 가격·위치·웨이팅·주차 정보는 본문 중간에 넣되 매 글마다 위치와 순서를 바꾸기. 재방문 의향 솔직하게.",
  "여행기":  "[스타일] 여행지 분위기·감성 묘사. 일정·비용·교통 팁은 본문 중간에 넣되 매 글마다 위치와 순서를 바꾸기. 포토스팟·현지 맛집 자연스럽게 언급.",
};

const BLOG_TEMPLATES = [
  {id:"none",      label:"📝 템플릿 없음", style:"감성일기" as const, persona:"none" as const, guide:""},
  {id:"restaurant",label:"🍽️ 맛집 후기",  style:"맛집후기" as const, persona:"young_w" as const, guide:"[템플릿: 맛집 후기]\n구성: 방문 계기 → 분위기/인테리어 → 메뉴/가격 → 맛 평가(식감·향·비주얼) → 서비스 → 재방문 의향\n필수: 가격대 언급, 주차/웨이팅 정보, 추천 메뉴"},
  {id:"travel",    label:"✈️ 여행 후기",  style:"여행기" as const,  persona:"young_w" as const, guide:"[템플릿: 여행 후기]\n구성: 여행지 소개 → 이동 방법/비용 → 주요 볼거리 → 맛집/카페 → 숙소 → 총평/팁\n필수: 교통비·숙박비 언급, 포토스팟, 여행 꿀팁"},
  {id:"product",   label:"📦 제품 리뷰",  style:"정보글" as const,  persona:"expert" as const, guide:"[템플릿: 제품 리뷰]\n구성: 구매 계기 → 언박싱/외관 → 실제 사용 후기 → 장점 3가지 → 단점 솔직하게 → 추천 대상\n필수: 가격 대비 만족도, 비교 제품 언급"},
  {id:"info",      label:"📋 정보/꿀팁",  style:"정보글" as const,  persona:"teacher" as const, guide:"[템플릿: 정보/꿀팁]\n구성: 주제 소개 → 핵심 정보 5~7가지(번호 목록) → 주의사항 → 자주 묻는 질문 → 정리\n필수: 수치/데이터 포함, 실용적 팁 위주"},
  {id:"experience",label:"💬 체험단 후기", style:"감성일기" as const, persona:"mid_w" as const, guide:"[템플릿: 체험단/협찬 후기]\n구성: 협찬 명시 → 첫인상 → 직접 체험 내용 → 솔직한 장단점 → 추천 이유\n필수: 협찬 투명하게 표시, 실제 사용 사진 캡션 포함"},
] as const;
type BlogTemplate = typeof BLOG_TEMPLATES[number]["id"];

const PERSONA_STYLES = [
  {id:"none",     label:"🙂 기본",      color:"#888", prompt:""},
  {id:"young_w",  label:"👩 20대 여성",  color:"#f472b6", prompt:"20대 여성이 친한 친구에게 카톡 보내듯 친근하고 감성적으로 작성해줘. '~했어요', '~더라고요', '~거든요' 말투로."},
  {id:"young_m",  label:"👨 20대 남성",  color:"#60a5fa", prompt:"20대 남성이 친구에게 솔직하게 말하듯 써줘. 직접적이고 핵심만 짚는 문체로. '~했어요', '~임', '~거든요' 자연스럽게."},
  {id:"mid_w",    label:"👩‍🦳 40대 여성", color:"#fb923c", prompt:"40대 주부나 직장맘이 또래 친구에게 진심으로 알려주듯 따뜻하고 실용적으로 써줘. '~해요', '~하더라고요' 말투로."},
  {id:"mid_m",    label:"👨‍🦳 40대 남성", color:"#34d399", prompt:"40대 직장인 남성이 후배에게 조언해주듯 신뢰감 있고 경험 기반으로 써줘. '~합니다', '~했어요' 섞어서."},
  {id:"mom",      label:"👩‍👧 엄마",      color:"#f9a8d4", prompt:"자상한 엄마가 아이에게 설명해주듯 따뜻하고 실용적 조언과 따뜻한 격려를 담아줘."},
  {id:"expert",   label:"🎓 전문가",     color:"#a78bfa", prompt:"해당 분야 전문가가 신뢰감 있게 써줘. 전문 지식을 쉬운 말로 풀어서 근거와 데이터를 적극 활용해줘."},
  {id:"teacher",  label:"👨‍🏫 선생님",    color:"#4ade80", prompt:"친절한 선생님이 학생에게 설명해주듯 차근차근 이해하기 쉽게 써줘."},
  {id:"reporter", label:"📰 기자",       color:"#94a3b8", prompt:"신문 기자가 심층 취재 기사 쓰듯 객관적이고 사실 기반으로 써줘."},
] as const;
type PersonaStyle = typeof PERSONA_STYLES[number]["id"];
const TABS = [
  {k:"keyword",         i:"🔍", l:"키워드/제목"},
  {k:"write",           i:"✍️", l:"글 생성"},
  {k:"image",           i:"🖼️", l:"이미지 생성"},
  {k:"photo",           i:"📷", l:"사진 글쓰기"},
  {k:"publish",         i:"🚀", l:"발행하기"},
  {k:"onetouch",        i:"⚡", l:"원터치 발행"},
  {k:"manage",          i:"📋", l:"발행 관리"},
  {k:"blogscore",       i:"📈", l:"블로그 지수"},
  {k:"crawl",           i:"🔍", l:"크롤링"},
  {k:"inflow",          i:"🆕", l:"트래픽 유입"},
  {k:"place",           i:"🏪", l:"플레이스 365"},
  {k:"place_reply",     i:"🗣️", l:"플레이스 리뷰답글"},
  {k:"accounts",        i:"🔗", l:"계정관리"},
  {k:"calendar",        i:"📅", l:"콘텐츠 캘린더"},
  {k:"crawl_manage",    i:"🔎", l:"크롤링 관리"},
  {k:"place_manage",    i:"🏪", l:"플레이스 관리"},
  {k:"place_reply_manage", i:"🗣️", l:"리뷰답글 관리"},
  {k:"neighbor",        i:"🤝", l:"서이추"},
  {k:"engage",          i:"❤️", l:"공감·댓글"},
  {k:"reply",           i:"💬", l:"답방"},
  {k:"pumasi",          i:"💞", l:"품앗이"},
  {k:"insta_dm",        i:"📱", l:"인스타 DM"},
  {k:"live",            i:"📡", l:"실시간 현황"},
  {k:"users",           i:"👥", l:"회원관리"},
  {k:"bug",             i:"🐞", l:"버그 신고"},
  {k:"stats",           i:"📊", l:"통계"},
  {k:"insta_dm_manage", i:"📮", l:"DM 회원관리"},
  {k:"neighbor_manage", i:"🗂️", l:"서이추 관리"},
  {k:"engage_manage",   i:"🗒️", l:"공감·댓글 관리"},
  {k:"reply_manage",    i:"↩️", l:"답방 관리"},
  {k:"blogscore_manage",i:"🩺", l:"지수 관리"},
  {k:"settings",        i:"🔐", l:"설정"},
  {k:"proxy",           i:"🌐", l:"프록시 IP"},
] as const;

export default function AdminPage({onBack, onDashboard, theme, onThemeToggle}: Props) {
  const [tab, setTab] = useState<"keyword"|"write"|"image"|"photo"|"publish"|"onetouch"|"manage"|"accounts"|"rank"|"blogscore"|"calendar"|"crawl"|"inflow"|"place"|"place_reply"|"crawl_manage"|"place_manage"|"place_reply_manage"|"neighbor"|"engage"|"reply"|"pumasi"|"neighbor_manage"|"engage_manage"|"reply_manage"|"blogscore_manage"|"insta_dm"|"insta_dm_manage"|"users"|"bug"|"stats"|"live"|"settings"|"proxy">("keyword");

  // ── 프록시(계정별 IP) 관리 ──
  const NEIGHBOR_BOT = "http://127.0.0.1:3364";   // 서이추·공감·품앗이 봇(프록시 헬스체크도 여기서 실행)
  const [proxies, setProxies] = useState<PublyProxy[]>([]);
  const [proxyAssign, setProxyAssign] = useState<Record<string, ProxyAssign[]>>({});
  // 🌐 프록시 사용량(B: 접속 카운트) + DataImpulse 실잔량(A)
  const [proxyUsageToday, setProxyUsageToday] = useState(0);
  const [proxyUsageHist, setProxyUsageHist] = useState<{ label: string; count: number }[]>([]);
  const [diToken, setDiToken] = useState("");
  const [diBalance, setDiBalance] = useState<{ balance?: number; traffic_left_gb?: number; raw?: any } | null>(null);
  const loadProxyUsage = async () => {
    const [u, h, tok] = await Promise.all([getProxyUsageToday(), getProxyUsageHistory(7), getDataImpulseToken()]);
    setProxyUsageToday(u); setProxyUsageHist(h); setDiToken(tok);
    if (tok) fetchDataImpulseBalance().then(setDiBalance).catch(() => {});
  };
  const [proxyChecking, setProxyChecking] = useState<Record<string,boolean>>({});
  const [proxyAccts, setProxyAccts] = useState<{accountIds:string[]; label:string; search:string}[]>([]);
  const [proxyAcctSearch, setProxyAcctSearch] = useState("");
  const [proxyUserSearch, setProxyUserSearch] = useState("");
  const [newProxy, setNewProxy] = useState({ label:"", server:"", username:"", password:"" });
  // 4개 기능 탭(서이추·공감·답방·품앗이)의 연결된 계정을 모아 배정 후보로 (관리자 기기 localStorage)
  // ★같은 계정(네이버 로그인 아이디 기준)을 한 줄로 묶는다. 탭별 격리로 accountId가 탭마다 달라(neighbor_acc_1·pumasi_acc_1…)
  //   같은 계정이 여러 줄로 쪼개지고 이름도 blogId(system-b)/id(bb9653)로 제각각이던 문제 해결.
  //   → 체크 한 번에 그 계정의 모든 탭 accountId에 배정. DB 배정은 accountId별 유지(봇 동작 불변).
  function loadProxyAccounts() {
    const tabs: [string,string][] = [["neighbor","서이추"],["engage","공감·댓글"],["reply","답방"],["pumasi","품앗이"]];
    const groups = new Map<string, { id:string; blogId:string; accountIds:Set<string> }>();
    tabs.forEach(([k]) => {
      try {
        const raw = localStorage.getItem(`publy_accounts_${k}`);
        const arr = raw ? JSON.parse(raw) : [];
        (Array.isArray(arr)?arr:[]).forEach((a:any)=>{
          if(!a?.accountId) return;
          const naverId = (a.id||"").trim();
          if(!naverId) return; // 로그인 안 한 빈 슬롯(아이디 없음)은 프록시 대상 아님 → 목록에서 제외
          // 네이버 아이디로 묶기(같은 계정=같은 로그인 아이디).
          const gkey = `id:${naverId.toLowerCase()}`;
          let g = groups.get(gkey);
          if(!g){ g = { id:naverId, blogId:a.blogId||"", accountIds:new Set() }; groups.set(gkey,g); }
          g.accountIds.add(a.accountId);
          if(!g.id && naverId) g.id = naverId;
          if(!g.blogId && a.blogId) g.blogId = a.blogId; // 로그인된 탭에서 blogId 보완
        });
      } catch {}
    });
    const list = Array.from(groups.values()).map(g => {
      const name = g.id || Array.from(g.accountIds)[0];
      const blog = g.blogId && g.blogId!==g.id ? ` (블로그: ${g.blogId})` : "";
      return {
        accountIds: Array.from(g.accountIds),
        label: `${name}${blog}`,
        search: `${g.id} ${g.blogId} ${Array.from(g.accountIds).join(" ")}`.toLowerCase(),
      };
    });
    setProxyAccts(list);
  }
  async function loadProxies() {
    const [ps, asg] = await Promise.all([getProxies(), getProxyAssignments()]);
    setProxies(ps); setProxyAssign(asg); loadProxyAccounts(); loadProxyUsage();
  }
  useEffect(() => { if (tab==="proxy") loadProxies(); /* eslint-disable-next-line */ }, [tab]);
  async function handleAddProxy() {
    if (!newProxy.server.trim()) { showToast("프록시 주소(IP:포트)를 입력해주세요","error"); return; }
    const r = await addProxy(newProxy);
    if (r) { setNewProxy({label:"",server:"",username:"",password:""}); showToast("✅ 프록시가 추가됐어요"); loadProxies(); }
  }
  async function handleCheckProxy(p: PublyProxy) {
    setProxyChecking(s=>({...s,[p.id]:true}));
    const r = await checkProxyHealth(NEIGHBOR_BOT, p);
    setProxyChecking(s=>({...s,[p.id]:false}));
    showToast(r.ok ? `🟢 정상 · 나가는 IP ${r.ip} · ${r.ms}ms` : `🔴 실패: ${r.error||"연결 안 됨"}`, r.ok?"success":"error");
    loadProxies();
  }
  // 계정 체크 토글: 이 IP에 배정 / 해제 (다른 IP에 있었으면 이 IP로 이동)
  // 한 계정(여러 탭 accountId)을 한 번에 배정/해제. onThis면 전부 해제, 아니면 전부 이 프록시로 배정.
  async function toggleProxyAccount(accountIds: string[], proxyId: string, onThis: boolean) {
    for (const aid of accountIds) {
      if (onThis) await unassignAccount(aid);
      else await assignAccountToProxy(aid, proxyId);
    }
    loadProxies();
  }
  // 기능 토글: 배정된 계정이 프록시를 쓸 기능(서이추/공감/품앗이/답방) on/off — 계정의 모든 탭에 동일 적용
  async function toggleProxyFeature(accountIds: string[], feature: string, cur: string[]) {
    const next = cur.includes(feature) ? cur.filter(f=>f!==feature) : [...cur, feature];
    for (const aid of accountIds) await setAccountFeatures(aid, next);
    loadProxies();
  }
  async function handleDeleteProxy(p: PublyProxy) {
    if (!window.confirm(`프록시 "${p.label||p.server}" 을(를) 삭제할까요?\n이 IP에 배정된 계정 배정도 함께 해제됩니다.`)) return;
    await deleteProxy(p.id); showToast("프록시를 삭제했어요"); loadProxies();
  }
  const [statsSubTab, setStatsSubTab] = useState<"mine"|"all">("mine");
  // ★자동화 탭 keep-alive(대시보드와 동일): 방문한 탭은 언마운트 안 하고 숨김 → 작업·데이터 유지
  const [visitedAutoTabs, setVisitedAutoTabs] = useState<Set<string>>(new Set());
  // 재연결 비밀번호 입력 모달 (window.prompt는 Electron에서 안 뜸 → 커스텀 모달) — 회원과 동일
  const [pwPrompt, setPwPrompt] = useState<{acc:PublyAccount; value:string} | null>(null);
  const [showPwPrompt, setShowPwPrompt] = useState(false);
  const pwPromptResolve = useRef<((pw:string|null)=>void)|null>(null);
  function askPassword(acc:PublyAccount):Promise<string|null>{
    return new Promise((resolve)=>{ pwPromptResolve.current=resolve; setPwPrompt({acc,value:""}); });
  }
  useEffect(() => {
    if (["neighbor", "engage", "reply", "pumasi", "blogscore", "place", "inflow", "crawl"].includes(tab)) {
      setVisitedAutoTabs(prev => prev.has(tab) ? prev : new Set(prev).add(tab));
    }
  }, [tab]);
  const [usersSubTab, setUsersSubTab] = useState<"list"|"referral">("list");
  // 버그 신고
  const [bugReports, setBugReports] = useState<PublyBugReport[]>([]);
  const [bugLoading, setBugLoading] = useState(false);
  const [bugExpanded, setBugExpanded] = useState<string|null>(null);
  const [bugFilter, setBugFilter] = useState<"open"|"all">("open");
  const [bugReply, setBugReply] = useState<Record<string,string>>({});
  const loadBugReports = useCallback(async()=>{ setBugLoading(true); try{ setBugReports(await getBugReports()); }catch{} finally{ setBugLoading(false); } },[]);
  useEffect(()=>{ if(tab==="bug") loadBugReports(); },[tab,loadBugReports]);
  // 인스타 DM 상태
  const [dmTargets, setDmTargets] = useState<InstaDmTarget[]>([]);
  const [dmHistory, setDmHistory] = useState<(InstaDmHistory & {user_name?:string;user_email?:string})[]>([]);
  const [dmQuotas, setDmQuotas] = useState<(InstaDmQuota & {user_name?:string;user_email?:string;plan?:string})[]>([]);
  const [dmLoading, setDmLoading] = useState(false);
  const [dmManageLoading, setDmManageLoading] = useState(false);
  const [dmSubTab, setDmSubTab] = useState<"targets"|"history"|"settings">("targets");
  const [dmManageSubTab, setDmManageSubTab] = useState<"quotas"|"history">("quotas");
  const [dmKeyword, setDmKeyword] = useState("");
  const [dmFollowerMin, setDmFollowerMin] = useState("500");
  const [dmFollowerMax, setDmFollowerMax] = useState("50000");
  const [dmMessage, setDmMessage] = useState("");
  const [dmAccount, setDmAccount] = useState("");
  const [dmTargetInput, setDmTargetInput] = useState("");
  const [dmFilter, setDmFilter] = useState<"all"|"pending"|"sent"|"fail"|"skip">("all");
  const [dmSearch, setDmSearch] = useState("");
  // 인스타 봇 연동
  const [dmIgPw, setDmIgPw] = useState("");
  const [dmSessionOk, setDmSessionOk] = useState(false);
  const [dmConnecting, setDmConnecting] = useState(false);
  const [dmLogs, setDmLogs] = useState<string[]>([]);
  const dmLogRef = useRef<HTMLDivElement>(null); const dmStick = useRef(true);
  const [dmRunning, setDmRunning] = useState(false);
  const esDmRef = useRef<BotEventStream|null>(null);
  const dmLog = (m:string)=>setDmLogs(p=>[...p.slice(-200), m]);
  useEffect(()=>{ const el=dmLogRef.current; if(el&&dmStick.current) el.scrollTop=el.scrollHeight; },[dmLogs]);

  const checkDmSession = async(acct:string)=>{
    if(!acct){setDmSessionOk(false);return;}
    try{ const r=await botFetch(`${INSTA_BOT}/api/session/${encodeURIComponent(acct)}`); const j=await r.json(); setDmSessionOk(!!j.exists); }catch{ setDmSessionOk(false); }
  };
  const connectIg = async()=>{
    const acct=dmAccount.trim().replace(/^@/,"");
    if(!acct||!dmIgPw){showToast("인스타 아이디와 비밀번호를 입력해주세요","error");return;}
    setDmConnecting(true);
    try{
      const r=await botFetch(`${INSTA_BOT}/api/login`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({accountId:acct,id:acct,pw:dmIgPw})});
      const j=await r.json();
      if(j.success){setDmSessionOk(true);setDmIgPw("");showToast("✅ 인스타 계정 연결 완료!");}
      else showToast("연결 실패: "+(j.error||""),"error");
    }catch(e:any){showToast("로컬 봇 서버 연결 실패 (봇 실행 확인): "+e.message,"error");}
    setDmConnecting(false);
  };
  const crawlIg = ()=>{
    const acct=dmAccount.trim().replace(/^@/,"");
    if(!acct){showToast("발송 인스타 계정을 먼저 입력/연결해주세요","error");return;}
    if(!dmKeyword.trim()){showToast("검색 키워드를 입력해주세요","error");return;}
    setDmRunning(true);setDmLogs([]);
    const url=`${INSTA_BOT}/api/crawl?accountId=${encodeURIComponent(acct)}&keyword=${encodeURIComponent(dmKeyword.trim())}&limit=30&minFollowers=${encodeURIComponent(dmFollowerMin||"0")}&maxFollowers=${encodeURIComponent(dmFollowerMax||"0")}`;
    const es=new BotEventStream(url);esDmRef.current=es;
    es.onmessage=async e=>{
      const d=JSON.parse(e.data);
      if(d.type==="log")dmLog(d.msg);
      else if(d.type==="result"){await addInstaDmTarget({user_id:ADM_UID,username:d.username,followers:d.followers||0,bio:"",keywords:dmKeyword,status:"pending",instagram_account:acct});}
      else if(d.type==="crawl_done"){dmLog(`🎉 ${d.results?.length||0}개 수집 완료`);getInstaDmTargets(ADM_UID).then(setDmTargets);es.close();setDmRunning(false);}
      else if(d.type==="error"){dmLog("❌ "+d.msg);es.close();setDmRunning(false);}
    };
    es.onerror=()=>{es.close();setDmRunning(false);dmLog("⚠️ 연결 종료 (로컬 봇 실행 확인)");};
  };
  const sendIg = ()=>{
    const acct=dmAccount.trim().replace(/^@/,"");
    if(!acct){showToast("발송 인스타 계정을 입력/연결해주세요","error");return;}
    if(!dmMessage.trim()){showToast("DM 문구를 입력해주세요","error");return;}
    const pend=dmTargets.filter(t=>t.status==="pending").map(t=>({id:t.id,username:t.username}));
    if(!pend.length){showToast("발송할 '대기중' 타겟이 없어요","error");return;}
    setDmRunning(true);setDmLogs([]);
    const url=`${INSTA_BOT}/api/send?userId=${encodeURIComponent(ADM_UID)}&accountId=${encodeURIComponent(acct)}&message=${encodeURIComponent(dmMessage)}&targets=${encodeURIComponent(JSON.stringify(pend))}`;
    const es=new BotEventStream(url);esDmRef.current=es;
    es.onmessage=e=>{
      const d=JSON.parse(e.data);
      if(d.type==="log")dmLog(d.msg);
      else if(d.type==="quota_info")dmLog(`💎 오늘 남은 한도 ${d.remaining}개`);
      else if(d.type==="quota_exceeded"){dmLog("🛑 오늘 한도 초과");es.close();setDmRunning(false);}
      else if(d.type==="progress")dmLog(`📊 진행 ${d.done} · 실패 ${d.fail}`);
      else if(d.type==="done"){dmLog("✅ 발송 작업 완료");getInstaDmTargets(ADM_UID).then(setDmTargets);es.close();setDmRunning(false);}
      else if(d.type==="error"){dmLog("❌ "+d.msg);es.close();setDmRunning(false);}
    };
    es.onerror=()=>{es.close();setDmRunning(false);dmLog("⚠️ 연결 종료 (로컬 봇 실행 확인)");};
  };
  const stopDm = ()=>{ try{esDmRef.current?.close();}catch{} setDmRunning(false); dmLog("⏹️ 중단됨"); };
  const [referralData, setReferralData] = useState<{referrer:any;referred:any[]}[]>([]);
  const [referralLoading, setReferralLoading] = useState(false);
  // 답방·지수 이력
  const [replyHistory, setReplyHistory] = useState<(ReplyHistory & {user_name?:string;user_email?:string})[]>([]);
  const [replyLoading, setReplyLoading] = useState(false);
  const [placeReplyHistory, setPlaceReplyHistory] = useState<(PlaceReplyHistory & {user_name?:string;user_email?:string})[]>([]);
  const [placeReplyLoading, setPlaceReplyLoading] = useState(false);
  const [blogscoreHistory, setBlogscoreHistory] = useState<(BlogscoreHistory & {user_name?:string;user_email?:string})[]>([]);
  const [blogscoreLoading, setBlogscoreLoading] = useState(false);
  // 실시간 사용현황
  const [liveUsage, setLiveUsage] = useState<DailyUsageRow[]>([]);
  const [liveLoading, setLiveLoading] = useState(false);
  const [liveUpdatedAt, setLiveUpdatedAt] = useState<Date|null>(null);
  const [liveAuto, setLiveAuto] = useState(true);
  // 📡 회원 로그 뷰어(회원 검색 → 현재 진행 로그 실시간)
  const [logSearch, setLogSearch] = useState("");
  const [logUserId, setLogUserId] = useState<string|null>(null);
  const [logRow, setLogRow] = useState<LiveLogRow|null>(null);
  const [logRunning, setLogRunning] = useState<LiveLogRow[]>([]);
  const [neighborHistory, setNeighborHistory] = useState<(NeighborHistory & {user_name?:string;user_email?:string})[]>([]);
  const [neighborLoading, setNeighborLoading] = useState(false);
  const [neighborFilter, setNeighborFilter] = useState<"all"|"success"|"fail"|"skip">("all");
  const [neighborSearch, setNeighborSearch] = useState("");
  const [engageHistory, setEngageHistory] = useState<(EngageHistory & {user_name?:string;user_email?:string})[]>([]);
  const [engageLoading, setEngageLoading] = useState(false);
  const [engageFilter, setEngageFilter] = useState<"all"|"success"|"fail"|"skip">("all");
  const [engageSearch, setEngageSearch] = useState("");
  const [fontMode, setFontMode] = useState<"normal"|"large">(()=>(localStorage.getItem("publy_adm_font_mode")||"normal") as "normal"|"large");
  const [showGuide, setShowGuide] = useState(false);
  const [showInstaWarn, setShowInstaWarn] = useState(false);
  const [guideTab, setGuideTab] = useState(0);
  const [botOnline, setBotOnline] = useState(false);
  const [platform, setPlatform] = useState<"naver"|"tistory">("naver");
  const [admAccs, setAdmAccs] = useState<PublyAccount[]>([]);

  // 발행
  const [pubTitle, setPubTitle] = useState(""); const [pubContent, setPubContent] = useState(""); const [pubTags, setPubTags] = useState(""); const [pubImg, setPubImg] = useState(""); const [pubAccId, setPubAccId] = useState(""); const [publishing, setPublishing] = useState(false); const [pubMsg, setPubMsg] = useState("");
  // ⚡ 원터치 발행(관리자 일반 사용 · 무제한) — 회원과 동일 기능
  const [otKeywords,setOtKeywords]=useState("");
  const [otAiKw,setOtAiKw]=useState(()=>localStorage.getItem("publy_adm_ot_aikw")==="1");
  const [otAiKwCount,setOtAiKwCount]=useState(()=>{const n=parseInt(localStorage.getItem("publy_adm_ot_aikw_count")||"5");return isNaN(n)?5:Math.max(1,Math.min(30,n));});
  const [otAiCats,setOtAiCats]=useState<string[]>(()=>{try{return JSON.parse(localStorage.getItem("publy_adm_ot_aicats")||"[]");}catch{return [];}});
  const [otTermMin,setOtTermMin]=useState(60);
  const [otCustomTerm,setOtCustomTerm]=useState("");
  const [otImgCount,setOtImgCount]=useState(3);
  const [otImgMode,setOtImgMode]=useState<"flow"|"ai">("flow");
  const [otCharMode,setOtCharMode]=useState<"auto"|"manual">("auto");
  const [otTargetChars,setOtTargetChars]=useState(1500);
  const [otWriteStyle,setOtWriteStyle]=useState<WriteStyle|"자동">(()=>{ const v=localStorage.getItem("publy_adm_ot_style"); return (v==="자동"||v==="감성일기"||v==="정보글"||v==="맛집후기"||v==="여행기")?v as any:"자동"; });
  const [otRunning,setOtRunning]=useState(false);
  const otRunningRef=useRef(false);
  const otStopRef=useRef(false);
  const otAbortRef=useRef<AbortController|null>(null);
  const otFlowExhaustedRef=useRef<Set<number>>(new Set());   // 이번 실행에서 크레딧 소진된 Flow 슬롯(자동 전환용)
  const [otNextAt,setOtNextAt]=useState<number|null>(null);
  const [otPaused,setOtPaused]=useState<{idx:number;kws:string[];reason?:"credit"|"stopped";reviveTarget?:{logNo:string;origTitle:string;origBody:string}}|null>(null);
  const [reviveState,setReviveState]=useState<{logNo:string;title:string;step:string;done?:boolean;fail?:string}|null>(null);   // ✨ 글 살리기 진행상황
  // ⏰ 예약 발행(관리자도 동일): 지정 시각에 원터치 자동 시작 + 예약 대기 중 절전 방지.
  const [otSchedOn,setOtSchedOn]=useState(false);
  const [otSchedTime,setOtSchedTime]=useState(()=>localStorage.getItem("publy_adm_ot_sched_time")||"09:00");
  const [otSchedDaily,setOtSchedDaily]=useState(()=>localStorage.getItem("publy_adm_ot_sched_daily")!=="0");
  const otRunRef=useRef<(()=>void)|null>(null);
  const otReviveRunRef=useRef<((target:{logNo:string;origTitle:string;origBody:string;blogId:string;accountId?:string;careAccountId?:string})=>Promise<void>)|null>(null);
  const [otLog,setOtLog]=useState<{id:string;kw:string;title?:string;cat?:string;step:string;status:"wait"|"run"|"done"|"fail"|"limit";postUrl?:string;error?:string;at?:string}[]>(()=>{try{return JSON.parse(localStorage.getItem("publy_adm_ot_log")||"[]");}catch{return [];}});
  useEffect(()=>{try{localStorage.setItem("publy_adm_ot_log",JSON.stringify(otLog.slice(0,50)));}catch{}},[otLog]);
  const [otLiveLog,setOtLiveLog]=useState<string[]>(()=>{try{return JSON.parse(localStorage.getItem("publy_adm_ot_livelog")||"[]");}catch{return [];}});
  const [otDockOpen,setOtDockOpen]=useState(true);
  useEffect(()=>{try{localStorage.setItem("publy_adm_ot_livelog",JSON.stringify(otLiveLog.slice(-300)));}catch{}},[otLiveLog]);
  // Flow 준비 + 계정 슬롯(여러 구글 계정 — 각자 프로필/포트)
  const [flowReady,setFlowReady]=useState(false);
  const [flowLaunching,setFlowLaunching]=useState(false);
  const [flowSlots,setFlowSlots]=useState<{id:number;name:string}[]>(()=>{try{const s=JSON.parse(localStorage.getItem("publy_adm_flow_slots")||"[]");return Array.isArray(s)&&s.length?s:[{id:0,name:"기본 계정"}];}catch{return [{id:0,name:"기본 계정"}];}});
  const [flowSlot,setFlowSlot]=useState<number>(()=>{const n=parseInt(localStorage.getItem("publy_adm_flow_slot")||"0");return isNaN(n)?0:n;});
  const [flowSlotReady,setFlowSlotReady]=useState<Record<number,boolean>>({});
  useEffect(()=>{try{localStorage.setItem("publy_adm_flow_slots",JSON.stringify(flowSlots));}catch{}},[flowSlots]);
  useEffect(()=>{try{localStorage.setItem("publy_adm_flow_slot",String(flowSlot));}catch{}},[flowSlot]);
  async function handleFlowLaunchChrome(slot:number=flowSlot){
    if(!(window as any).electron?.flowLaunchChrome){ showToast("PC 앱에서만 Flow 준비가 가능해요. Publy 앱을 실행해주세요.","error"); return; }
    setFlowLaunching(true);
    try{ const r=await (window as any).electron.flowLaunchChrome(slot);
      if(r.ok){ setFlowSlot(slot); setFlowReady(true); setFlowSlotReady(p=>({...p,[slot]:true})); const nm=flowSlots.find(s=>s.id===slot)?.name||`계정 ${slot+1}`; showToast(r.already?`✅ '${nm}' Flow 크롬이 준비돼 있어요!`:`✅ '${nm}' Flow 크롬을 열었어요! 로그인만 해주세요 (최초 1회)`); }
      else showToast("❌ "+(r.error||"Flow 준비 실패"),"error");
    }catch(e:any){ showToast("❌ Flow 준비 실패: "+e.message,"error"); }
    finally{ setFlowLaunching(false); }
  }
  async function handleFlowConnectAll(){
    if(!(window as any).electron?.flowLaunchChrome){ showToast("PC 앱에서만 가능해요.","error"); return; }
    setFlowLaunching(true);
    try{ for(const s of flowSlots){ try{ const r=await (window as any).electron.flowLaunchChrome(s.id); if(r.ok)setFlowSlotReady(p=>({...p,[s.id]:true})); }catch{} await new Promise(r=>setTimeout(r,1500)); } showToast(`✅ ${flowSlots.length}개 계정 창을 순서대로 열었어요. 이미 로그인된 계정은 그대로 두고, 풀린 계정만 다시 로그인해 주세요.`); }
    finally { setFlowLaunching(false); }
  }
  useEffect(()=>{
    if(!(tab==="onetouch"&&otImgMode==="flow")||!(window as any).electron?.flowStatus)return;
    let alive=true;
    const check=async()=>{ try{ const s=await (window as any).electron.flowStatus(flowSlot); if(alive){setFlowReady(!!s.ready);setFlowSlotReady(p=>({...p,[flowSlot]:!!s.ready}));} }catch{} };
    check(); const iv=setInterval(check,5000);
    return ()=>{ alive=false; clearInterval(iv); };
  },[tab,otImgMode,flowSlot]);
  // ★절전 방지: 원터치(텀 대기 포함)·발행 중엔 화면/시스템 안 꺼지게
  useEffect(()=>{
    const busy = otRunning || publishing || otSchedOn;
    (window as any).electron?.keepAwake?.(busy)?.catch?.(()=>{});
    return ()=>{ if(busy) (window as any).electron?.keepAwake?.(false)?.catch?.(()=>{}); };
  },[otRunning, publishing, otSchedOn]);
  // ⏰ 예약 감시: 30초마다 예약 시각 확인 → 원터치 자동 시작(중복 방지).
  useEffect(()=>{
    otRunRef.current=()=>runOneTouch(undefined,undefined,"schedule");
    otReviveRunRef.current=(target)=>runOneTouch(undefined,target,"revive",target.accountId);
  });
  // ⏰ 예약 감시 — '다음 목표 시각'을 계산해 그 시각이 실제로 지나야만 실행. 켜자마자 절대 안 돎.
  const otSchedTargetRef=useRef<number>(0);
  useEffect(()=>{
    if(!otSchedOn){ otSchedTargetRef.current=0; return; }
    const computeTarget=()=>{
      const [th,tm]=otSchedTime.split(":").map(n=>parseInt(n,10));
      if(!Number.isFinite(th)||!Number.isFinite(tm)) return 0;
      const now=new Date();
      const t=new Date(now.getFullYear(),now.getMonth(),now.getDate(),th,tm,0,0);
      if(t.getTime()<=now.getTime()) t.setDate(t.getDate()+1);
      return t.getTime();
    };
    otSchedTargetRef.current=computeTarget();
    const check=()=>{
      if(otRunningRef.current) return;
      const tgt=otSchedTargetRef.current;
      if(!tgt || Date.now()<tgt) return;
      if(otSchedDaily){ const n=new Date(tgt); n.setDate(n.getDate()+1); otSchedTargetRef.current=n.getTime(); }
      else { otSchedTargetRef.current=0; setOtSchedOn(false); }
      otRunRef.current?.();
    };
    const iv=setInterval(check,20000);
    return ()=>clearInterval(iv);
    // eslint-disable-next-line
  },[otSchedOn,otSchedTime,otSchedDaily]);
  // ★글자수 하드 캡: AI 오버슈트(1500 지정→3000) 방지. 목표 125% 초과 시 FAQ 보존하고 본문 문단을 잘라 목표 근처로.
  function enforceMaxChars(body:string, target:number):string{
    if(!target||body.length<=Math.round(target*1.25))return body;
    const faqIdx=body.search(/\[FAQ시작\]|자주\s*묻는\s*질문|(?:^|\n)\s*Q\s*1\s*[:：.]/);
    const main=faqIdx>0?body.slice(0,faqIdx):body;
    const tail=faqIdx>0?body.slice(faqIdx):"";
    if(main.length<=Math.round(target*1.25))return body;
    const paras=main.split(/\n\n+/);
    let out="";
    for(const p of paras){ if(out.length>=target*0.85 && (out+"\n\n"+p).length>target) break; out+=(out?"\n\n":"")+p; }
    if(!out.trim())out=main.slice(0,target);
    return (out.trim()+(tail?"\n\n"+tail.trim():"")).trim();
  }
  // ══ ⚡ 원터치 엔진(관리자 무제한 · 회원과 동일 흐름) ══
  async function otGenTitleBest(kw:string):Promise<string>{
    const text=await callAI(`당신은 대한민국 최고의 네이버 블로그 SEO 제목 전문가입니다.\n키워드: "${kw}"\n\n네이버 검색 상위노출이 잘 되는 제목 15개를 JSON 배열로만 반환하세요.\n- 키워드 "${kw}"를 제목 앞부분에 자연스럽게 포함\n- 20~35자, 실제 검색어 형태(추천/후기/방법/가격/비교/고르는법)\n- 과장·낚시 감탄사(대박/충격/1등/미쳤다) 금지, 물음표·느낌표 남발 금지\n${AEO_TITLE_RULE}\nJSON 배열만.`);
    const arr=parseArr(text).map((t:string)=>enforceExactKeyword(t,kw)).filter(Boolean);
    if(!arr.length)throw new Error("제목 생성 실패");
    return arr[0];
  }
  function otSpaceParagraphs(text:string):string{
    const isMarker=(s:string)=>/\[(FAQ|관련글|참고자료)(시작|끝)\]|^Q\d|^A\d/.test(s.trim());
    return text.split(/\n\n+/).map(block=>{
      const b=block.trim(); if(!b||isMarker(b))return b;
      return b.split(/\n/).map(line=>{
        const l=line.trim(); if(!l||isMarker(l))return l;
        const sents=l.match(/[^.!?。]*[.!?。]+['")\]]*\s*|[^.!?。]+$/g)||[l];
        if(sents.length<=2 && l.length<=120) return l;
        const out:string[]=[]; for(let i=0;i<sents.length;i+=2) out.push(sents.slice(i,i+2).join("").trim());
        return out.filter(Boolean).join("\n\n");
      }).join("\n\n");
    }).filter(Boolean).join("\n\n");
  }
  // 🎨 글 패턴 자동: 키워드에 어울리는 패턴 하나를 AI가 고름. 실패 시 정보글.
  async function otPickStyle(kw:string,title:string):Promise<WriteStyle>{
    try{
      const t=await callAI(`아래 블로그 글감에 가장 어울리는 글 패턴 하나만 골라 그 단어만 답해. 다른 말 절대 금지.\n선택지: 감성일기 / 정보글 / 맛집후기 / 여행기\n기준: 음식·카페·식당·맛집이면 맛집후기, 여행·여행지·숙소·관광이면 여행기, 개인 경험·감정·일상이면 감성일기, 그 외 정보·방법·가격·비교·추천은 정보글.\n\n키워드: "${kw}"\n제목: "${title}"`);
      const s=(t||"").replace(/[^가-힣]/g,"");
      const hit=(["맛집후기","여행기","감성일기","정보글"] as WriteStyle[]).find(x=>s.includes(x));
      return hit||"정보글";
    }catch{ return "정보글"; }
  }
  async function otGenPost(kw:string,title:string,styleOverride?:WriteStyle):Promise<{content:string;tags:string}>{
    const chars=otCharMode==="manual"?otTargetChars:calcTargetChars();
    const effStyle:WriteStyle=styleOverride||(otWriteStyle==="자동"?"정보글":otWriteStyle);
    const styleGuide=WRITE_STYLE_GUIDE[effStyle]||"";
    const text=await callAI(`당신은 대한민국 최고의 블로그 작가입니다.\n키워드: "${kw}"  제목: "${title}"\n목표 글자수: ${chars}자 내외(±100자, 반드시 이 범위)\n\n${styleGuide?"★ 아래 [글의 방향]을 최우선으로:\n"+styleGuide+"\n\n":""}=== 절대 규칙 ===\n⛔ ## 및 ** * - + 마크다운 기호 전부 금지(소제목도 순수 텍스트)\n⛔ 한자·중국어·일본어·영어단어 금지(브랜드명 제외)\n⛔ AI 상투어 금지(~해보겠습니다/살펴보겠습니다/결론적으로/다양한/효과적인) → 실제 사람 말투(~해요, ~거든요, ~더라고요)\n✅ ★핵심 키워드 "${kw}"를 본문에 띄어쓰기·글자 그대로 정확히 5~6번 반복(검색 노출 핵심)\n✅ 구체적 수치·가격·기간·경험담 포함, 과장·거짓 금지\n✅ 본문을 4~6개 구간으로 나누고 각 구간 앞에 짧은 소제목(10~30자, ## 없이)\n✅ 모든 단락 사이 빈 줄 하나(엔터 두 번), 한 단락 2~4문장(모바일 가독성)\n\n${AEO_RULES}\n\n=== 출력 형식 ===\n태그: 태그1, 태그2, 태그3, 태그4, 태그5\n\n(본문 ${chars}자 내외 순수 텍스트. ★맨 첫 문단은 AEO 규칙대로 '핵심 요약' 2~3문장으로 시작)\n\n${AEO_FAQ_FORMAT}`);
    const cleaned=stripMarkdown(text);
    const tgm=cleaned.match(/태그[:\s]*([^\n]+)/);
    const bm=cleaned.match(/태그[^\n]*\n([\s\S]+)/);
    const bodyRaw=ensureAeoIntroSummary(await ensureKeywordCount(bm?bm[1].trim():cleaned,kw,5),title);
    const bodyCap=enforceMaxChars(bodyRaw,chars);
    const body=otSpaceParagraphs(bodyCap);   // 모바일 가독성: 긴 문단 2~3문장마다 쪼개 빈 줄로
    return {content:body,tags:tgm?tgm[1].trim():""};
  }
  async function otPickCategory(title:string,content:string,cats:{id:string;name:string}[]):Promise<{id?:string;name?:string}>{
    if(!cats.length)return {};
    if(cats.length===1)return cats[0];
    const names=cats.map((c,i)=>`${i+1}. ${c.name}`).join("\n");
    try{ const t=await callAI(`아래 블로그 글 전체를 읽고, 이 글의 핵심 주제에 가장 잘 맞는 카테고리 하나를 고르세요.\n제목: ${title}\n\n본문:\n${content.slice(0,2500)}\n\n카테고리 목록:\n${names}\n\n글의 주제를 먼저 파악한 뒤, 위 목록에서 가장 잘 맞는 카테고리의 번호만 숫자로 답하세요(설명·다른 말 금지). 애매하면 1번.`);
      const m=t.match(/\d+/); const idx=m?parseInt(m[0],10)-1:-1; if(idx>=0&&idx<cats.length)return cats[idx]; }catch{}
    return cats[0];
  }
  async function otPublishItem(kw:string,title:string,content:string,tags:string[],images:string[],categoryId:string|undefined,acc:PublyAccount|undefined,flowN:number=0,editLogNo?:string,editBlogId?:string):Promise<string>{
    const blocks:any[]=[];
    if(!flowN&&images[0])blocks.push({type:"image",src:images[0],alt:""});
    const paras=content.split(/\n\n+/).map(s=>s.trim()).filter(Boolean);
    const rest=flowN?[]:images.slice(1); const caps=buildCaptions(kw,rest.length,content); const every=rest.length?Math.max(1,Math.floor(paras.length/(rest.length+1))):0; let ri=0;
    paras.forEach((p,i)=>{ blocks.push({type:"text",content:p}); if(every&&ri<rest.length&&(i+1)%every===0){blocks.push({type:"image",src:rest[ri],alt:caps[ri]||kw});ri++;} });
    while(ri<rest.length){blocks.push({type:"image",src:rest[ri],alt:caps[ri]||kw});ri++;}
    // ★글쓴이 인사말: 썸네일(첫 이미지) 바로 다음 1회 삽입(발행하기와 동일). 비어있으면 안 넣음.
    if(greeting.trim()){
      const g=greeting.trim();
      if(!blocks.some(b=>b.type==="text"&&(b.content||"").trim()===g)){
        const firstImgIdx=blocks.findIndex(b=>b.type==="image"||b.type==="image-pair");
        const at=firstImgIdx>=0?firstImgIdx+1:0;
        blocks.splice(at,0,{type:"text",content:g});
      }
    }
    const payload:any={userId:ADM_UID,platform:"naver",title,content,naverId:acc?.username||undefined,pubScope,tags,imageUrl:(!flowN&&images[0])||undefined,categoryId:categoryId||undefined,visibility,blocks,...(editLogNo?{editLogNo,editBlogId}:{})};
    if(flowN){   // 무료 Flow: 봇이 발행 중 생성
      const lines=content.split("\n").filter((l:string)=>l.trim().length>5);
      const step=Math.max(1,Math.floor(lines.length/flowN));
      payload.useFlow=true; payload.flowImgCount=flowN;
      payload.flowPrompts=Array.from({length:flowN},(_,i)=>{const seg=lines.slice(i*step,(i+1)*step).join(" ").slice(0,150);return buildAdmFlowPrompt(kw,title,seg,i);});
      payload.flowCaptions=buildCaptions(kw,flowN,content);
    }
    const r=await botFetch(`${BOT}/api/publish-full`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload),signal:otAbortRef.current?.signal});
    const d=await r.json().catch(()=>({}));
    if(r.status===401)throw new Error("세션 만료 — 계정 재연결 필요");
    if(!r.ok)throw new Error(d.error||"발행 실패");
    return d.postUrl||"";
  }
  function stopOneTouch(){otStopRef.current=true;try{otAbortRef.current?.abort();}catch{};setOtRunning(false);setOtNextAt(null);showToast("원터치를 멈췄어요 — 진행 중이던 작업도 중단","info");}

  function showOneTouchPreflight(errors:string[],title="글 살리기를 시작할 수 없어요"){
    window.alert(`${title}\n\n${errors.map(v=>`• ${v}`).join("\n")}`);
  }

  useEffect(()=>{
    const h=async(e:any)=>{ const {logNo,title,blogId,naverId,careAccountId,requestId}=e.detail||{}; if(!logNo)return;
      const finish=(accepted:boolean)=>window.dispatchEvent(new CustomEvent("publy-revive-request-finished",{detail:{requestId,logNo:String(logNo),accepted}}));
      const target={logNo:String(logNo),origTitle:String(title||""),origBody:"",blogId:String(blogId||""),careAccountId:String(careAccountId||"")};
      setTab("onetouch");
      // ★원문 blogId로 소유 계정을 고른다. 로그인ID와 블로그ID가 다른 계정도
      //   blog_name(연결 때 저장한 실제 blogId)으로 정확히 찾는다.
      const naverAccs=admAccs.filter(a=>a.platform==="naver"&&(botOnline?a.is_connected:true));
      const errors:string[]=[];
      if(!naverAccs.length)errors.push("네이버 계정이 연결 안 됐어요 → 계정관리에서 계정을 연결하세요");
      const norm=(v?:string)=>String(v||"").trim().toLowerCase().replace(/@naver\.com$/i,"");
      const targetBlogId=norm(target.blogId);
      const ownerAcc=naverAccs.find(a=>norm(a.username)===norm(naverId))
        ||naverAccs.find(a=>norm(a.blog_name)===targetBlogId)
        ||naverAccs.find(a=>norm(a.username)===targetBlogId)
        ||(naverAccs.length===1?naverAccs[0]:undefined);
      if(naverAccs.length&&!ownerAcc)errors.push(`이 글의 주인 블로그(${target.blogId})와 연결된 계정을 찾지 못했어요 → 해당 네이버 계정을 다시 연결하세요`);
      if(otImgMode==="flow"&&!flowSlotReady[flowSlot])errors.push("Flow가 연결 안 됐어요 → 원터치 발행에서 Flow를 연결 후 다시 시작하세요");
      if(errors.length){e.preventDefault?.();showOneTouchPreflight(errors);finish(false);return;}
      if(otRunningRef.current){e.preventDefault?.();const fail="다른 원터치 작업이 진행 중이에요. 완료하거나 중단한 뒤 다시 시도해주세요.";setReviveState({...target,title:target.origTitle,step:"실패",fail});showToast(fail,"error");finish(false);return;}
      const acc=ownerAcc!;
      setPubAccId(acc.id);
      await otReviveRunRef.current?.({...target,accountId:acc.id});
      finish(true);
    };
    window.addEventListener("publy-revive-post",h as any);
    return ()=>window.removeEventListener("publy-revive-post",h as any);
  },[admAccs,platform,otImgMode,flowSlot,flowSlotReady]);
  function otRecentUsedKw():string[]{ try{ const cut=Date.now()-14*86400000; return (JSON.parse(localStorage.getItem("publy_adm_ot_used_kw")||"[]") as any[]).filter(r=>r.at>cut).map(r=>r.kw); }catch{return [];} }
  function otRecordUsedKw(kws:string[]){ try{ const cut=Date.now()-14*86400000; const kept=(JSON.parse(localStorage.getItem("publy_adm_ot_used_kw")||"[]") as any[]).filter(r=>r.at>cut); const now=Date.now(); for(const k of kws) kept.push({kw:k,at:now}); localStorage.setItem("publy_adm_ot_used_kw",JSON.stringify(kept.slice(-800))); }catch{} }
  async function otGenKeywords(count:number):Promise<string[]>{
    const used=otRecentUsedKw();
    let hot:string[]=[];
    try{ const r=await botFetch(`${BOT}/api/hot-issues?category=${encodeURIComponent("실시간")}`,{signal:AbortSignal.timeout(15000)} as any); const d=await r.json().catch(()=>({})); if(Array.isArray(d.items))hot=d.items.slice(0,30); }catch{}
    const excl=used.slice(0,120).join(", ");
    const hotHint=hot.length?`\n\n[요즘 뜨는 주제 참고 — SEO 키워드로 다듬어 활용]\n${hot.slice(0,25).join(", ")}`:"";
    const catRule=otAiCats.length
      ? `- ★반드시 다음 주제 카테고리 안에서만 생성(밖의 주제 금지): ${otAiCats.join(", ")}. 골고루 분배.`
      : `- 분야를 최대한 골고루 섞기: 맛집·여행·재테크·건강·육아·뷰티·인테리어·IT/가전·정책자금·반려동물·패션·자기계발 등`;
    const text=await callAI(`당신은 네이버 블로그 SEO·트렌드 전문가입니다.\n지금 검색이 잘 되고 사람들이 많이 찾는, 서로 겹치지 않는 다양한 블로그 키워드 ${count}개를 JSON 배열로만 생성하세요.\n[규칙]\n- 실제 검색량 많은 자연스러운 형태(예: "원주 맛집", "겨울 제철 음식", "소상공인 정책자금 신청")\n${catRule}\n- 2~4어절, 과장·낚시 금지\n${excl?`- ⛔ 최근 14일간 이미 쓴 키워드는 절대 포함 금지: ${excl}`:""}${hotHint}\nJSON 배열만 반환.`);
    const usedSet=new Set(used.map(u=>u.replace(/\s+/g,""))); const seen=new Set<string>();
    const arr=parseArr(text).map(s=>s.trim()).filter(Boolean).filter(k=>{const key=k.replace(/\s+/g,""); if(!key||usedSet.has(key)||seen.has(key))return false; seen.add(key); return true;});
    let tries=0;
    while(arr.length<count && tries<2){ tries++; const need=count-arr.length; const exclAll=[...used,...arr].slice(0,150).join(", ");
      try{ const more=await callAI(`위와 같은 조건으로 네이버 블로그 SEO 키워드 ${need}개를 JSON 배열로만 더 생성하세요.\n${catRule}\n- ⛔ 아래 키워드는 절대 포함 금지(14일 내 사용 + 방금 뽑은 것): ${exclAll}\n- 2~4어절, 과장·낚시 금지\nJSON 배열만.`);
        for(const k of parseArr(more).map(s=>s.trim()).filter(Boolean)){ const key=k.replace(/\s+/g,""); if(key&&!usedSet.has(key)&&!seen.has(key)){seen.add(key);arr.push(k);} if(arr.length>=count)break; }
      }catch{break;} }
    return arr.slice(0,count);
  }
  async function runOneTouch(resume?:{idx:number;kws:string[];reviveTarget?:{logNo:string;origTitle:string;origBody:string;blogId?:string;careAccountId?:string}},reviveTarget?:{logNo:string;origTitle:string;origBody:string;blogId?:string;careAccountId?:string},source:"manual"|"schedule"|"revive"="manual",accountId?:string){
    const activeRevive=reviveTarget||resume?.reviveTarget;
    if(otRunningRef.current){if(activeRevive)setReviveState({logNo:activeRevive.logNo,title:activeRevive.origTitle,step:"실패",fail:"다른 원터치 작업이 진행 중이에요."});return;}
    if(otSchedOn&&source!=="schedule"&&!activeRevive){const fail=`예약 대기 중이에요. ${otSchedTime} 예약을 끈 뒤 다시 시도해주세요.`;showToast(fail,"info");return;}
    if(activeRevive){
      const rq=await checkReviveQuota(ADM_HISTORY_UID,"admin");
      if(!rq.ok){const fail=`오늘 이 글 살리기 한도(${rq.limit}회)를 모두 사용했어요. 자정에 다시 사용할 수 있어요.`;setReviveState({logNo:activeRevive.logNo,title:activeRevive.origTitle,step:"실패",fail});showToast(fail,"info");return;}
    }
    const runAccId=accountId||pubAccId;
    const preflightErrors:string[]=[];
    // 관문 = '연결된 네이버 계정이 있나'(발행은 user.id 세션으로 하므로 계정 매칭 불필요). revive는 platform 상태와 무관하게 통과해야 하니 admAccs 전체에서 확인.
    const hasNaverAcc=admAccs.some(a=>a.platform==="naver"&&(botOnline?a.is_connected:true));
    const runAccOk=!!runAccId&&(connAccs.some(a=>a.id===runAccId)||admAccs.some(a=>a.id===runAccId));
    if(activeRevive?!hasNaverAcc:(!runAccOk))preflightErrors.push("네이버 계정이 연결 안 됐어요 → 계정관리에서 계정을 연결하세요");
    if(otImgMode==="flow"&&!flowSlotReady[flowSlot])preflightErrors.push("Flow가 연결 안 됐어요 → 원터치 발행에서 Flow를 연결 후 다시 시작하세요");
    if(preflightErrors.length){showOneTouchPreflight(preflightErrors,activeRevive?undefined:"원터치 발행을 시작할 수 없어요");return;}
    const acc=connAccs.find(a=>a.id===runAccId);
    const termMin=otCustomTerm.trim()?Math.max(1,parseInt(otCustomTerm,10)||otTermMin):otTermMin;
    otRunningRef.current=true;otStopRef.current=false;setOtRunning(true);setOtNextAt(null);setOtPaused(null);otFlowExhaustedRef.current.clear();
    const ctrl=new AbortController();otAbortRef.current=ctrl;
    try{
    const otLive=(t:string)=>setOtLiveLog(prev=>[...prev,`[${new Date().toLocaleTimeString("ko-KR")}] ${t}`].slice(-300));
    const bySched=source==="schedule";
    setOtLiveLog(prev=>[...prev,activeRevive
      ? `━━ 글 살리기 시작 ━━`
      : `━━━━━ ${new Date().toLocaleString("ko-KR")} 원터치 ${resume?`이어가기(${resume.idx+1}번째부터)`:bySched?"예약 자동 시작":"시작"} ━━━━━`].slice(-300));
    // 👤 어떤 네이버 계정으로 도는지 시작 로그 맨 앞에 항상 표시(일반 원터치·예약·이어가기·글살리기 전부). 회원=관리자 동일.
    { const runAccount=connAccs.find(a=>a.id===runAccId)||admAccs.find(a=>a.id===runAccId);
      otLive(`👤 글 작성 계정: ${runAccount?.username||"확인 불가"}${runAccount?.blog_name?` → 블로그 ${runAccount.blog_name}`:""}`); }
    if(activeRevive?.blogId&&activeRevive.logNo){
      otLive(`🔗 살릴 글 주소: https://blog.naver.com/${encodeURIComponent(activeRevive.blogId)}/${encodeURIComponent(activeRevive.logNo)}`);
    }
    if(!resume&&!activeRevive){
      const cntTxt=otAiKw?`AI 자동추천 ${otAiKwCount}개`:`직접 입력 ${otKeywords.split(/[\n,]+/).map(s=>s.trim()).filter(Boolean).length}개`;
      const styleTxt=otWriteStyle==="자동"?"글패턴 자동":`글패턴 ${otWriteStyle}`;
      const imgTxt=otImgMode==="flow"?`무료 Flow 이미지 ${otImgCount}장`:`AI 이미지 ${otImgCount}장`;
      if(bySched){
        otLive(`⏰ 예약 발행 자동 시작 — 예약 시각 ${otSchedTime}${otSchedDaily?" (매일 반복)":" (오늘 1회)"}`);
        if(otSchedDaily) otLive(`   다음 예약: 내일 ${otSchedTime}`);
      }
      otLive(`📋 발행 계획: ${bySched?"예약으로 ":""}지금부터 ${cntTxt} · ${styleTxt} · ${imgTxt} · 발행 텀 약 ${termMin}분 간격(±15% 안전 랜덤)으로 순서대로 발행해요`);
    }
    let kws:string[]; let startIdx=0; let reviveImageCount=otImgCount||3; let reviveSucceeded=false;
    if(activeRevive){
      otLive(`✨ 대상 글: "${activeRevive.origTitle}"`);
      setReviveState({logNo:activeRevive.logNo,title:activeRevive.origTitle,step:"원본 글을 읽고 주제 파악 중..."});
      let origBody=activeRevive.origBody;
      // ★원본 글 읽기 = 실제 blogId(예: system-b)로. 예전엔 계정 username(bb9653)을 blogId 자리에 넣어 실패했음.
      { const readBlogId=activeRevive.blogId||""; try{const br=await botFetch(`${BOT}/api/post-body?blogId=${encodeURIComponent(readBlogId)}&logNo=${encodeURIComponent(activeRevive.logNo)}`,{signal:AbortSignal.timeout(25000)} as any);const bd=await br.json().catch(()=>({}));if(bd.ok){if(!origBody)origBody=String(bd.body||"");const fetchedCount=Number(bd.imageCount);if(Number.isFinite(fetchedCount)&&fetchedCount>=0)reviveImageCount=Math.floor(fetchedCount);}}catch{} }
      let kw=activeRevive.origTitle.replace(/[\[\]#]/g,"").trim().slice(0,20);
      try{const t=await callAI(`아래 블로그 글의 핵심 검색 키워드(2~4어절)만 답해. 다른 말 절대 금지.\n제목: ${activeRevive.origTitle}\n본문: ${origBody.slice(0,600)}`);const k=(t||"").split("\n")[0].replace(/["'`]/g,"").trim();if(k&&k.length<=25)kw=k;}catch{}
      kws=[kw]; otLive(`📝 주제: ${kw}`);
    } else if(resume){ kws=resume.kws; startIdx=resume.idx; otLive(`▶ ${resume.idx+1}번째 키워드부터 이어서 발행해요`); }
    else if(otAiKw){
      otLive(`✨ AI 자동추천 키워드 ${otAiKwCount}개 생성 중(핫이슈+SEO·14일 중복 제외)`);
      try{ kws=await otGenKeywords(otAiKwCount); }catch(e:any){ otLive(`❌ 키워드 생성 실패: ${e.message||"오류"}`); showToast("AI 키워드 생성 실패","error"); otRunningRef.current=false;setOtRunning(false); return; }
      if(!kws.length){ otLive(`❌ 생성된 키워드가 없어요(최근 사용분 제외 후 0개).`); showToast("생성된 키워드가 없어요","error"); otRunningRef.current=false;setOtRunning(false); return; }
      otLive(`✅ 생성된 키워드 ${kws.length}개: ${kws.join(", ")}`);
    } else {
      kws=otKeywords.split(/[\n,]+/).map(s=>s.trim()).filter(Boolean);
      if(!kws.length){ showToast("키워드를 넣거나 AI 자동추천을 켜세요","error"); otRunningRef.current=false;setOtRunning(false); return; }
    }
    if(!resume&&!activeRevive) otRecordUsedKw(kws);
    let cats:{id:string;name:string}[]=[];
    try{ const cr=await botFetch(`${BOT}/api/naver/categories/${ADM_UID}`,{signal:AbortSignal.timeout(30000)} as any); const cd=await cr.json().catch(()=>({})); if(cd.categories&&cd.categories.length)cats=cd.categories; }catch{}
    if(!cats.length)cats=(accCats[runAccId]||[]).map((c,i)=>({id:String(i),name:c}));
    if(!resume) setOtLog(kws.map(kw=>({id:uid(),kw,step:"대기",status:"wait" as const})));
    // ★이어가기 지점 = 발행 성공한 다음 글. 발행 전 중단된 글은 그 글부터 다시(테리 확정).
    let nextResumeIdx=startIdx;
    for(let i=startIdx;i<kws.length;i++){
      if(otStopRef.current)break;
      const kw=kws[i]; const upd=(patch:any)=>setOtLog(prev=>prev.map((r,j)=>j===i?{...r,...patch}:r));
      const n=activeRevive?reviveImageCount:Math.min(6,Math.max(1,otImgCount));
      try{
        upd({step:"제목 생성 중",status:"run"}); otLive(activeRevive?`✏️ 새 제목 생성 중...`:`▶ [${i+1}/${kws.length}] "${kw}" 제목 생성 중`); const title=await otGenTitleBest(kw); upd({title}); otLive(activeRevive?`✏️ 제목 수정: "${activeRevive.origTitle}" → "${title}"`:`  ✅ 제목 선택: ${title}`);
        if(activeRevive&&title.trim().length<8)throw new Error("제목 생성 품질 미달 — 덮어쓰기 중단(원본 안전)");
        let effStyle:WriteStyle=otWriteStyle==="자동"?"정보글":otWriteStyle;
        if(otWriteStyle==="자동"){ effStyle=await otPickStyle(kw,title); otLive(`  🎨 글 패턴 자동 선택: ${effStyle}`); }
        upd({step:"본문 생성 중"}); otLive(`  ✍️ 본문 생성 중(${otCharMode==="manual"?otTargetChars+"자·":""}${effStyle})`); const {content,tags}=await otGenPost(kw,title,effStyle); otLive(`  ✅ 본문 완성 (${content.length}자)`);
        if(activeRevive&&content.replace(/\s/g,"").length<400)throw new Error("본문 생성 품질 미달 — 덮어쓰기 중단(원본 안전)");
        if(activeRevive)otLive(`🖼️ 이미지 ${n}장 · 📄 글자수 ${content.length}자로 덮어쓰기 시작합니다`);
        const imgs:string[]=[];
        if(n===0){otLive(`  🖼️ 원본 글에 이미지가 없어 이미지 생성은 건너뜁니다`);
        } else if(otImgMode==="ai"){ upd({step:"이미지 생성 중"}); otLive(`  🖼️ 이미지 ${n}장 생성 중(AI)`);
          for(let k=0;k<n;k++){ if(otStopRef.current)break; try{imgs.push(await generateImage(kw,title,k));}catch{} }
          otLive(`  ✅ 이미지 ${imgs.length}/${n}장`);
        } else {   // 무료 Flow: 'Flow 준비'로 연 크롬(9222) 그대로 사용
          upd({step:"Flow 이미지 생성 중"}); otLive(`  🖼️ Flow 이미지 ${n}장 생성 중(연결된 크롬 사용)`);
          const flines=content.split("\n").filter((l:string)=>l.trim().length>5); const fstep=Math.max(1,Math.floor(flines.length/n));
          const fprompts=Array.from({length:n},(_,k)=>{const seg=flines.slice(k*fstep,(k+1)*fstep).join(" ").slice(0,150);return buildAdmFlowPrompt(kw,title,seg,k);});
          const fcaptions=buildCaptions(kw,n,content);
          // ★크레딧이 떨어지면 미리 로그인해둔 다음 슬롯으로 자동 전환하며 이어감. 소진 슬롯은 otFlowExhaustedRef에 기록.
          const trySlots=[flowSlot,...flowSlots.map(s=>s.id).filter(id=>id!==flowSlot)].filter(id=>!otFlowExhaustedRef.current.has(id));
          let flowHandled=false;
          for(const slotId of trySlots){
            if(otStopRef.current)break;
            if(slotId!==flowSlot){ const nm=flowSlots.find(s=>s.id===slotId)?.name||`슬롯${slotId+1}`; otLive(`  🔄 '${nm}' 계정으로 자동 전환해서 계속해요(미리 로그인돼 있어요)`); setFlowSlot(slotId); if(!flowSlotReady[slotId]){ try{ await handleFlowLaunchChrome(slotId); }catch{} } }
            try{ const fr=await botFetch(`${BOT}/api/flow-generate`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({prompts:fprompts,captions:fcaptions,cdpPort:9222+(slotId||0)}),signal:ctrl.signal});
              const fd=await fr.json().catch(()=>({}));
              if(fr.status===402||fd.code==="FLOW_NO_CREDIT"){ otFlowExhaustedRef.current.add(slotId); otLive(`  ⏸ 이 계정 크레딧이 떨어졌어요 — 다음 계정 확인 중...`); continue; }
              else if(fr.ok&&Array.isArray(fd.images)&&fd.images.length){ imgs.push(...fd.images.map((im:any)=>im.src).filter(Boolean)); otLive(`  ✅ Flow 이미지 ${imgs.length}/${n}장${imgs.length<n?` (${n-imgs.length}장은 생성 실패해 빠졌어요)`:""}`); flowHandled=true; break; }
              else { otLive(`  ❌ Flow 이미지 실패: ${fd.error||("HTTP "+fr.status)} — 이미지 없이 발행하지 않고 멈춥니다`); flowHandled=true; break; }
            }catch(e:any){ if(e?.name==="AbortError")throw e; otLive(`  ❌ Flow 이미지 오류: ${e.message} — 이미지 없이 발행하지 않고 멈춥니다`); flowHandled=true; break; }
          }
          if(!flowHandled&&!otStopRef.current){
            upd({step:"⏸ 모든 Flow 계정 크레딧 소진 — 계정 추가 후 이어가기",status:"limit"});
            otLive(`  ⏸ 등록된 Flow 계정이 모두 크레딧이 떨어졌어요. 새 계정을 연결한 뒤 '이어가기'를 누르면 이 키워드부터 계속돼요.`);
            showToast("모든 Flow 계정 크레딧 소진 — 계정 추가 후 '이어가기'","info");
            if(activeRevive){setReviveState({logNo:activeRevive.logNo,title:activeRevive.origTitle,step:"실패",fail:"모든 Flow 계정의 크레딧이 소진됐어요."});otLive("❌ 글 살리기 실패 — 모든 Flow 계정의 크레딧이 소진됐어요");}
            else setOtPaused({idx:i,kws,reason:"credit"});
            otRunningRef.current=false; setOtRunning(false); setOtNextAt(null); return;
          }
          if(!otStopRef.current&&imgs.length===0)throw new Error("Flow 이미지를 한 장도 만들지 못해 발행을 중단했어요. Flow 연결 상태를 확인한 후 다시 시작하세요.");
        }
        if(otStopRef.current){ upd({step:"⏹ 중단됨 — 이 글은 발행하지 않았어요",status:"limit"}); otLive(`  ⏹ 중단 — 발행 전이라 이 글은 올리지 않았어요`); break; }
        upd({step:"카테고리 매칭 중"}); const cat=await otPickCategory(title,content,cats); upd({cat:cat.name||"기본"}); otLive(`  📂 카테고리 자동 선택: ${cat.name||"기본"}`);
        if(otStopRef.current){ upd({step:"⏹ 중단됨 — 이 글은 발행하지 않았어요",status:"limit"}); otLive(`  ⏹ 중단 — 발행 전이라 이 글은 올리지 않았어요`); break; }
        upd({step:"발행 중"}); otLive(`  🚀 네이버 발행 중...`);
        const postUrl=await otPublishItem(kw,title,content,tags.split(",").map(t=>t.replace("#","").trim()).filter(Boolean),imgs,cat.id,acc,0,activeRevive?.logNo,activeRevive?.blogId);
        const at=new Date().toLocaleTimeString("ko-KR",{hour:"2-digit",minute:"2-digit"});
        if(postUrl){
          await addHistory({user_id:ADM_UID,platform:"naver",title,post_url:postUrl,status:"success"}).catch(()=>{});
          upd({step:"발행 완료",status:"done",postUrl,at}); nextResumeIdx=i+1; otLive(`  ✅ 발행 완료! ${postUrl}`);
          if(activeRevive){
            reviveSucceeded=true;
            window.dispatchEvent(new CustomEvent("publy-revive-succeeded",{detail:{logNo:activeRevive.logNo}}));
            await incrementReviveQuota(ADM_HISTORY_UID);
            if(activeRevive.careAccountId){
              const tracked=await markTitleChanged(ADM_HISTORY_UID,activeRevive.careAccountId,activeRevive.logNo,title);
              if(tracked){
                otLive(`  🩺 수정추적 등록 완료: ${activeRevive.logNo}`);
                window.dispatchEvent(new CustomEvent("publy-revive-tracked",{detail:{logNo:activeRevive.logNo,careAccountId:activeRevive.careAccountId}}));
              }else otLive(`  ⚠️ 발행은 완료됐지만 수정추적 저장에 실패했어요`);
            }
            setReviveState({logNo:activeRevive.logNo,title:activeRevive.origTitle,step:"완료",done:true});showToast("✨ 글을 새로 써서 덮어썼어요!","success");
          }
        } else {
          if(activeRevive)setReviveState({logNo:activeRevive.logNo,title:activeRevive.origTitle,step:"실패",fail:"덮어쓰기 주소를 못 받았어요 — 블로그를 확인하세요"});
          upd({step:"⚠️ 발행 주소를 못 받음 — 블로그에 올라갔는지 확인하세요",status:"fail",at});
          otLive(`  ⚠️ 발행 주소를 못 받았어요(글이 실제로 안 올라갔을 수 있음). 블로그를 확인하세요.`);
          if(activeRevive)otLive(`❌ 글 살리기 실패 — 덮어쓰기 주소를 못 받았어요`);
          await addHistory({user_id:ADM_UID,platform:"naver",title,status:"fail",error_message:"발행 주소 미수신(글 미게시 의심)"}).catch(()=>{});
        }
      }catch(e:any){
        if(activeRevive){const fail=String(e?.message||e).split("\n")[0];setReviveState({logNo:activeRevive.logNo,title:activeRevive.origTitle,step:"실패",fail});showToast("글 살리기 실패: "+fail,"error");}
        upd({step:"실패: "+(e.message||"오류"),status:"fail",error:e.message}); otLive(activeRevive?`❌ 글 살리기 실패 — ${e.message||"오류"}`:`  ❌ 실패: ${e.message||"오류"}`);
        await addHistory({user_id:ADM_UID,platform:"naver",title:kw,status:"fail",error_message:e.message}).catch(()=>{});
      }
      if(otStopRef.current) break;
      const hasNext=i<kws.length-1;
      if(hasNext){ const jitter=0.85+Math.random()*0.3; const actualMin=Math.max(1,Math.round(termMin*jitter)); const until=Date.now()+actualMin*60000; setOtNextAt(until); const hhmm=(d:number)=>new Date(d).toLocaleTimeString("ko-KR",{hour:"2-digit",minute:"2-digit"}); otLive(`  ⏱️ 약 ${actualMin}분 대기 (설정 ${termMin}분 ±안전 랜덤 · ${hhmm(Date.now())} → ${hhmm(until)}에 다음 글)`); while(Date.now()<until){ if(otStopRef.current)break; await new Promise(r=>setTimeout(r,1000)); } setOtNextAt(null); if(otStopRef.current)break; otLive(`  ▶ ${hhmm(Date.now())} 대기 끝 — 다음 글 시작`); }
    }
    if(otStopRef.current){
      if(activeRevive){setReviveState({logNo:activeRevive.logNo,title:activeRevive.origTitle,step:"실패",fail:"사용자가 작업을 중단했어요. 원본 글은 덮어쓰지 않았습니다."});otLive("❌ 글 살리기 실패 — 사용자가 작업을 중단했어요");}
      const remain=kws.slice(nextResumeIdx);
      if(remain.length&&!activeRevive){
        setOtPaused({idx:nextResumeIdx,kws,reason:"stopped"});
        if(!otAiKw){ setOtKeywords(remain.join("\n")); }
        otLive(`⏹ 중단 — 남은 ${remain.length}개는 아래 '이어가기'로 계속할 수 있어요. 텀을 바꾸려면 위에서 바꾼 뒤 이어가기를 누르세요.`);
      } else if(!activeRevive) { otLive(`⏹ 전체 중단 — 남은 글이 없어요`); }
    } else if(activeRevive) { if(reviveSucceeded)otLive("✅ 글 살리기 완료 — 새 글로 덮어썼어요"); }
    else { otLive("🎉 원터치 발행 전체 완료"); }
    }catch(e:any){
      const fail=String(e?.message||e||"알 수 없는 오류").split("\n")[0];
      if(activeRevive){setReviveState({logNo:activeRevive.logNo,title:activeRevive.origTitle,step:"실패",fail});showToast("글 살리기 실패: "+fail,"error");}
      else showToast("원터치 실행 실패: "+fail,"error");
    }finally{
      otRunningRef.current=false;otAbortRef.current=null;setOtRunning(false);setOtNextAt(null);
    }
  }

  // 글 생성
  const [adType, setAdType] = useState<"adpost"|"adsense">("adpost");
  const [targetChars, setTargetChars] = useState(1350);
  const [charMode, setCharMode] = useState<"auto"|"manual">("auto");
  const [imgSource, setImgSource] = useState<"ai"|"upload"|"none">("ai");
  const [imgCountManual, setImgCountManual] = useState<number|null>(null);
  const [imgCount, setImgCount] = useState(3);
  const [imgCountAuto, setImgCountAuto] = useState(true);
  const [generatedImages, setGeneratedImages] = useState<string[]>([]);
  const [uploadedImages, setUploadedImages] = useState<string[]>([]);
  const [genImgLoading, setGenImgLoading] = useState(false);
  const [captions, setCaptions] = useState<string[]>([]);
  const [videoOn, setVideoOn] = useState(false);
  const [videoUrl, setVideoUrl] = useState("");
  const [videoPosition, setVideoPosition] = useState<"top"|"middle"|"bottom">("middle");
  const [imgPattern, setImgPattern] = useState<"A"|"B"|"C"|"random">("random");
  const [imgGenType, setImgGenType] = useState<"ai"|"flow">("ai");
  const [showFlowGuide, setShowFlowGuide] = useState(false);
  const [flowImgCount, setFlowImgCount] = useState(2);
  const [flowImgCountAuto, setFlowImgCountAuto] = useState(true);
  const [currentImgPrompt, setCurrentImgPrompt] = useState("");
  const [genImgProgress, setGenImgProgress] = useState(0);
  const [genImgCurrent, setGenImgCurrent] = useState(0);
  const imgAbortRef = useRef<AbortController|null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [keywords, setKeywords] = useState<string[]>(()=>{try{return JSON.parse(localStorage.getItem("publy_adm_kws")||"[]");}catch{return [];}});
  const [generating, setGenerating] = useState(false);
  const [genTitle, setGenTitle] = useState(""); const [genContent, setGenContent] = useState(""); const [genTags, setGenTags] = useState(""); const [genImage, setGenImage] = useState("");
  const [titles, setTitles] = useState<string[]>(()=>{try{return JSON.parse(localStorage.getItem("publy_adm_titles")||"[]");}catch{return[];}});
  const [selectedTitle, setSelectedTitle] = useState(""); const [loadingTitles, setLoadingTitles] = useState(false);

  // 계정
  const [newPlat, setNewPlat] = useState<"naver"|"tistory">("naver"); const [newUser, setNewUser] = useState(""); const [newPw, setNewPw] = useState(""); const [newBlog, setNewBlog] = useState(""); const [addingAcc, setAddingAcc] = useState(false); const [connId, setConnId] = useState<string|null>(null);
  const [accCats, setAccCats] = useState<Record<string,string[]>>(()=>{try{return JSON.parse(localStorage.getItem("publy_adm_acc_cats")||"{}");}catch{return {};}});
  const [editingCatAccId, setEditingCatAccId] = useState<string|null>(null);
  const [catInput, setCatInput] = useState("");
  const [showPw, setShowPw] = useState(false); const [showPw1, setShowPw1] = useState(false); const [showPw2, setShowPw2] = useState(false); const [showDmIgPw, setShowDmIgPw] = useState(false);

  // 회원
  const [users, setUsers] = useState<UserFull[]>([]); const [loading, setLoading] = useState(true); const [search, setSearch] = useState(""); const [selUser, setSelUser] = useState<UserFull|null>(null);
  const [history, setHistory] = useState<PublyHistory[]>([]);
  // 📈 순위 성과 추적(회원과 동일)
  const [photoGuideModal, setPhotoGuideModal] = useState<null|"guide"|"caution"|"example">(null);
  const [rankData, setRankData] = useState<Record<string,{rank:number|null;prev:number|null;at:number}>>(()=>{try{return JSON.parse(localStorage.getItem("publy_adm_rank_track")||"{}");}catch{return{};}});
  const [rankChecking, setRankChecking] = useState(false);
  const scLogNoOf=(url?:string)=>url?.match(/(?:logNo=|\/)(\d{6,})(?:[/?&]|$)/)?.[1]||"";
  const scBlogIdOf=(url?:string)=>url?.match(/blog\.naver\.com\/([a-zA-Z0-9_-]+)/)?.[1]||"";
  async function checkPostRanks(){
    const naverPosts=history.filter(h=>h.status==="success"&&h.platform==="naver"&&h.post_url&&scLogNoOf(h.post_url)&&scBlogIdOf(h.post_url));
    if(naverPosts.length===0){showToast("순위를 확인할 네이버 발행 글이 없어요","error");return;}
    setRankChecking(true);
    try{
      const items=naverPosts.slice(0,30).map(h=>({title:h.title,blogId:scBlogIdOf(h.post_url),logNo:scLogNoOf(h.post_url)}));
      const r=await fetch(`${BOT}/api/post-rank`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({items})});
      const d=await r.json();
      if(!d.ok) throw new Error(d.error||"조회 실패");
      setRankData(prev=>{const next={...prev};for(const rk of d.ranks){const old=prev[rk.logNo];next[rk.logNo]={rank:rk.rank,prev:old?old.rank:null,at:Date.now()};}localStorage.setItem("publy_adm_rank_track",JSON.stringify(next));return next;});
      showToast("📈 순위 성과를 확인했어요!");
    }catch(e:any){showToast("❌ "+e.message,"error");}
    finally{setRankChecking(false);}
  }
  const [editMap, setEditMap] = useState<Record<string,any>>({}); const [saving, setSaving] = useState<string|null>(null);
  const [newNote, setNewNote] = useState(""); const [newPayAmt, setNewPayAmt] = useState(""); const [newPayNote, setNewPayNote] = useState(""); const [addingPay, setAddingPay] = useState(false);
  const [pubSub, setPubSub] = useState<"full"|"body_faq"|"body_only">("full");

  // 설정
  const [writeAI, setWriteAI] = useState(()=>localStorage.getItem("publy_adm_write_ai")||"gemini");
  const [imageAI, setImageAI] = useState(()=>localStorage.getItem("publy_adm_image_ai")||"openai_img");
  // ── 블록 에디터 (tarry 방식) ──
  type TextBlock = {type:"text";id:string;content:string};
  type SingleImageBlock = {type:"image";id:string;src:string;alt:string;position:"left"|"center"|"right";source:"auto"|"manual"};
  type ImagePairBlock = {type:"image-pair";id:string;images:{src:string;alt:string}[]};
  type ContentBlock = TextBlock | SingleImageBlock | ImagePairBlock;
  function uid(){return Math.random().toString(36).slice(2);}
  const [blocks, setBlocks] = useState<ContentBlock[]>([{type:"text",id:uid(),content:""}]);
  const [thumbnail, setThumbnail] = useState("");
  const [greeting, setGreeting] = useState(()=>localStorage.getItem("publy_adm_greeting")||"");
  const [savedGreeting, setSavedGreeting] = useState(()=>localStorage.getItem("publy_adm_greeting")||"");
  const saveGreeting = ()=>{ const g=greeting.trim(); localStorage.setItem("publy_adm_greeting",g); setSavedGreeting(g); showToast(g?"글쓴이 인사말을 저장했어요. 앞으로 모든 글에 자동으로 들어가요":"저장된 인사말을 비웠어요","success"); };
  const [hashtags, setHashtags] = useState<string[]>([]);
  const [newTag, setNewTag] = useState("");
  const [imageMode, setImageMode] = useState<"auto"|"manual">("auto");
  const [autoInserted, setAutoInserted] = useState(false);
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [showNaverMenu, setShowNaverMenu] = useState(false);
  const [showPublishPanel, setShowPublishPanel] = useState(false);
  const [showMeta, setShowMeta] = useState(false);
  const thumbnailRef = useRef<HTMLInputElement>(null);
  const manualFileRef = useRef<HTMLInputElement>(null);
  // ── 카테고리 / 공개 설정 / 예약 발행 ──
  const [category, setCategory] = useState("");
  const [categories, setCategories] = useState<{id:string;name:string}[]>([]);
  const [loadingCats, setLoadingCats] = useState(false);
  const [visibility, setVisibility] = useState<"public"|"neighbor"|"private">("public");
  const [scheduleOn, setScheduleOn] = useState(false);
  const [scheduleTime, setScheduleTime] = useState("");
  const [newPw1, setNewPw1] = useState(""); const [newPw2, setNewPw2] = useState(""); const [pwMsg, setPwMsg] = useState("");
  const [noticeTitle, setNoticeTitle] = useState("");
  const [noticeBody, setNoticeBody] = useState("");
  const [noticeSaving, setNoticeSaving] = useState(false);
  const [noticeMsg, setNoticeMsg] = useState("");
  const [adminNaverKeys, setAdminNaverKeys] = useState<NaverApiKeys>({});
  const [adminNaverSaving, setAdminNaverSaving] = useState(false);
  const [adminNaverMsg, setAdminNaverMsg] = useState("");
  const [showRankInfo, setShowRankInfo] = useState(false);
  const [toasts, setToasts] = useState<{id:number;msg:string;type:"success"|"error"|"info"}[]>([]);
  const [writeStyle, setWriteStyle] = useState<WriteStyle>(()=>(localStorage.getItem("publy_adm_write_style") as WriteStyle)||"감성일기");
  const [persona, setPersona] = useState<PersonaStyle>(()=>(localStorage.getItem("publy_adm_persona") as PersonaStyle)||"none");
  const [blogTemplate, setBlogTemplate] = useState<BlogTemplate>("none");
  const [pubScope, setPubScope] = useState<"body"|"faq"|"full">("full");
  const [draftAvailable, setDraftAvailable] = useState(false);
  const [draftData, setDraftData] = useState<{title:string;content:string;savedAt:string}|null>(null);
  const [errorLogs, setErrorLogs] = useState<{id:string;user_id:string;user_name:string;user_email:string;feature:string;error_message:string;created_at:string;is_read:boolean}[]>([]);
  const [errorLogsLoading, setErrorLogsLoading] = useState(false);
  const [errorLogsError, setErrorLogsError] = useState("");
  const [unreadErrors, setUnreadErrors] = useState(0);
  const [showErrorPopup, setShowErrorPopup] = useState(false);
  const [errorFilter, setErrorFilter] = useState<string|null>(null);
  const [showAllErrors, setShowAllErrors] = useState(false);
  const [photoFiles, setPhotoFiles] = useState<{id:string;src:string;name:string}[]>([]);
  const [photoKeypoints, setPhotoKeypoints] = useState("");
  const [photoGenerating, setPhotoGenerating] = useState(false);
  const [photoGenDone, setPhotoGenDone] = useState(false);
  const [photoDragOver, setPhotoDragOver] = useState(false);
  const [qualityScore, setQualityScore] = useState<{score:number;items:{label:string;pass:boolean;detail:string;weight:number}[]}|null>(null);
  const [calKeywords, setCalKeywords] = useState("");
  const [calPlatform, setCalPlatform] = useState<"naver"|"tistory">("naver");
  const [calDays, setCalDays] = useState(30);
  // ★캘린더 스케줄·완료기록 localStorage 저장(관리자용 키) → 재접속해도 유지
  const [calSchedule, setCalSchedule] = useState<{date:string;keyword:string;title:string;style:string;adType:string;promo?:{name:string;url:string;blurb:string}}[]>(()=>{try{return JSON.parse(localStorage.getItem("publy_adm_cal_schedule")||"[]");}catch{return[];}});
  const [pendingPromo, setPendingPromo] = useState<{name:string;url:string;blurb:string}|null>(null);
  const [calCompleted, setCalCompleted] = useState<Record<string,string>>(()=>{try{return JSON.parse(localStorage.getItem("publy_adm_cal_done")||"{}");}catch{return{};}});
  const [calLoading, setCalLoading] = useState(false);
  const [calDone, setCalDone] = useState(false);
  function showToast(msg:string, type:"success"|"error"|"info"="success"){
    const id=Date.now();
    setToasts(p=>[...p,{id,msg,type}]);
    setTimeout(()=>setToasts(p=>p.filter(t=>t.id!==id)),3200);
  }
  const [kwData, setKwData] = useState<{keyword:string;volume:number;competition:string;cpc:number;clicks:number}[]>([]);
  const [loadingKw, setLoadingKw] = useState(false);
  const [showKwInfo, setShowKwInfo] = useState(false);
  const [naverQuotaInfo, setNaverQuotaInfo] = useState<{used:number;limit:number}|null>(null);

  function calcGoldScore(kw:{volume:number;competition:string;cpc:number;clicks:number;keyword?:string}):number{
    const compScore=kw.competition==="낮음"?100:kw.competition==="중"?50:10;
    const volScore=kw.volume>=1000&&kw.volume<=30000?100:kw.volume>30000&&kw.volume<=80000?60:kw.volume<1000?20:40;
    const ctrScore=kw.volume>0?Math.min(100,(kw.clicks/kw.volume)*1000):0;
    const cpcScore=Math.min(100,kw.cpc/8);
    const kwText=(kw.keyword||"").toLowerCase();
    const commercialBonus=/추천|비교|후기|리뷰|방법|가격|구매|어디|어떻게|얼마|순위|최고|좋은|싼/.test(kwText)?20:0;
    const wordCount=kwText.replace(/\s+/g," ").trim().split(" ").length;
    const longtailBonus=wordCount>=3?15:wordCount===2?8:0;
    const base=Math.round(compScore*0.35+volScore*0.25+ctrScore*0.15+cpcScore*0.25);
    return Math.min(100,base+commercialBonus+longtailBonus);
  }

  function calcQualityScore(content:string, kw:string):{score:number;items:{label:string;pass:boolean;detail:string;weight:number}[]}|null {
    if(!content||content.length<100)return null;
    const items:{label:string;pass:boolean;detail:string;weight:number}[]=[];
    const charOk=content.length>=1200;
    items.push({label:"글자수",pass:charOk,detail:content.length.toLocaleString()+"자 (권장 1,200자+)",weight:20});
    const headings=(content.match(/^## .+/gm)||[]);
    const qHeadings=headings.filter(h=>/[?？]/.test(h)||/하는법|방법|이유|이란|할까|될까|인가|인지|는지/.test(h));
    const headingOk=headings.length>=3&&qHeadings.length>=Math.ceil(headings.length*0.5);
    items.push({label:"질문형 소제목",pass:headingOk,detail:headings.length+"개 중 "+qHeadings.length+"개 질문형",weight:25});
    const keyword=kw.trim();
    const kwCount=keyword?(content.match(new RegExp(keyword.replace(/[.*+?^${}()|[\]\\]/g,"\\$&"),"gi"))||[]).length:0;
    const kwOk=keyword?kwCount>=2&&kwCount<=6:true;
    items.push({label:"키워드 밀도",pass:kwOk,detail:keyword?keyword+" "+kwCount+"회 (권장 2~6회)":"키워드 없음",weight:20});
    const aiPatterns=["해보겠습니다","알아보겠습니다","살펴보겠습니다","소개해드리겠습니다","정리해보겠습니다","결론적으로","중요합니다","다양한","효과적인","필수적으로"];
    const aiHits=aiPatterns.filter(p=>content.includes(p));
    const aiOk=aiHits.length===0;
    items.push({label:"AI 패턴 차단",pass:aiOk,detail:aiOk?"AI 냄새 없음 ✓":"감지됨: "+aiHits.slice(0,2).join(", "),weight:20});
    const paragraphs=content.split(/\n\n+/).filter(p=>p.trim().length>20&&!p.startsWith("##")&&!p.startsWith("["));
    const avgLen=paragraphs.length>0?paragraphs.reduce((a,p)=>a+p.length,0)/paragraphs.length:0;
    const paraOk=paragraphs.length>=4&&avgLen>=80&&avgLen<=400;
    items.push({label:"단락 균형",pass:paraOk,detail:"단락 "+paragraphs.length+"개, 평균 "+Math.round(avgLen)+"자",weight:15});
    const score=Math.round(items.reduce((acc,it)=>acc+(it.pass?it.weight:0),0));
    return{score,items};
  }

  // 🔥 핫이슈 추천 — 회원 대시보드와 동일(카테고리별 실시간 인기 주제)
  const HOT_CATS = ["실시간","정책자금","음식레시피","여행","재테크","건강운동","뷰티","패션","인테리어","반려동물","육아","경제","증권","산업","정치","사회","전국","세계","문화","연예","스포츠","건강"];
  const [hotCat, setHotCat] = useState("실시간");
  const [hotItems, setHotItems] = useState<string[]>([]);
  const [hotLoading, setHotLoading] = useState(false);
  const [hotPage, setHotPage] = useState(0); // 핫이슈 페이지네이션(주제 많아 아래로 길어짐 방지) — 회원 대시보드와 동일
  const HOT_PAGE_SIZE = 20;
  const [quickKw, setQuickKw] = useState(""); // 핫이슈 '바로 글쓰기'용(캘린더와 별개)
  const HOT_FALLBACK: Record<string,string[]> = {
    실시간:["요즘 뜨는 부업","정부지원금 신청","가을 여행지 추천","제철 음식 요리","전기요금 절약법","1인 창업 아이템","연말정산 미리보기","청년 지원 정책","넷플릭스 추천작","다이어트 식단","반려동물 용품","스마트스토어 창업","환절기 건강관리","실내 인테리어 팁","제철 과일 고르는 법","중고거래 꿀팁","캠핑 초보 준비물","홈카페 레시피","가성비 노트북","주말 나들이 코스"],
    경제:["금리 전망","연말정산 팁","소상공인 지원금","재테크 초보","청년 목돈 마련","부동산 시장 동향","환율 전망","연금 저축 활용","월세 세액공제","가계부 쓰는 법","금값 시세","비상금 모으기","신용점수 올리는 법","청년도약계좌","절세 상품 정리","가상자산 과세","실손보험 개편","전세대출 금리","배달 물가","최저임금 변화"],
    증권:["배당주 추천","ETF 초보 투자","국장 vs 미장","공모주 청약","미국 주식 세금","반도체 관련주","2차전지 전망","코스피 전망","고배당 ETF","IRP 계좌 활용","증권사 수수료 비교","리츠 투자","적립식 투자","우량주 장기투자","AI 관련주","환헤지 ETF","실적 시즌 체크","채권 투자 기초","테마주 주의점","분산투자 방법"],
    산업:["AI 활용법","전기차 보조금","반도체 전망","스마트스토어 창업","2차전지 산업","로봇 자동화","배터리 소재","친환경 에너지","수소차 근황","클라우드 시장","자율주행 기술","디스플레이 신기술","드론 활용 사례","3D 프린팅","스타트업 투자 유치","제조업 스마트팩토리","항공우주 산업","바이오 헬스케어","조선업 수주","반도체 장비"],
    정치:["정부 지원 정책","청년 정책","주거 지원 제도","소상공인 대책","육아 지원금","기초연금 인상","교육 정책 변화","지방 소멸 대응","복지 혜택 총정리","세금 개편안","국민연금 개혁","최저임금 결정","전월세 대책","일자리 정책","저출생 대책","고령화 대책","의료 정책","교통 정책","환경 규제","디지털 정부"],
    사회:["요즘 생활 물가","전세 사기 예방","실업급여 조건","보이스피싱 예방","중고거래 사기","교통비 절약","청년 주거 문제","1인 가구 생활","반려동물 에티켓","이웃 갈등 해결","재난 문자 대처","분리수거 방법","응급실 이용 팁","학교폭력 대응","노인 돌봄","기후 변화 체감","미세먼지 대응","층간소음 해결","알뜰폰 요금제","무인점포 이용법"],
    전국:["지역 축제 일정","당일치기 여행","지방 맛집 투어","제주 여행 코스","부산 가볼 만한 곳","강원도 드라이브","경주 역사 여행","전주 한옥마을","가을 단풍 명소","해돋이 명소","시장 먹거리 투어","템플스테이","섬 여행 추천","캠핑장 추천","기차 여행 코스","야경 명소","벚꽃 명소","계곡 피서지","힐링 여행지","지역 특산물"],
    세계:["해외여행 준비물","환율 여행 팁","면세점 쇼핑","일본 여행 코스","동남아 휴양지","유럽 배낭여행","해외 직구 방법","여권 재발급","해외여행 보험","항공권 싸게 사는 법","로밍 vs 유심","해외 축제","비자 발급 정보","시차 적응법","환전 꿀팁","해외 맛집","크루즈 여행","트래블 카드","해외 안전 여행","글로벌 트렌드"],
    문화:["넷플릭스 추천작","전시회 나들이","베스트셀러 도서","뮤지컬 추천","독립영화 추천","OTT 비교","웹툰 추천","클래식 공연","미술관 관람","연극 추천","독서 모임","팟캐스트 추천","다큐멘터리 추천","전시 예매 팁","도서관 활용법","문화생활 할인","페스티벌 일정","작가 인터뷰","신간 소식","오디오북 추천"],
    연예:["아이돌 컴백 소식","드라마 정주행","예능 다시보기","OTT 신작","영화 개봉 소식","콘서트 티켓팅","연예인 화보","드라마 촬영지","신인 배우","음악 방송 순위","해외 K팝 반응","예능 라인업","OST 추천","팬미팅 일정","시상식 소식","웹드라마 추천","리얼리티쇼","배우 인터뷰","컴백 무대","연말 가요제"],
    스포츠:["프로야구 순위","홈트레이닝 루틴","등산 초보 코스","러닝 입문","축구 국가대표","프로농구 일정","골프 입문","헬스 식단","마라톤 대회","클라이밍 시작","수영 배우기","자전거 코스","배드민턴 기초","요가 스트레칭","스포츠 중계 일정","다이어트 운동","홈짐 구성","테니스 입문","겨울 스포츠","축구화 추천"],
    건강:["다이어트 식단","영양제 추천","환절기 건강관리","수면의 질 높이기","면역력 높이는 법","스트레스 해소","눈 건강 관리","장 건강 음식","혈압 관리","단백질 보충","금연 방법","비타민D 부족","목·어깨 스트레칭","물 많이 마시기","혈당 관리","치아 관리","피부 건강","갱년기 관리","정신건강 챙기기","건강검진 항목"],
    음식레시피:["제육볶음 레시피","된장찌개 끓이는 법","에어프라이어 요리","자취 요리","다이어트 도시락","김치볶음밥","밑반찬 만들기","닭가슴살 요리","간단 아침 메뉴","계란 요리","캠핑 요리","국물 요리","저칼로리 간식","전자레인지 요리","브런치 메뉴","야식 추천","제철 나물","홈베이킹","백종원 레시피","비 오는 날 부침개"],
    패션:["가을 코디","데일리룩","여자 데일리룩","남자 코디","키작녀 코디","오피스룩","니트 코디","청바지 코디","가을 아우터","신발 추천","가방 추천","커플룩","하객룩","운동복 코디","레이어드룩","트렌치코트 코디","맨투맨 코디","원피스 코디","계절 옷 정리","패션 소품"],
    뷰티:["가을 메이크업","스킨케어 순서","수분 크림 추천","다크서클 커버","눈썹 그리기","입술 각질 관리","모공 관리","선크림 추천","헤어 에센스","셀프 네일","향수 추천","다이어트 방법","탈모 예방","두피 관리","화장품 정리","데일리 메이크업","블러셔 추천","클렌징 방법","피부 진정","립 제품 추천"],
    여행:["당일치기 여행","국내 가볼만한곳","제주 여행 코스","부산 여행","강원도 여행","가을 단풍 여행","힐링 여행지","캠핑장 추천","글램핑","서울 데이트 코스","전주 여행","경주 여행","섬 여행","온천 여행","호캉스 추천","드라이브 코스","아이와 여행","반려견 동반 여행","기차 여행","야경 명소"],
    인테리어:["원룸 인테리어","셀프 인테리어","홈카페 꾸미기","수납 정리","작은 방 꾸미기","거실 인테리어","주방 정리","조명 추천","셀프 페인팅","소품 추천","이케아 추천","벽 꾸미기","반셀프 인테리어","가구 배치","화장실 인테리어","현관 정리","침실 꾸미기","포인트 벽지","식물 인테리어","공간 활용"],
    반려동물:["강아지 훈련","고양이 사료 추천","강아지 간식","반려견 산책","고양이 화장실","강아지 목욕","펫 미용","반려동물 장난감","강아지 사료 추천","고양이 장난감","분리불안 해결","반려견 영양제","고양이 스크래처","강아지 옷","펫 보험","반려동물 등록","강아지 배변훈련","고양이 건강","반려견 여행","펫 용품 추천"],
    재테크:["직장인 부업","적금 추천","청약통장","주식 초보","절약 방법","정부지원금 신청","연금저축","가계부 앱","비상금 모으기","티끌 모으기","앱테크","중고거래 부업","배당주 투자","월급 관리","목돈 만들기","신용점수 관리","무지출 챌린지","포인트 재테크","공모주 청약","경제 공부"],
    정책자금:["소상공인 정책자금 신청","청년 창업 지원금","정부지원금 총정리","소상공인 대출 조건","근로장려금 신청","청년내일채움공제","두루누리 지원금","고용지원금 종류","긴급경영안정자금","자영업자 지원제도","지역화폐 혜택","중소기업 지원사업","햇살론 자격","창업 지원사업 정리","청년 월세 지원","소상공인 방역지원금","일자리 안정자금","국민취업지원제도","여성 창업 지원","정책자금 받는 법"],
    육아:["이유식 레시피","신생아 용품","아기 수면 교육","육아템 추천","어린이집 준비물","기저귀 추천","분유 추천","돌잔치 준비","아기 발달","유아 장난감","출산 준비물","아기 이유식 시기","육아 스트레스","아기 옷 추천","유아식 메뉴","아기 목욕","예방접종 일정","임신 초기 증상","산후조리","아이 훈육"],
    건강운동:["홈트레이닝","다이어트 운동","복부 운동","스트레칭 루틴","런닝 초보","헬스 초보 루틴","요가 동작","체중 감량","전신 운동","하체 운동","다이어트 식단","맨몸 운동","코어 운동","걷기 운동","등산 초보","자세 교정","폼롤러 스트레칭","근력 운동","유산소 운동","운동 습관"],
  };
  const loadHotIssues = async (cat: string, opts?: { refreshed?: boolean }) => {
    setHotCat(cat); setHotLoading(true); setHotPage(0); // 카테고리 바뀌면 첫 페이지로
    try {
      const r = await botFetch(`${BOT}/api/hot-issues?category=${encodeURIComponent(cat)}${opts?.refreshed ? "&fresh=1" : ""}`, { signal: AbortSignal.timeout(15000) } as any);
      const d = await r.json();
      const items = d.ok ? (d.items || []) : [];
      setHotItems(items.length ? items : (HOT_FALLBACK[cat] || HOT_FALLBACK["실시간"]));
    } catch { setHotItems(HOT_FALLBACK[cat] || HOT_FALLBACK["실시간"]); }
    setHotLoading(false);
    if (opts?.refreshed) showToast(`✨ ${cat} 핫이슈를 최신으로 갱신했어요!`);
  };
  useEffect(() => { if (tab === "calendar" && hotItems.length === 0 && !hotLoading) loadHotIssues("실시간"); /* eslint-disable-next-line */ }, [tab]);

  async function generateCalendar(){
    const kws = calKeywords.split(/[,\n]+/).map((s:string)=>s.trim()).filter(Boolean);
    if(kws.length===0){showToast("키워드를 입력해주세요","error");return;}
    setCalLoading(true);setCalDone(false);setCalSchedule([]);
    try{
      const today=new Date();
      const geminiKey=localStorage.getItem("publy_adm_gemini_key")||"";
      if(!geminiKey){showToast("설정탭에서 관리자 Gemini API 키를 먼저 입력해주세요","error");setCalLoading(false);return;}
      const prompt=`You are a JSON generator. Return ONLY a valid JSON array, no explanation, no markdown, no code blocks.
Generate a ${calDays}-day blog publishing schedule.
Keywords: ${kws.join(", ")}
Platform: ${calPlatform==="naver"?"Naver Blog":"Tistory"}
Rules:
- If keywords are insufficient, generate related keywords to fill ${calDays} days
- Weekends (Sat/Sun): lifestyle/travel/food topics. Weekdays: informational topics
- No consecutive same keywords
- adType: use "adpost" for emotional/lifestyle posts, "adsense" for informational posts
- style: one of 감성일기/정보글/맛집후기/여행기
Today: ${today.toISOString().slice(0,10)}

★제목 작성 규칙 (네이버 클릭률·검색노출 최적화 — 반드시 준수):
- 실제 검색어(핵심 키워드)를 제목 맨 앞 8글자 안에 배치
- 25~32자 권장
- 구체성: 숫자·대상(초보·직장인)·상황(방법·후기·비교·주의점) 중 1~2개 포함
- 검색 의도어: ~하는 법 / ~추천 / ~정리 / ~후기 / 총정리
- ⛔ 과장·낚시 감탄사 금지(대박·충격·미쳤다·1등·완벽·진짜), 물음표·느낌표 남발 금지(최대 1개)
Output format (JSON array only, no other text):
[{"date":"YYYY-MM-DD","keyword":"키워드","title":"SEO제목","style":"글스타일","adType":"adpost or adsense"}]`;
      const r=await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key="+encodeURIComponent(geminiKey),
        {method:"POST",headers:{"Content-Type":"application/json"},
          body:JSON.stringify({
            contents:[{parts:[{text:prompt}]}],
            generationConfig:{temperature:0.5,maxOutputTokens:8192,responseMimeType:"application/json"}
          })}
      );
      const d=await r.json();
      const raw=d.candidates?.[0]?.content?.parts?.[0]?.text||"";
      if(!raw){throw new Error("Gemini 응답이 비어있어요. API 키를 확인해주세요.");}
      const clean=raw.replace(/```json|```/g,"").trim();
      const parsed=JSON.parse(clean);
      const sched=parsed.slice(0,calDays);
      // ★우리 서비스 주제 1개를 스케줄에 자연스럽게 랜덤 삽입(회원 대시보드와 동일) → 글 본문에 링크 녹아듦
      const SERVICE_TOPICS=[
        {name:"온종일팜",url:"https://app.yuanfnb.com",keyword:"제철 농수산물 온라인 주문",title:"산지직송 제철 농수산물 온라인으로 편하게 사는 법",blurb:"산지에서 바로 보내주는 신선한 농수산물 쇼핑몰"},
        {name:"온종일 체험단",url:"https://pick.온종일.com",keyword:"블로그 체험단 신청 방법",title:"블로그 체험단 처음 신청하는 법과 후기 잘 쓰는 팁",blurb:"블로그 체험단·협찬을 신청하고 리뷰하는 플랫폼"},
        {name:"온파트너",url:"https://partner.yuanfnb.com",keyword:"제휴마케팅 부업",title:"초보도 시작하는 제휴마케팅 부업, 이렇게 하면 됩니다",blurb:"상품을 소개하고 수익을 얻는 제휴마케팅 서비스"},
        {name:"온캐치",url:"https://game.온종일.com",keyword:"무료 웹게임 추천",title:"설치 없이 바로 즐기는 무료 웹게임 추천 모음",blurb:"회원가입만으로 즐기는 무료 게임 14종"},
        {name:"온종일뉴스",url:"https://news.온종일.com",keyword:"정부지원금 정보",title:"놓치기 쉬운 정부지원금·창업 정보 한눈에 챙기는 법",blurb:"AI·창업·지원금·마케팅 실용 정보를 다루는 뉴스"},
        {name:"온종일 스튜디오",url:"https://studio.온종일.com",keyword:"소상공인 홍보 영상 제작",title:"소상공인을 위한 홍보 영상·홈페이지 제작 시작하기",blurb:"홈페이지·홍보 영상을 만들어주는 제작 서비스"},
      ];
      if(sched.length>0){
        const svc=SERVICE_TOPICS[Math.floor(Math.random()*SERVICE_TOPICS.length)];
        const insertAt=Math.floor(Math.random()*sched.length);
        const base=sched[insertAt];
        sched[insertAt]={...base,keyword:svc.keyword,title:svc.title,style:base?.style||"정보글",adType:base?.adType||"adsense",promo:{name:svc.name,url:svc.url,blurb:svc.blurb}};
      }
      setCalSchedule(sched);
      localStorage.setItem("publy_adm_cal_schedule",JSON.stringify(sched));
      setCalCompleted({}); localStorage.setItem("publy_adm_cal_done","{}");
      setCalDone(true);
      showToast(`${sched.length}일치 스케줄 생성 완료!`);
    }catch(e:any){showToast("❌ "+e.message,"error");}
    finally{setCalLoading(false);}
  }
  // ★개별 항목 재추천(관리자, 회원과 동일): 그 줄 제목·키워드만 새로
  const [calRegenIdx,setCalRegenIdx]=useState<number>(-1);
  async function regenCalItem(idx:number){
    const cur=calSchedule[idx]; if(!cur) return;
    const key=localStorage.getItem("publy_adm_gemini_key")||"";
    if(!key){showToast("설정탭에서 관리자 Gemini API 키를 먼저 입력해주세요","error");return;}
    setCalRegenIdx(idx);
    try{
      const existTitles=calSchedule.filter((_,i)=>i!==idx).map(s=>s.title);
      const prompt=`You are a JSON generator. Return ONLY a valid JSON object, no explanation, no markdown, no code blocks.
주제 키워드: "${cur.keyword}" (주제는 유지, 아래 기존 제목과 겹치지 않는 새 각도로 블로그 글감 1개)
기존 제목(중복 금지): ${existTitles.slice(0,20).join(" / ")}
★제목 규칙: 검색어 앞 8글자 배치, 25~32자, 숫자·대상·상황 1~2개, 과장·낚시 감탄사 금지, 물음표·느낌표 최대 1개.
Output (JSON object only): {"keyword":"핵심키워드","title":"새 제목","style":"감성일기 또는 정보글 또는 맛집후기 또는 여행기","adType":"adpost 또는 adsense"}`;
      // ★2.5-flash-lite는 thinkingBudget:0을 안 주면 thinking에 토큰 다 써서 빈 응답 → 재추천 실패의 원인.
      //   토큰도 넉넉히(2048) + thinkingBudget:0 + 45초 타임아웃.
      const r=await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key="+encodeURIComponent(key),
        {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({contents:[{parts:[{text:prompt}]}],generationConfig:{temperature:0.7,maxOutputTokens:2048,responseMimeType:"application/json",thinkingConfig:{thinkingBudget:0}}}),signal:AbortSignal.timeout(45000)});
      if(!r.ok){const j=await r.json().catch(()=>null);const em=(j?.error?.message||"").toLowerCase();throw new Error(em.includes("quota")||em.includes("429")||r.status===429?"Gemini 하루 무료 한도를 다 썼어요. 잠시 후 다시 시도해주세요":`AI 오류(${r.status})`);}
      const d=await r.json(); const raw=d.candidates?.[0]?.content?.parts?.[0]?.text||"";
      const clean=raw.replace(/```json|```/g,"").trim();
      if(!clean)throw new Error("AI가 빈 응답을 보냈어요. 잠시 후 다시 시도해주세요");
      const s=clean.indexOf("{"),e=clean.lastIndexOf("}");
      if(s<0||e<=s)throw new Error("AI 응답 형식 오류(잠시 후 다시)");
      let obj:any; try{ obj=JSON.parse(clean.slice(s,e+1)); }catch{ throw new Error("AI 응답을 읽지 못했어요(형식 오류). 다시 시도해주세요"); }
      setCalSchedule(prev=>{const next=[...prev];next[idx]={...next[idx],keyword:String(obj.keyword||cur.keyword),title:String(obj.title||cur.title),style:String(obj.style||cur.style),adType:String(obj.adType||cur.adType)};localStorage.setItem("publy_adm_cal_schedule",JSON.stringify(next));return next;});
      showToast("🔄 새 제목으로 다시 추천했어요!");
    }catch(e:any){ const msg=e?.name==="AbortError"?"시간이 초과됐어요. 다시 눌러주세요":(e?.message||"알 수 없는 오류"); showToast("❌ 재추천 실패: "+msg,"error"); }
    finally{setCalRegenIdx(-1);}
  }
  function toggleCalDone(date:string){
    setCalCompleted(prev=>{
      const next={...prev};
      if(next[date]) delete next[date]; else next[date]=new Date().toISOString();
      localStorage.setItem("publy_adm_cal_done",JSON.stringify(next));
      return next;
    });
  }
  function writeFromSchedule(s:{keyword:string;title:string;promo?:{name:string;url:string;blurb:string}}){
    setKeyword(s.keyword);
    setSelectedTitle(s.title);
    setPendingPromo(s.promo||null);
    setTab("write");
    showToast(`✍️ "${s.title}" 글쓰기로 이동했어요!`);
  }

  async function fetchKeywordData(){
    if(!keyword.trim()){showToast("키워드를 먼저 입력해주세요","error");return;}
    setLoadingKw(true);
    try{
      const keys=await getNaverApiKeys(ADM_UID);
      if(!keys.naver_access_license||!keys.naver_secret_key||!keys.naver_customer_id){
        showToast("설정탭에서 네이버 검색광고 API 키를 입력해주세요","error");
        setLoadingKw(false);return;
      }
      const r=await botFetch(`${BOT}/api/naver-keywords`,{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({accessLicense:keys.naver_access_license,secretKey:keys.naver_secret_key,customerId:keys.naver_customer_id,keywords:[keyword.trim()]}),
      });
      if(!r.ok)throw new Error((await r.json()).error);
      const data=await r.json();
      const list=(data.keywordList||[]).slice(0,20).map((item:any,i:number)=>{
        const pc=parseInt((item.monthlyPcQcCnt||"0").toString().replace(/,/g,""))||0;
        const mob=parseInt((item.monthlyMobileQcCnt||"0").toString().replace(/,/g,""))||0;
        const total=pc+mob;
        return{keyword:item.relKeyword||"",volume:total,clicks:Math.round(total*0.03),
          cpc:Math.round((parseFloat(item.avgMonthlyPC||"0")||0)*1000),
          competition:item.compIdx==="높음"?"높음":item.compIdx==="낮음"?"낮음":"중"};
      }).filter((k:any)=>k.keyword);
      setKwData(list);
      showToast(`📊 키워드 ${list.length}개 수집 완료!`);
    }catch(e:any){showToast("❌ "+e.message,"error");}
    finally{setLoadingKw(false);}
  }

  // 카테고리 로드
  async function loadCategories(plat: string) {
    if (!botOnline) {
      const saved=accCats[pubAccId]||[];
      setCategories(saved.map((c,i)=>({id:String(i),name:c})));
      return;
    }
    setLoadingCats(true); setCategories([]); setCategory("");
    try {
      const r = await botFetch(`${BOT}/api/${plat}/categories/${ADM_UID}`, {signal: AbortSignal.timeout(30000)});
      const d = await r.json();
      if (d.categories && d.categories.length>0) {
        setCategories(d.categories);
        const names=d.categories.map((c:{id:string;name:string})=>c.name);
        saveAccCat(pubAccId, names);
      } else {
        const saved=accCats[pubAccId]||[];
        setCategories(saved.map((c,i)=>({id:String(i),name:c})));
      }
    } catch {
      const saved=accCats[pubAccId]||[];
      setCategories(saved.map((c,i)=>({id:String(i),name:c})));
    }
    finally { setLoadingCats(false); }
  }

  // ── 블록 조작 ──
  function updateBlock(id:string,updates:Partial<ContentBlock>){setBlocks(prev=>prev.map(b=>b.id===id?({...b,...updates} as ContentBlock):b));}
  function removeBlock(id:string){setBlocks(prev=>prev.filter(b=>b.id!==id));}
  function addTextBlock(afterId?:string){
    const nb:TextBlock={type:"text",id:uid(),content:""};
    if(!afterId){setBlocks(prev=>[...prev,nb]);return;}
    setBlocks(prev=>{const i=prev.findIndex(b=>b.id===afterId);const n=[...prev];n.splice(i+1,0,nb);return n;});
  }
  function addManualImageBlock(afterId?:string){
    const nb:SingleImageBlock={type:"image",id:uid(),src:"",alt:"",position:"center",source:"manual"};
    if(!afterId){setBlocks(prev=>[...prev,nb]);return;}
    setBlocks(prev=>{const i=prev.findIndex(b=>b.id===afterId);const n=[...prev];n.splice(i+1,0,nb);return n;});
  }

  // ── triggerAutoInsert ──
  function triggerAutoInsert(images:{id:number;src:string;alt?:string}[]){
    const textOnly=blocks.filter(b=>b.type==="text"||(b.type==="image"&&(b as SingleImageBlock).source==="manual"));
    if(textOnly.filter(b=>b.type==="text").length===0)return;
    function hasSectionMarker(b:ContentBlock):boolean{
      if(b.type!=="text")return false;
      const c=(b as TextBlock).content;
      return c.includes("[FAQ시작]")||c.includes("[참고자료시작]")||c.includes("[관련글시작]");
    }
    const markerIdx=textOnly.findIndex(hasSectionMarker);
    const safeBlocks=markerIdx===-1?textOnly:textOnly.slice(0,markerIdx);
    const sectionBlocks=markerIdx===-1?[]:textOnly.slice(markerIdx);
    const safeTextCount=safeBlocks.filter(b=>b.type==="text").length;
    const imgs=images.filter(img=>img?.src&&img.src.trim()!=="");
    if(imgs.length===0)return;

    const patterns:("A"|"B"|"C")[] = ["A","B","C"];
    const activePattern:("A"|"B"|"C") = imgPattern==="random"
      ? patterns[Math.floor(Math.random()*3)]
      : imgPattern;

    const result:ContentBlock[]=[];
    let insertedCount=0;

    if(activePattern==="A"){
      result.push({type:"image",id:uid(),src:imgs[0].src,alt:imgs[0].alt||"이미지 1",position:"center",source:"auto"} as ContentBlock);
      insertedCount++;
      const remaining=imgs.slice(1);
      const midPoint=Math.floor(safeTextCount/2);
      let textCount=0;
      for(let i=0;i<safeBlocks.length;i++){
        result.push(safeBlocks[i]);
        if(safeBlocks[i].type==="text"){
          textCount++;
          if(textCount===midPoint&&remaining.length>0){
            remaining.forEach((img,idx)=>{result.push({type:"image",id:uid(),src:img.src,alt:img.alt||`이미지 ${insertedCount+idx+1}`,position:"center",source:"auto"} as ContentBlock);});
            insertedCount+=remaining.length;
          }
        }
      }
    } else if(activePattern==="B"){
      result.push({type:"image",id:uid(),src:imgs[0].src,alt:imgs[0].alt||"이미지 1",position:"center",source:"auto"} as ContentBlock);
      insertedCount++;
      const remaining=imgs.slice(1);
      const pairs:typeof remaining[]=[];
      for(let i=0;i<remaining.length;i+=2) pairs.push(remaining.slice(i,i+2));
      const insertMap=new Map<number,typeof pairs[0][]>();
      if(safeTextCount>0&&pairs.length>0){
        pairs.forEach((pair,index)=>{
          const targetTextIndex=Math.min(safeTextCount,Math.max(1,Math.ceil(((index+1)*safeTextCount)/pairs.length)));
          const bucket=insertMap.get(targetTextIndex)||[];bucket.push(pair);insertMap.set(targetTextIndex,bucket);
        });
      }
      let textCount=0;
      for(let i=0;i<safeBlocks.length;i++){
        result.push(safeBlocks[i]);
        if(safeBlocks[i].type==="text"){
          textCount++;
          const toInsert=insertMap.get(textCount)||[];
          toInsert.forEach(pair=>{
            if(pair.length===2){
              result.push({type:"image-pair",id:uid(),images:[{src:pair[0].src,alt:pair[0].alt||"이미지"},{src:pair[1].src,alt:pair[1].alt||"이미지"}]} as ContentBlock);
              insertedCount+=2;
            } else {
              result.push({type:"image",id:uid(),src:pair[0].src,alt:pair[0].alt||"이미지",position:"center",source:"auto"} as ContentBlock);
              insertedCount++;
            }
          });
        }
      }
    } else {
      result.push({type:"image",id:uid(),src:imgs[0].src,alt:imgs[0].alt||"이미지 1",position:"center",source:"auto"} as ContentBlock);
      insertedCount++;
      const remainingImages=imgs.slice(1);
      const insertMap=new Map<number,typeof remainingImages>();
      if(safeTextCount>0&&remainingImages.length>0){
        remainingImages.forEach((img,index)=>{
          const targetTextIndex=Math.min(safeTextCount,Math.max(1,Math.ceil(((index+1)*safeTextCount)/remainingImages.length)));
          const bucket=insertMap.get(targetTextIndex)||[];bucket.push(img);insertMap.set(targetTextIndex,bucket);
        });
      }
      let textCount=0;
      for(let i=0;i<safeBlocks.length;i++){
        result.push(safeBlocks[i]);
        if(safeBlocks[i].type==="text"){
          textCount++;
          const toInsert=insertMap.get(textCount)||[];
          toInsert.forEach((img,idx)=>{result.push({type:"image",id:uid(),src:img.src,alt:img.alt||`이미지 ${insertedCount+idx+1}`,position:"center",source:"auto"} as ContentBlock);});
          insertedCount+=toInsert.length;
        }
      }
      if(insertedCount<imgs.length){
        const remaining=imgs.slice(insertedCount);
        let lastTextIdx=-1;
        for(let i=result.length-1;i>=0;i--){if(result[i].type==="text"){lastTextIdx=i;break;}}
        const insertAt=lastTextIdx>=0?lastTextIdx+1:result.length;
        remaining.reverse().forEach(img=>{result.splice(insertAt,0,{type:"image",id:uid(),src:img.src,alt:img.alt||"이미지",position:"center",source:"auto"} as ContentBlock);});
      }
    }

    for(const b of sectionBlocks)result.push(b);
    setBlocks(result);setAutoInserted(true);
  }

  function handleAutoInsert(){
    const imgs=getActiveImages();
    if(imgs.length===0){alert("이미지를 먼저 생성해주세요");return;}
    triggerAutoInsert(imgs.map((src,i)=>({id:i,src,alt:`${keyword||selectedTitle} ${i===0?"대표":"현장"} 사진`})));
  }
  function handleRemoveAutoImages(){
    setBlocks(prev=>prev.filter(b=>b.type==="text"||(b.type==="image"&&(b as SingleImageBlock).source==="manual")));
    setAutoInserted(false);
  }

  // ── 네이버 복사 ──
  function addNaverImageMarkers(text:string):string{
    const hasReal=blocks.some(b=>(b.type==="image"&&(b as SingleImageBlock).src!==""));
    if(hasReal)return text;
    const lines=text.split("\n").map(l=>l.trim()).filter(l=>l.length>0);
    if(lines.length<=1)return text;
    const CHUNK=300;const chunks:string[]=[];let buf="";
    for(const line of lines.slice(1)){if(buf.length>0&&buf.length+line.length+1>CHUNK){chunks.push(buf.trim());buf=line;}else{buf=buf?buf+"\n"+line:line;}}
    if(buf.trim())chunks.push(buf.trim());
    const result:string[]=[lines[0]];
    for(const chunk of chunks){result.push("📸 [여기에 사진 삽입]");result.push(chunk);}
    return result.join("\n\n");
  }
  function buildNaverText(mode:"full"|"faq"|"body"):string{
    const lines:string[]=[];
    if(pubTitle.trim())lines.push(pubTitle.trim()+"\n");
    if(greeting.trim())lines.push(greeting.trim()+"\n");
    blocks.forEach(b=>{
      if(b.type==="text"){
        let c=(b as TextBlock).content;
        if(mode==="body")c=c.replace(/\[FAQ시작\][\s\S]*?\[FAQ끝\]/g,"").replace(/\[참고자료시작\][\s\S]*?\[참고자료끝\]/g,"").replace(/\[관련글시작\][\s\S]*?\[관련글끝\]/g,"").trim();
        else if(mode==="faq")c=c.replace(/\[참고자료시작\][\s\S]*?\[참고자료끝\]/g,"").replace(/\[관련글시작\][\s\S]*?\[관련글끝\]/g,"").trim();
        c=c.replace(/^#{1,3}\s+/gm,"").replace(/\*\*(.*?)\*\*/g,"$1").replace(/\*(.*?)\*/g,"$1");
        if(c)lines.push(c);
      }else if(b.type==="image"&&(b as SingleImageBlock).src){lines.push("[이미지]");}
    });
    if(hashtags.length>0)lines.push("\n"+hashtags.join(" "));
    return addNaverImageMarkers(lines.filter(Boolean).join("\n"));
  }
  function copyForNaver(){navigator.clipboard.writeText(buildNaverText("full"));}
  function copyForNaverWithFaq(){navigator.clipboard.writeText(buildNaverText("faq"));}
  function copyForNaverBodyOnly(){navigator.clipboard.writeText(buildNaverText("body"));}

  // ── HTML 빌더 ──
  function buildHtmlContent():string{
    function escHtml(t:string){return t.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");}
    function inlineFmt(t:string){return escHtml(t).replace(/\*\*(.+?)\*\*/g,"<strong>$1</strong>").replace(/\*(.+?)\*/g,"<em>$1</em>");}
    const parts:string[]=[];
    const sectionMarkerIdx=blocks.findIndex(b=>b.type==="text"&&((b as TextBlock).content.includes("[FAQ시작]")||(b as TextBlock).content.includes("[참고자료시작]")||(b as TextBlock).content.includes("[관련글시작]")));
    blocks.forEach((b,blockIdx)=>{
      const afterSection=sectionMarkerIdx!==-1&&blockIdx>=sectionMarkerIdx;
      if(b.type==="text"){
        const cleaned=(b as TextBlock).content.replace(/\[FAQ시작\][\s\S]*?\[FAQ끝\]/g,"").replace(/\[참고자료시작\][\s\S]*?\[참고자료끝\]/g,"").replace(/\[관련글시작\][\s\S]*?\[관련글끝\]/g,"").trim();
        if(cleaned){
          const html=cleaned.split("\n").map(line=>{
            const t=line.trim();if(!t)return"";
            if(/^##\s+/.test(t))return`<h2 style="font-size:20px;font-weight:800;margin:28px 0 12px;color:#111;border-bottom:2px solid #eee;padding-bottom:8px">${inlineFmt(t.replace(/^##\s+/,""))}</h2>`;
            if(/^###\s+/.test(t))return`<h3 style="font-size:17px;font-weight:700;margin:20px 0 8px;color:#1a1a1a;border-left:4px solid #2563eb;padding-left:10px">${inlineFmt(t.replace(/^###\s+/,""))}</h3>`;
            if(/^---+$/.test(t))return`<hr style="border:none;border-top:2px solid #eee;margin:20px 0">`;
            return`<p style="line-height:1.9;margin:0 0 14px;color:#333;font-size:16px">${inlineFmt(t)}</p>`;
          }).filter(Boolean).join("\n");
          if(html)parts.push(html);
        }
      }else if(b.type==="image"&&!afterSection){
        const src=(b as SingleImageBlock).src;const alt=(b as SingleImageBlock).alt;
        if(src)parts.push(`<div style="padding:24px 0"><figure style="margin:0;text-align:center"><img src="${escHtml(src)}" alt="${escHtml(alt||"")}" style="width:100%;border-radius:12px;display:block">${alt?`<figcaption style="font-size:12px;color:#888;text-align:center;margin-top:6px">${inlineFmt(alt)}</figcaption>`:""}</figure></div>`);
      }else if(b.type==="image-pair"&&!afterSection){
        const pair=(b as ImagePairBlock).images;
        if(pair&&pair.length>=2){
          parts.push(`<div style="padding:24px 0;display:grid;grid-template-columns:1fr 1fr;gap:8px"><figure style="margin:0"><img src="${escHtml(pair[0].src)}" alt="${escHtml(pair[0].alt||"")}" style="width:100%;border-radius:12px;display:block">${pair[0].alt?`<figcaption style="font-size:12px;color:#888;text-align:center;margin-top:6px">${inlineFmt(pair[0].alt)}</figcaption>`:""}</figure><figure style="margin:0"><img src="${escHtml(pair[1].src)}" alt="${escHtml(pair[1].alt||"")}" style="width:100%;border-radius:12px;display:block">${pair[1].alt?`<figcaption style="font-size:12px;color:#888;text-align:center;margin-top:6px">${inlineFmt(pair[1].alt)}</figcaption>`:""}</figure></div>`);
        }
      }
    });
    if(hashtags.length>0)parts.push(`<p style="margin-top:20px;color:#888;font-size:14px">${hashtags.join(" ")}</p>`);
    return parts.join("\n");
  }

  // ── 미리보기 렌더 ──
  function renderPreview(text:string):React.ReactElement[]{
    return text.split("\n").map((line,i)=>{
      if(line.startsWith("## "))return<h2 key={i} style={{fontSize:18,fontWeight:800,margin:"20px 0 8px",color:"var(--text)"}}>{line.slice(3)}</h2>;
      if(line.startsWith("### "))return<h3 key={i} style={{fontSize:16,fontWeight:700,margin:"16px 0 6px",color:"var(--text)"}}>{line.slice(4)}</h3>;
      if(line==="---")return<hr key={i} style={{border:"none",borderTop:"1px solid var(--border)",margin:"16px 0"}}/>;
      if(line==="")return<br key={i}/>;
      return<p key={i} style={{marginBottom:8,fontSize:14,lineHeight:1.8,color:"var(--text)"}}>{line}</p>;
    });
  }

  function handlePhotoUpload(files: FileList|null) {
    if(!files)return;
    const arr = Array.from(files).slice(0, 20 - photoFiles.length);
    arr.forEach(file=>{
      if(!file.type.startsWith("image/"))return;
      const reader = new FileReader();
      reader.onload = ev=>{
        const src = ev.target?.result as string;
        setPhotoFiles(prev=>{
          if(prev.length>=20)return prev;
          return [...prev,{id:Date.now().toString()+Math.random(),src,name:file.name}];
        });
      };
      reader.readAsDataURL(file);
    });
  }

  async function generateFromPhotos() {
    if(photoFiles.length===0){showToast("사진을 먼저 업로드해주세요","error");return;}
    const geminiKey=localStorage.getItem("publy_adm_gemini_key")||localStorage.getItem("publy_gemini_key")||"";
    if(!geminiKey){showToast("설정에서 Gemini API 키를 입력해주세요","error");return;}
    setPhotoGenerating(true);setPhotoGenDone(false);
    try {
      const imgParts = photoFiles.slice(0,10).map(f=>{
        const b64 = f.src.split(",")[1]||f.src;
        const mime = f.src.startsWith("data:image/png")?"image/png":"image/jpeg";
        return {inlineData:{mimeType:mime,data:b64}};
      });
      const keypointText = photoKeypoints.trim()?`\n\n[작성자 키포인트]\n${photoKeypoints.trim()}`:"";
      const styleGuide = WRITE_STYLE_GUIDE[writeStyle]||"";
      const personaGuide = PERSONA_STYLES.find(p=>p.id===persona)?.prompt||"";
      const prompt = `당신은 대한민국 최고의 블로그 작가입니다. 첨부된 사진들을 자세히 분석하여 네이버 블로그 글을 작성해주세요.\n사진 속 모든 디테일을 실제로 경험한 것처럼 생생하게 묘사해주세요.${keypointText}\n\n=== 절대 규칙 ===\n⛔ ## 기호 완전 금지\n⛔ ** * 마크다운 기호 금지\n⛔ AI 티 나는 표현 금지\n⛔ 영어 단어 금지\n✅ 사진에서 직접 보이는 것을 구체적으로 묘사\n✅ 독자에게 말 걸듯 친근하게\n✅ 구체적 수치, 가격, 시간 포함\n\n${styleGuide}${personaGuide?`\n[말투]\n${personaGuide}`:""}\n\n${AEO_RULES}\n\n=== 출력 형식 ===\n제목: (SEO 최적화 제목, 15~20자)\n태그: 태그1, 태그2, 태그3, 태그4, 태그5\n\n(본문 1500자 이상)\n\n${AEO_FAQ_FORMAT}\n\n[관련글시작]\nPOST1: (제목)|(이유)\nPOST2: (제목)|(이유)\n[관련글끝]`;

      // 서버 프록시 경유 시도 → 실패 시 직접 호출 폴백
      let text = "";
      try {
        const proxyR = await botFetch(`${BOT}/api/gemini-vision`, {
          method:"POST",
          headers:{"Content-Type":"application/json"},
          body:JSON.stringify({apiKey:geminiKey, parts:imgParts, prompt}),
          signal:AbortSignal.timeout(30000)
        });
        if(proxyR.ok){
          const proxyData = await proxyR.json();
          if(proxyData.text) text = proxyData.text;
        }
      } catch {}

      if(!text){
        const MODELS = ["gemini-2.5-flash","gemini-2.5-flash-lite","gemini-flash-latest","gemini-flash-lite-latest"];
        for(const model of MODELS){
          try{
            const genCfg:any={maxOutputTokens:8000,temperature:0.9};   // 사진글 길어서 8000·2.5 thinking 끄기
            if(model.startsWith("gemini-2.5")) genCfg.thinkingConfig={thinkingBudget:0};
            const bodyDirect = {contents:[{parts:[...imgParts,{text:prompt}]}],generationConfig:genCfg};
            const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(bodyDirect),signal:AbortSignal.timeout(120000)});
            if(!r.ok) continue;
            const d = await r.json();
            const c = d.candidates?.[0];
            const t = c?.content?.parts?.[0]?.text;
            if(t&&c?.finishReason!=="MAX_TOKENS"){text=t;break;}
          }catch{}
        }
      }
      if(!text) throw new Error("생성 실패. Gemini 키를 확인하거나 잠시 후 다시 시도해주세요.");
      const titleM = text.match(/제목[^\n]+/);
      const tagM = text.match(/태그[^\n]+/);
      const bodyM = text.match(/태그[^\n]*\n([\s\S]+)/);
      const title = titleM?.[0]?.replace(/^제목[:\s]*/,"").trim()||"사진으로 작성된 글";
      if(tagM){
        const tagStr = tagM[0].replace(/^태그[:\s]*/,"").trim();
        setPubTags(tagStr);
      }
      const body2 = bodyM?.[1]?.trim()||text;
      setGenContent(body2);setPubTitle(title);
      const rawBlocks = body2.split("\n\n").filter(Boolean).map((p:string)=>({type:"text" as const,id:Date.now().toString()+Math.random(),content:p}));
      setBlocks(rawBlocks.length>0?rawBlocks:[{type:"text" as const,id:Date.now().toString(),content:body2}]);
      if(photoFiles.length>0){
        const imgs = photoFiles.map((f,i)=>({id:i,src:f.src,alt:f.name.replace(/\.[^.]+$/,"")}));
        triggerAutoInsert(imgs);
        setThumbnail(photoFiles[0].src);
      }
      setQualityScore(calcQualityScore(body2, photoKeypoints.split(/[\s,]/)[0]||""));
      setPhotoGenDone(true);setAutoInserted(true);
      showToast("✅ 사진 기반 글 생성 완료!");
    } catch(e:any) {
      showToast("❌ 생성 실패: "+e.message+" (오류가 자동 전달됩니다)","error");logError({user_id:ADM_UID,user_name:"관리자",user_email:"",feature:"사진 글쓰기",error_message:e.message}).catch(()=>{});
    } finally {
      setPhotoGenerating(false);
    }
  }

  async function loadErrorLogs(userId?: string) {
    setErrorLogsLoading(true);
    setErrorLogsError("");
    try {
      const logs = await getErrorLogs(userId||undefined);
      setErrorLogs(logs);
    } catch (e:any) {
      setErrorLogs([]);
      setErrorLogsError(e.message || "오류 로그를 불러오지 못했습니다");
    } finally {
      setErrorLogsLoading(false);
    }
  }

  async function loadUnreadCount() {
    const count = await getUnreadErrorCount();
    setUnreadErrors(count);
  }

  async function handleMarkAllRead() {
    await markErrorsAsRead();
    setUnreadErrors(0);
    setErrorLogs(prev => prev.map(l => ({...l, is_read: true})));
  }

    function openPreview(){
    const sectionTags=["[FAQ시작]","[관련글시작]","[참고자료시작]"];
    const blocksHtml=blocks.map((b:any)=>{
      if(b.type==="text"){
        const txt=b.content||"";
        const secStart=sectionTags.reduce((min:number,tag:string)=>{const i=txt.indexOf(tag);return i>-1&&i<min?i:min;},Infinity);
        const body=secStart<Infinity?txt.slice(0,secStart).trim():txt;
        const sec=secStart<Infinity?txt.slice(secStart).trim():"";
        const toHtml=(t:string)=>t.split("\n").filter((l:string)=>l.trim()&&!sectionTags.some(tag=>l.includes(tag))).map((line:string)=>{
          if(line.startsWith("## "))return`<h2>${line.slice(3)}</h2>`;
          if(line.startsWith("### "))return`<h3>${line.slice(4)}</h3>`;
          if(line==="---")return`<hr/>`;
          return`<p>${line}</p>`;
        }).join("");
        return toHtml(body)+(sec?`<div class="section-box">${toHtml(sec)}</div>`:"");
      }
      return b.src?`<figure><img src="${b.src}" alt="${b.alt||""}"/>${b.alt?`<figcaption>${b.alt}</figcaption>`:""}</figure>`:"";
    }).join("");
    const tagsHtml=pubTags?`<div class="tags">${pubTags.split(",").map((t:string)=>`<span class="tag">${t.trim().startsWith("#")?t.trim():"#"+t.trim()}</span>`).join("")}</div>`:"";
    const html=`<!DOCTYPE html><html><head><meta charset="utf-8"><title>미리보기</title><style>*{box-sizing:border-box;margin:0;padding:0}body{background:#f5f5f5;font-family:'Apple SD Gothic Neo','Malgun Gothic',sans-serif;padding:20px}h1{font-size:24px;font-weight:900;color:#111;margin-bottom:16px;line-height:1.35;word-break:keep-all}.card{max-width:680px;margin:0 auto;background:#fff;border-radius:16px;padding:32px 28px;box-shadow:0 2px 12px rgba(0,0,0,.08)}h2{font-size:18px;font-weight:800;margin:24px 0 10px;color:#111;border-bottom:2px solid #eee;padding-bottom:8px}h3{font-size:15px;font-weight:700;margin:18px 0 8px;color:#222;border-left:4px solid #2563eb;padding-left:10px}p{margin:0 0 12px;font-size:15px;line-height:1.9;color:#333;word-break:keep-all}img{width:100%;border-radius:10px;display:block;margin:16px 0}figure{margin:16px 0}figcaption{font-size:11px;color:#999;text-align:center;margin-top:4px}.tags{margin-top:20px;display:flex;flex-wrap:wrap;gap:6px}.tag{font-size:12px;padding:3px 10px;border-radius:99px;background:#f0f4ff;color:#2563eb;font-weight:600}.section-box{margin-top:20px;padding:16px;background:#f8f8f8;border-radius:12px;border-left:4px solid #ddd}hr{border:none;border-top:1px solid #eee;margin:16px 0}</style></head><body><div class="card">${pubTitle?`<h1>${pubTitle}</h1>`:""}${pubImg?`<img src="${pubImg}" alt="썸네일"/>`:""}${blocksHtml}${tagsHtml}</div></body></html>`;
    if((window as any).electron?.openPreview){
      (window as any).electron.openPreview(html);
    } else {
      const w=window.open("","_blank","width=900,height=960,scrollbars=yes");
      if(w){w.document.write(html);w.document.close();}
    }
  }

  const checkBot = useCallback(async () => {
    try { const r = await botFetch(`${BOT}/health`,{signal:AbortSignal.timeout(3000)}); setBotOnline(r.ok); }
    catch { setBotOnline(false); }
  }, []);

  // 🔄 상단바 새로고침 — 눈에 보이게 반응(회전+토스트)하고 봇 상태 갱신 후 실제 새로고침
  const [refreshing, setRefreshing] = useState(false);
  const handleHeaderRefresh = useCallback(() => {
    if (refreshing) return;
    setRefreshing(true);
    showToast("🔄 최신 상태로 새로고침해요", "success");
    checkBot();
    setTimeout(() => window.location.reload(), 480);
  }, [refreshing, checkBot]);

  useEffect(() => {
    checkBot(); getAccounts(ADM_UID).then(setAdmAccs); loadUsers();
    getHistory(ADM_HISTORY_UID).then(setHistory).catch(e=>console.error("[관리자 발행기록] 로드 실패", e));
    loadUnreadCount();
    // 임시저장 확인
    try{const d=localStorage.getItem("publy_adm_draft");if(d){const p=JSON.parse(d);if(p.content&&p.title){setDraftAvailable(true);setDraftData(p);}}}catch{}
    const iv = setInterval(() => { checkBot(); loadUnreadCount(); }, 30000); return () => clearInterval(iv);
  }, [checkBot]);

  // 실시간 사용현황 로드
  const loadLiveUsage = useCallback(()=>{
    setLiveLoading(true);
    getAllDailyUsageToday().then(d=>{ setLiveUsage(d); setLiveUpdatedAt(new Date()); setLiveLoading(false); }).catch(()=>setLiveLoading(false));
  },[]);
  // 실시간 현황 탭: 진입 시 즉시 로드 + 자동(30초) 새로고침. 통계 탭도 진입 시 1회 로드(기능별 사용량 표시용)
  useEffect(()=>{
    if(tab==="stats"){ loadLiveUsage(); return; }
    // 회원관리 탭: 회원 카드의 '오늘 발행수/한도'를 위해 5초마다 실시간 갱신(초기화·발행 즉시 반영)
    if(tab==="users"){ loadLiveUsage(); const t=setInterval(loadLiveUsage,5000); return ()=>clearInterval(t); }
    if(tab!=="live") return;
    loadLiveUsage();
    // 📡 회원 로그 뷰어 폴링: 진행중 목록 + (선택 회원)그 회원 현재 로그를 3초마다 갱신
    const loadLogs = ()=>{ getRunningLiveLogs().then(rows=>setLogRunning(rows.filter(r=>r.is_running || (Date.now()-new Date(r.updated_at).getTime()<10*60000)))).catch(()=>{}); if(logUserId) getLiveLog(logUserId).then(setLogRow).catch(()=>{}); };
    loadLogs();
    if(!liveAuto) return;
    const t = setInterval(loadLiveUsage, 5000); // 실시간성 강화: 30초→5초
    const tl = setInterval(loadLogs, 3000);
    return ()=>{clearInterval(t);clearInterval(tl);};
  },[tab, liveAuto, loadLiveUsage, logUserId]);

  // ★관리 탭(서이추·공감·답방·지수)이 열려있는 동안 30초마다 최신 이력 자동 재로드(실시간 연동).
  //   회원이 서이추/공감/답방을 돌리면 관리자 화면이 새로고침 없이도 갱신된다.
  useEffect(()=>{
    const loaders: Record<string, ()=>void> = {
      neighbor_manage: ()=>{ getAllNeighborHistory().then(setNeighborHistory); },
      engage_manage:   ()=>{ getAllEngageHistory().then(setEngageHistory); },
      reply_manage:    ()=>{ getAllReplyHistory().then(setReplyHistory); },
      blogscore_manage:()=>{ getAllBlogscoreHistory().then(setBlogscoreHistory); },
    };
    const fn = loaders[tab];
    if(!fn) return;
    const iv = setInterval(fn, 30000);
    return ()=>clearInterval(iv);
  },[tab]);

  // 설정탭 열 때 관리자 네이버 키 로드
  useEffect(()=>{
    // 탭 열 때마다 최신 이력 로드(예전엔 length===0 조건 때문에 처음 한 번만 불러와 '최신 반영 안 됨' 버그)
    if(tab==="neighbor_manage"){
      if(neighborHistory.length === 0) setNeighborLoading(true);
      getAllNeighborHistory().then(d=>{ setNeighborHistory(d); setNeighborLoading(false); });
    }
    if(tab==="engage_manage"){
      if(engageHistory.length === 0) setEngageLoading(true);
      getAllEngageHistory().then(d=>{ setEngageHistory(d); setEngageLoading(false); });
    }
    if(tab==="reply_manage"){
      if(replyHistory.length === 0) setReplyLoading(true);
      getAllReplyHistory().then(d=>{ setReplyHistory(d); setReplyLoading(false); });
    }
    if(tab==="blogscore_manage"){
      if(blogscoreHistory.length === 0) setBlogscoreLoading(true);
      getAllBlogscoreHistory().then(d=>{ setBlogscoreHistory(d); setBlogscoreLoading(false); });
    }
    if(tab==="insta_dm" && dmTargets.length === 0){
      setDmLoading(true);
      getInstaDmTargets(ADM_UID).then(d=>{ setDmTargets(d); setDmLoading(false); });
    }
    if((tab==="insta_dm"||tab==="insta_dm_manage") && !localStorage.getItem("insta_dm_warn_hide")){
      setShowInstaWarn(true);
    }
    if(tab==="insta_dm_manage" && dmQuotas.length === 0){
      setDmManageLoading(true);
      Promise.all([getAllInstaDmHistory(), getAllInstaDmQuotas()]).then(([h,q])=>{
        setDmHistory(h); setDmQuotas(q); setDmManageLoading(false);
      });
    }
    if(tab==="settings"){
      // admin_ 접두사 키만 직접 조회
      const keys = ["naver_customer_id","naver_access_license","naver_secret_key","naver_datalab_client_id","naver_datalab_client_secret"];
      Promise.all(keys.map(k=>
        supabase.from("publy_settings").select("value").eq("key",`admin_${k}`).single()
          .then(({data})=>({k, v:data?.value||""}))
      )).then(results=>{
        const obj: NaverApiKeys = {};
        results.forEach(({k,v})=>{ if(v)(obj as any)[k]=v; });
        setAdminNaverKeys(obj);
      }).catch(()=>{});
    }
  },[tab]);

  async function loadUsers() {
    setLoading(true);
    const {data} = await supabase.from("publy_users").select("*").order("created_at",{ascending:false});
    if (!data) { setLoading(false); return; }
    const full = await Promise.all(data.map(async u => {
      const [{data:q},{data:p},{data:n},{count}] = await Promise.all([
        supabase.from("publy_quotas").select("*").eq("user_id",u.id).single(),
        supabase.from("publy_payments").select("*").eq("user_id",u.id).order("created_at",{ascending:false}).limit(20),
        supabase.from("publy_notes").select("*").eq("user_id",u.id).order("created_at",{ascending:false}).limit(20),
        supabase.from("publy_history").select("*",{count:"exact",head:true}).eq("user_id",u.id),
      ]);
      return {...u, quota:q||undefined, payments:p||[], notes:n||[], history_count:count||0};
    }));
    setUsers(full as UserFull[]); setLoading(false);
  }

  function exportToExcel() {
    const headers = ["이름","이메일","연락처","등급","활성여부","마지막 결제일","다음 결제일(만료일)","총 발행 건수","사용한 건수","남은 건수","발행 이력","마지막 접속","가입일","회원 ID"];
    const rows = users.map(u => {
      const lastPay = u.payments?.[0];
      return [
        u.name||"",
        u.email,
        u.phone||"",
        (PLAN_LABELS[u.plan]||u.plan).toUpperCase(),
        u.is_active?"활성":"비활성",
        lastPay?new Date(lastPay.created_at).toLocaleDateString("ko-KR"):"",
        u.quota?.reset_date?new Date(u.quota.reset_date).toLocaleDateString("ko-KR"):"",
        u.quota?.total_quota??0,
        u.quota?.used_quota??0,
        u.quota?.remaining_quota??0,
        u.history_count??0,
        u.last_seen?new Date(u.last_seen).toLocaleString("ko-KR"):"기록 없음",
        new Date(u.created_at).toLocaleDateString("ko-KR"),
        u.id,
      ];
    });
    // BOM + CSV (Excel에서 한글 깨짐 방지)
    const escape = (v:any)=>{const s=String(v!=null?v:"");return s.includes(",")||s.includes("\n")||s.includes('"')?`"${s.replace(/"/g,'""')}"`:s;};
    const csv="\uFEFF"+[headers,...rows].map(r=>r.map(escape).join(",")).join("\n");
    const blob=new Blob([csv],{type:"text/csv;charset=utf-8;"});
    const url=URL.createObjectURL(blob);
    const a=document.createElement("a");
    a.href=url;
    a.download=`publy_회원목록_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // 이미지 프롬프트 (KO_EN_MAP 축약 버전)
  // ─── 300+ 키워드 이미지 프롬프트 시스템 ────────────────────
  const NP_TAG = "no people, no person, no face, no human, no text, no watermark, safe for work, wholesome family-friendly, no violence, no weapons, no explicit or adult content, no real brand logos, no celebrities";
  const PROMPT_DB: {keywords:string[];prompt:string}[] = [
    {keywords:["한식","한정식","백반","집밥","가정식"],prompt:"Korean home-style meal spread, banchan side dishes, stone pot bibimbap, wooden table, steam rising, cozy restaurant, warm natural lighting"},
    {keywords:["맛집","식당","레스토랑","음식점","맛"],prompt:"cozy Korean restaurant interior, beautifully plated dishes on wooden table, ambient warm lighting, inviting atmosphere, bokeh"},
    {keywords:["삼겹살","고기","구이","바베큐","BBQ","갈비"],prompt:"Korean BBQ pork belly sizzling on grill, smoke rising, lettuce wraps, sesame oil, glowing charcoal, dark dramatic lighting"},
    {keywords:["회","횟집","사시미","해산물","해물"],prompt:"fresh Korean sashimi platter, colorful fish slices on ice, glistening presentation, premium seafood restaurant, cinematic"},
    {keywords:["초밥","스시","오마카세","일식"],prompt:"premium omakase sushi assortment, chef-crafted nigiri on wooden platter, minimalist Japanese restaurant, soft dramatic lighting"},
    {keywords:["스테이크","소고기","등심","ribeye","안심"],prompt:"perfectly seared ribeye steak, medium-rare interior, herb butter melting, fine dining plating, dramatic dark background"},
    {keywords:["파스타","이탈리안","피자","양식","스파게티"],prompt:"rustic Italian pasta dish, spaghetti with rich tomato sauce, fresh basil, parmesan, warm restaurant ambiance"},
    {keywords:["라면","라멘","국수","우동","소바"],prompt:"steaming bowl of Korean ramen, rich broth, soft egg, noodles, steam wisps, dark moody background, cinematic"},
    {keywords:["치킨","통닭","후라이드","양념치킨"],prompt:"crispy golden Korean fried chicken on wooden board, sauce cups, casual dining atmosphere, warm lighting"},
    {keywords:["피자","도우","화덕피자"],prompt:"artisan wood-fired pizza bubbling cheese, fresh toppings, rustic wooden table, Italian atmosphere"},
    {keywords:["버거","햄버거","샌드위치"],prompt:"gourmet burger juicy patty, fresh vegetables, sauce dripping, brioche bun, craft paper, casual dining"},
    {keywords:["카페","커피","아메리카노","라떼","에스프레소","카페인"],prompt:"cozy Korean cafe interior, latte art in ceramic cup, morning light through window, wooden table, minimalist"},
    {keywords:["빵","베이커리","크루아상","소금빵"],prompt:"artisan bakery display, golden croissants, fresh-baked bread, pastries, warm bakery interior, flour dusted"},
    {keywords:["케이크","디저트","마카롱","초콜릿","아이스크림"],prompt:"elegant dessert plating, layered chocolate cake, fresh berry garnish, marble surface, soft studio lighting"},
    {keywords:["빙수","팥빙수","설빙"],prompt:"Korean shaved ice bingsu, fluffy snow texture, red bean paste, condensed milk drizzle, pastel tones"},
    {keywords:["떡볶이","분식","순대","어묵","포장마차"],prompt:"Korean street food tteokbokki in red sauce, fish cakes, steam, night market atmosphere"},
    {keywords:["편의점","컵라면","야식","간식"],prompt:"Korean convenience store interior, colorful snack displays, late night warm glow, modern retail"},
    {keywords:["채식","비건","샐러드","건강식"],prompt:"vibrant vegan grain bowl, colorful vegetables, quinoa, avocado, hummus, white ceramic bowl, editorial"},
    {keywords:["브런치","아보카도","팬케이크","와플"],prompt:"weekend brunch spread, avocado toast, stacked pancakes with maple syrup, fresh fruit, white marble, morning light"},
    {keywords:["맥주","와인","술","주류","칵테일"],prompt:"artisan craft beer glass, golden bubbles, bar setting, warm amber lighting, premium beverage"},
    {keywords:["국","찌개","탕","설렁탕","감자탕"],prompt:"steaming Korean soup pot, rich broth, ingredients visible, ceramic bowl, restaurant wooden table, comfort food"},
    {keywords:["도시락","간편식","밀키트"],prompt:"beautifully arranged Korean lunch box bento, colorful vegetables, rice, clean minimal presentation"},
    {keywords:["제주도","제주","한라산","성산일출봉","우도"],prompt:"Jeju island volcanic coastline, dramatic black lava rocks, turquoise ocean waves, Hallasan mountain backdrop, golden hour"},
    {keywords:["부산","해운대","광안리","남포동","감천"],prompt:"Busan Gwangalli beach at sunset, Gwangan Bridge illuminated, warm golden reflection on water, cinematic"},
    {keywords:["서울","경복궁","남산","한강","명동"],prompt:"Seoul cityscape at dusk, Namsan tower glowing, Han River reflection, modern skyscrapers meets traditional palace"},
    {keywords:["경주","불국사","첨성대","신라"],prompt:"ancient Gyeongju Bulguksa temple, cherry blossoms, stone lanterns, misty morning atmosphere, UNESCO heritage"},
    {keywords:["전주","한옥마을"],prompt:"Jeonju Hanok village, traditional Korean architecture, tile roofs, stone paths, warm golden afternoon light"},
    {keywords:["강원","강릉","속초","설악산","동해"],prompt:"Seoraksan mountain peaks with autumn foliage, dramatic rocky cliffs, crisp mountain air, editorial"},
    {keywords:["일본","도쿄","오사카","교토","후쿠오카"],prompt:"Kyoto traditional street at twilight, lantern-lit cobblestone alley, cherry blossom petals, cinematic"},
    {keywords:["유럽","파리","로마","스페인","런던","프랑스"],prompt:"Paris street at golden hour, Eiffel Tower in distance, café tables, warm European ambiance, cobblestone"},
    {keywords:["동남아","베트남","태국","발리","싱가포르"],prompt:"Bali tropical infinity pool overlooking lush jungle, lotus flowers, temple offerings, golden sunset"},
    {keywords:["미국","뉴욕","LA","하와이"],prompt:"Manhattan skyline at blue hour, skyscrapers reflected in Hudson River, city lights, dramatic urban"},
    {keywords:["캠핑","글램핑","텐트","야외","아웃도어"],prompt:"luxury glamping tent in forest clearing, warm lantern glow, campfire embers, starry night sky, misty morning"},
    {keywords:["호텔","리조트","숙소","펜션","풀빌라"],prompt:"luxury hotel suite interior, king bed with crisp white linens, floor-to-ceiling window with city view, elegant"},
    {keywords:["여행준비","패킹","캐리어","배낭여행"],prompt:"open suitcase with neatly packed clothes, travel accessories, passport, camera, clean flat lay on white bed"},
    {keywords:["국내여행","드라이브","도로여행","차박"],prompt:"scenic Korean coastal highway, road trip, mountain pass, autumn foliage, blue sky, freedom"},
    {keywords:["다이어트","체중감량","살빼기","체중조절"],prompt:"clean healthy meal prep bowls, colorful vegetables, measuring tape, fresh ingredients, bright kitchen, weight loss"},
    {keywords:["운동","헬스","헬스장","피트니스","gym"],prompt:"modern gym interior, barbell rack, dumbbells, exercise equipment, motivating atmosphere, early morning light"},
    {keywords:["요가","필라테스","스트레칭"],prompt:"yoga studio with morning light, warrior pose on mat, peaceful atmosphere, plants, minimal decor"},
    {keywords:["러닝","마라톤","조깅","달리기"],prompt:"runner silhouette at sunrise on empty road, morning mist, dynamic motion, motivational editorial"},
    {keywords:["피부","스킨케어","화장품","로션","에센스"],prompt:"luxury skincare product flat lay, serum bottles, jade roller, white marble, morning light, K-beauty aesthetic"},
    {keywords:["탈모","모발","두피","샴푸"],prompt:"healthy thick hair close-up, shampoo foam, bathroom natural lighting, clean fresh aesthetic"},
    {keywords:["성형","시술","피부과","의원","클리닉"],prompt:"modern medical clinic interior, clean white aesthetic, professional equipment, trust and care atmosphere"},
    {keywords:["영양제","비타민","건강기능식품","보충제"],prompt:"supplement capsules and vitamins on white surface, green plant, morning light, health wellness aesthetic"},
    {keywords:["수면","불면증","숙면","수면습관"],prompt:"cozy bedroom at night, soft bedside lamp, fluffy white pillows, peaceful sleep environment, blue hour"},
    {keywords:["스트레스","번아웃","힐링","멘탈"],prompt:"serene nature meditation spot, calm lake, misty morning, tranquility, mental wellness atmosphere"},
    {keywords:["당뇨","혈당","혈압","심장","혈관"],prompt:"fresh healthy foods for diabetes management, whole grains, vegetables, fruit, blood glucose monitor"},
    {keywords:["치아","치과","구강","칫솔"],prompt:"dental care flat lay, toothbrush, floss, mouthwash, white background, clean clinical aesthetic"},
    {keywords:["병원","진료","의료","건강검진"],prompt:"modern hospital corridor, clean professional healthcare, trust and expertise, bright clinical lighting"},
    {keywords:["주식","주식투자","증권","코스피","코스닥"],prompt:"stock market candlestick chart on monitor, trading platform, financial data visualization, dark professional"},
    {keywords:["코인","비트코인","가상화폐","NFT","블록체인"],prompt:"golden bitcoin coins, blockchain network visualization, digital currency concept, blue neon tech aesthetic"},
    {keywords:["부동산","아파트","투자","분양","청약"],prompt:"modern Korean apartment complex aerial view, urban cityscape, real estate development, sunset reflection"},
    {keywords:["재테크","돈","저축","절약","금융"],prompt:"Korean won bills and coins arranged neatly, piggy bank, growth chart, financial planning, clean white background"},
    {keywords:["ETF","펀드","적금","예금","금리"],prompt:"financial investment growth concept, ascending bar chart, coins stacking, plant growing from money, prosperity"},
    {keywords:["사업","창업","스타트업","사업자","CEO"],prompt:"modern startup office, whiteboard with business plan, team collaboration energy, contemporary workspace"},
    {keywords:["프리랜서","부업","N잡러","재택근무"],prompt:"home office setup, laptop on clean desk, plants, natural window light, productive remote work"},
    {keywords:["AI","인공지능","ChatGPT","GPT","클로드"],prompt:"artificial intelligence neural network visualization, futuristic blue light, data streams, tech concept"},
    {keywords:["스마트폰","아이폰","갤럭시","핸드폰"],prompt:"premium smartphone on minimal surface, app interface glow, clean tech product photography"},
    {keywords:["노트북","맥북","컴퓨터","PC"],prompt:"MacBook Pro on clean minimal desk, code on screen, soft ambient lighting, developer workspace"},
    {keywords:["코딩","프로그래밍","개발","개발자"],prompt:"dark mode code editor screen, colorful syntax highlighting, developer keyboard, multiple monitors"},
    {keywords:["유튜브","유튜버","영상","콘텐츠","크리에이터"],prompt:"YouTube creator studio setup, ring light, camera, microphone, content creation workspace, professional"},
    {keywords:["인스타","SNS","소셜미디어","틱톡"],prompt:"social media content creation, smartphone photography setup, aesthetic flat lay, influencer lifestyle"},
    {keywords:["게임","게이밍","PC방","플스","닌텐도"],prompt:"gaming setup with RGB lighting, multiple monitors, mechanical keyboard, competitive esports atmosphere"},
    {keywords:["임신","출산","태교","임산부"],prompt:"soft nursery room preparation, baby items, gentle morning light, pastel colors, tender atmosphere"},
    {keywords:["육아","아기","신생아","돌잔치"],prompt:"adorable baby toys on soft pastel blanket, tiny shoes, teddy bear, warm nursery, gentle light"},
    {keywords:["유아","어린이","아이","유치원"],prompt:"colorful children learning environment, educational toys, ABC blocks, watercolor paintings, bright playful space"},
    {keywords:["공부","수능","입시","학원","과외"],prompt:"student study desk with books, stationery, planner, focused learning, warm desk lamp"},
    {keywords:["영어","영어공부","어학","토익","토플"],prompt:"language learning setup, English textbooks, headphones, notebook with vocabulary, coffee, productive study"},
    {keywords:["인테리어","인테리어디자인","집꾸미기","홈데코"],prompt:"beautifully designed Korean apartment interior, minimalist Scandinavian style, plants, warm natural tones"},
    {keywords:["청소","정리","수납","정돈","미니멀"],prompt:"perfectly organized closet with coordinated items, minimalist Korean home, clean aesthetic"},
    {keywords:["강아지","댕댕이","dog","puppy"],prompt:"fluffy golden retriever puppy in Korean home garden, playful expression, soft natural light, adorable"},
    {keywords:["고양이","냥이","cat","kitty"],prompt:"elegant cat lounging on window sill, soft afternoon sunbeam, bokeh background, peaceful domestic"},
    {keywords:["반려동물","펫","애완"],prompt:"loving pet care scene, cozy home with happy pet, warm domestic life, lifestyle photography"},
    {keywords:["독서","책","서재","도서관"],prompt:"cozy reading nook with books, warm lamp light, coffee cup, wooden shelves, peaceful literary atmosphere"},
    {keywords:["가드닝","정원","식물","화분","홈가드닝"],prompt:"lush indoor plant collection, botanical home aesthetic, morning light through leaves, terra cotta pots"},
    {keywords:["요리","쿠킹","홈쿠킹","레시피"],prompt:"home cooking preparation, fresh ingredients on wooden cutting board, kitchen lifestyle, warm"},
    {keywords:["패션","옷","코디","스타일링","OOTD"],prompt:"Korean fashion street style flat lay, seasonal outfit coordination, accessories, clean white background"},
    {keywords:["명품","가방","지갑","액세서리","주얼리"],prompt:"luxury handbag editorial, leather texture, branded accessories, marble surface, premium lifestyle"},
    {keywords:["화장","메이크업","립스틱","뷰티"],prompt:"K-beauty makeup flat lay, cosmetic products arranged artfully, rose gold accents, mirror, beauty editorial"},
    {keywords:["향수","perfume","프래그런스"],prompt:"luxury perfume bottle on marble surface, light refraction, soft bokeh, elegant fragrance photography"},
    {keywords:["네일","네일아트","네일샵"],prompt:"artistic nail art close-up, intricate designs, gel polish, hands on marble, beauty editorial"},
    {keywords:["헤어","헤어스타일","미용실","염색","펌"],prompt:"Korean hair salon interior, glossy healthy hair, professional care, bright modern salon"},
    {keywords:["자동차","신차","차","차량"],prompt:"sleek modern sedan on mountain road, dramatic landscape, automotive photography, golden hour"},
    {keywords:["전기차","EV","테슬라","아이오닉"],prompt:"electric vehicle charging station, clean energy concept, modern EV design, sustainable future"},
    {keywords:["SUV","4WD","오프로드"],prompt:"powerful SUV on mountain trail, rugged terrain, adventure lifestyle, dramatic sky"},
    {keywords:["골프","골프장","골프채","필드"],prompt:"golf course at sunrise, morning mist over fairway, lush green grass, dramatic landscape, premium sport"},
    {keywords:["등산","트레킹","산행","백패킹"],prompt:"hiker on Korean mountain summit, vast panoramic view, autumn foliage, achievement, dramatic sky"},
    {keywords:["자전거","사이클","MTB"],prompt:"cyclist on scenic riverside path at sunrise, motion and speed, Korean landscape, freedom"},
    {keywords:["취업","구직","이력서","면접"],prompt:"professional Korean job interview setting, confident candidate, modern office, career opportunity"},
    {keywords:["직장","회사","사무실","직장인"],prompt:"modern Korean office interior, collaborative workspace, professionals working, clean contemporary"},
    {keywords:["이직","커리어","경력"],prompt:"career growth concept, ascending staircase, professional development, business success, ambition"},
    {keywords:["봄","벚꽃","봄꽃","개나리","튤립"],prompt:"Korean spring cherry blossom path, soft pink petals falling, warm sunlight through branches, dreamy"},
    {keywords:["여름","바다","해수욕장","여름휴가"],prompt:"Korean summer beach, crystal clear water, white sand, golden hour sunlight, vacation mood"},
    {keywords:["가을","단풍","추석","단풍여행"],prompt:"Korean autumn forest, vibrant red and orange foliage, misty mountain morning, fallen leaves path"},
    {keywords:["겨울","눈","스키장","크리스마스"],prompt:"winter wonderland snowscape, frost on pine trees, soft blue twilight, peaceful Korean winter"},
    {keywords:["자기계발","성장","동기부여","목표","습관"],prompt:"morning routine motivation, sunrise through window, journal and coffee, goal setting, fresh productive start"},
    {keywords:["명상","마음챙김","힐링","치유"],prompt:"peaceful meditation space, serene pose, soft morning light, minimalist zen atmosphere, calm"},
    {keywords:["영화","OTT","넷플릭스","드라마"],prompt:"cozy home cinema setup, dark room with large screen glow, popcorn, blanket, movie night"},
    {keywords:["음악","콘서트","공연","아이돌","K-pop"],prompt:"concert stage with dramatic lighting, spotlights, smoke effects, electric atmosphere, performance energy"},
    {keywords:["환경","친환경","제로웨이스트","지속가능"],prompt:"eco-friendly lifestyle flat lay, reusable items, green plants, sustainable products, earth-tone"},
    {keywords:["애드포스트","블로그수익","네이버블로그","수익화"],prompt:"blogger workspace with laptop showing analytics, coffee, notebook, Korean lifestyle content creator setup, warm"},
    {keywords:["애드센스","구글","SEO","검색노출"],prompt:"SEO analytics dashboard on monitor, digital marketing workspace, growth charts, professional setup"},
  ];

  function buildImagePrompt(kw: string, title: string = "", idx: number = 0, segmentContent?: string): string {
    const k = segmentContent
      ? (kw + " " + title + " " + segmentContent.slice(0, 100)).toLowerCase()
      : (kw + " " + title).toLowerCase();
    const st = adType === "adpost"
      ? "Korean lifestyle photography, warm emotional, soft natural light"
      : "ultra realistic DSLR 8K magazine editorial photography";
    const sorted = [...PROMPT_DB].sort((a,b) => b.keywords.join("").length - a.keywords.join("").length);
    for (const entry of sorted) {
      if (entry.keywords.some(kw2 => k.includes(kw2))) {
        let p = entry.prompt;
        if (idx === 1) p = p.replace(/warm natural lighting|morning light|warm lighting|warm/g, "golden hour afternoon light");
        if (idx === 2) p = p.replace(/warm natural lighting|morning light|warm lighting|warm/g, "dramatic blue hour lighting");
        if (idx === 3) p = p.replace(/warm natural lighting|morning light|warm lighting|warm/g, "soft overcast diffused light");
        return `${p}, ${NP_TAG}, ${st}`;
      }
    }
    const CATS: [RegExp, string][] = [
      [/먹|맛|식당|음식|요리|카페|커피|레스토랑|맛집|디저트|베이커리|밥|국|찌개|술|맥주|와인|소주|막걸리/, `stunning Korean food photography, beautifully plated gourmet dish, vibrant fresh ingredients, professional food styling, ${NP_TAG}`],
      [/여행|관광|투어|trip|호텔|숙소|제주|부산|해외|유럽|일본|동남아|캠핑|글램핑|아웃도어|트레킹/, `breathtaking travel destination, majestic scenic landscape, dramatic sky, golden hour atmosphere, ${NP_TAG}`],
      [/주식|펀드|선물|옵션|채권|ETF|코인|암호화폐|트레이딩|차트|증권|배당|퀀트/, `professional financial trading concept, stock market charts, data visualization, clean workspace, ${NP_TAG}`],
      [/보험|연금|퇴직|적금|예금|저축|재테크|투자|경제|수익|부자|부업|프리랜서|애드센스|블로그수익/, `sophisticated financial planning concept, premium documents and calculator, aspirational wealth aesthetic, ${NP_TAG}`],
      [/건강|운동|fitness|헬스|요가|필라테스|러닝|수영|자전거|체중|다이어트|diet/, `motivating healthy lifestyle, wellness equipment, energizing fresh ingredients, bright minimal aesthetic, ${NP_TAG}`],
      [/의료|병원|의사|약|의약품|치료|간호|한의원|제약|바이오|헬스케어/, `clean medical healthcare concept, professional stethoscope and equipment, sterile clinical aesthetic, ${NP_TAG}`],
      [/피부|뷰티|스킨케어|화장|메이크업|헤어|네일|미용|세럼|크림|화장품/, `luxurious beauty skincare flat lay, premium cosmetic products on marble, dewy glowing texture, ${NP_TAG}`],
      [/패션|옷|스타일|코디|ootd|아우터|가방|명품|쇼핑|브랜드/, `stylish fashion editorial flat lay, trendy clothing and accessories, urban chic aesthetic, ${NP_TAG}`],
      [/집|방|인테리어|아파트|가구|리모델링|청소|정리|수납|홈데코/, `stunning modern Korean home interior, thoughtfully curated furniture, warm cozy atmosphere, ${NP_TAG}`],
      [/건축|건설|부동산|땅|분양|임대|전세|월세|재건축|도시개발/, `professional architecture real estate concept, modern building blueprint, urban development aesthetic, ${NP_TAG}`],
      [/농업|농장|농촌|농산물|채소|과일|쌀|밀|텃밭|스마트팜|유기농/, `beautiful farm and agriculture photography, fresh organic produce, countryside pastoral aesthetic, ${NP_TAG}`],
      [/수산업|어업|수산물|생선|해산물|굴|새우|랍스터|참치|연어|양식/, `fresh seafood and fisheries concept, glistening ocean products on ice, coastal market aesthetic, ${NP_TAG}`],
      [/육류|육가공|정육|소고기|돼지고기|닭고기|햄|소시지|정육점/, `premium meat and butchery concept, quality cuts on wooden board, rustic professional food styling, ${NP_TAG}`],
      [/유통|물류|배송|창고|SCM|택배|운송|화물|항만|수출|수입|무역/, `modern logistics and supply chain concept, warehouse shelves, delivery and shipping aesthetic, ${NP_TAG}`],
      [/제조|공장|생산|가공|조립|금속|철강|기계|설비|산업|자동화/, `industrial manufacturing concept, precision machinery and equipment, clean factory aesthetic, ${NP_TAG}`],
      [/화학|석유|에너지|전력|태양광|풍력|수소|배터리|반도체|원자력|신재생/, `energy and materials science concept, clean technology visualization, innovation aesthetic, ${NP_TAG}`],
      [/과학|연구|실험|물리|생물|quantum|퀀텀|파동|나노|우주|천문/, `professional scientific research concept, laboratory equipment, precise academic aesthetic, ${NP_TAG}`],
      [/법률|법무|변호사|소송|계약|세무|회계|감사|컴플라이언스/, `professional legal compliance concept, clean document arrangement, authoritative academic aesthetic, ${NP_TAG}`],
      [/교육|학원|공부|강의|수업|학습|입시|자격증|직업훈련|온라인교육/, `inspiring education concept, organized study materials and books, clean learning environment, ${NP_TAG}`],
      [/마케팅|광고|홍보|브랜딩|sns|소셜미디어|콘텐츠|유튜브|인스타|미디어|방송/, `creative marketing and media concept, brand elements on clean workspace, content creation aesthetic, ${NP_TAG}`],
      [/스타트업|창업|사업|경영|비즈니스|기업|CEO|리더십|벤처|혁신/, `dynamic startup and business concept, innovative workspace, entrepreneurial vision, modern corporate, ${NP_TAG}`],
      [/자동차|차량|드라이브|전기차|수입차|SUV|오토바이|바이크/, `dramatic automotive photography, sleek vehicle design detail, dynamic angles, premium surfaces, ${NP_TAG}`],
      [/스포츠|축구|야구|농구|골프|테니스|스키|서핑|클라이밍/, `energetic sports equipment flat lay, athletic gear artfully arranged, performance aesthetic, ${NP_TAG}`],
      [/기술|tech|AI|인공지능|컴퓨터|스마트폰|앱|IT|아이폰|아이패드|노트북|게임|드론/, `cutting-edge technology concept, sleek device on minimal surface, digital innovation aesthetic, ${NP_TAG}`],
      [/봄|여름|가을|겨울|자연|꽃|풍경|숲|바다|산|식물|원예|정원/, `breathtaking Korean seasonal nature, pristine landscape, vivid natural colors, serene atmosphere, ${NP_TAG}`],
      [/환경|친환경|제로웨이스트|탄소중립|ESG|재활용|생태계/, `eco-friendly sustainability concept, green products and plants, earth-tone natural aesthetic, ${NP_TAG}`],
      [/음악|악기|노래|피아노|기타|드럼|클래식|K팝|밴드/, `artistic music concept, beautiful instrument flat lay, creative studio aesthetic, ${NP_TAG}`],
      [/미술|그림|디자인|영화|드라마|공연|전시|갤러리|예술|창작/, `creative arts concept, artist tools elegantly arranged, gallery inspirational aesthetic, ${NP_TAG}`],
      [/종교|불교|기독교|명상|영성|철학|심리|힐링|치유/, `peaceful meditation spiritual concept, serene candles and nature, calm mindful aesthetic, ${NP_TAG}`],
      [/아이|육아|아기|어린이|임신|출산|유아|초등|교육|공부|입시/, `warm family educational concept, child-friendly environment, soft pastel tones, learning materials, ${NP_TAG}`],
      [/강아지|고양이|반려동물|pet|puppy|햄스터|앵무새|수족관/, `adorable pet care flat lay, pet accessories and products, soft heartwarming background, ${NP_TAG}`],
      [/결혼|웨딩|신혼|프로포즈|부케|예식|혼수|청첩장/, `romantic wedding concept, elegant floral arrangement, soft dreamy lighting, bridal aesthetic, ${NP_TAG}`],
    ];
    for (const [re, prompt] of CATS) {
      if (re.test(k)) return `${prompt}, ${st}`;
    }
    return `beautiful Korean lifestyle blog editorial photography, professional composition, warm aesthetic, ${NP_TAG}, ${st}`;
  }

  function parseArr(text: string): string[] {
    const clean = text.replace(/```json|```/gi,"").trim();
    try { const m = clean.match(/\[[\s\S]*\]/); if (m) { const p = JSON.parse(m[0]); if (Array.isArray(p)) return p.map(String).filter(t=>t.length>3); } } catch {}
    try { const p = JSON.parse(clean); if (Array.isArray(p)) return p.map(String).filter(t=>t.length>3); } catch {}
    return clean.split("\n").map(l=>l.replace(/^[\d]+[).\s]+|^[-*•\s]+/,"").replace(/^[\s"']+|[\s"']+$/g,"").trim()).filter(l=>l.length>4&&l.length<100);
  }

  // ★키워드 형태 통일(제목·본문 공통) — 입력 키워드를 입력한 형태 그대로 일정하게(띄어쓰기까지). 상위노출용.
  function enforceExactKeyword(text:string, kw:string):string {
    const exact=(kw||"").trim();
    const bare=exact.replace(/\s/g,"");
    if(!exact||bare.length<2) return text;
    const esc=(c:string)=>c.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
    const pattern=bare.split("").map(esc).join("\\s*");
    try{ return text.replace(new RegExp(pattern,"g"), exact); }catch{ return text; }
  }
  const kwCountOf=(s:string, kw:string):number=>{
    const bare=(kw||"").replace(/\s/g,""); if(bare.length<2) return 0;
    const esc=(c:string)=>c.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
    try{ return (s.match(new RegExp(bare.split("").map(esc).join("\\s*"),"g"))||[]).length; }catch{ return 0; }
  };
  // ★키워드 횟수 보장(제목·본문 완성) — 형태통일→부족시 AI재요청→최후 문장보충. 상위노출 목적.
  async function ensureKeywordCount(text:string, kw:string, min=5):Promise<string>{
    const exact=(kw||"").trim(); if(!exact||exact.replace(/\s/g,"").length<2) return text;
    let out=enforceExactKeyword(text,exact);
    if(kwCountOf(out,exact)>=min) return out;
    try{
      const ask=`아래 블로그 글을 내용·길이·문단 구성 거의 그대로 유지하되, 핵심 키워드 "${exact}"가 글 전체에서 정확히 ${min}~${min+1}번 나오도록 자연스럽게 문장 몇 곳만 다듬어줘. 키워드는 반드시 "${exact}" 형태 그대로(띄어쓰기까지 동일). 마크다운·설명 없이 완성된 본문만 출력.\n\n[글]\n${out}`;
      const re=enforceExactKeyword(stripMarkdown(await callAI(ask)).trim(), exact);
      if(re.length>=Math.min(200,out.length*0.7) && kwCountOf(re,exact)>kwCountOf(out,exact)) out=re;
      if(kwCountOf(out,exact)>=min) return out;
    }catch{}
    const fillers=[`${exact} 찾으시는 분들께 도움이 됐길 바라요.`,`${exact} 관련해 궁금한 점은 댓글로 남겨주세요.`,`${exact} 준비하실 때 이 글이 참고가 되면 좋겠어요.`,`${exact} 더 알아보고 싶다면 저장해두고 다시 보셔도 좋아요.`];
    let i=0;
    while(kwCountOf(out,exact)<min && i<6){ out=out.trimEnd()+`\n\n${fillers[i%fillers.length]}`; i++; }
    return out;
  }
  function stripMarkdown(text: string): string {
    const markers = ["[FAQ시작]","[FAQ끝]","[관련글시작]","[관련글끝]"];
    const ph: [string,string][] = markers.map((m,i) => [`XMARK${i}X`,m]);
    ph.forEach(([k,v]) => { text = text.split(v).join(k); });
    const h2s: string[] = [];
    text = text.replace(/^## .+$/gm, m => { const i = h2s.length; h2s.push(m); return `XH2${i}X`; });
    text = text.replace(/[一-鿿㐀-䶿]/g,"").replace(/[\u3040-\u30FF]/g,"")
      .replace(/[^\uAC00-\uD7A3a-zA-Z0-9\s.,!?;:()\-\'".\[\]%@#&+=/\\~`|<>{}^_$\n]/g,"")
      .replace(/\*{2,}/g,"").replace(/^#{3,}\s+/gm,"").replace(/^[-*]\s+/gm,"")
      .replace(/_{2,}/g,"").replace(/ {2,}/g," ").replace(/\n{3,}/g,"\n\n").trim();
    h2s.forEach((line,i) => { text = text.split(`XH2${i}X`).join(line); });
    ph.forEach(([k,v]) => { text = text.split(k).join(v); });
    return text;
  }

  function getCategoryGuide(kw: string, title: string): string {
    const k = (kw + " " + title).toLowerCase();
    if (/맛집|음식|카페|식당|요리|커피/.test(k)) return "[맛집/음식]\n- 직접 방문한 것처럼: 분위기, 맛, 가격\n- 단점도 솔직하게";
    if (/여행|관광|호텔|숙소/.test(k)) return "[여행]\n- 교통편, 비용, 소요시간\n- 꼭 가야 할 명소, 현지 맛집";
    if (/건강|다이어트|운동|피부/.test(k)) return "[건강]\n- 전문 용어 쉽게 풀이\n- 집에서 가능 vs 병원 필요 구분";
    if (/재테크|투자|주식|금융/.test(k)) return "[재테크]\n- 초보자도 이해하는 설명\n- 실제 숫자 예시 포함";
    return "[정보/일상]\n- 독자가 몰랐던 새로운 정보\n- 일상에서 바로 써먹는 팁";
  }

  async function callAI(prompt: string): Promise<string> {
    const ai = localStorage.getItem("publy_adm_write_ai") || "gemini";
    if (ai === "gemini") {
      const key = localStorage.getItem("publy_adm_gemini_key") || ""; if (!key) throw new Error("Gemini API 키 없음 (관리자 설정에서 입력하세요)");
      for (const model of GEMINI_MODELS_ADM) {
        try {
          const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
            {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({contents:[{parts:[{text:prompt}]}],generationConfig:{maxOutputTokens:8000}}),signal:AbortSignal.timeout(60000)});
          if (!r.ok) continue;
          const d = await r.json(); const t = d.candidates?.[0]?.content?.parts?.[0]?.text||""; if (t) return t;
        } catch { continue; }
      }
      throw new Error("Gemini 실패");
    }
    if (ai === "groq") {
      const key = localStorage.getItem("publy_adm_groq_key") || ""; if (!key) throw new Error("Groq API 키 없음 (관리자 설정에서 입력하세요)");
      const r = await fetch("https://api.groq.com/openai/v1/chat/completions",{method:"POST",headers:{"Content-Type":"application/json","Authorization":`Bearer ${key}`},body:JSON.stringify({model:"llama-3.3-70b-versatile",max_tokens:8000,messages:[{role:"user",content:prompt}]}),signal:AbortSignal.timeout(60000)});
      if (!r.ok) { const e = await r.json(); throw new Error(e.error?.message||"Groq 오류"); }
      const d = await r.json(); return d.choices?.[0]?.message?.content||"";
    }
    if (ai === "openai") {
      const key = localStorage.getItem("publy_adm_openai_key") || ""; if (!key) throw new Error("OpenAI API 키 없음 (관리자 설정에서 입력하세요)");
      const r = await fetch("https://api.openai.com/v1/chat/completions",{method:"POST",headers:{"Content-Type":"application/json","Authorization":`Bearer ${key}`},body:JSON.stringify({model:"gpt-4o",max_tokens:8000,messages:[{role:"user",content:prompt}]}),signal:AbortSignal.timeout(60000)});
      if (!r.ok) { const e = await r.json(); throw new Error(e.error?.message||"OpenAI 오류"); }
      const d = await r.json(); return d.choices?.[0]?.message?.content||"";
    }
    throw new Error("AI 미선택");
  }

  async function generateImage(kw: string, title: string = "", idx: number = 0, segmentContent?: string): Promise<string> {
    const imgPrompt = buildImagePrompt(kw, title, idx, segmentContent);
    const ai = localStorage.getItem("publy_adm_image_ai") || "openai_img";
    if (ai === "openai_img") {
      const key = localStorage.getItem("publy_adm_openai_key") || ""; if (!key) throw new Error("OpenAI 키 없음");
      const r = await fetch("https://api.openai.com/v1/images/generations",{method:"POST",headers:{"Content-Type":"application/json","Authorization":`Bearer ${key}`},body:JSON.stringify({model:"dall-e-3",prompt:imgPrompt,n:1,size:"1024x1024"}),signal:AbortSignal.timeout(60000)});
      if (!r.ok) { const e = await r.json(); throw new Error("DALL-E: "+(e.error?.message||r.status)); }
      const d = await r.json(); return d.data?.[0]?.url||"";
    }
    if (ai === "replicate") {
      const key = localStorage.getItem("publy_adm_replicate_key") || ""; if (!key) throw new Error("Replicate 키 없음");
      const pr = await fetch("https://api.replicate.com/v1/models/black-forest-labs/flux-schnell/predictions",{method:"POST",headers:{"Content-Type":"application/json","Authorization":`Bearer ${key}`},body:JSON.stringify({input:{prompt:imgPrompt,num_outputs:1,aspect_ratio:"16:9"}}),signal:AbortSignal.timeout(30000)});
      if (!pr.ok) { const e = await pr.json(); throw new Error("Replicate: "+(e.detail||pr.status)); }
      const pred = await pr.json(); const pollUrl = pred.urls?.get; if (!pollUrl) throw new Error("Replicate 응답 오류");
      for (let i = 0; i < 30; i++) { await new Promise(r=>setTimeout(r,2000)); const res = await fetch(pollUrl,{headers:{"Authorization":`Bearer ${key}`}}); const data = await res.json(); if (data.status==="succeeded") return data.output?.[0]||""; if (data.status==="failed") throw new Error("Replicate 실패"); }
      throw new Error("Replicate 타임아웃");
    }
    throw new Error("이미지 AI 미선택");
  }

  function recommendImageCount(content: string): number { return Math.max(1, Math.min(10, Math.floor(content.length/500))); }

  function buildAdmFlowPrompt(kw: string, title: string = "", content: string = "", idx: number = 0): string {
    const k = (kw + " " + title).toLowerCase();
    const c = content.slice(0, 500).toLowerCase();
    const lightings = [
      "soft golden hour natural lighting, warm sunlight filtering through",
      "bright airy daylight, clean studio-style lighting, crisp shadows",
      "dramatic cinematic side lighting, deep contrast, moody atmosphere",
      "soft diffused overcast light, even tones, pastel color palette",
    ];
    const lighting = lightings[idx % lightings.length];
    const quality = "ultra-high resolution 8K, hyperrealistic, award-winning photography, National Geographic quality, razor-sharp focus, perfect composition";
    const FLOW_CATS: [RegExp, string][] = [
      [/먹|맛|식당|음식|요리|카페|커피|맛집|디저트|밥|술|맥주|와인|소주/, `A stunning food photography scene featuring "${title}", beautifully plated gourmet Korean cuisine, vibrant fresh ingredients, professional food styling, bokeh restaurant interior`],
      [/여행|관광|투어|호텔|숙소|제주|해외|유럽|일본|동남아|캠핑|아웃도어/, `A breathtaking travel photography of "${title}", majestic scenic landscape with dramatic sky, vibrant atmosphere, wanderlust inspiring composition`],
      [/주식|펀드|선물|옵션|채권|ETF|코인|트레이딩|차트|증권|배당|퀀트/, `A sophisticated stock market concept for "${title}", dynamic financial data visualization, trading screens with charts, modern professional workspace`],
      [/보험|연금|저축|적금|재테크|투자|경제|수익|부자|부업|프리랜서|애드센스|블로그수익/, `A sophisticated financial success concept for "${title}", modern professional workspace, premium business aesthetic, aspirational and trustworthy mood`],
      [/건강|운동|fitness|헬스|요가|필라테스|러닝|수영|다이어트|diet/, `A motivating healthy lifestyle photography for "${title}", wellness activity, fresh organic ingredients, clean bright atmosphere`],
      [/의료|병원|약|치료|제약|바이오|헬스케어|한의원/, `A clean medical healthcare concept for "${title}", professional equipment, sterile clinical precision aesthetic`],
      [/피부|뷰티|스킨케어|화장|메이크업|헤어|네일|화장품|세럼|크림/, `A luxurious beauty editorial for "${title}", premium cosmetic products on marble, dewy glowing texture, feminine elegance`],
      [/패션|옷|스타일|코디|ootd|아우터|가방|명품|쇼핑|브랜드/, `A stylish fashion editorial for "${title}", trendy outfit with accessories, urban street style, Vogue-worthy composition`],
      [/집|방|인테리어|아파트|가구|리모델링|청소|정리|수납/, `A stunning interior design photography of "${title}", beautifully decorated Korean modern home, warm cozy atmosphere`],
      [/건축|건설|부동산|분양|임대|전세|재건축/, `A professional architecture real estate concept for "${title}", modern building, urban development premium aesthetic`],
      [/농업|농장|농산물|채소|과일|쌀|유기농|스마트팜/, `A beautiful farm and agriculture photography for "${title}", fresh organic produce, countryside pastoral aesthetic`],
      [/수산업|어업|수산물|생선|해산물|굴|새우|참치|연어/, `A fresh seafood photography for "${title}", glistening ocean products on ice, vibrant coastal market aesthetic`],
      [/육류|육가공|정육|소고기|돼지고기|닭고기|햄|소시지/, `A premium meat concept for "${title}", quality cuts on rustic wooden board, professional food styling`],
      [/유통|물류|배송|창고|SCM|택배|운송|화물|무역/, `A modern logistics concept for "${title}", organized warehouse, delivery and shipping aesthetic`],
      [/제조|공장|생산|가공|철강|기계|설비|산업|자동화/, `An industrial manufacturing concept for "${title}", precision machinery, clean factory aesthetic`],
      [/화학|에너지|태양광|풍력|수소|배터리|반도체|신재생/, `A clean energy and materials concept for "${title}", innovative technology visualization, sustainable aesthetic`],
      [/과학|연구|실험|물리|생물|quantum|퀀텀|파동|나노|우주|천문/, `A professional scientific research concept for "${title}", laboratory precision, quantum visualization aesthetic`],
      [/법률|법무|변호사|소송|계약|세무|회계|컴플라이언스/, `A professional legal concept for "${title}", clean document arrangement, authoritative trustworthy aesthetic`],
      [/교육|학원|강의|학습|입시|자격증|온라인교육/, `An inspiring education concept for "${title}", organized study materials, clean learning environment`],
      [/마케팅|광고|홍보|브랜딩|소셜미디어|콘텐츠|유튜브|미디어/, `A creative marketing concept for "${title}", brand elements on workspace, content creation aesthetic`],
      [/스타트업|창업|사업|경영|비즈니스|기업|리더십|벤처/, `A dynamic startup concept for "${title}", innovative workspace, entrepreneurial vision, modern corporate`],
      [/자동차|차량|드라이브|전기차|수입차|SUV|오토바이/, `A dramatic automotive photography for "${title}", sleek vehicle design, dynamic angles, premium surfaces`],
      [/스포츠|축구|야구|농구|골프|테니스|스키|서핑/, `An energetic sports photography for "${title}", peak athletic performance, dynamic action`],
      [/기술|tech|AI|인공지능|컴퓨터|스마트폰|앱|IT|아이폰|아이패드|노트북|게임|드론/, `A cutting-edge technology concept for "${title}", sleek devices, digital innovation aesthetic`],
      [/봄|여름|가을|겨울|자연|꽃|풍경|숲|바다|산|식물|원예/, `A breathtaking nature photography for "${title}", pristine landscape, vivid seasonal colors`],
      [/환경|친환경|제로웨이스트|탄소중립|ESG|재활용/, `An eco-friendly sustainability concept for "${title}", green products, earth-tone natural aesthetic`],
      [/음악|악기|노래|피아노|기타|드럼|K팝/, `An artistic music concept for "${title}", beautiful instrument flat lay, creative studio aesthetic`],
      [/미술|그림|디자인|영화|드라마|공연|전시|예술/, `A creative arts concept for "${title}", artist tools elegantly arranged, gallery aesthetic`],
      [/명상|영성|철학|심리|힐링|치유|종교/, `A peaceful meditation concept for "${title}", serene candles and nature, calm mindful aesthetic`],
      [/아이|육아|아기|어린이|임신|출산|유아|교육|공부/, `A heartwarming family concept for "${title}", soft pastel tones, child-friendly environment`],
      [/강아지|고양이|반려동물|pet|puppy/, `A charming pet photography for "${title}", expressive companion, playful moments, soft bokeh`],
      [/결혼|웨딩|신혼|프로포즈|부케|예식|혼수/, `A romantic wedding photography for "${title}", elegant venue, bridal details, dreamy style`],
    ];
    if (/강아지|고양이|반려동물|pet|puppy|kitten|햄스터/.test(k)) {
      return `A charming pet photography for "${title}", adorable real dog or cat as the unmistakable main subject, responsible pet adoption and animal shelter context, playful heartwarming moment, soft bokeh, ${lighting}, ${quality}`;
    }
    for (const [re, prompt] of FLOW_CATS) {
      if (re.test(k+c)) return `${prompt}, ${lighting}, ${quality}`;
    }
    return `A high-quality professional blog photography representing "${title}" about ${kw}, visually compelling, Korean lifestyle aesthetic, ${lighting}, ${quality}, editorial magazine style`;
  }

  function buildCaptions(kw: string, count: number, content?: string): string[] {
    const k = kw || "사진";
    // ★"사진 1/사진 2"·"~이미지" 숫자·플레이스홀더 금지 + 서로 다르게(중복 없음). SEO 키워드 유지.
    const pool = [
      `${k}`, `${k} 현장`, `${k} 실물`, `${k} 자세히 보기`, `${k} 추천`, `${k} 정보`,
      `${k} 살펴보기`, `${k} 후기`, `${k} 한눈에`, `${k} 미리보기`, `${k} 포인트`, `${k} 상세`,
    ];
    const fromBody: string[] = [];
    if (content) {
      for (const line of content.split(/\n+/).map(s => s.trim())) {
        if (line.length >= 4 && line.length <= 24 && !/https?:\/\/|\[|Q\d|A\d|태그|해시/.test(line)) fromBody.push(line);
      }
    }
    const seen = new Set<string>();
    const out: string[] = [];
    const pick = (s: string) => { const t = s.trim(); if (t && !seen.has(t)) { seen.add(t); out.push(t); } };
    for (const s of fromBody) { if (out.length >= count) break; pick(s); }
    for (const s of pool) { if (out.length >= count) break; pick(s); }
    const extra = ["소개", "살펴봐요", "눈여겨볼 점", "참고하세요", "체크포인트", "활용 팁"];
    let ei = 0;
    while (out.length < count) { pick(`${k} ${extra[ei % extra.length]}`); ei++; if (ei > extra.length + count) break; }
    return out.slice(0, count);
  }

  function calcTargetChars(): number {
    if (charMode === "manual") return targetChars;
    if (platform === "tistory") return Math.floor(Math.random()*1000)+2000;
    if (adType === "adpost" && /체험단|맛집|후기|리뷰|방문|다녀/.test(keywords[0]||""))
      return Math.floor(Math.random()*700)+1800;
    return Math.floor(Math.random()*500)+1500;
  }
  function getActiveImages(): string[] { return imgSource === "upload" ? uploadedImages : generatedImages; }

  function buildAdmPublishContent(): string {
    if (!genContent) return pubContent;
    // pubScope 필터 먼저 적용 (블록보다 우선)
    if (pubScope === "body") {
      let t = genContent;
      t = t.replace(/\[FAQ시작\][\s\S]*?\[FAQ끝\]/g,"").replace(/\[참고자료시작\][\s\S]*?\[참고자료끝\]/g,"").replace(/\[관련글시작\][\s\S]*?\[관련글끝\]/g,"").trim();
      return t;
    }
    if (pubScope === "faq") {
      let t = genContent;
      t = t.replace(/\[참고자료시작\][\s\S]*?\[참고자료끝\]/g,"").replace(/\[관련글시작\][\s\S]*?\[관련글끝\]/g,"").trim();
      return t;
    }
    // full: 블록 기반 HTML 빌드
    if(blocks.some(b=>b.type==="text"&&(b as TextBlock).content.trim()))return buildHtmlContent();
    return genContent;
  }


  function splitContentWithImages(content: string, images: string[]): {text:string;img?:string}[] {
    if (!images.length||imgSource==="none") return [{text:content}];
    const cps = Math.floor(content.length/(images.length+1));
    const sections: {text:string;img?:string}[] = [];
    let pos = 0;
    for (let i = 0; i < images.length; i++) {
      const end = Math.min(pos+cps, content.length);
      const brk = content.lastIndexOf("\n",end)||end;
      sections.push({text:content.slice(pos,brk>pos?brk:end).trim()});
      sections.push({text:"",img:images[i]});
      pos = brk>pos?brk:end;
    }
    if (pos < content.length) sections.push({text:content.slice(pos).trim()});
    return sections;
  }

  async function handleGenerateImages() {
    if (!keyword&&!genTitle) { alert("먼저 글을 생성해주세요"); return; }
    setGenImgLoading(true); setGenImgProgress(0); setGenImgCurrent(0);
    imgAbortRef.current = new AbortController();
    const imgs: string[] = [];

    // 글 내용 구간별 분할
    const content = genContent || "";
    const segments: string[] = [];
    if (content.length > 0 && imgCount > 1) {
      const lines = content.split("\n").filter((l:string) => l.trim().length > 5);
      const step = Math.max(1, Math.floor(lines.length / imgCount));
      for (let i = 0; i < imgCount; i++) {
        segments.push(lines.slice(i * step, (i + 1) * step).join(" ").slice(0, 150));
      }
    }

    try {
      for (let i=0;i<imgCount;i++) {
        if (imgAbortRef.current.signal.aborted) break;
        setGenImgCurrent(i+1);
        const url = await generateImage(keyword||selectedTitle, genTitle||selectedTitle||"", i, segments[i]);
        imgs.push(url); setGeneratedImages([...imgs]);
        setGenImgProgress(Math.round(((i+1)/imgCount)*100));
      }
      // 이미지 완료 시 캡션 자동생성 + 블록 자동배치 + 썸네일 자동지정
      setCaptions(buildCaptions(keyword||selectedTitle, imgs.length, genContent));
      setCurrentImgPrompt(buildImagePrompt(keyword||selectedTitle, genTitle||selectedTitle||"", 0));
      if(imgs.length>0){
        if(!thumbnail)setThumbnail(imgs[0]);
        const captionList = buildCaptions(keyword||selectedTitle, imgs.length, genContent);
        triggerAutoInsert(imgs.map((src,i)=>({id:i,src,alt:captionList[i]||`${keyword||selectedTitle} ${i===0?"대표":"현장"} 사진`})));
        setShowMeta(true);
      }
    } catch(e:any) { if (e.name!=="AbortError") alert("이미지 생성 실패: "+e.message); }
    finally { setGenImgLoading(false); imgAbortRef.current=null; }
  }

  function stopImageGen() { imgAbortRef.current?.abort(); setGenImgLoading(false); }

  function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files; if (!files) return;
    Array.from(files).forEach(file => {
      const reader = new FileReader();
      reader.onload = ev => { if (ev.target?.result) setUploadedImages(prev=>[...prev,ev.target!.result as string]); };
      reader.readAsDataURL(file as Blob);
    });
  }

  async function handleGenerateTitles(reset=false) {
    if (!keyword.trim()) { alert("키워드를 입력하세요"); return; }
    // 키워드 풀 누적 (중복제거, 90개 제한)
    if(!keywords.includes(keyword.trim())){
      const newKws=[...keywords,keyword.trim()].slice(-MAX_KW);
      setKeywords(newKws);
      localStorage.setItem("publy_adm_kws",JSON.stringify(newKws));
    }
    if (reset) setTitles([]);
    setLoadingTitles(true);
    const isAdpost = adType === "adpost";
    const prompt = isAdpost
      ? `당신은 대한민국 최고의 네이버 블로그 SEO 제목 전문가입니다.\n키워드: "${keyword.trim()}"\n목적: 네이버 애드포스트 클릭률 극대화\n\n반드시 제목 30개를 JSON 배열로만 반환하세요.\n- 키워드를 자연스럽게 포함\n- 15~20자, 친근하고 감성적, 검색어 포함\n- 숫자 필수 (BEST 7, TOP 5 등)\n- "솔직히", "이것만", "나만 알던" 등 클릭 유발\n\nJSON 배열만 반환.`
      : `당신은 구글 애드센스 최적화 SEO 전문가입니다.\n키워드: "${keyword.trim()}"\n목적: 구글 검색 상위노출 + 애드센스 클릭률 극대화\n\n반드시 제목 30개를 JSON 배열로만 반환하세요.\n- 키워드를 자연스럽게 포함\n- 15~20자, 정보성·전문적 톤, 검색어 포함\n- "완벽 가이드", "총정리", "이유 5가지" 등\n\nJSON 배열만 반환.`;
    try {
      const text = await callAI(prompt);
      const parsed = parseArr(text).map((t:string)=>enforceExactKeyword(t, keyword.trim()));
      if (!parsed.length) throw new Error("제목 파싱 실패");
      setTitles(prev => {
        const combined = [...parsed,...prev];
        if (combined.length >= 90) { localStorage.setItem("publy_adm_titles",JSON.stringify(parsed)); return parsed; }
        localStorage.setItem("publy_adm_titles",JSON.stringify(combined));
        return combined;
      });
    } catch(e:any) { alert("제목 생성 실패: "+e.message); }
    finally { setLoadingTitles(false); }
  }

  async function handleGenerate() {
    if (!selectedTitle && !keyword) return;
    const title = selectedTitle || keyword;
    setGenerating(true); setGenImage(""); setQualityScore(null);

    // 글자수 자동 랜덤
    const chars = calcTargetChars();
    if (charMode === "auto") setTargetChars(chars);

    // AI 패턴 뱅크 - 매번 랜덤
    const INTRO_BANK = [
      `오늘은 ${keyword} 직접 경험한 거 솔직하게 써볼게요.`,
      `솔직히 처음엔 별 기대 안 했어요. 근데 ${keyword} 해보고 나서 생각이 완전히 바뀌었어요.`,
      `${keyword} 궁금한 분들 많죠? 저도 한참 찾아봤거든요.`,
      `주변에서 ${keyword} 어디 좋냐고 물어봐서 이참에 정리해봤어요.`,
      `사실 이거 쓸까 말까 고민했는데... ${keyword} 후기 솔직하게 써볼게요.`,
      `${keyword} 직접 겪은 거라 자신있게 말할 수 있어요.`,
      `블로그에 ${keyword} 글 많은데 제 경험이랑 달라서 새로 써봐요.`,
      `저도 처음엔 막막했는데 ${keyword} 이렇게 하면 됩니다.`,
    ];
    const SUBHEAD_BANK = [
      `왜 {주제}가 이렇게 인기 있는 걸까요?`,
      `직접 해보니까 이런 점이 달랐어요`,
      `기대했던 것 vs 실제로 느낀 것`,
      `꼭 알아야 할 핵심 포인트`,
      `이런 분들께 특히 추천해요`,
    ];
    const OUTRO_BANK = [
      `다음에 또 기회가 되면 다시 경험해보고 싶어요.`,
      `이 글이 도움이 됐으면 좋겠습니다.`,
      `궁금한 거 있으면 댓글로 물어봐요!`,
      `저처럼 고민하시는 분들한테 도움이 됐으면 해요.`,
      `오늘도 긴 글 읽어주셔서 감사해요.`,
      `여러분도 꼭 한번 경험해보시길 추천드려요.`,
    ];
    const intro = INTRO_BANK[Math.floor(Math.random()*INTRO_BANK.length)];
    const subStyle = SUBHEAD_BANK[Math.floor(Math.random()*SUBHEAD_BANK.length)];
    const outro = OUTRO_BANK[Math.floor(Math.random()*OUTRO_BANK.length)];

    const catGuide = getCategoryGuide(keyword, title);
    const adGuide = adType==="adpost"
      ? "[수익] 애드포스트: 체류시간 늘리는 감성 스토리."
      : "[수익] 애드센스: 클릭 유도, 키워드 밀도 높게.";
    const platGuide = platform==="naver"
      ? "[플랫폼] 네이버: ## 기호 절대 금지. 순수 텍스트. 감성적 경험담."
      : "[플랫폼] 티스토리: 정보성 중심. 내부링크 2개 자연스럽게 포함.";
    const styleGuide = WRITE_STYLE_GUIDE[writeStyle]||"";
    const personaGuide = PERSONA_STYLES.find(p=>p.id===persona)?.prompt||"";
    const templateGuide = BLOG_TEMPLATES.find(t=>t.id===blogTemplate)?.guide||"";
    // ★퍼블리 기능 자연 녹이기(테리 2026-08-26): 회원과 동일 — 모든 글에 퍼블리 '기능'을 간접적으로 1곳만 슬쩍.
    const publyGuide=`\n\n=== 🌿 블로그 자동화 팁 한 스푼 (모든 글 공통 · 짧게라도 꼭) ===
주제가 무엇이든, 글 중반이나 마무리쯤에서 "블로그·글쓰기를 편하게 하는 요즘 방법"으로 이야기를 살짝 이어, 아래 기능 중 이 글 주제와 가장 잘 어울리는 1가지를 골라 1~2문장으로 자연스럽게 녹여라.
- 키워드만 넣으면 AI가 블로그 글을 SEO에 맞게 자동으로 써주고
- 어울리는 사진·이미지도 자동 생성
- 네이버·티스토리에 원하는 시간으로 예약 자동 발행(컴퓨터를 꺼도 올라감)
- 서로이웃·공감·댓글 같은 이웃 관리까지 자동
- 내 블로그 지수(검색 노출·저품질) 진단
규칙: ①딱 1곳, 1~2문장만(장황 금지) ②대놓고 광고·서비스 소개 말고 "요즘은 이런 걸 자동으로 해주는 도구도 있더라고요" 식 정보/경험 말투로 부드럽게 ③'퍼블리'라는 이름은 안 써도 되고, 써도 딱 한 번 가볍게만 ④과장·거짓·링크 금지.`;

    const prompt = `당신은 대한민국 최고의 블로그 작가입니다.

키워드: "${keyword}"  제목: "${title}"
목표 글자수: ${chars}자 내외 (±100자, 반드시 이 범위 안에서 작성)

${catGuide}

=== 절대 규칙 ===
⛔ ## 기호 완전 금지 (소제목은 그냥 텍스트로)
⛔ ** * - + 마크다운 기호 전부 금지
⛔ 한자,중국어,일본어 금지
⛔ AI 티 나는 표현 금지 (중요합니다, 다양한, 효과적인, 필수적으로 등)
✅ 독자에게 직접 말 걸기
✅ 구체적 수치, 가격, 기간 포함
✅ 문장 끝: ~해요, ~거든요, ~더라고요, ~잖아요 다양하게
✅ ★핵심 키워드 "${keyword||title}"를 본문에 **띄어쓰기·글자 그대로 똑같이 정확히 5~6번** 반복 (예: "원주맛집"이면 "원주 맛집"으로 띄우지 말고 "원주맛집" 그대로 — 검색 노출의 핵심)
✅ 반드시 ${chars-100}~${chars+100}자 사이로 작성

${AEO_RULES}

=== 글 패턴 가이드 (매번 다르게) ===
인트로: "${intro}"
소제목 스타일: "${subStyle}"
마무리: "${outro}"

${adGuide}
${platGuide}
${styleGuide}${personaGuide?"\n\n[말투/페르소나]\n"+personaGuide:""}${templateGuide?"\n\n"+templateGuide:""}${publyGuide}

=== 출력 형식 ===
태그: 태그1, 태그2, 태그3, 태그4, 태그5

(본문 ${chars}자 내외 - 순수 텍스트. ★맨 첫 문단은 위 AEO 규칙대로 '핵심 요약' 2~3문장으로 시작)

${AEO_FAQ_FORMAT}

[관련글시작]
POST1: (제목)|(이유)
POST2: (제목)|(이유)
POST3: (제목)|(이유)
[관련글끝]`;
    try {
      const text = await callAI(prompt);
      const cleaned = stripMarkdown(text);
      const tgm = cleaned.match(/태그[:\s]*([^\n]+)/);
      const bm = cleaned.match(/태그[^\n]*\n([\s\S]+)/);
      setGenTitle(title);
      if (tgm) setGenTags(tgm[1].trim());
      const bodyRaw = await ensureKeywordCount(bm ? bm[1].trim() : cleaned, keyword||title, 5);
      const body = charMode==="manual" ? enforceMaxChars(bodyRaw, targetChars) : bodyRaw;   // 지정 글자수 오버슈트 방지
      setGenContent(body);
      setQualityScore(calcQualityScore(body,keyword));
      const recCount = imgCountManual ?? recommendImageCount(body);
      if (imgCountAuto) setImgCount(recCount);
      if (flowImgCountAuto) setFlowImgCount(recommendImageCount(body));
      // ── tarry 방식: 블록 자동 분리 + 제목/태그 자동 연동 ──
      const rawBlocks = body.split("\n\n").filter(Boolean).map(p=>({type:"text" as const,id:uid(),content:p}));
      setBlocks(rawBlocks.length>0?rawBlocks:[{type:"text",id:uid(),content:body}]);
      setPubTitle(title);
      if(tgm)setHashtags(tgm[1].trim().split(",").map((t:string)=>t.trim().startsWith("#")?t.trim():"#"+t.trim()).filter(Boolean));
      // 임시저장
      try{localStorage.setItem("publy_adm_draft",JSON.stringify({title,content:body,savedAt:new Date().toLocaleString("ko-KR")}));}catch{}
      setAutoInserted(false);setThumbnail("");
    } catch(e:any) { alert("본문 생성 실패: "+e.message); }
    finally { setGenerating(false); }
  }

  async function handlePublish() {
    const content = buildAdmPublishContent();
    if (!pubTitle||!content||!pubAccId) return;
    if (scheduleOn&&!scheduleTime) { setPubMsg("❌ 예약 날짜와 시간을 선택해주세요"); return; }
    setPublishing(true); setPubMsg(scheduleOn?"예약 설정 중...":"발행 중...");
    const tags=hashtags.map((t:string)=>t.replace("#","")).filter(Boolean);
    const publishBody = {
      userId:ADM_UID, platform, title:pubTitle, content,
      pubScope,
      tags,
      imageUrl:thumbnail||getActiveImages()[0]||undefined,
      categoryId:category||undefined,
      visibility,
      scheduleTime:scheduleOn?scheduleTime:undefined,
      blocks:blocks.map((b:any)=>{
        if(b.type==="text")return{type:"text",content:b.content};
        if(b.type==="image")return{type:"image",src:b.src,alt:b.alt||""};
        if(b.type==="image-pair")return{type:"image-pair",images:b.images};
        return null;
      }).filter(Boolean),
      useFlow: imgGenType === "flow",
      flowImgCount: imgGenType === "flow" ? flowImgCount : undefined,
      flowPrompts: imgGenType === "flow" ? (() => {
        const c = genContent || "";
        const lines = c.split("\n").filter((l:string) => l.trim().length > 5);
        const step = Math.max(1, Math.floor(lines.length / flowImgCount));
        return Array.from({length: flowImgCount}, (_:any, i:number) => {
          const seg = lines.slice(i * step, (i + 1) * step).join(" ").slice(0, 150);
          return buildAdmFlowPrompt(keywords[0]||"", pubTitle||"", seg, i);
        });
      })() : undefined,
      flowCaptions: imgGenType === "flow"
        ? buildCaptions(keywords[0]||"", flowImgCount, genContent)
        : undefined,
    };
    try {
      const r = await botFetch(`${BOT}/api/publish-full`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(publishBody)});
      const d = await r.json();
      if (r.status===401) { setPubMsg("❌ 세션 만료 — 계정 관리 탭에서 재연결해주세요"); setPublishing(false); return; }
      if (!r.ok) throw new Error(d.error);
      // 회원과 동일하게 발행기록을 content 통째로 저장 → 관리자도 발행관리에 쌓이고 재발행 통째복원 가능
      // user_id는 관리자 본인 회원계정(ADM_HISTORY_UID) — publy_history FK(→publy_users.id) 충족
      await addHistory({user_id:ADM_HISTORY_UID, platform, title:pubTitle, post_url:d.postUrl, status:"success",
        content:{title:pubTitle, content, pubScope, tags, imageUrl:thumbnail||getActiveImages()[0]||undefined, categoryId:category||undefined, visibility, blocks:publishBody.blocks, platform}} as any)
        .catch(async()=>{ await addHistory({user_id:ADM_HISTORY_UID, platform, title:pubTitle, post_url:d.postUrl, status:"success"}).catch(()=>{}); });
      getHistory(ADM_HISTORY_UID).then(setHistory).catch(()=>{});
      setPubMsg(scheduleOn?"✅ 예약 완료! 설정한 시간에 자동 발행돼요.":"✅ 발행 완료!");
      setPubTitle(""); setPubContent(""); setPubTags(""); setPubImg("");
    } catch(e:any) { await addHistory({user_id:ADM_HISTORY_UID, platform, title:pubTitle, status:"fail", error_message:e.message}).catch(()=>{}); setPubMsg("❌ "+e.message+" (오류가 자동 전달됩니다)");logError({user_id:ADM_UID,user_name:"관리자",user_email:"",feature:"관리자 발행",error_message:e.message}).catch(()=>{}); }
    finally { setPublishing(false); }
  }


  // ── 발행 패널 렌더 ──
  function renderAdmPublishPanel(){
    return(<div style={{display:"flex",flexDirection:"column",gap:12}}>
      <div className="card" style={{padding:"14px 16px"}}>
        <div className="card-title" style={{marginBottom:10}}>🌐 플랫폼</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
          {([{p:"naver",ico:"🟢",name:"네이버",c:"var(--naver)"},{p:"tistory",ico:"🟠",name:"티스토리",c:"var(--tistory)"}] as const).map(({p,ico,name,c})=>(
            <button key={p} onClick={()=>{setPlatform(p);if(pubAccId)loadCategories(p);}} style={{padding:"12px",borderRadius:10,border:`2px solid ${platform===p?c:"var(--border)"}`,background:platform===p?`${c}18`:"var(--bg)",cursor:"pointer",fontFamily:"inherit",display:"flex",alignItems:"center",gap:8,transition:"all .15s"}}>
              <span style={{fontSize:22}}>{ico}</span>
              <span style={{fontSize:13,fontWeight:700,color:"var(--text)"}}>{name}</span>
              {platform===p&&<span style={{marginLeft:"auto",color:c,fontSize:14}}>✓</span>}
            </button>
          ))}
        </div>
      </div>

      <div className="card" style={{padding:"14px 16px"}}>
        <div className="card-title" style={{marginBottom:10}}>🔗 발행 계정</div>
        {connAccs.length===0?(
          <div style={{textAlign:"center",padding:"16px"}}>
            <div style={{fontSize:13,color:"var(--text3)",marginBottom:10}}>연결된 계정 없음</div>
            <button className="btn btn-primary btn-sm" onClick={()=>setTab("accounts")}>계정 관리 →</button>
          </div>
        ):connAccs.map(a=>(
          <label key={a.id} onClick={()=>{setPubAccId(a.id);loadCategories(platform);}} style={{display:"flex",alignItems:"center",gap:10,padding:"12px 14px",borderRadius:10,cursor:"pointer",marginBottom:6,background:pubAccId===a.id?"var(--accent-bg)":"var(--bg)",border:`2px solid ${pubAccId===a.id?"var(--accent)":"var(--border)"}`,transition:"all .15s"}}>
            <input type="radio" name="admpacc" checked={pubAccId===a.id} onChange={()=>{}} style={{accentColor:"var(--accent)",width:16,height:16,flexShrink:0}}/>
            <div style={{flex:1}}><div style={{fontSize:14,fontWeight:700,color:"var(--text)"}}>{a.username}</div>{a.blog_name&&<div style={{fontSize:11,color:"var(--text3)"}}>{a.blog_name}</div>}</div>
            {pubAccId===a.id&&<span style={{fontSize:11,fontWeight:700,padding:"2px 8px",borderRadius:99,background:"var(--accent-bg)",color:"var(--accent-text)",border:"1px solid var(--accent-border)"}}>✅</span>}
          </label>
        ))}
      </div>

      {pubAccId&&(
        <div className="card" style={{padding:"14px 16px"}}>
          <div className="card-title" style={{marginBottom:10}}>📂 카테고리</div>
          {loadingCats?(
            <div style={{display:"flex",alignItems:"center",gap:8,padding:"8px",color:"var(--text3)",fontSize:13}}><span className="spinner" style={{width:16,height:16}}/>불러오는 중...</div>
          ):(()=>{
            const cats=categories.length>0?categories:(accCats[pubAccId]||[]).map((c,i)=>({id:String(i),name:c}));
            return cats.length===0?(
              <div style={{display:"flex",flexDirection:"column",gap:8}}>
                <div style={{fontSize:12,color:"var(--text3)",textAlign:"center"}}>카테고리 없음 (기본 발행)</div>
                <button className="btn btn-secondary btn-sm" onClick={()=>loadCategories(platform)}>🔄 불러오기</button>
                <button className="btn btn-secondary btn-sm" onClick={()=>setTab("accounts")} style={{fontSize:11}}>📂 계정 관리에서 직접 입력</button>
              </div>
            ):(
              <select value={category} onChange={e=>setCategory(e.target.value)} style={{width:"100%",padding:"10px 12px",borderRadius:10,border:"1px solid var(--border)",background:"var(--bg)",color:"var(--text)",fontSize:14,fontFamily:"inherit",outline:"none"}}>
                <option value="">선택 안 함 (기본)</option>
                {cats.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            );
          })()}
        </div>
      )}

        {/* 발행 범위 */}
        <div className="card" style={{padding:"14px 16px"}}>
          <div className="card-title" style={{marginBottom:10}}>📝 발행 범위</div>
          <div style={{display:"flex",flexDirection:"column",gap:8}}>
            {([
              {v:"body",ico:"✍️",label:"본문 + 해시태그",desc:"관련글/링크/질문 제외"},
              {v:"faq",ico:"❓",label:"본문 + FAQ + 해시태그",desc:"관련글/링크만 제외"},
              {v:"full",ico:"📄",label:"전체 발행",desc:"모든 섹션 포함"},
            ] as {v:string,ico:string,label:string,desc:string}[]).map(opt=>(
              <button key={opt.v} onClick={()=>setPubScope(opt.v as "body"|"faq"|"full")} style={{padding:"11px 14px",borderRadius:10,border:`2px solid ${pubScope===opt.v?"var(--accent)":"var(--border)"}`,background:pubScope===opt.v?"var(--accent-bg)":"var(--bg)",cursor:"pointer",fontFamily:"inherit",textAlign:"left",transition:"all .15s",display:"flex",alignItems:"center",gap:10}}>
                <span style={{fontSize:18,flexShrink:0}}>{opt.ico}</span>
                <div style={{flex:1}}>
                  <div style={{fontSize:13,fontWeight:700,color:pubScope===opt.v?"var(--accent-text)":"var(--text)"}}>{opt.label}</div>
                  <div style={{fontSize:11,color:"var(--text3)",marginTop:2}}>{opt.desc}</div>
                </div>
                {pubScope===opt.v&&<span style={{color:"var(--accent-text)",flexShrink:0}}>✓</span>}
              </button>
            ))}
          </div>
          {pubScope==="body"&&<div style={{marginTop:10,padding:"9px 12px",borderRadius:9,background:"rgba(245,158,11,.1)",border:"1px solid rgba(245,158,11,.3)",fontSize:11.5,color:"#f59e0b",lineHeight:1.55,fontWeight:600}}>ℹ️ '본문만' 발행이라 <b>Q&amp;A(자주 묻는 질문)가 빠져요.</b> Q&amp;A는 네이버 AI가 답변에 인용하기 좋은 부분이라, 상위노출·AI 노출을 노린다면 <b>'본문 + FAQ'</b>를 추천해요. (체험단·맛집 글이면 본문만도 괜찮아요)</div>}
        </div>
      <div className="card" style={{padding:"14px 16px"}}>
        <div className="card-title" style={{marginBottom:10}}>👁️ 공개 설정</div>
        <div style={{display:"flex",flexDirection:"column",gap:8}}>
          {(platform==="naver"?[{v:"public",ico:"🌍",label:"전체 공개"},{v:"neighbor",ico:"👥",label:"이웃 공개"},{v:"private",ico:"🔒",label:"비공개"}]:[{v:"public",ico:"🌍",label:"전체 공개"},{v:"private",ico:"🔒",label:"비공개"}] as {v:string,ico:string,label:string}[]).map(opt=>(
            <button key={opt.v} onClick={()=>setVisibility(opt.v as "public"|"neighbor"|"private")} style={{padding:"10px 14px",borderRadius:10,border:`2px solid ${visibility===opt.v?"var(--accent)":"var(--border)"}`,background:visibility===opt.v?"var(--accent-bg)":"var(--bg)",cursor:"pointer",fontFamily:"inherit",textAlign:"left",transition:"all .15s",display:"flex",alignItems:"center",gap:10}}>
              <span style={{fontSize:18}}>{opt.ico}</span>
              <span style={{fontSize:13,fontWeight:600,color:visibility===opt.v?"var(--accent-text)":"var(--text)"}}>{opt.label}</span>
              {visibility===opt.v&&<span style={{marginLeft:"auto",color:"var(--accent-text)"}}>✓</span>}
            </button>
          ))}
        </div>
      </div>

      <div className="card" style={{padding:"14px 16px"}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:scheduleOn?12:0}}>
          <div>
            <div className="card-title" style={{margin:0}}>⏰ 예약 발행</div>
            <div style={{fontSize:11,color:"var(--text3)",marginTop:2}}>설정 시간에 자동 발행</div>
          </div>
          <button onClick={()=>{setScheduleOn(v=>!v);if(!scheduleTime){const d=new Date();d.setHours(d.getHours()+1,0,0,0);setScheduleTime(d.toISOString().slice(0,16));}}} style={{width:48,height:26,borderRadius:99,background:scheduleOn?"var(--accent)":"var(--border)",border:"none",cursor:"pointer",position:"relative",transition:"background .2s",flexShrink:0}}>
            <div style={{position:"absolute",top:3,left:scheduleOn?24:3,width:20,height:20,borderRadius:"50%",background:"#fff",transition:"left .2s",boxShadow:"0 1px 4px rgba(0,0,0,.3)"}}/>
          </button>
        </div>
        {scheduleOn&&(
          <div>
            <input type="datetime-local" value={scheduleTime} onChange={e=>setScheduleTime(e.target.value)} min={new Date().toISOString().slice(0,16)} style={{width:"100%",padding:"10px 12px",borderRadius:10,border:"2px solid var(--border)",background:"var(--bg)",color:"var(--text)",fontSize:14,fontFamily:"inherit",outline:"none",boxSizing:"border-box"}}/>
            {scheduleTime&&<div style={{marginTop:8,padding:"10px 12px",borderRadius:10,background:"var(--accent-bg)",border:"1px solid var(--accent-border)",fontSize:12,color:"var(--accent-text)",fontWeight:600}}>
              ✅ {new Date(scheduleTime).toLocaleDateString("ko-KR",{month:"long",day:"numeric",weekday:"short"})} {new Date(scheduleTime).toLocaleTimeString("ko-KR",{hour:"2-digit",minute:"2-digit"})} 발행
            </div>}
          </div>
        )}
      </div>

      <button onClick={handlePublish} disabled={publishing||!botOnline||!pubAccId||!pubTitle||!buildAdmPublishContent()||(scheduleOn&&!scheduleTime)} className="btn btn-primary btn-full btn-xl pub-submit-btn">
        {publishing
          ?<><span className="spinner"/>{scheduleOn?"예약 중...":"발행 중..."}</>
          :scheduleOn?<>⏰ 예약 발행 설정하기</>:<>🚀 블로그 자동 발행</>
        }
      </button>
    </div>);
  }

  function saveAccCat(accId:string, cats:string[]){
    const next={...accCats,[accId]:cats};
    setAccCats(next);localStorage.setItem("publy_adm_acc_cats",JSON.stringify(next));
  }
  function addCatToAcc(accId:string){
    const val=catInput.trim();if(!val)return;
    const cur=accCats[accId]||[];if(cur.includes(val))return;
    saveAccCat(accId,[...cur,val]);setCatInput("");
  }
  function removeCatFromAcc(accId:string,cat:string){
    saveAccCat(accId,(accCats[accId]||[]).filter(c=>c!==cat));
  }

  async function handleAddAcc() {
    if (!newUser||!newPw) return;
    setAddingAcc(true);
    try {
      if(!botOnline)throw new Error("봇 서버 실행 필요");
      const r=await botFetch(`${BOT}/api/${newPlat}/save-session`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({userId:ADM_UID,id:newUser,pw:newPw,blogName:newBlog||undefined})});
      const d=await r.json();if(!d.success)throw new Error(d.error||"연결 실패");
      // 같은 계정(플랫폼+아이디)이 이미 있으면 새로 만들지 말고 그 행을 갱신 → 중복 생성 방지
      const existingAcc=admAccs.find(a=>a.platform===newPlat&&a.username===newUser);
      await upsertAccount({...(existingAcc?{id:existingAcc.id}:{}),user_id:ADM_UID,platform:newPlat,username:newUser,blog_name:newBlog||undefined,is_connected:true,connected_at:new Date().toISOString()});
      await getAccounts(ADM_UID).then(setAdmAccs);setNewUser("");setNewPw("");setNewBlog("");
    }
    catch(e:any) { alert(e.message); }
    finally { setAddingAcc(false); }
  }

  async function handleConnect(acc: PublyAccount) {
    if (!botOnline) { alert("봇 서버 실행 필요"); return; }
    setConnId(acc.id);
    try {
      const legacy=(acc as any).password_encrypted||"";let pw="";try{pw=legacy?atob(legacy):"";}catch{}
      if(!pw){ const entered=await askPassword(acc); if(entered===null){setConnId(null);return;} pw=entered; }
      if(!pw)throw new Error("비밀번호 입력이 필요합니다");
      const r = await botFetch(`${BOT}/api/${acc.platform}/save-session`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({userId:ADM_UID,id:acc.username,pw,blogName:acc.blog_name})});
      if (!r.ok) { const d = await r.json(); throw new Error(d.error); }
      await supabase.from("publy_accounts").update({is_connected:true,connected_at:new Date().toISOString()}).eq("id",acc.id);
      await upsertAccount({...acc,password_encrypted:"",is_connected:true,connected_at:new Date().toISOString()});
      getAccounts(ADM_UID).then(setAdmAccs);
    } catch(e:any) { alert("연결 실패: "+e.message); }
    finally { setConnId(null); }
  }
  // 🔖 AEO 강조 배너 — 회원과 동일. 발행/원터치 상단.
  function renderAeoBanner(){
    return (
      <div style={{margin:"12px 0 0",padding:"14px 16px",borderRadius:14,background:"rgba(124,58,237,.06)",border:"1.5px solid rgba(124,58,237,.3)"}}>
        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:6}}>
          <span style={{fontSize:20}}>🔖</span>
          <div style={{fontSize:14,fontWeight:800,color:"#7c3aed"}}>이 글은 'AI가 인용하는 글'로 만들어져요</div>
          <span style={{fontSize:10,fontWeight:800,color:"#7c3aed",background:"rgba(124,58,237,.12)",padding:"3px 8px",borderRadius:6,border:"1px solid rgba(124,58,237,.3)"}}>AEO 탑재</span>
        </div>
        <div style={{fontSize:12,color:"var(--text2)",lineHeight:1.65,fontWeight:500}}>
          퍼블리는 <b style={{color:"#7c3aed"}}>제목·본문·Q&amp;A</b>를 <b>네이버 AI 브리핑·Cue:</b>가 답변에 <b>인용하기 좋은 형식(AEO)</b>으로 자동 작성해요. <b>검색 상위노출 + AI 답변 노출</b>을 동시에 노려요.
        </div>
      </div>
    );
  }

  async function saveUser(u: UserFull) {
    const e = editMap[u.id]||{}; setSaving(u.id);
    try {
      // 🔒🔒 트래픽 앱은 publy_users.plan(등급)·publy_quotas(발행한도)를 절대 건드리지 않는다.
      //   이 테이블들은 퍼블리와 공유 → 여기서 등급/한도를 저장하면 퍼블리 회원 등급이 오염된다(2026-09-05 실제 사고).
      //   트래픽 등급/한도는 관리자 컨트롤타워(tool_licenses)로만 발급한다. 여기선 메모·연락처만 저장.
      const upd: any = {};
      if (e.memo!==undefined) upd.memo=e.memo;
      if (e.phone!==undefined) upd.phone=e.phone;
      if (Object.keys(upd).length>0) {
        const {data,error}=await supabase.from("publy_users").update(upd).eq("id",u.id).select("id,memo,phone");
        if(error) throw new Error(`회원정보 저장 실패: ${error.message}`);
        const saved=data?.[0];
        if(!saved || (upd.memo!==undefined&&saved.memo!==upd.memo) || (upd.phone!==undefined&&saved.phone!==upd.phone)) throw new Error("회원정보 저장 실패 — 권한/RLS로 반영된 행이 없거나 값이 일치하지 않습니다");
      }
      await loadUsers(); setEditMap(p=>{const n={...p};delete n[u.id];return n;}); alert("저장됨 (등급·한도는 컨트롤타워에서 관리)");
    } catch(e:any) { alert("오류: "+e.message); }
    finally { setSaving(null); }
  }

  async function resetQuota(uid: string) {
    if (!confirm("이 회원의 오늘 사용 건수를 모두 0으로 초기화할까요?\n(발행·서이추·공감·댓글·답방·지수·품앗이 전부)")) return;
    try {
      const today = new Date().toISOString().slice(0, 10);
      // 🔒 트래픽은 publy_quotas(퍼블리 발행 누적 한도, 퍼블리와 공유)를 건드리지 않는다 — 공유테이블 오염 방지(2026-09-05).
      // 일일 카운터만 통째 삭제 — publy_settings의 `{기능}_daily_{uid}_{오늘}` 키
      //    (발행/서이추/공감/답방/지수/품앗이 전부가 이 형식으로 저장됨 → 지우면 전부 0/한도)
      const { error } = await supabase.from("publy_settings").delete().like("key", `%_daily_${uid}_${today}`);
      if (error) throw new Error(error.message);
      await loadUsers();
      loadLiveUsage(); // 카드의 '오늘 발행수' 즉시 0으로 반영
      alert("✅ 오늘 사용 건수를 모두 초기화했어요 (발행·서이추·공감·답방·지수 전부). 회원 화면엔 5초 안에 반영됩니다.");
    } catch (e: any) { alert("건수 초기화 실패 — " + e.message); }
  }
  async function toggleActive(u: UserFull) { if (!confirm(`${u.name||u.email} ${u.is_active?"비활성화":"활성화"}?`)) return; try { const next=!u.is_active; const {data,error}=await supabase.from("publy_users").update({is_active:next}).eq("id",u.id).select("id,is_active"); if(error)throw new Error(error.message); if(!data?.[0]||data[0].is_active!==next)throw new Error("권한/RLS로 반영된 행이 없습니다"); await loadUsers(); } catch(e:any){alert("활성 상태 저장 실패 — "+e.message);} }
  // 🔎 크롤링 잠금해제 토글 — 회원 publy_users.crawl_enabled. 반영 검증(.select) 후 목록 갱신.
  async function toggleCrawl(u: UserFull) { try { const cur=u.crawl_enabled!==false; const next=!cur; const {data,error}=await supabase.from("publy_users").update({crawl_enabled:next}).eq("id",u.id).select("id,crawl_enabled"); if(error)throw new Error(error.message); if(!data?.[0]||data[0].crawl_enabled!==next)throw new Error("권한/RLS로 반영된 행이 없습니다"); await loadUsers(); showToast(next?`🔓 ${u.name||u.email} 크롤링 잠금해제`:`🔒 ${u.name||u.email} 크롤링 잠금`, "success"); } catch(e:any){ showToast("크롤링 권한 저장 실패 — "+e.message, "error"); } }
  // 🆕 트래픽 유입 = 기본 잠금(inflow_enabled===true여야 사용). 관리자가 회원별로 열어줌.
  async function toggleInflow(u: UserFull) { try { const cur=u.inflow_enabled===true; const next=!cur; const {data,error}=await supabase.from("publy_users").update({inflow_enabled:next}).eq("id",u.id).select("id,inflow_enabled"); if(error)throw new Error(error.message); if(!data?.[0]||data[0].inflow_enabled!==next)throw new Error("권한/RLS로 반영된 행이 없습니다"); await loadUsers(); showToast(next?`🔓 ${u.name||u.email} 트래픽 유입 열림`:`🔒 ${u.name||u.email} 트래픽 유입 잠금`, "success"); } catch(e:any){ showToast("트래픽 유입 권한 저장 실패 — "+e.message, "error"); } }
  // ✍️ 리뷰 자동작성 = 기본 잠금(밴 위험). 관리자가 회원별로 신중히 열어줌.
  async function toggleInflowReview(u: UserFull) { try { const cur=u.inflow_review_enabled===true; const next=!cur; const {data,error}=await supabase.from("publy_users").update({inflow_review_enabled:next}).eq("id",u.id).select("id,inflow_review_enabled"); if(error)throw new Error(error.message); if(!data?.[0]||data[0].inflow_review_enabled!==next)throw new Error("권한/RLS로 반영된 행이 없습니다"); await loadUsers(); showToast(next?`🔓 ${u.name||u.email} 리뷰 자동작성 열림`:`🔒 ${u.name||u.email} 리뷰 자동작성 잠금`, "success"); } catch(e:any){ showToast("리뷰 자동작성 권한 저장 실패 — "+e.message, "error"); } }
  async function togglePlace360(u: UserFull) { try { const cur=u.place360_enabled!==false; const next=!cur; const {data,error}=await supabase.from("publy_users").update({place360_enabled:next}).eq("id",u.id).select("id,place360_enabled"); if(error)throw new Error(error.message); if(!data?.[0]||data[0].place360_enabled!==next)throw new Error("권한/RLS로 반영된 행이 없습니다"); await loadUsers(); showToast(next?`🏪 ${u.name||u.email} 플레이스 365 사용 허용`:`🔒 ${u.name||u.email} 플레이스 365 잠금`, "success"); } catch(e:any){ showToast("플레이스 365 권한 저장 실패 — "+e.message, "error"); } }
  // 🔒 기기 잠금 토글 — allow_multi_device. 기본 OFF(한 기기만). ON이면 여러 컴퓨터 동시 로그인 허용.
  //   ON으로 켜면 지금 물려있는 활성 기기도 풀어(active_device_id=null) 즉시 다른 곳에서도 열림.
  async function toggleMultiDevice(u: UserFull) { try { const cur=u.allow_multi_device===true; const next=!cur; const {data,error}=await supabase.from("publy_users").update({allow_multi_device:next, ...(next?{active_device_id:null}:{})}).eq("id",u.id).select("id,allow_multi_device"); if(error)throw new Error(error.message); if(!data?.[0]||data[0].allow_multi_device!==next)throw new Error("권한/RLS로 반영된 행이 없습니다"); await loadUsers(); showToast(next?`🔓 ${u.name||u.email} 여러 기기 허용(어디서나 열림)`:`🔒 ${u.name||u.email} 한 기기만 로그인`, "success"); } catch(e:any){ showToast("기기 설정 저장 실패 — "+e.message, "error"); } }
  async function addNote(uid: string) { if (!newNote.trim()) return; try { const content=newNote.trim(); const {data,error}=await supabase.from("publy_notes").insert({user_id:uid,content}).select("id,user_id,content"); if(error)throw new Error(error.message); if(!data?.[0]||data[0].user_id!==uid||data[0].content!==content)throw new Error("권한/RLS로 반영된 행이 없습니다"); setNewNote(""); await loadUsers(); } catch(e:any){alert("메모 추가 실패 — "+e.message);} }
  async function addPayment(uid: string, plan: string) {
    // 🔒🔒 트래픽 앱은 결제/등급을 여기서 처리하지 않는다.
    //   publy_users.plan·publy_quotas는 퍼블리와 공유하는 테이블 → 여기서 등급/한도를 저장하면 퍼블리 회원 등급이 오염된다(2026-09-05 사고).
    //   트래픽 결제·등급은 관리자 컨트롤타워(tool_licenses)에서만 발급한다.
    void uid; void plan;
    alert("트래픽 등급·결제는 관리자 컨트롤타워(tool_licenses)에서 발급합니다.\n여기서 저장하면 퍼블리 회원 등급이 바뀌므로 비활성화했어요.");
  }
  async function changeAdminPw() {
    if (!newPw1 || newPw1 !== newPw2) { setPwMsg("비밀번호를 확인하세요"); return; }
    if (newPw1.length < 4) { setPwMsg("4자 이상 입력하세요"); return; }
    try {
      await setAdminPassword(newPw1);
      setNewPw1(""); setNewPw2("");
      setPwMsg("✅ 변경 완료 — Supabase에 저장됨");
      setTimeout(() => setPwMsg(""), 3000);
    } catch (e: any) {
      setPwMsg("❌ 변경 실패: " + e.message);
    }
  }

  const filteredUsers = users.filter(u => !search || u.email.includes(search) || (u.name||"").includes(search) || (u.phone||"").includes(search));
  const writeStep = genContent ? 3 : selectedTitle ? 2 : titles.length > 0 ? 1 : 0;
  const connAccs = admAccs.filter(a => a.is_connected && a.platform === platform);

  return (
    <>
      <style>{CSS}</style>
      <div className={`app ${theme} ${fontMode==="large"?"large":""}`}>

        {/* ── 초기 로딩 오버레이 (플리커 방지) ── */}
        {loading && (
          <div style={{position:"fixed",inset:0,background:theme==="dark"?"#050a12":"#f0faf4",zIndex:9999,display:"flex",alignItems:"center",justifyContent:"center"}}>
            <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:16}}>
              <div style={{width:44,height:44,borderRadius:"50%",border:"3px solid rgba(255,107,107,.2)",borderTopColor:"#ff6b6b",animation:"spin 1s linear infinite"}}/>
              <div style={{fontSize:13,color:"var(--text3)",fontWeight:600}}>관리자 페이지 로딩 중...</div>
            </div>
            <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
          </div>
        )}

        {/* ── 관리자 사용설명서 모달 ── */}
        {showGuide && (() => {
          const PINK = "#FF6B9D"; const YELLOW = "#FFD93D"; const GREEN = "#00C875"; const RED = "#f85149";
          const tabs = ["📋 개요","✍️ 글 생성","🖼️ 이미지","👥 회원관리","🏪 360 관리","📊 통계/설정","❓ FAQ"];
          const pages = [
            // 0 - 개요
            <div key="0">
              <div className="g-step" style={{borderColor:`${RED}40`,background:`${RED}08`}}>
                <div className="g-step-num" style={{color:RED}}>🔐 관리자 전용 페이지</div>
                <div className="g-step-title" style={{color:"#fff"}}>Publy 관리자 대시보드</div>
                <div className="g-step-desc">이 페이지는 <b>관리자만 접근</b>할 수 있어요. 회원들의 일반 페이지와 완전히 분리돼 있어요.</div>
              </div>
              <div className="g-step" style={{borderColor:`${YELLOW}40`,background:`${YELLOW}08`}}>
                <div className="g-step-num" style={{color:YELLOW}}>🔑 API 키 완전 분리</div>
                <div className="g-step-title" style={{color:"#fff"}}>관리자 키 ≠ 회원 키</div>
                <div className="g-step-desc">
                  관리자 API 키(<b style={{color:YELLOW}}>publy_adm_*</b>)와 회원 API 키(<b style={{color:GREEN}}>publy_*</b>)는 <b>절대 섞이지 않아요.</b><br/>
                  각 회원도 본인 키만 사용해요. 타인 키를 쓰는 건 구조적으로 불가능해요.
                </div>
              </div>
              {[
                {ico:"✍️ 🖼️",title:"블로그 기능 (사이드바 상단)",desc:"글쓰기 → 이미지 → 발행 → 기록 → 계정. 관리자가 직접 블로그 글을 쓰고 발행할 때 사용",color:GREEN},
                {ico:"🔐",title:"관리자 전용 (사이드바 하단)",desc:"회원관리 / 통계 / 설정. 일반 회원은 절대 접근 불가",color:RED},
              ].map((item,i) => (
                <div key={i} className="g-step" style={{borderColor:`${item.color}35`,background:`${item.color}07`,padding:"12px 14px"}}>
                  <div style={{display:"flex",alignItems:"center",gap:10}}>
                    <span style={{fontSize:22,flexShrink:0}}>{item.ico}</span>
                    <div><div style={{fontSize:14,fontWeight:800,color:item.color}}>{item.title}</div><div style={{fontSize:13,color:"rgba(255,255,255,.7)",marginTop:2}}>{item.desc}</div></div>
                  </div>
                </div>
              ))}
            </div>,

            // 1 - 글 생성
            <div key="1">
              {[
                {num:"STEP 1",ico:"🎯",title:"플랫폼 + 수익화 선택",color:GREEN,desc:<>헤더에서 <b>🟢 네이버</b> 또는 <b>🟠 티스토리</b> 선택. 글쓰기 탭에서 애드포스트/애드센스 선택!</>},
                {num:"STEP 2",ico:"🔍",title:"키워드 입력 + 제목 선택",color:YELLOW,desc:<>키워드 입력 후 Enter. 제목 30개 자동 추천. 최대 90개까지 추가 가능!</>},
                {num:"STEP 3",ico:"📏",title:"글자수 설정 (자동 랜덤 권장)",color:PINK,desc:<><b>🎲 자동 랜덤</b>: 네이버 1800~2500자, 체험단/맛집 2000~3000자, 티스토리 2500~4000자. 매번 달라서 AI 감지 방지!</>},
                {num:"STEP 4",ico:"✨",title:"글 생성",color:"#8B5CF6",desc:<>인트로·소제목·마무리가 매번 달라져요. 네이버/티스토리 프롬프트도 자동 분리!</>},
                {num:"STEP 5",ico:"🚀",title:"이미지 탭으로 이동",color:RED,desc:<>글 완료 후 이미지 탭에서 캡션·영상·패턴 설정 후 발행!</>},
              ].map((s,i) => (
                <div key={i} className="g-step" style={{borderColor:`${s.color}40`,background:`${s.color}08`}}>
                  <div className="g-step-num" style={{color:s.color}}>{s.ico} {s.num}</div>
                  <div className="g-step-title" style={{color:"#fff"}}>{s.title}</div>
                  <div className="g-step-desc">{s.desc}</div>
                </div>
              ))}
              <div className="g-tip">💡 설정 탭에서 관리자 API 키를 먼저 입력해야 글 생성이 가능해요!</div>
            </div>,

            // 2 - 이미지
            <div key="2">
              <div className="g-step" style={{borderColor:`${GREEN}40`,background:`${GREEN}08`}}>
                <div className="g-step-num" style={{color:GREEN}}>🖼️ 이미지마다 캡션 필수!</div>
                <div className="g-step-title" style={{color:"#fff"}}>네이버 상위 노출에 도움이 돼요</div>
                <div className="g-step-desc">이미지 생성 완료 후 캡션이 자동 생성돼요. 직접 수정도 가능해요.</div>
              </div>
              {[
                {ico:"🎲",title:"이미지 배치 패턴",desc:"랜덤(권장): 매 발행마다 자동 변경 → AI 감지 방지!\nA: 중간 1장 / B: 앞뒤 각 1장 / C: 균등 분산"},
                {ico:"🎬",title:"영상 삽입",desc:"네이버TV/유튜브 URL 입력 + 위치 선택(상단/중간/하단). 체험단 영상 필수 업체 대응!"},
                {ico:"✏️",title:"수동 수량 설정",desc:"'직접입력' 선택 후 숫자 입력. 체험단 15장 이상도 가능 (최대 20장)"},
              ].map((item,i) => (
                <div key={i} style={{padding:"12px 14px",borderRadius:12,background:"rgba(255,255,255,.04)",border:"1px solid rgba(255,255,255,.08)",marginBottom:8}}>
                  <div style={{fontSize:15,fontWeight:800,color:"#fff",marginBottom:4}}>{item.ico} {item.title}</div>
                  <div style={{fontSize:13,color:"rgba(255,255,255,.65)",lineHeight:1.7,whiteSpace:"pre-line"}}>{item.desc}</div>
                </div>
              ))}
            </div>,

            // 3 - 회원관리
            <div key="3">
              <div className="g-step" style={{borderColor:`${GREEN}40`,background:`${GREEN}08`}}>
                <div className="g-step-num" style={{color:GREEN}}>👥 회원 목록</div>
                <div className="g-step-title" style={{color:"#fff"}}>회원을 클릭하면 상세 정보가 펼쳐져요</div>
                <div className="g-step-desc">이름, 이메일로 검색 가능. 클릭 한 번으로 상세 확인!</div>
              </div>
              {[
                {ico:"💳",title:"플랜 변경",desc:"FREE → BASIC → PRO로 변경하면 발행 건수 자동 업데이트.",color:YELLOW},
                {ico:"🔢",title:"건수 조정",desc:"총 발행 건수 직접 입력. 특별 혜택 제공 시 사용.",color:PINK},
                {ico:"📅",title:"만료일 연장",desc:"일수 입력 → 현재 만료일에서 자동 연장.",color:"#8B5CF6"},
                {ico:"💰",title:"결제 등록",desc:"금액 + 플랜 선택 → 결제 내역 기록 + 플랜 자동 업그레이드.",color:GREEN},
                {ico:"📝",title:"메모",desc:"회원별 관리 메모. 상담 내역, 요청 사항 기록.",color:RED},
                {ico:"🔍",title:"크롤링 허용/잠김",desc:"버튼에 적힌 게 지금 상태예요. ‘허용됨’=쓸 수 있음, ‘잠김’=못 씀. 누르면 반대로 바뀌어요.",color:"#2f9e5e"},
                {ico:"🏪",title:"플레이스 365 허용/잠김",desc:"‘허용됨’이면 순위·진단·업체수집·고객화면을 쓸 수 있고, ‘잠김’이면 못 써요. 누르면 전환돼요.",color:"#d53d73"},
              ].map((item,i) => (
                <div key={i} className="g-step" style={{borderColor:`${item.color}35`,background:`${item.color}07`,padding:"12px 14px"}}>
                  <div style={{display:"flex",alignItems:"center",gap:10}}>
                    <span style={{fontSize:20,flexShrink:0}}>{item.ico}</span>
                    <div><div style={{fontSize:14,fontWeight:800,color:item.color}}>{item.title}</div><div style={{fontSize:13,color:"rgba(255,255,255,.7)",marginTop:2}}>{item.desc}</div></div>
                  </div>
                </div>
              ))}
              <div className="g-tip">⚠️ <b>저장 버튼</b>을 꼭 눌러야 변경사항이 반영돼요!</div>
            </div>,

            // 4 - 플레이스 365 관리
            <div key="4">
              <div className="g-step" style={{borderColor:"rgba(22,133,107,.45)",background:"rgba(22,133,107,.09)"}}>
                <div className="g-step-num" style={{color:"#4ade80"}}>🏪 회원과 같은 플레이스 365</div>
                <div className="g-step-title" style={{color:"#fff"}}>관리자도 실제 회원 화면과 같은 순서로 직접 시험해요</div>
                <div className="g-step-desc">왼쪽 <b>플레이스 365</b>에서 여러 매장 등록·전환 → 현재 순위 → 공개자료 진단 → 신규·재방문·광고 운영자료 직접 입력·CSV 진단 → 오늘 할 일 → 고객 화면 확인 → 리뷰어 역추적을 그대로 사용할 수 있어요. 관리자는 모든 횟수가 무제한이에요.</div>
              </div>
              {[
                {ico:"🔐",title:"회원 사용 권한",desc:"크롤링 관리에서 회원별 ‘🏪 플레이스 365 허용됨/잠김’ 버튼을 눌러 사용을 허용하거나 잠가요.",color:PINK},
                {ico:"📋",title:"매장 진단 기록",desc:"회원이 저장한 매장·날짜·방문자 리뷰·블로그 리뷰·주변 평균을 확인하고 잘못된 기록은 삭제해요.",color:GREEN},
                {ico:"👀",title:"고객 화면 사용량",desc:"회원별 오늘 사용량을 확인해요. 고객 지원이 필요한 경우에만 ‘초기화’를 눌러 0회로 돌려요.",color:YELLOW},
                {ico:"📊",title:"등급 한도 확인",desc:"회원관리 상세의 ‘모든 기능 한도’에서 등록 매장·진단·순위·고객 화면 확인 횟수를 한꺼번에 확인해요.",color:"#3b82f6"},
              ].map((item,i)=><div key={i} className="g-step" style={{borderColor:`${item.color}35`,background:`${item.color}08`,padding:"12px 14px"}}><div style={{display:"flex",gap:10,alignItems:"flex-start"}}><span style={{fontSize:21}}>{item.ico}</span><div><div style={{fontSize:14,fontWeight:850,color:item.color}}>{item.title}</div><div style={{fontSize:13,color:"rgba(255,255,255,.72)",lineHeight:1.7,marginTop:3}}>{item.desc}</div></div></div></div>)}
              <div className="g-tip">⚠️ 플레이스는 외부 공개 화면을 확인하는 민감한 작업이에요. 같은 네이버 계정에서 다른 자동화가 실행 중이면 완료 후 다시 시도하고, 무리하게 반복 실행하지 마세요.</div>
              <button className="g-btn" style={{background:"linear-gradient(135deg,#16856b,#22a880)",color:"#fff"}} onClick={()=>{setShowGuide(false);setTab("crawl_manage");}}>🏪 플레이스 회원 관리 열기</button>
            </div>,

            // 5 - 통계/설정
            <div key="5">
              <div className="g-step" style={{borderColor:`${YELLOW}40`,background:`${YELLOW}08`}}>
                <div className="g-step-num" style={{color:YELLOW}}>📊 통계 탭</div>
                <div className="g-step-title" style={{color:"#fff"}}>한눈에 보는 서비스 현황</div>
                <div className="g-step-desc">
                  {[["전체 회원","가입 회원 수 총합"],["활성 회원","현재 이용 중"],["PRO/BASIC 회원","플랜별 수"],["총 발행 건수","전체 합산"],["플랜 분포 바","FREE/BASIC/PRO 비율"],["발행 TOP 10","가장 많이 발행한 회원 순위"]].map(([t,d],i) => (
                    <div key={i} style={{display:"flex",justifyContent:"space-between",padding:"7px 0",borderBottom:i<5?"1px solid rgba(255,255,255,.06)":"none",fontSize:13}}>
                      <b style={{color:"#fff"}}>{t}</b><span style={{color:"rgba(255,255,255,.55)"}}>{d}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="g-step" style={{borderColor:`${RED}40`,background:`${RED}08`}}>
                <div className="g-step-num" style={{color:RED}}>🔐 설정 탭 - 관리자 API 키</div>
                <div className="g-step-title" style={{color:"#fff"}}>회원 키와 완전 분리!</div>
                <div className="g-step-desc">
                  관리자 키는 <b>publy_adm_*</b>로 저장. 회원 키(publy_*)와 절대 섞이지 않아요.<br/>
                  글쓰기 AI(Gemini/Groq/GPT), 이미지 AI(DALL-E/Flux) 각각 설정!
                </div>
                <button className="g-btn" style={{background:`linear-gradient(135deg,${YELLOW},#FFA500)`,color:"#000"}}
                  onClick={() => { setShowGuide(false); setTab("settings"); }}>🔐 API 키 설정하러 가기</button>
              </div>
            </div>,

            // 6 - FAQ
            <div key="6">
              {[
                {q:"회원이 오류가 났다고 연락했어요",a:"회원관리 탭 → 해당 회원의 오류확인 버튼을 누르면 언제/어디서/어떤 오류인지 바로 확인할 수 있어요. 오류는 자동으로 저장돼요.",c:RED},
                {q:"설치할 때 'Publy cannot be closed' 문구가 떠요",a:"이전에 실행 중인 Publy가 완전히 꺼지지 않은 거예요.\nCtrl+Shift+Esc → 프로세스 탭 → Publy 찾기 → 마우스 우클릭 → 작업 끝내기 → 다시 시도 클릭하면 돼요.",c:PINK},
                {q:"봇이 계속 오프라인으로 떠요",a:"PC에서 Publy 앱이 실행 중인지 확인하세요. 앱을 껐다 켜면 봇이 자동으로 켜져요. 봇은 반드시 PC에서 실행해야 해요.",c:YELLOW},
                {q:"회원이 발행이 안 된다고 해요",a:"1) 봇 온라인 상태 확인 2) 계정 연결 상태 확인 3) 발행 건수 초과 여부 확인 4) 회원의 오류확인 버튼으로 구체적인 오류 메시지 확인",c:GREEN},
                {q:"새 오류 배지가 안 사라져요",a:"오류 팝업을 열고 '모두 읽음' 버튼을 누르면 배지가 사라져요.",c:"#8B5CF6"},
                {q:"회원을 비활성화하면 어떻게 되나요?",a:"비활성화된 회원은 로그인이 차단돼요. 발행 기록과 데이터는 그대로 보존되고, 다시 활성화하면 정상 사용 가능해요.",c:"#4ECDC4"},
                {q:"회원이 플레이스 365을 열 수 없어요",a:"1) 회원이 활성 상태인지 확인 2) 이용기간이 남았는지 확인 3) 크롤링·플레이스 관리에서 해당 회원의 ‘🏪 360’이 ON인지 확인하세요.",c:"#d53d73"},
                {q:"고객 화면 확인 횟수를 모두 썼대요",a:"크롤링·플레이스 관리 아래 ‘오늘 고객 화면 확인 사용량’에서 해당 회원을 찾고, 상담상 필요할 때만 초기화하세요. 등급 자체 한도는 회원관리 기능표에서 확인할 수 있어요.",c:"#16856b"},
              ].map((item,i)=>(
                <div key={i} className="g-step" style={{borderColor:`${item.c}55`,background:`${item.c}15`,marginBottom:10,padding:"14px 16px"}}>
                  <div style={{fontSize:13,fontWeight:900,color:item.c,marginBottom:6}}>Q. {item.q}</div>
                  <div style={{fontSize:13,color:"rgba(255,255,255,.85)",lineHeight:1.8,whiteSpace:"pre-line"}}>👉 {item.a}</div>
                </div>
              ))}
            </div>,
          ];

          return (
            <div className="guide-overlay" onClick={() => setShowGuide(false)}>
              <div className="guide-modal" onClick={e => e.stopPropagation()}>
                <div className="guide-header" style={{position:"relative"}}>
                  <div className="guide-logo-row">
                    <div className="guide-logo-ico">📋</div>
                    <div>
                      <div className="guide-title">관리자 사용설명서</div>
                      <div className="guide-subtitle">Publy 관리자 페이지 완전 가이드</div>
                    </div>
                  </div>
                  <button className="guide-close" onClick={() => setShowGuide(false)}>✕</button>
                  <div className="guide-tabs">
                    {tabs.map((t,i) => (
                      <button key={i} className={`guide-tab ${guideTab===i?"active":""}`} onClick={() => setGuideTab(i)}>{t}</button>
                    ))}
                  </div>
                </div>
                <div className="guide-body">{pages[guideTab]}</div>
                <div className="guide-footer">
                  <button className="guide-nav-btn" style={{borderColor:"rgba(255,255,255,.15)",background:"transparent",color:"rgba(255,255,255,.6)"}} onClick={() => setGuideTab(Math.max(0,guideTab-1))} disabled={guideTab===0}>← 이전</button>
                  <span className="guide-page">{guideTab+1} / {tabs.length}</span>
                  {guideTab < tabs.length-1
                    ? <button className="guide-nav-btn" style={{borderColor:YELLOW,background:`${YELLOW}15`,color:YELLOW}} onClick={() => setGuideTab(guideTab+1)}>다음 →</button>
                    : <button className="guide-nav-btn" style={{borderColor:GREEN,background:`${GREEN}15`,color:GREEN}} onClick={() => setShowGuide(false)}>✅ 확인!</button>
                  }
                </div>
              </div>
            </div>
          );
        })()}

        {/* 헤더 */}
        <div className="header">
          <div className="logo">
            <div className="logo-ico" style={{fontSize:16,fontWeight:900,color:"#fff"}}>T</div>
            <span className="logo-text">TRAFFIC ADM</span>
          </div>
          <div className="header-mid">
            <button className="plat-hdr-btn" onClick={()=>{setPlatform("naver");if(pubAccId)loadCategories("naver");}}
              style={{background:platform==="naver"?"rgba(3,199,90,.12)":"transparent",color:platform==="naver"?"var(--naver)":"var(--text2)",borderColor:platform==="naver"?"rgba(3,199,90,.4)":"var(--border)"}}>
              🟢 네이버
            </button>
            <button className="plat-hdr-btn" onClick={()=>{setPlatform("tistory");if(pubAccId)loadCategories("tistory");}}
              style={{background:platform==="tistory"?"rgba(255,107,53,.12)":"transparent",color:platform==="tistory"?"var(--tistory)":"var(--text2)",borderColor:platform==="tistory"?"rgba(255,107,53,.4)":"var(--border)"}}>
              🟠 티스토리
            </button>
            <div style={{width:1,height:16,background:"var(--border)",flexShrink:0}}/>
            <div className={`server-badge ${botOnline?"server-on":"server-off"}`}>
              <span className={`dot ${botOnline?"dot-on":"dot-off"}`}/>
              {botOnline?"봇 온라인":"봇 오프라인"}
            </div>
            <span className="adm-badge">🔐 관리자</span>
          </div>
          <div className="header-right">
            <button className="icon-btn" onClick={onThemeToggle}>{theme==="dark"?"☀️":"🌙"}</button>
            <button className="icon-btn" onClick={handleHeaderRefresh} title="새로고침" aria-label="새로고침" disabled={refreshing}><span style={{display:"inline-block",animation:refreshing?"publySpin .55s linear infinite":"none"}}>🔄</span></button>
            <button className="adm-guide-btn" onClick={() => { setShowGuide(true); setGuideTab(0); }}>
              📋 <span className="adm-guide-text">관리자 가이드</span>
            </button>
            {unreadErrors>0&&(
              <button onClick={()=>{setShowAllErrors(true);loadErrorLogs();markErrorsAsRead().then(()=>setUnreadErrors(0));}} style={{position:"relative",padding:"6px 14px",borderRadius:20,background:"#f85149",color:"#fff",border:"none",cursor:"pointer",fontSize:12,fontWeight:800,fontFamily:"inherit",animation:"pulse 1.5s ease-in-out infinite",whiteSpace:"nowrap"}}>
                🚨 새 오류 {unreadErrors}건
              </button>
            )}
            <button className="back-btn" onClick={onDashboard}>🏠 <span className="back-text">회원 화면</span></button>
            <button className="back-btn" style={{borderColor:"rgba(248,81,73,.3)",color:"var(--danger)"}} onClick={onBack}>🚪 <span className="back-text">로그아웃</span></button>
          </div>
        </div>

        <div className="layout">
          {/* 사이드바 */}
          <div className="sidebar">
            {/* 🔗 회원 대시보드와 동일한 분류·순서 (관리자 차이=무제한·크롤링 잠금없음뿐). 순서 보장 위해 명시 배열로 렌더 */}
            {(() => {
              const navBtn = (k: string) => {
                const t = TABS.find(x => x.k === k); if (!t) return null;
                const isHot = t.k==="crawl";
                return (
                  <button key={t.k} className={`nav-item ${tab===t.k?"active":""} ${isHot?"nav-shine":""}`} onClick={()=>setTab(t.k as any)}>
                    <span className="nav-ico">{t.i}</span>{t.l}
                    {isHot && <span className="nav-hot">HOT</span>}
                    {t.k==="users" && users.length>0 && <span className="nav-badge">{users.length}</span>}
                  </button>
                );
              };
              const secStyle = {fontSize:10,fontWeight:800,color:"var(--text3)",padding:"10px 12px 4px",letterSpacing:".08em",borderTop:"1px solid var(--border)",marginTop:6} as const;
              return (<>
                <div className="nav-section" style={{...secStyle,borderTop:"none",marginTop:0,padding:"8px 12px 4px"}}>콘텐츠 만들기</div>
                {["keyword","write","image","photo","publish","onetouch"].map(navBtn)}
                <div className="nav-section" style={secStyle}>블로그 운영</div>
                {["calendar","manage","blogscore","crawl","inflow"].map(navBtn)}
                <div className="nav-box">
                  <div className="nav-box-lbl">플레이스</div>
                  {["place","place_reply"].map(navBtn)}
                </div>
                <div className="nav-section" style={secStyle}>관계·소통 자동화</div>
                {["neighbor","engage","reply","pumasi","insta_dm"].map(navBtn)}
                <div className="nav-section" style={secStyle}>계정·설정</div>
                {["accounts","settings"].map(navBtn)}
                <div className="nav-section" style={{...secStyle,color:"#FF6B9D",background:"linear-gradient(90deg,rgba(255,107,157,.08),transparent)"}}>🔐 관리자 전용</div>
                {["crawl_manage","place_manage","place_reply_manage","users","stats","proxy","insta_dm_manage","neighbor_manage","engage_manage","reply_manage","blogscore_manage"].map(navBtn)}
              </>);
            })()}
            <div className="sidebar-stats">
              <div className="stat-box">
                <div className="stat-num">{users.length}</div>
                <div className="stat-lbl">전체 회원</div>
              </div>
              <div className="stat-box" style={{background:"rgba(248,81,73,.06)",borderColor:"rgba(248,81,73,.2)"}}>
                <div className="stat-num" style={{fontSize:18,color:"var(--danger)"}}>{users.filter(u=>u.is_active).length}</div>
                <div className="stat-lbl">활성 회원</div>
              </div>
            </div>
          </div>

          {/* 메인 */}
          <div className="main">

            {/* ───── 🔍 크롤링 (회원과 동일 · 관리자는 잠금 없이 항상 사용) · 탭 이동해도 작업 유지 keep-alive ───── */}
            {visitedAutoTabs.has("crawl") && (
              <div style={{ display: tab === "crawl" ? "block" : "none" }}><CrawlCenter showToast={showToast} theme={theme==="dark"?"dark":"light"} userId={ADM_HISTORY_UID} plan="unlimited" /></div>
            )}

            {/* ───── 🆕 NEW 트래픽 유입 (회원과 동일 · 관리자는 무제한) · 탭 이동해도 작업 유지 keep-alive ───── */}
            {visitedAutoTabs.has("inflow") && (
              <div style={{ display: tab === "inflow" ? "block" : "none" }}><InflowCenter showToast={showToast} theme={theme==="dark"?"dark":"light"} userId={ADM_HISTORY_UID} plan="unlimited" /></div>
            )}

            {/* ───── 🏪 플레이스 365 (회원과 동일 · 관리자는 무제한) ───── */}
            {visitedAutoTabs.has("place") && (
              <div style={{ display: tab === "place" ? "block" : "none" }}><Place360 showToast={showToast} theme={theme==="dark"?"dark":"light"} userId={ADM_UID} plan="admin" onOpenCrawl={()=>setTab("crawl")} onOpenReview={()=>setTab("place_reply")} /></div>
            )}
            {/* ───── 🗣️ 플레이스 리뷰답글 (회원과 동일 · 관리자는 무제한) ───── */}
            {tab==="place_reply" && (
              <PlaceReview showToast={showToast} theme={theme==="dark"?"dark":"light"} userId={ADM_UID} plan="admin" onOpenPlace={()=>setTab("place")} />
            )}

            {/* ───── 🔎 크롤링·플레이스 365 관리 (관리자 전용 · 공용 권한 승인) ───── */}
            {tab === "crawl_manage" && (
              <div style={{animation:"fadeUp .25s ease both"}}>
                <div className="card">
                  <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap",marginBottom:6}}>
                    <div className="card-title" style={{margin:0}}>🔎 크롤링·플레이스 365 관리</div>
                    <span style={{fontSize:11,fontWeight:800,color:"#ff6fa5",background:"rgba(255,111,165,.12)",padding:"2px 9px",borderRadius:99}}>회원 공용 권한</span>
                    <button onClick={loadUsers} style={{marginLeft:"auto",padding:"7px 13px",borderRadius:8,border:"1px solid var(--border)",background:"var(--bg)",color:"var(--text2)",cursor:"pointer",fontSize:12,fontWeight:700,fontFamily:"inherit"}}>↻ 새로고침</button>
                  </div>
                  <div style={{fontSize:12.5,color:"var(--text2)",lineHeight:1.7,marginBottom:10}}>회원마다 <b style={{color:"var(--text)"}}>크롤링</b>과 <b style={{color:"var(--text)"}}>플레이스 365</b> 권한을 각각 켜고 끕니다. 플레이스 365을 켜야 매장 진단·측정 기록·업체 수집·리뷰어 역추적을 사용할 수 있어요. 관리자는 항상 열려 있고 모든 횟수가 무제한입니다.</div>
                  <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:14}}>{["현재 순위 측정","매장 원인 진단","고객 화면 상세 확인","정보 완성도·개선 순서","업체 크롤링","리뷰어 역추적","크롤링 제안 연결"].map(label=><span key={label} style={{fontSize:11,fontWeight:750,color:"#16856b",background:"rgba(22,133,107,.1)",border:"1px solid rgba(22,133,107,.2)",padding:"5px 9px",borderRadius:99}}>✓ {label}</span>)}</div>
                  <input className="inp" placeholder="🔍 이름·이메일 검색" value={search} onChange={e=>setSearch(e.target.value)} style={{marginBottom:12}} />
                  {(() => {
                    const q = search.trim().toLowerCase();
                    const list = users.filter(u => !q || (u.name||"").toLowerCase().includes(q) || (u.email||"").toLowerCase().includes(q));
                    const onCount = users.filter(u=>u.crawl_enabled!==false).length;
                    const placeOnCount = users.filter(u=>u.place360_enabled!==false).length;
                    return (<>
                      <div style={{display:"flex",gap:8,marginBottom:12,flexWrap:"wrap"}}>
                        <span style={{fontSize:12,fontWeight:800,color:"var(--text2)",background:"var(--bg)",border:"1px solid var(--border)",padding:"6px 12px",borderRadius:99}}>전체 {users.length}명</span>
                        <span style={{fontSize:12,fontWeight:800,color:"#2f9e5e",background:"rgba(47,158,94,.1)",border:"1px solid rgba(47,158,94,.25)",padding:"6px 12px",borderRadius:99}}>🔍 크롤링 켜짐 {onCount}명</span>
                        <span style={{fontSize:12,fontWeight:800,color:"#d53d73",background:"rgba(213,61,115,.1)",border:"1px solid rgba(213,61,115,.25)",padding:"6px 12px",borderRadius:99}}>🏪 플레이스 365 켜짐 {placeOnCount}명</span>
                      </div>
                      {loading ? <div style={{padding:"30px 0",textAlign:"center",color:"var(--text3)"}}><span className="spinner"/> 회원 불러오는 중…</div>
                       : list.length===0 ? <div style={{padding:"30px 0",textAlign:"center",color:"var(--text3)"}}>회원이 없습니다.</div>
                       : <div style={{display:"flex",flexDirection:"column",gap:8}}>
                          {list.map(u=>(
                            <div key={u.id} style={{display:"flex",alignItems:"center",gap:12,padding:"12px 14px",border:"1px solid var(--border)",borderRadius:12,background:"var(--bg)"}}>
                              <div style={{minWidth:0,flex:1}}>
                                <div style={{fontSize:14,fontWeight:700,color:"var(--text)",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{u.name||"(이름 없음)"} <span style={{fontSize:11,fontWeight:600,color:"var(--text3)"}}>{u.plan}</span></div>
                                <div style={{fontSize:11.5,color:"var(--text3)",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{u.email}</div>
                              </div>
                              {(()=>{ const crawlOn=u.crawl_enabled!==false; const placeOn=u.place360_enabled!==false; const multiOn=u.allow_multi_device===true; const inflowOn=u.inflow_enabled===true; const reviewOn=u.inflow_review_enabled===true; return <div style={{display:"flex",gap:6,flexWrap:"wrap",justifyContent:"flex-end"}}><button onClick={()=>toggleCrawl(u)} title={crawlOn?"이 회원은 크롤링을 쓸 수 있어요 — 누르면 잠급니다":"이 회원은 크롤링이 잠겨 있어요 — 누르면 허용합니다"} style={{padding:"8px 12px",borderRadius:99,border:`1.5px solid ${crawlOn?"#2f9e5e":"var(--border)"}`,background:crawlOn?"rgba(47,158,94,.12)":"var(--card)",color:crawlOn?"#2f9e5e":"var(--text3)",cursor:"pointer",fontSize:11.5,fontWeight:800,fontFamily:"inherit",whiteSpace:"nowrap"}}>🔍 크롤링 {crawlOn?"허용됨":"잠김"}</button><button onClick={()=>toggleInflow(u)} title={inflowOn?"이 회원은 트래픽 유입을 쓸 수 있어요 — 누르면 잠급니다":"트래픽 유입이 잠겨 있어요 — 누르면 허용합니다"} style={{padding:"8px 12px",borderRadius:99,border:`1.5px solid ${inflowOn?"#2563eb":"var(--border)"}`,background:inflowOn?"rgba(37,99,235,.12)":"var(--card)",color:inflowOn?"#2563eb":"var(--text3)",cursor:"pointer",fontSize:11.5,fontWeight:800,fontFamily:"inherit",whiteSpace:"nowrap"}}>🆕 트래픽 유입 {inflowOn?"허용됨":"잠김"}</button><button onClick={()=>toggleInflowReview(u)} title={reviewOn?"이 회원은 리뷰 자동작성을 쓸 수 있어요(밴 위험) — 누르면 잠급니다":"리뷰 자동작성이 잠겨 있어요(밴 위험) — 누르면 허용합니다"} style={{padding:"8px 12px",borderRadius:99,border:`1.5px solid ${reviewOn?"#dc2626":"var(--border)"}`,background:reviewOn?"rgba(220,38,38,.12)":"var(--card)",color:reviewOn?"#dc2626":"var(--text3)",cursor:"pointer",fontSize:11.5,fontWeight:800,fontFamily:"inherit",whiteSpace:"nowrap"}}>✍️ 리뷰작성 {reviewOn?"허용됨":"잠김"}</button><button onClick={()=>togglePlace360(u)} title={placeOn?"이 회원은 플레이스 365을 쓸 수 있어요 — 누르면 잠급니다":"이 회원은 플레이스 365이 잠겨 있어요 — 누르면 허용합니다"} style={{padding:"8px 12px",borderRadius:99,border:`1.5px solid ${placeOn?"#d53d73":"var(--border)"}`,background:placeOn?"rgba(213,61,115,.12)":"var(--card)",color:placeOn?"#d53d73":"var(--text3)",cursor:"pointer",fontSize:11.5,fontWeight:800,fontFamily:"inherit",whiteSpace:"nowrap"}}>🏪 플레이스 365 {placeOn?"허용됨":"잠김"}</button><button onClick={()=>toggleMultiDevice(u)} title={multiOn?"여러 컴퓨터에서 동시 로그인 허용 중 — 누르면 한 기기만 허용":"한 기기만 로그인(다른 컴퓨터는 튕김) — 누르면 여러 기기 허용"} style={{padding:"8px 12px",borderRadius:99,border:`1.5px solid ${multiOn?"#e0952f":"var(--border)"}`,background:multiOn?"rgba(224,149,47,.12)":"var(--card)",color:multiOn?"#e0952f":"var(--text3)",cursor:"pointer",fontSize:11.5,fontWeight:800,fontFamily:"inherit",whiteSpace:"nowrap"}}>{multiOn?"🔓 여러기기":"🔒 한기기"}</button></div>; })()}
                            </div>
                          ))}
                         </div>}
                    </>);
                  })()}
                </div>
              </div>
            )}

            {/* ───── 🏪 플레이스 365 회원 관리 (관리자 전용) ───── */}
            {tab === "place_manage" && (
              <div style={{animation:"fadeUp .25s ease both"}}>
                <div className="card">
                  <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap",marginBottom:6}}>
                    <div className="card-title" style={{margin:0}}>🏪 플레이스 365 회원 관리</div>
                    <span style={{fontSize:11,fontWeight:800,color:"#d53d73",background:"rgba(213,61,115,.12)",padding:"2px 9px",borderRadius:99}}>관리자 전용</span>
                    <button onClick={loadUsers} style={{marginLeft:"auto",padding:"7px 13px",borderRadius:8,border:"1px solid var(--border)",background:"var(--bg)",color:"var(--text2)",cursor:"pointer",fontSize:12,fontWeight:700,fontFamily:"inherit"}}>↻ 새로고침</button>
                  </div>
                  <div style={{fontSize:12.5,color:"var(--text2)",lineHeight:1.7,marginBottom:10}}>회원별 <b style={{color:"var(--text)"}}>플레이스 365</b> 사용 권한을 켜고 끕니다. 켜야 매장 진단·순위 측정·경쟁사 비교·업체 발굴·리뷰어 역추적을 쓸 수 있어요. 관리자는 항상 열려 있고 모든 횟수가 무제한입니다.</div>
                  <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:14}}>{["링크 검사·별점","현재 순위 측정","경쟁사 비교","자동 키워드 발굴","성과 리포트·PDF","업체 발굴·리뷰어 역추적","측정 기록 보관"].map(label=><span key={label} style={{fontSize:11,fontWeight:750,color:"#d53d73",background:"rgba(213,61,115,.1)",border:"1px solid rgba(213,61,115,.2)",padding:"5px 9px",borderRadius:99}}>✓ {label}</span>)}</div>
                  <input className="inp" placeholder="🔍 이름·이메일 검색" value={search} onChange={e=>setSearch(e.target.value)} style={{marginBottom:12}} />
                  {(() => {
                    const q = search.trim().toLowerCase();
                    const list = users.filter(u => !q || (u.name||"").toLowerCase().includes(q) || (u.email||"").toLowerCase().includes(q));
                    const placeOnCount = users.filter(u=>u.place360_enabled!==false).length;
                    return (<>
                      <div style={{display:"flex",gap:8,marginBottom:12,flexWrap:"wrap"}}>
                        <span style={{fontSize:12,fontWeight:800,color:"var(--text2)",background:"var(--bg)",border:"1px solid var(--border)",padding:"6px 12px",borderRadius:99}}>전체 {users.length}명</span>
                        <span style={{fontSize:12,fontWeight:800,color:"#d53d73",background:"rgba(213,61,115,.1)",border:"1px solid rgba(213,61,115,.25)",padding:"6px 12px",borderRadius:99}}>🏪 플레이스 365 켜짐 {placeOnCount}명</span>
                      </div>
                      {loading ? <div style={{padding:"30px 0",textAlign:"center",color:"var(--text3)"}}><span className="spinner"/> 회원 불러오는 중…</div>
                       : list.length===0 ? <div style={{padding:"30px 0",textAlign:"center",color:"var(--text3)"}}>회원이 없습니다.</div>
                       : <div style={{display:"flex",flexDirection:"column",gap:8}}>
                          {list.map(u=>{ const placeOn=u.place360_enabled!==false; return (
                            <div key={u.id} style={{display:"flex",alignItems:"center",gap:12,padding:"12px 14px",border:"1px solid var(--border)",borderRadius:12,background:"var(--bg)"}}>
                              <div style={{minWidth:0,flex:1}}>
                                <div style={{fontSize:14,fontWeight:700,color:"var(--text)",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{u.name||"(이름 없음)"} <span style={{fontSize:11,fontWeight:600,color:"var(--text3)"}}>{u.plan}</span></div>
                                <div style={{fontSize:11.5,color:"var(--text3)",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{u.email}</div>
                              </div>
                              <button onClick={()=>togglePlace360(u)} title={placeOn?"이 회원은 플레이스365를 쓸 수 있어요 — 누르면 잠급니다":"이 회원은 플레이스365가 잠겨 있어요 — 누르면 허용합니다"} style={{padding:"8px 14px",borderRadius:99,border:`1.5px solid ${placeOn?"#d53d73":"var(--border)"}`,background:placeOn?"rgba(213,61,115,.12)":"var(--card)",color:placeOn?"#d53d73":"var(--text3)",cursor:"pointer",fontSize:12,fontWeight:800,fontFamily:"inherit",whiteSpace:"nowrap"}}>🏪 플레이스 365 {placeOn?"허용됨":"잠김"}</button>
                            </div>
                          ); })}
                         </div>}
                    </>);
                  })()}
                  <Place360AdminManager showToast={showToast} />
                </div>
              </div>
            )}
            {/* ───── 🗣️ 리뷰답글 관리 (관리자 전용) ───── */}
            {tab === "place_reply_manage" && (
              <div style={{animation:"fadeUp .25s ease both"}}>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:10,marginBottom:16}}>
                  <div>
                    <div style={{fontSize:19,fontWeight:900,color:"var(--text)"}}>🗣️ 리뷰답글 관리</div>
                    <div style={{fontSize:12,color:"var(--text3)",marginTop:4}}>회원들이 매장 리뷰에 남긴 사장님 답글 이력이에요. {placeReplyHistory.length>0&&`· 총 ${placeReplyHistory.length}건`}</div>
                  </div>
                  <button onClick={()=>{setPlaceReplyLoading(true);getAllPlaceReplyHistory().then(d=>{setPlaceReplyHistory(d);setPlaceReplyLoading(false);});}} disabled={placeReplyLoading} style={{padding:"8px 16px",borderRadius:9,border:"none",background:"var(--accent)",color:"#000",cursor:"pointer",fontSize:12,fontWeight:800,fontFamily:"inherit"}}>{placeReplyLoading?"불러오는 중...":"🔄 새로고침"}</button>
                </div>
                <div className="card">
                  {placeReplyLoading&&placeReplyHistory.length===0 ? <div style={{padding:"40px",textAlign:"center",color:"var(--text3)"}}>불러오는 중...</div>
                  : placeReplyHistory.length===0 ? <div style={{padding:"40px",textAlign:"center",color:"var(--text3)",fontSize:13}}>아직 리뷰답글 이력이 없어요.<br/><span style={{fontSize:11.5}}>회원이 리뷰답글을 등록하면 여기 쌓여요.</span></div>
                  : <div style={{overflowX:"auto"}}><table style={{width:"100%",borderCollapse:"collapse",fontSize:13,minWidth:560}}>
                      <thead><tr style={{borderBottom:"2px solid var(--border)"}}>{["회원","매장","결과","답글 내용","시각"].map(h=><th key={h} style={{padding:"9px 10px",textAlign:"left",fontWeight:700,color:"var(--text3)",whiteSpace:"nowrap"}}>{h}</th>)}</tr></thead>
                      <tbody>{placeReplyHistory.map(r=>(<tr key={r.id} style={{borderBottom:"1px solid var(--border)"}}>
                        <td style={{padding:"9px 10px",fontWeight:600,whiteSpace:"nowrap"}}>{r.user_name||r.user_email||r.user_id.slice(0,8)}</td>
                        <td style={{padding:"9px 10px",maxWidth:180,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}} title={r.store_name}>{r.store_name||"-"}</td>
                        <td style={{padding:"9px 10px"}}><span style={{fontSize:11.5,fontWeight:700,color:r.status==="success"?"var(--success)":r.status==="fail"?"var(--danger)":"var(--text3)"}}>{r.status==="success"?"✅ 성공":r.status==="fail"?"❌ 실패":"⏭️ 스킵"}</span></td>
                        <td style={{padding:"9px 10px",color:"var(--text2)",maxWidth:220,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}} title={r.message}>{r.message||"-"}</td>
                        <td style={{padding:"9px 10px",color:"var(--text3)",whiteSpace:"nowrap"}}>{new Date(r.created_at).toLocaleString("ko-KR",{month:"numeric",day:"numeric",hour:"2-digit",minute:"2-digit"})}</td>
                      </tr>))}</tbody></table></div>}
                </div>
              </div>
            )}

            {/* ───── ✍️ 글 생성 ───── */}
            {/* ───── 🔍 키워드/제목 ───── */}
            {tab === "keyword" && (
              <div style={{animation:"fadeUp .25s ease both"}}>
                <UsageGuide theme={theme==="dark"?"dark":"light"} subtitle="펄리예요! 쓸 주제부터 정해봐요. 인기 키워드와 제목을 추천해줄게요." steps={[{ico:"✏️",title:"주제·키워드 입력",desc:"쓰고 싶은 주제나 키워드를 적어요(예: 강남 맛집)."},{ico:"💡",title:"추천 받기",desc:"버튼을 누르면 인기 키워드와 제목 후보를 보여줘요."},{ico:"➡️",title:"제목 고르기",desc:"마음에 드는 제목을 고르면 ‘글 생성’으로 이어가요."}]} />
                <div className="card">
                  <div className="card-title">🎯 수익화 목적</div>
                  <div className="adtype-grid">
                    {([{id:"adpost",label:"📰 네이버 애드포스트",sub:"감성적·경험 공유형, 1200~1500자",cls:"adpost-sel"},{id:"adsense",label:"🔍 구글 애드센스",sub:"정보성·SEO 최적화, 1500자+",cls:"adsense-sel"}] as const).map(t=>(
                      <button key={t.id} className={`adtype-btn ${adType===t.id?t.cls:""}`} onClick={()=>setAdType(t.id)}>
                        <div className="adtype-label">{t.label}</div><div className="adtype-sub">{t.sub}</div>
                      </button>
                    ))}
                  </div>
                  {keywords.length>0&&(
                    <div style={{marginBottom:14}}>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                        <label className="inp-label" style={{margin:0}}>🏷️ 누적 키워드 ({keywords.length}/{MAX_KW})</label>
                        <button style={{padding:"4px 10px",borderRadius:7,border:"1px solid rgba(248,81,73,.3)",background:"rgba(248,81,73,.1)",color:"var(--danger)",cursor:"pointer",fontSize:11,fontFamily:"inherit"}} onClick={()=>{setKeywords([]);localStorage.removeItem("publy_adm_kws");}}>전체 삭제</button>
                      </div>
                      <div style={{display:"flex",flexWrap:"wrap",gap:7}}>
                        {keywords.map((kw,i)=>(
                          <button key={i} onClick={()=>setKeyword(kw)} style={{padding:"8px 15px",borderRadius:99,fontSize:13,fontWeight:600,cursor:"pointer",border:`1.5px solid ${keyword===kw?"var(--accent)":"var(--border)"}`,background:keyword===kw?"var(--accent-bg)":"var(--bg)",color:keyword===kw?"var(--accent-text)":"var(--text2)",fontFamily:"inherit",transition:"all .15s"}}>{kw}</button>
                        ))}
                      </div>
                    </div>
                  )}
                  <label className="inp-label">🔍 키워드 입력</label>
                  <div style={{display:"flex",gap:8}}>
                    <input className="inp lg" style={{flex:1}} placeholder="예: 강남 맛집, 다이어트 방법..."
                      value={keyword} onChange={e=>setKeyword(e.target.value)} onKeyDown={e=>e.key==="Enter"&&handleGenerateTitles(true)}/>
                    <select className="inp" style={{width:100}} value={platform} onChange={e=>setPlatform(e.target.value as any)}>
                      <option value="naver">네이버</option><option value="tistory">티스토리</option>
                    </select>
                  </div>
                  <div style={{display:"flex",gap:8,marginTop:12,flexWrap:"wrap"}}>
                    <button className="btn btn-primary" onClick={()=>handleGenerateTitles(true)} disabled={loadingTitles||!keyword}>
                      {loadingTitles?<><span className="spinner"/>생성 중...</>:<>⭐ 제목 {BATCH}개 추천</>}
                    </button>
                    {titles.length>0&&<button className="btn btn-secondary" onClick={()=>handleGenerateTitles(false)} disabled={loadingTitles}>{titles.length>=MAX_TITLES?"🔄 초기화 후 재생성":"➕ 30개 추가"}</button>}
                    {titles.length>0&&<button className="btn btn-sm" style={{background:"rgba(248,81,73,.1)",color:"var(--danger)",border:"1px solid rgba(248,81,73,.3)"}} onClick={()=>{setTitles([]);setSelectedTitle("");localStorage.removeItem("publy_adm_titles");}}>🗑 초기화</button>}
                    <div style={{display:"flex",alignItems:"center",gap:6}}>
                      <button className="btn btn-secondary" onClick={fetchKeywordData} disabled={loadingKw||!keyword} style={{borderColor:"var(--naver)",color:"var(--naver)"}}>
                        {loadingKw?<><span className="spinner"/>수집 중...</>:"📊 황금 키워드 분석"}
                      </button>
                      <button onClick={()=>setShowKwInfo(true)} style={{padding:"7px 14px",borderRadius:8,border:"none",background:"linear-gradient(135deg,#ff6b9d,#ff4081)",color:"#fff",cursor:"pointer",fontSize:12,fontWeight:800,fontFamily:"inherit",whiteSpace:"nowrap",boxShadow:"0 3px 10px rgba(255,64,129,.35)"}}>
                        💡 이게 뭐야?
                      </button>
                    </div>
                  </div>

                  {/* 황금 키워드 결과 테이블 */}
                  {kwData.length>0&&(
                    <div className="card" style={{marginTop:12,padding:0,overflow:"hidden",animation:"fadeUp .2s ease both"}}>
                      <div style={{padding:"12px 16px",borderBottom:"1px solid var(--border)",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                        <span style={{fontSize:13,fontWeight:800,color:"var(--text)"}}>📊 키워드 분석 결과</span>
                        <button onClick={()=>setKwData([])} style={{background:"transparent",border:"none",color:"var(--text3)",cursor:"pointer",fontSize:18}}>✕</button>
                      </div>
                      <div style={{overflowX:"auto"}}>
                        <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                          <thead>
                            <tr style={{background:"var(--bg2)"}}>
                              {["키워드","검색량","경쟁도","CPC","황금점수",""].map(h=>(
                                <th key={h} style={{padding:"8px 12px",textAlign:"left",fontWeight:700,color:"var(--text3)",whiteSpace:"nowrap",borderBottom:"1px solid var(--border)"}}>{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {kwData.sort((a,b)=>calcGoldScore(b)-calcGoldScore(a)).map((kw,i)=>{
                              const score=calcGoldScore(kw);
                              const sc=score>=70?"#4ade80":score>=45?"#fbbf24":"#94a3b8";
                              const compC=kw.competition==="낮음"?"#4ade80":kw.competition==="중"?"#fbbf24":"#f87171";
                              return(
                                <tr key={i} style={{borderBottom:"1px solid var(--border)",cursor:"pointer",transition:"background .1s"}}
                                  onClick={()=>{setKeyword(kw.keyword);showToast(`"${kw.keyword}" 선택됐어요!`);}}
                                  onMouseEnter={e=>(e.currentTarget.style.background="var(--card-hover)")}
                                  onMouseLeave={e=>(e.currentTarget.style.background="")}>
                                  <td style={{padding:"9px 12px",fontWeight:700,color:"var(--text)"}}>{kw.keyword}</td>
                                  <td style={{padding:"9px 12px",color:"var(--text2)"}}>{kw.volume.toLocaleString()}</td>
                                  <td style={{padding:"9px 12px"}}><span style={{fontSize:11,fontWeight:700,color:compC}}>{kw.competition}</span></td>
                                  <td style={{padding:"9px 12px",color:"var(--text2)"}}>{kw.cpc>0?kw.cpc.toLocaleString()+"원":"—"}</td>
                                  <td style={{padding:"9px 12px"}}>
                                    <div style={{display:"flex",alignItems:"center",gap:6}}>
                                      <div style={{width:48,height:4,background:"var(--border)",borderRadius:99,overflow:"hidden"}}>
                                        <div style={{height:"100%",width:`${score}%`,background:sc,borderRadius:99}}/>
                                      </div>
                                      <span style={{fontSize:11,fontWeight:800,color:sc,minWidth:28}}>{score}</span>
                                    </div>
                                  </td>
                                  <td style={{padding:"9px 12px"}}><button onClick={e=>{e.stopPropagation();setKeyword(kw.keyword);handleGenerateTitles(true);}} style={{padding:"3px 8px",borderRadius:6,border:"1px solid var(--accent)",background:"var(--accent-bg)",color:"var(--accent-text)",cursor:"pointer",fontSize:11,fontWeight:700,fontFamily:"inherit",whiteSpace:"nowrap"}}>제목 추천 →</button></td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                      <div style={{padding:"8px 16px",fontSize:11,color:"var(--text3)",borderTop:"1px solid var(--border)"}}>💡 클릭하면 해당 키워드로 바로 적용 · 점수 기준: 경쟁도(35%) + 검색량(25%) + CTR(15%) + CPC(25%) + 보너스</div>
                    </div>
                  )}
                  {titles.length>0&&(
                    <div style={{marginTop:10,display:"flex",alignItems:"center",gap:8}}>
                      <div style={{flex:1,height:4,background:"var(--border)",borderRadius:99,overflow:"hidden"}}>
                        <div style={{height:"100%",width:`${(titles.length/MAX_TITLES)*100}%`,background:titles.length>=MAX_TITLES?"var(--danger)":"var(--accent)",borderRadius:99,transition:"width .4s"}}/>
                      </div>
                      <span style={{fontSize:11,color:titles.length>=MAX_TITLES?"var(--danger)":"var(--text2)",fontFamily:"monospace"}}>{titles.length}/{MAX_TITLES}</span>
                    </div>
                  )}
                </div>
                {titles.length>0&&(
                  <div className="card">
                    <div className="card-title">✨ 제목 선택<span style={{marginLeft:"auto",fontSize:11,fontWeight:500,color:"var(--text2)",textTransform:"none",letterSpacing:0}}>클릭해서 선택</span></div>
                    {selectedTitle&&<div className="selected-banner" style={{marginBottom:14}}><div className="selected-banner-label">✅ 선택된 제목</div><div className="selected-banner-text">{selectedTitle}</div></div>}
                    <div className="title-grid">
                      {titles.map((t,i)=>(
                        <button key={`${t}-${i}`} className={`title-card ${selectedTitle===t?"selected":""}`} onClick={()=>setSelectedTitle(t)}>
                          <div className="title-num">#{titles.length-i}</div>
                          <div className="title-text">{t}</div>
                          {selectedTitle===t&&<div className="title-check">✓</div>}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {selectedTitle&&(
                  <button className="btn btn-primary btn-full btn-xl" style={{marginTop:4}} onClick={()=>setTab("write")}>
                    ✍️ 글 생성하러 가기 →
                  </button>
                )}
              </div>
            )}

            {/* ───── ✍️ 글 생성 ───── */}
            {tab === "write" && (
              <div style={{animation:"fadeUp .25s ease both"}}>
                <UsageGuide theme={theme==="dark"?"dark":"light"} subtitle="고른 제목으로 본문을 자동으로 써줄게요." steps={[{ico:"📝",title:"제목·키워드 확인",desc:"위에서 고른 제목과 키워드가 맞는지 봐요."},{ico:"🎨",title:"스타일 고르기",desc:"말투·글 유형(정보/후기 등)을 골라요."},{ico:"✨",title:"글 생성",desc:"‘글 생성’을 누르면 본문이 자동으로 써져요."}]} />
                {/* 임시저장 불러오기 */}
                {draftAvailable&&draftData&&!genContent&&(
                  <div style={{padding:"12px 16px",borderRadius:12,background:"rgba(0,200,120,.1)",border:"1px solid rgba(0,200,120,.3)",marginBottom:12,display:"flex",alignItems:"center",justifyContent:"space-between",gap:10}}>
                    <div>
                      <div style={{fontSize:13,fontWeight:800,color:"var(--success)"}}>📝 임시저장된 글이 있어요</div>
                      <div style={{fontSize:11,color:"var(--text3)",marginTop:2}}>{draftData.savedAt} · {draftData.title}</div>
                    </div>
                    <div style={{display:"flex",gap:6,flexShrink:0}}>
                      <button onClick={()=>{setGenContent(draftData.content);setPubTitle(draftData.title);const rb=draftData.content.split("\n\n").filter(Boolean).map((p:string)=>({type:"text" as const,id:uid(),content:p}));setBlocks(rb.length>0?rb:[{type:"text",id:uid(),content:draftData.content}]);setDraftAvailable(false);showToast("✅ 임시저장 불러오기 완료");}} style={{padding:"5px 12px",borderRadius:8,background:"var(--success)",color:"#fff",border:"none",cursor:"pointer",fontSize:12,fontWeight:700,fontFamily:"inherit"}}>불러오기</button>
                      <button onClick={()=>{localStorage.removeItem("publy_adm_draft");setDraftAvailable(false);setDraftData(null);}} style={{padding:"5px 10px",borderRadius:8,background:"var(--bg2)",color:"var(--text3)",border:"1px solid var(--border)",cursor:"pointer",fontSize:12,fontFamily:"inherit"}}>삭제</button>
                    </div>
                  </div>
                )}
                {selectedTitle?(
                  <div className="selected-banner" style={{marginBottom:14}}>
                    <div className="selected-banner-label">📌 선택된 제목 — <span style={{fontWeight:400,cursor:"pointer",textDecoration:"underline"}} onClick={()=>setTab("keyword")}>키워드/제목 탭에서 변경</span></div>
                    <div className="selected-banner-text">{selectedTitle}</div>
                  </div>
                ):(
                  <div className="alert alert-warn" style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
                    ⚠️ 먼저 키워드/제목 탭에서 제목을 선택해주세요
                    <button className="btn btn-sm" style={{marginLeft:"auto",flexShrink:0,background:"var(--card)",border:"1px solid var(--border)",color:"var(--text)",fontFamily:"inherit",cursor:"pointer",borderRadius:8,padding:"8px 14px",fontSize:13}} onClick={()=>setTab("keyword")}>키워드/제목 탭으로 →</button>
                  </div>
                )}
                <div className="card">
                  <div className="card-title">⚙️ 생성 설정</div>

                  {/* 글 템플릿 */}
                  <div style={{marginBottom:14}}>
                    <label className="inp-label">📋 글 템플릿 <span style={{fontSize:10,color:"var(--text3)",fontWeight:400}}>(선택 시 스타일·말투 자동 세팅)</span></label>
                    <select value={blogTemplate} onChange={e=>{
                      const t=BLOG_TEMPLATES.find(t=>t.id===e.target.value);
                      if(t){
                        setBlogTemplate(t.id);
                        if(t.id!=="none"){
                          setWriteStyle(t.style);localStorage.setItem("publy_adm_write_style",t.style);
                          setPersona(t.persona);localStorage.setItem("publy_adm_persona",t.persona);
                        }
                      }
                    }} style={{width:"100%",padding:"9px 12px",borderRadius:10,border:"1px solid var(--border)",background:"var(--bg)",color:"var(--text)",fontSize:13,fontFamily:"inherit",outline:"none",cursor:"pointer"}}>
                      {BLOG_TEMPLATES.map(t=><option key={t.id} value={t.id}>{t.label}</option>)}
                    </select>
                  </div>

                  {/* 글 스타일 프리셋 */}
                  <div style={{marginBottom:16}}>
                    <label className="inp-label">✍️ 글 스타일</label>
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:7}}>
                      {WRITE_STYLES.map(s=>(
                        <button key={s.id} onClick={()=>{setWriteStyle(s.id);localStorage.setItem("publy_adm_write_style",s.id);}}
                          style={{padding:"10px 12px",borderRadius:10,border:`1.5px solid ${writeStyle===s.id?"var(--accent)":"var(--border)"}`,background:writeStyle===s.id?"var(--accent-bg)":"var(--bg)",cursor:"pointer",textAlign:"left",fontFamily:"inherit",transition:"all .15s"}}>
                          <div style={{fontSize:13,fontWeight:700,color:writeStyle===s.id?"var(--accent-text)":"var(--text)"}}>{s.i} {s.id}</div>
                          <div style={{fontSize:11,color:"var(--text3)",marginTop:2}}>{s.desc}</div>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* 말투/페르소나 */}
                  <div style={{marginBottom:16}}>
                    <label className="inp-label">🎭 말투 설정 <span style={{fontSize:10,color:"var(--text3)",fontWeight:400}}>(선택)</span></label>
                    <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                      {PERSONA_STYLES.map(p=>(
                        <button key={p.id} onClick={()=>{setPersona(p.id);localStorage.setItem("publy_adm_persona",p.id);}}
                          style={{padding:"6px 11px",borderRadius:20,border:`1.5px solid ${persona===p.id?p.color:"var(--border)"}`,background:persona===p.id?p.color+"22":"var(--bg)",cursor:"pointer",fontFamily:"inherit",fontSize:12,fontWeight:persona===p.id?700:500,color:persona===p.id?p.color:"var(--text2)",transition:"all .15s",whiteSpace:"nowrap"}}>
                          {p.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div style={{marginBottom:16}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                      <label className="inp-label" style={{margin:0}}>📏 목표 글자수</label>
                      <span style={{fontSize:15,fontWeight:800,color:"var(--accent-text)"}}>{targetChars.toLocaleString()}자</span>
                    </div>
                    <input type="range" min={1200} max={2000} step={100} value={targetChars} onChange={e=>setTargetChars(Number(e.target.value))} style={{width:"100%",accentColor:"var(--accent)",height:6,cursor:"pointer"}}/>
                    <div style={{display:"flex",justifyContent:"space-between",fontSize:11,color:"var(--text3)",marginTop:4}}><span>1,200자</span><span>1,600자</span><span>2,000자</span></div>
                  </div>
                  <div style={{marginBottom:16}}>
                    <label className="inp-label">🖼️ 이미지</label>
                    <div className="toggle-group">
                      {([{id:"ai",label:"✨ AI 생성"},{id:"upload",label:"📁 내 이미지"},{id:"none",label:"🚫 없음"}] as const).map(s=>(
                        <button key={s.id} className={`toggle-btn ${imgSource===s.id?"active":""}`} onClick={()=>setImgSource(s.id)}>{s.label}</button>
                      ))}
                    </div>
                  </div>
                  {imgSource==="upload"&&(
                    <div style={{marginBottom:16}}>
                      <label style={{display:"flex",alignItems:"center",gap:10,padding:"14px 18px",borderRadius:10,border:"2px dashed var(--accent-border)",background:"var(--accent-bg)",cursor:"pointer"}}>
                        <span style={{fontSize:22}}>📁</span>
                        <div><div style={{fontSize:13,fontWeight:700,color:"var(--accent-text)"}}>이미지 파일 선택</div><div style={{fontSize:11,color:"var(--text2)"}}>여러 장 동시 선택 가능</div></div>
                        <input type="file" accept="image/*" multiple onChange={handleImageUpload} style={{display:"none"}}/>
                      </label>
                      {uploadedImages.length>0&&<div className="img-grid" style={{marginTop:10}}>{uploadedImages.map((img,i)=>(<div key={i} className="img-thumb-wrap"><img src={img} alt="" className={`img-thumb ${i===0?"thumb-first":""}`}/><button className="img-thumb-del" onClick={()=>setUploadedImages(prev=>prev.filter((_,j)=>j!==i))}>✕</button></div>))}</div>}
                    </div>
                  )}
                  <button className="btn btn-primary btn-full btn-xl" onClick={handleGenerate} disabled={generating||!selectedTitle}>
                    {generating?<><span className="spinner"/>AI 작성 중...</>:<>✍️ 본문 생성 시작</>}
                  </button>
                </div>
                {genContent&&(
                  <>
                    <div className="card">
                      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14,flexWrap:"wrap",gap:8}}>
                        <div className="card-title" style={{marginBottom:0}}>🎉 글 생성 완료!</div>
                        <div style={{display:"flex",gap:7,alignItems:"center"}}>
                          <span className="char-badge">{genContent.length.toLocaleString()}자</span>
                          <button className="preview-btn" onClick={()=>openPreview()}>👁️ 미리보기</button>
                        </div>
                      </div>

                      {/* 품질 점수 */}
                      {qualityScore&&(
                      <div style={{padding:"14px 16px",borderRadius:12,background:"var(--card2)",border:"1px solid var(--border)",marginBottom:14}}>
                        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
                          <span style={{fontSize:12,fontWeight:800,color:"var(--text2)"}}>📊 SEO 품질 분석</span>
                          <span style={{fontSize:20,fontWeight:900,color:qualityScore.score>=80?"var(--success)":qualityScore.score>=55?"var(--warn)":"var(--danger)",fontFamily:"'Space Grotesk',sans-serif"}}>{qualityScore.score}점</span>
                        </div>
                        <div style={{display:"flex",flexDirection:"column",gap:6}}>
                          {qualityScore.items.map((item,idx2)=>(
                            <div key={idx2} style={{display:"flex",alignItems:"center",gap:8,padding:"6px 10px",borderRadius:8,background:item.pass?"rgba(0,255,150,.06)":"rgba(255,80,80,.06)"}}>
                              <span style={{fontSize:14,flexShrink:0}}>{item.pass?"✅":"❌"}</span>
                              <div style={{flex:1,minWidth:0}}>
                                <div style={{fontSize:11,fontWeight:700,color:item.pass?"var(--success)":"var(--danger)"}}>{item.label}</div>
                                <div style={{fontSize:10,color:"var(--text3)",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{item.detail}</div>
                              </div>
                              <span style={{fontSize:10,color:"var(--text3)",flexShrink:0}}>{item.weight}점</span>
                            </div>
                          ))}
                        </div>
                      </div>
                      )}

                      <div style={{display:"flex",flexDirection:"column",gap:12}}>
                        {([{l:"제목",v:genTitle,s:setGenTitle},{l:"태그",v:genTags,s:setGenTags}] as const).map(f=>(
                          <div key={f.l}><label className="inp-label">{f.l}</label><input className="inp" value={f.v} onChange={e=>f.s(e.target.value)}/></div>
                        ))}
                        <div>
                          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
                            <label className="inp-label" style={{margin:0}}>본문</label>
                            <span style={{fontSize:12,color:"var(--text2)"}}>{genContent.length.toLocaleString()}자</span>
                          </div>
                          <textarea className="inp" rows={12} style={{fontSize:13,lineHeight:1.8}} value={genContent} onChange={e=>setGenContent(e.target.value)}/>
                        </div>
                      </div>
                    </div>
                    <div style={{display:"flex",gap:8,marginBottom:20,flexWrap:"wrap"}}>
                      <button className="btn btn-primary" style={{flex:1}} onClick={()=>setTab("image")}>🖼️ 이미지 생성하기 →</button>
                      <button className="btn btn-secondary" style={{flex:1}} onClick={()=>{setPubTitle(genTitle);setPubContent(genContent);setPubTags(genTags);setPubImg(getActiveImages()[0]||"");setTab("publish");}}>🚀 발행하기로 이동</button>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* ───── 🖼️ 이미지 생성 ───── */}
            {tab === "image" && (
              <div style={{animation:"fadeUp .25s ease both"}}>
                <UsageGuide theme={theme==="dark"?"dark":"light"} subtitle="글과 어울리는 이미지를 만들어줄게요." steps={[{ico:"🖼️",title:"이미지 키워드 입력",desc:"글과 어울리는 이미지 키워드를 적어요."},{ico:"🆓",title:"방식 고르기",desc:"무료(Google Flow) 또는 유료 방식 중 골라요."},{ico:"➡️",title:"생성·확인",desc:"이미지를 만들고 캡션을 확인한 뒤 발행에 넣어요."}]} />
                {!genContent&&(
                  <div className="alert alert-warn" style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
                    ⚠️ 먼저 글 생성 탭에서 글을 생성해주세요!
                    <button className="btn btn-secondary btn-sm" style={{marginLeft:"auto",flexShrink:0}} onClick={()=>setTab("write")}>글 생성하러 가기</button>
                  </div>
                )}

                {/* ── 이미지 생성 방식 스위치 ── */}
                <div style={{marginBottom:16,padding:"18px 22px",borderRadius:20,background:"linear-gradient(135deg,rgba(99,102,241,.12),rgba(168,85,247,.12))",border:"1.5px solid rgba(168,85,247,.25)",boxShadow:"0 8px 32px rgba(99,102,241,.15)",animation:"float 3s ease-in-out infinite"}}>
                  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12,flexWrap:"wrap",gap:8}}>
                    <div>
                      <div style={{fontSize:14,fontWeight:900,color:"var(--text)"}}>🖼️ 이미지 생성 방식</div>
                      <div style={{fontSize:11,color:"var(--text3)",marginTop:2}}>원하는 방식을 선택하세요</div>
                    </div>
                    <button onClick={()=>setShowFlowGuide(true)} style={{padding:"5px 12px",borderRadius:99,border:"1px solid rgba(168,85,247,.4)",background:"rgba(168,85,247,.1)",color:"#a855f7",cursor:"pointer",fontSize:11,fontWeight:700,fontFamily:"inherit"}}>❓ Flow란?</button>
                  </div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                    <button onClick={()=>setImgGenType("ai")} style={{padding:"14px 12px",borderRadius:14,border:`2px solid ${imgGenType==="ai"?"#6366f1":"var(--border)"}`,background:imgGenType==="ai"?"linear-gradient(135deg,rgba(99,102,241,.18),rgba(99,102,241,.06))":"var(--card)",cursor:"pointer",fontFamily:"inherit",textAlign:"left",transition:"all .2s",boxShadow:imgGenType==="ai"?"0 4px 20px rgba(99,102,241,.25)":"none"}}>
                      <div style={{fontSize:24,marginBottom:5}}>✨</div>
                      <div style={{fontSize:13,fontWeight:900,color:imgGenType==="ai"?"#818cf8":"var(--text)",marginBottom:3}}>AI 이미지</div>
                      <div style={{fontSize:10,color:"var(--text3)",lineHeight:1.5}}>DALL-E · Flux<br/>API 키 필요</div>
                      {imgGenType==="ai"&&<div style={{marginTop:6,fontSize:10,fontWeight:800,color:"#818cf8",background:"rgba(99,102,241,.15)",padding:"2px 7px",borderRadius:99,display:"inline-block"}}>✓ 선택됨</div>}
                    </button>
                    <button onClick={()=>setImgGenType("flow")} style={{padding:"14px 12px",borderRadius:14,border:`2px solid ${imgGenType==="flow"?"#a855f7":"var(--border)"}`,background:imgGenType==="flow"?"linear-gradient(135deg,rgba(168,85,247,.18),rgba(168,85,247,.06))":"var(--card)",cursor:"pointer",fontFamily:"inherit",textAlign:"left",transition:"all .2s",boxShadow:imgGenType==="flow"?"0 4px 20px rgba(168,85,247,.25)":"none",position:"relative",overflow:"hidden"}}>
                      <div style={{position:"absolute",top:6,right:8,fontSize:9,fontWeight:800,color:"#fff",background:"linear-gradient(135deg,#a855f7,#7c3aed)",padding:"1px 6px",borderRadius:99}}>FREE</div>
                      <div style={{fontSize:24,marginBottom:5}}>🎨</div>
                      <div style={{fontSize:13,fontWeight:900,color:imgGenType==="flow"?"#c084fc":"var(--text)",marginBottom:3}}>Flow 이미지</div>
                      <div style={{fontSize:10,color:"var(--text3)",lineHeight:1.5}}>Google Flow<br/>무료 · 고퀄리티</div>
                      {imgGenType==="flow"&&<div style={{marginTop:6,fontSize:10,fontWeight:800,color:"#c084fc",background:"rgba(168,85,247,.15)",padding:"2px 7px",borderRadius:99,display:"inline-block"}}>✓ 선택됨</div>}
                    </button>
                  </div>
                </div>

                {/* Flow 가이드 팝업 */}
                {showFlowGuide&&(
                  <div style={{position:"fixed",inset:0,zIndex:9999,background:"rgba(0,0,0,.75)",display:"flex",alignItems:"flex-start",justifyContent:"center",padding:"60px 20px 20px"}} onClick={()=>setShowFlowGuide(false)}>
                    <div style={{width:"100%",maxWidth:480,borderRadius:22,background:"var(--card)",border:"1px solid rgba(168,85,247,.3)",overflow:"hidden",animation:"fadeUp .25s ease"}} onClick={e=>e.stopPropagation()}>
                      <div style={{padding:"18px 22px 14px",background:"linear-gradient(135deg,#7c3aed,#a855f7)",display:"flex",alignItems:"center",gap:10}}>
                        <div style={{fontSize:28}}>🎨</div>
                        <div style={{flex:1}}>
                          <div style={{fontSize:15,fontWeight:900,color:"#fff"}}>Google Flow 이미지란?</div>
                          <div style={{fontSize:11,color:"rgba(255,255,255,.8)",marginTop:1}}>무료 고퀄리티 AI 이미지 생성</div>
                        </div>
                        <button onClick={()=>setShowFlowGuide(false)} style={{width:26,height:26,borderRadius:7,border:"none",background:"rgba(255,255,255,.2)",color:"#fff",cursor:"pointer",fontSize:15,display:"flex",alignItems:"center",justifyContent:"center"}}>×</button>
                      </div>
                      <div style={{padding:"16px 22px"}}>
                        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:12}}>
                          <a href="https://accounts.google.com/signup" target="_blank" rel="noreferrer" style={{display:"flex",flexDirection:"column",alignItems:"center",gap:5,padding:"12px 10px",borderRadius:12,border:"1.5px solid rgba(168,85,247,.3)",background:"rgba(168,85,247,.08)",textDecoration:"none"}}>
                            <span style={{fontSize:20}}>👤</span>
                            <span style={{fontSize:12,fontWeight:800,color:"#c084fc"}}>구글 회원가입</span>
                            <span style={{fontSize:10,color:"var(--text3)",textAlign:"center"}}>구글 계정 없으면 먼저 가입</span>
                          </a>
                          <a href="https://labs.google/fx/ko/tools/image-fx" target="_blank" rel="noreferrer" style={{display:"flex",flexDirection:"column",alignItems:"center",gap:5,padding:"12px 10px",borderRadius:12,border:"1.5px solid rgba(0,214,143,.3)",background:"rgba(0,214,143,.08)",textDecoration:"none"}}>
                            <span style={{fontSize:20}}>🔗</span>
                            <span style={{fontSize:12,fontWeight:800,color:"var(--success)"}}>Flow 설정하기</span>
                            <span style={{fontSize:10,color:"var(--text3)",textAlign:"center"}}>클릭 후 구글 로그인 완료</span>
                          </a>
                        </div>
                        <div style={{marginBottom:10,padding:"10px 12px",borderRadius:10,background:"rgba(99,102,241,.08)",border:"1px solid rgba(99,102,241,.2)"}}>
                          <div style={{fontSize:12,fontWeight:800,color:"#818cf8",marginBottom:5}}>🚀 동작 방식</div>
                          <div style={{fontSize:11,color:"var(--text)",lineHeight:1.9}}>① Flow 선택 → ② 발행 버튼 → ③ 크롬 자동 실행<br/>→ ④ 구간별 프롬프트 자동 입력 → ⑤ 이미지 생성<br/>→ ⑥ 자동 다운로드 → ⑦ 글 사이 자동 삽입 후 발행</div>
                        </div>
                        <div style={{padding:"10px 12px",borderRadius:10,background:"rgba(255,159,63,.08)",border:"1px solid rgba(255,159,63,.2)"}}>
                          <div style={{fontSize:12,fontWeight:800,color:"var(--warn)",marginBottom:5}}>⚠️ 주의사항</div>
                          <div style={{fontSize:11,color:"var(--text)",lineHeight:1.9}}>장시간 미사용 시 재로그인 필요<br/>발행 시 크롬 창 자동으로 열림 (닫지 마세요)</div>
                        </div>
                        <button onClick={()=>setShowFlowGuide(false)} style={{width:"100%",marginTop:12,padding:"11px",borderRadius:10,border:"none",background:"linear-gradient(135deg,#7c3aed,#a855f7)",color:"#fff",cursor:"pointer",fontSize:13,fontWeight:800,fontFamily:"inherit"}}>확인했어요!</button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Flow 선택 시 UI */}
                {imgGenType==="flow"&&(
                  <div style={{marginBottom:14,animation:"fadeUp .2s ease both"}}>
                    <div className="card" style={{padding:"18px 20px",border:"1.5px solid rgba(168,85,247,.25)",background:"linear-gradient(135deg,rgba(168,85,247,.06),rgba(99,102,241,.04))"}}>
                      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:14}}>
                        <div style={{width:36,height:36,borderRadius:10,background:"linear-gradient(135deg,#7c3aed,#a855f7)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,flexShrink:0}}>🎨</div>
                        <div>
                          <div style={{fontSize:13,fontWeight:900,color:"var(--text)"}}>Google Flow 자동 생성</div>
                          <div style={{fontSize:11,color:"var(--text3)"}}>발행 시 크롬이 자동으로 열려 이미지를 생성합니다</div>
                        </div>
                      </div>
                      <div style={{marginBottom:12}}>
                        <div style={{fontSize:11,fontWeight:700,color:"var(--text3)",marginBottom:6}}>📸 생성할 이미지 수</div>
                        <div style={{display:"flex",gap:6,marginBottom:6}}>
                          <button onClick={()=>{setFlowImgCountAuto(true);if(genContent)setFlowImgCount(Math.max(1,Math.min(10,Math.floor(genContent.length/500))));}} style={{flex:1,padding:"7px",borderRadius:8,border:`1.5px solid ${flowImgCountAuto?"#a855f7":"var(--border)"}`,background:flowImgCountAuto?"rgba(168,85,247,.15)":"transparent",cursor:"pointer",fontSize:11,fontWeight:700,color:flowImgCountAuto?"#c084fc":"var(--text2)",fontFamily:"inherit"}}>✨ 자동추천</button>
                          <button onClick={()=>setFlowImgCountAuto(false)} style={{flex:1,padding:"7px",borderRadius:8,border:`1.5px solid ${!flowImgCountAuto?"#a855f7":"var(--border)"}`,background:!flowImgCountAuto?"rgba(168,85,247,.15)":"transparent",cursor:"pointer",fontSize:11,fontWeight:700,color:!flowImgCountAuto?"#c084fc":"var(--text2)",fontFamily:"inherit"}}>✏️ 직접입력</button>
                        </div>
                        {flowImgCountAuto ? (
                          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"8px 12px",borderRadius:9,background:"rgba(168,85,247,.1)",border:"1px solid rgba(168,85,247,.25)"}}>
                            <span style={{fontSize:11,color:"#c084fc",fontWeight:600}}>💡 500자당 1장 자동 추천</span>
                            <span style={{fontSize:20,fontWeight:900,color:"#c084fc",fontFamily:"'Space Grotesk',sans-serif"}}>{flowImgCount}장</span>
                          </div>
                        ) : (
                          <div style={{display:"flex",alignItems:"center",gap:6}}>
                            <button onClick={()=>setFlowImgCount(Math.max(1,flowImgCount-1))} style={{width:32,height:32,borderRadius:8,border:"1px solid var(--border)",background:"var(--bg2)",cursor:"pointer",fontSize:16,fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center",color:"var(--text)"}}>−</button>
                            <input type="number" min={1} max={10} value={flowImgCount} onChange={e=>setFlowImgCount(Math.max(1,Math.min(10,Number(e.target.value))))} style={{flex:1,textAlign:"center",padding:"6px",borderRadius:8,border:"1.5px solid rgba(168,85,247,.4)",background:"var(--bg2)",color:"#c084fc",fontSize:18,fontWeight:900,fontFamily:"'Space Grotesk',sans-serif"}}/>
                            <button onClick={()=>setFlowImgCount(Math.min(10,flowImgCount+1))} style={{width:32,height:32,borderRadius:8,border:"1px solid var(--border)",background:"var(--bg2)",cursor:"pointer",fontSize:16,fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center",color:"var(--text)"}}>+</button>
                          </div>
                        )}
                      </div>
                      {genTitle&&(
                        <div style={{padding:"10px 12px",borderRadius:10,background:"var(--bg)",border:"1px solid var(--border)",marginBottom:10}}>
                          <div style={{fontSize:10,fontWeight:700,color:"var(--text3)",marginBottom:4}}>🔤 자동 생성될 영문 프롬프트</div>
                          <div style={{fontSize:10,color:"#c084fc",lineHeight:1.8,fontStyle:"italic",wordBreak:"break-word"}}>
                            "{genTitle}" — A high-quality, realistic photographic image. Professional photography, vivid colors, sharp focus, 8K resolution, cinematic lighting.
                          </div>
                        </div>
                      )}
                      <div style={{display:"flex",alignItems:"center",gap:6,padding:"10px 12px",borderRadius:10,background:"rgba(168,85,247,.08)",border:"1px solid rgba(168,85,247,.2)"}}>
                        <div style={{width:7,height:7,borderRadius:"50%",background:"#a855f7",boxShadow:"0 0 6px #a855f7",animation:"float 1.5s ease-in-out infinite",flexShrink:0}}/>
                        <div style={{fontSize:11,color:"#c084fc",fontWeight:600}}>발행하기 탭에서 🚀 발행 버튼을 누르면 자동으로 시작됩니다</div>
                      </div>
                    </div>
                  </div>
                )}

                <div className="adm-img-split">

                  {/* ── 왼쪽 패널 ── */}
                  <div style={{display:"flex",flexDirection:"column",gap:10}}>

                    {/* 1. 프롬프트 미리보기 */}
                    {(keyword||genTitle)&&(
                      <div className="card" style={{padding:"14px 16px"}}>
                        <div className="card-title" style={{marginBottom:10}}>🔍 이미지 프롬프트</div>
                        <div style={{marginBottom:8}}>
                          <div style={{fontSize:10,fontWeight:700,color:"var(--text3)",marginBottom:4}}>키워드</div>
                          <div style={{fontSize:14,fontWeight:800,color:"var(--accent-text)"}}>{keyword||genTitle}</div>
                        </div>
                        <div>
                          <div style={{fontSize:10,fontWeight:700,color:"var(--text3)",marginBottom:4}}>영문 프롬프트</div>
                          <div style={{fontSize:11,color:"var(--text2)",lineHeight:1.6,background:"var(--bg)",padding:"8px 10px",borderRadius:8,border:"1px solid var(--border)",wordBreak:"break-all"}}>
                            {currentImgPrompt||buildImagePrompt(keyword||genTitle,genTitle,0)}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* 2. 이미지 설정 */}
                    <div className="card" style={{padding:"14px 16px"}}>
                      <div className="card-title" style={{marginBottom:12}}>⚙️ 이미지 설정</div>
                      <label className="inp-label">이미지 소스</label>
                      <div style={{display:"flex",flexDirection:"column",gap:6,marginBottom:16}}>
                        {([{id:"ai",ico:"✨",label:"AI 자동 생성"},{id:"upload",ico:"📁",label:"내 이미지 업로드"},{id:"none",ico:"🚫",label:"이미지 없이 발행"}] as const).map(s=>(
                          <button key={s.id} onClick={()=>setImgSource(s.id)} style={{padding:"10px 14px",borderRadius:10,border:`1.5px solid ${imgSource===s.id?"var(--accent-text)":"var(--border)"}`,background:imgSource===s.id?"var(--accent-bg)":"var(--bg)",cursor:"pointer",fontFamily:"inherit",transition:"all .15s",display:"flex",alignItems:"center",gap:9,textAlign:"left"}}>
                            <span style={{fontSize:18}}>{s.ico}</span>
                            <span style={{fontSize:13,fontWeight:600,color:imgSource===s.id?"var(--accent-text)":"var(--text2)"}}>{s.label}</span>
                            {imgSource===s.id&&<span style={{marginLeft:"auto",color:"var(--accent-text)"}}>✓</span>}
                          </button>
                        ))}
                      </div>

                      {imgSource==="ai"&&(
                        <>
                          <label className="inp-label">생성 수량</label>
                          <div style={{display:"flex",gap:6,marginBottom:10}}>
                            <button onClick={()=>{setImgCountAuto(true);if(genContent)setImgCount(recommendImageCount(genContent));}} style={{flex:1,padding:"7px",borderRadius:8,border:`1.5px solid ${imgCountAuto?"var(--accent-text)":"var(--border)"}`,background:imgCountAuto?"var(--accent-bg)":"transparent",cursor:"pointer",fontSize:12,fontWeight:700,color:imgCountAuto?"var(--accent-text)":"var(--text2)",fontFamily:"inherit"}}>✨ 자동추천</button>
                            <button onClick={()=>setImgCountAuto(false)} style={{flex:1,padding:"7px",borderRadius:8,border:`1.5px solid ${!imgCountAuto?"var(--accent-text)":"var(--border)"}`,background:!imgCountAuto?"var(--accent-bg)":"transparent",cursor:"pointer",fontSize:12,fontWeight:700,color:!imgCountAuto?"var(--accent-text)":"var(--text2)",fontFamily:"inherit"}}>✏️ 직접입력</button>
                          </div>
                          {imgCountAuto?(
                            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 14px",borderRadius:10,background:"var(--accent-bg)",border:"1px solid var(--accent-border)",marginBottom:10}}>
                              <span style={{fontSize:12,color:"var(--accent-text)",fontWeight:600}}>💡 글자 수 기반 추천</span>
                              <span style={{fontSize:24,fontWeight:900,color:"var(--accent-text)"}}>{imgCount}장</span>
                            </div>
                          ):(
                            <div style={{marginBottom:10}}>
                              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
                                <button onClick={()=>setImgCount(Math.max(1,imgCount-1))} style={{width:32,height:32,borderRadius:8,border:"1px solid var(--border)",background:"var(--bg2)",cursor:"pointer",fontSize:18,fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center"}}>−</button>
                                <input type="number" min={1} max={30} value={imgCount} onChange={e=>setImgCount(Math.max(1,Math.min(30,Number(e.target.value))))} style={{flex:1,textAlign:"center",padding:"7px",borderRadius:8,border:"1.5px solid var(--border)",background:"var(--bg2)",color:"var(--text)",fontSize:18,fontWeight:900}}/>
                                <button onClick={()=>setImgCount(Math.min(30,imgCount+1))} style={{width:32,height:32,borderRadius:8,border:"1px solid var(--border)",background:"var(--bg2)",cursor:"pointer",fontSize:18,fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center"}}>+</button>
                              </div>
                              <div style={{fontSize:11,color:"var(--text3)",textAlign:"center"}}>체험단 15장 이상도 가능 (최대 30장)</div>
                            </div>
                          )}

                          {genImgLoading&&(
                            <div style={{marginBottom:12,padding:"12px 14px",borderRadius:10,background:"var(--bg)",border:"1px solid var(--border)"}}>
                              <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
                                <span style={{fontSize:12,fontWeight:700,color:"var(--accent-text)",animation:"pulse 1.2s infinite"}}>⏳ {genImgCurrent} / {imgCount}장</span>
                                <span style={{fontSize:14,fontWeight:900,color:"var(--accent-text)"}}>{genImgProgress}%</span>
                              </div>
                              <div style={{height:8,background:"var(--border)",borderRadius:99,overflow:"hidden"}}>
                                <div style={{height:"100%",width:`${genImgProgress}%`,background:"linear-gradient(90deg,var(--accent-text),#00cc80)",borderRadius:99,transition:"width .4s"}}/>
                              </div>
                            </div>
                          )}

                          <div style={{display:"flex",flexDirection:"column",gap:8}}>
                            <button className="btn btn-primary btn-full" onClick={handleGenerateImages} disabled={genImgLoading||!genContent}>
                              {genImgLoading?<><span className="spinner"/>생성 중...</>:<>🎨 이미지 생성 시작</>}
                            </button>
                            {genImgLoading&&<button className="btn-stop" onClick={stopImageGen}>⏹ 생성 중단</button>}
                            {generatedImages.length>0&&!genImgLoading&&<button className="btn btn-sm btn-full" style={{background:"rgba(248,81,73,.1)",color:"var(--danger)",border:"1px solid rgba(248,81,73,.3)"}} onClick={()=>{setGeneratedImages([]);setGenImgProgress(0);setGenImgCurrent(0);setCaptions([]);}}>🗑 이미지 초기화</button>}
                          </div>
                        </>
                      )}

                      {imgSource==="upload"&&(
                        <div>
                          <label style={{display:"flex",alignItems:"center",gap:10,padding:"16px 14px",borderRadius:10,border:"2px dashed var(--accent-border)",background:"var(--accent-bg)",cursor:"pointer"}}>
                            <span style={{fontSize:24}}>📁</span>
                            <div><div style={{fontSize:13,fontWeight:700,color:"var(--accent-text)"}}>파일 선택</div><div style={{fontSize:11,color:"var(--text2)",marginTop:2}}>여러 장 동시 가능 (체험단 15장+)</div></div>
                            <input type="file" accept="image/*" multiple onChange={handleImageUpload} style={{display:"none"}}/>
                          </label>
                          {uploadedImages.length>0&&<button className="btn btn-sm btn-full" style={{marginTop:10,background:"rgba(248,81,73,.1)",color:"var(--danger)",border:"1px solid rgba(248,81,73,.3)"}} onClick={()=>{setUploadedImages([]);setCaptions([]);}}>🗑 업로드 초기화</button>}
                        </div>
                      )}

                      {imgSource==="none"&&(
                        <div style={{padding:"14px",borderRadius:10,background:"rgba(248,81,73,.06)",border:"1px solid rgba(248,81,73,.2)",fontSize:13,color:"var(--text2)",lineHeight:1.7}}>
                          이미지 없이 텍스트만 발행해요.
                        </div>
                      )}
                    </div>

                    {/* 3. 영상 삽입 */}
                    <div className="card" style={{padding:"14px 16px"}}>
                      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
                        <div>
                          <div className="card-title" style={{margin:0}}>🎬 영상 삽입</div>
                          <div style={{fontSize:11,color:"var(--text3)",marginTop:3}}>체험단 영상 필수 업체 대응</div>
                        </div>
                        <div style={{display:"flex",alignItems:"center",gap:8}}>
                          <span style={{fontSize:11,fontWeight:700,color:videoOn?"var(--accent-text)":"var(--text3)"}}>{videoOn?"ON":"OFF"}</span>
                          <button onClick={()=>setVideoOn(v=>!v)} style={{width:48,height:26,borderRadius:99,background:videoOn?"var(--accent-text)":"var(--border)",border:"none",cursor:"pointer",position:"relative",transition:"background .2s",flexShrink:0}}>
                            <div style={{position:"absolute",top:3,left:videoOn?25:3,width:20,height:20,borderRadius:"50%",background:"#fff",transition:"left .2s"}}/>
                          </button>
                        </div>
                      </div>
                      {!videoOn&&<div style={{fontSize:12,color:"var(--text3)",padding:"8px 10px",borderRadius:8,background:"var(--bg2)"}}>OFF 상태입니다. 영상을 삽입하려면 위 버튼을 눌러 ON 하세요.</div>}
                      {videoOn&&(
                        <>
                          <div style={{marginBottom:10,padding:"8px 10px",borderRadius:8,background:"var(--accent-bg)",border:"1px solid var(--accent-border)",fontSize:12,color:"var(--accent-text)",fontWeight:600}}>✅ 영상 삽입 ON — URL을 입력해주세요</div>
                          <input className="inp" placeholder="네이버TV 또는 유튜브 영상 주소 붙여넣기" value={videoUrl} onChange={e=>setVideoUrl(e.target.value)} style={{marginBottom:10,fontSize:13}}/>
                          <label className="inp-label">📍 영상을 글 어디에 넣을까요?</label>
                          <div style={{display:"flex",gap:6}}>
                            {(["top","middle","bottom"] as const).map(p=>(
                              <button key={p} onClick={()=>setVideoPosition(p)} style={{flex:1,padding:"8px 4px",borderRadius:8,border:`1.5px solid ${videoPosition===p?"var(--accent-text)":"var(--border)"}`,background:videoPosition===p?"var(--accent-bg)":"transparent",cursor:"pointer",fontSize:11,fontWeight:700,color:videoPosition===p?"var(--accent-text)":"var(--text2)",fontFamily:"inherit",textAlign:"center"}}>
                                <div>{p==="top"?"🔝 상단":p==="middle"?"🔲 중간":"🔽 하단"}</div>
                                <div style={{fontSize:10,fontWeight:400,marginTop:2,color:"var(--text3)"}}>{p==="top"?"글 맨 위":p==="middle"?"본문 중간":"글 맨 아래"}</div>
                              </button>
                            ))}
                          </div>
                        </>
                      )}
                    </div>

                    {/* 4. 이미지 배치 패턴 */}
                    <div className="card" style={{padding:"14px 16px"}}>
                      <div className="card-title" style={{marginBottom:4}}>📐 이미지 배치 패턴</div>
                      <div style={{fontSize:11,color:"var(--text3)",marginBottom:12}}>글 안에 이미지를 어떻게 배치할지 선택해요</div>
                      <div style={{display:"flex",flexDirection:"column",gap:8}}>
                        {([
                          {v:"random",l:"🎲 랜덤",badge:"권장",sub:"매 발행마다 자동으로 패턴 변경",diagram:"🖼️ → 📝 → 🖼️ → 📝"},
                          {v:"A",l:"패턴 A",badge:"",sub:"썸네일 + 중간 이미지 1장",diagram:"🖼️썸네일 → 📝글 → 🖼️중간 → 📝글"},
                          {v:"B",l:"패턴 B",badge:"",sub:"썸네일 + 앞뒤 이미지 각 1장",diagram:"🖼️썸네일 → 🖼️앞 → 📝글 → 🖼️뒤"},
                          {v:"C",l:"패턴 C",badge:"",sub:"썸네일 + 이미지 균등 분산",diagram:"🖼️썸네일 → 📝 → 🖼️ → 📝 → 🖼️"},
                        ] as const).map(p=>(
                          <button key={p.v} onClick={()=>setImgPattern(p.v)} style={{padding:"11px 13px",borderRadius:10,border:`1.5px solid ${imgPattern===p.v?"var(--accent-text)":"var(--border)"}`,background:imgPattern===p.v?"var(--accent-bg)":"var(--bg)",cursor:"pointer",fontFamily:"inherit",textAlign:"left",transition:"all .15s"}}>
                            <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:4}}>
                              <span style={{fontSize:13,fontWeight:800,color:imgPattern===p.v?"var(--accent-text)":"var(--text)"}}>{p.l}</span>
                              {p.badge&&<span style={{fontSize:10,fontWeight:800,padding:"2px 7px",borderRadius:99,background:"var(--accent-text)",color:"#000"}}>{p.badge}</span>}
                            </div>
                            <div style={{fontSize:12,color:"var(--text2)",marginBottom:4}}>{p.sub}</div>
                            <div style={{fontSize:11,color:"var(--text3)",fontFamily:"monospace",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p.diagram}</div>
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* ── 오른쪽: 갤러리 + 캡션 ── */}
                  <div>
                    <div className="card" style={{minHeight:300}}>
                      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14,flexWrap:"wrap",gap:8}}>
                        <div className="card-title" style={{margin:0}}>
                          🖼️ 생성된 이미지
                          {getActiveImages().length>0&&<span style={{fontWeight:400,color:"var(--text3)",textTransform:"none",letterSpacing:0}}> — {getActiveImages().length}장 · 첫 번째 썸네일</span>}
                        </div>
                        {getActiveImages().length>0&&captions.length===0&&(
                          <button className="btn btn-sm btn-secondary" onClick={()=>setCaptions(buildCaptions(keyword||selectedTitle,getActiveImages().length,genContent))}>💬 캡션 자동생성</button>
                        )}
                      </div>

                      {getActiveImages().length===0&&!genImgLoading?(
                        <div style={{textAlign:"center",padding:"48px 24px",color:"var(--text3)"}}>
                          <div style={{fontSize:48,marginBottom:12,animation:"float 3s ease-in-out infinite"}}>🖼️</div>
                          <div style={{fontSize:15,fontWeight:700,color:"var(--text2)",marginBottom:6}}>아직 이미지가 없어요</div>
                          <div style={{fontSize:13}}>왼쪽에서 설정 후 생성 버튼을 눌러주세요</div>
                        </div>
                      ):(
                        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(160px,1fr))",gap:14}}>
                          {genImgLoading&&Array.from({length:imgCount-generatedImages.length}).map((_,i)=>(
                            <div key={`ph-${i}`} style={{display:"flex",flexDirection:"column",gap:6}}>
                              <div style={{aspectRatio:"1",borderRadius:12,background:"var(--bg)",border:"2px dashed var(--border)",display:"flex",alignItems:"center",justifyContent:"center"}}>
                                {i===0?<><span className="spinner" style={{width:24,height:24}}/></>:<span style={{fontSize:22,opacity:.3}}>🖼️</span>}
                              </div>
                            </div>
                          ))}
                          {getActiveImages().map((img,i)=>(
                            <div key={i} style={{display:"flex",flexDirection:"column",gap:6}}>
                              <div style={{position:"relative",aspectRatio:"1"}}>
                                <img src={img} alt="" style={{width:"100%",height:"100%",objectFit:"cover",borderRadius:12,border:i===0?"2px solid var(--accent-text)":"2px solid var(--border)",display:"block",cursor:"pointer",animation:"fadeUp .3s ease both"}}
                                  onClick={()=>window.open(img,"_blank")}
                                  onError={e=>{(e.target as HTMLImageElement).style.display="none";}}/>
                                {i===0&&<span style={{position:"absolute",top:-7,left:-4,fontSize:9,fontWeight:800,padding:"2px 7px",borderRadius:99,background:"var(--accent-text)",color:"#000",whiteSpace:"nowrap"}}>썸네일</span>}
                                <button style={{position:"absolute",top:-8,right:-8,width:28,height:28,borderRadius:"50%",background:"var(--danger)",border:"2px solid var(--bg)",color:"#fff",cursor:"pointer",fontSize:12,display:"flex",alignItems:"center",justifyContent:"center",boxShadow:"0 2px 6px rgba(0,0,0,.3)"}}
                                  onClick={()=>{
                                    if(imgSource==="ai")setGeneratedImages(p=>p.filter((_,j)=>j!==i));
                                    else setUploadedImages(p=>p.filter((_,j)=>j!==i));
                                    setCaptions(p=>p.filter((_,j)=>j!==i));
                                  }}>✕</button>
                              </div>
                              <input
                                className="img-caption-inp"
                                placeholder={`캡션 (예: ${keyword||"사진"} ${i===0?"대표":"현장"} 사진)`}
                                value={captions[i]||""}
                                onChange={e=>{const next=[...captions];next[i]=e.target.value;setCaptions(next);}}
                              />
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="flow-nav">
                      <button className="flow-btn flow-btn-g" onClick={()=>setTab("publish")} disabled={!genContent}>🚀 발행하기로 이동 →</button>
                      <button className="flow-btn flow-btn-skip" onClick={()=>setTab("write")}>← 글 생성으로</button>
                    </div>
                  </div>
                </div>
              </div>
            )}


            {/* ───── 📋 발행 관리 ───── */}
            {tab === "manage" && (
              <div style={{animation:"fadeUp .25s ease both"}}>
                <UsageGuide theme={theme==="dark"?"dark":"light"} subtitle="지금까지 올린 글을 모아서 관리해요." steps={[{ico:"📋",title:"목록 확인",desc:"발행한 글이 모두 여기 모여요."},{ico:"✅",title:"상태 보기",desc:"성공/실패와 올라간 주소를 확인해요."},{ico:"📈",title:"성과 추적",desc:"순위·조회 변화를 보고 다음 글에 참고해요."}]} />

                {/* 요약 카드 */}
                {(()=>{
                  const success=history.filter(h=>h.status==="success");
                  const fail=history.filter(h=>h.status==="fail");
                  const pending=history.filter(h=>h.status==="pending");
                  const naverCnt=success.filter(h=>h.platform==="naver").length;
                  const tistoryCnt=success.filter(h=>h.platform==="tistory").length;
                  const neighborCnt=history.filter(h=>h.platform==="neighbor").length;
                  return(
                    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(110px,1fr))",gap:10,marginBottom:14}}>
                      {[
                        {label:"전체 발행",value:history.filter(h=>h.platform!=="neighbor").length,color:"var(--text)"},
                        {label:"✅ 성공",value:success.filter(h=>h.platform!=="neighbor").length,color:"var(--success)"},
                        {label:"❌ 실패",value:fail.filter(h=>h.platform!=="neighbor").length,color:"var(--danger)"},
                        {label:"🟢 네이버",value:naverCnt,color:"var(--naver)"},
                        {label:"🟠 티스토리",value:tistoryCnt,color:"var(--tistory)"},
                        {label:"🤝 서이추",value:neighborCnt,color:"var(--info)"},
                      ].map((s,i)=>(
                        <div key={i} style={{padding:"12px 14px",borderRadius:12,background:"var(--card)",border:"1px solid var(--border)",textAlign:"center"}}>
                          <div style={{fontSize:20,fontWeight:900,color:s.color,fontFamily:"'Space Grotesk',sans-serif"}}>{s.value}</div>
                          <div style={{fontSize:11,color:"var(--text3)",marginTop:4,fontWeight:600}}>{s.label}</div>
                        </div>
                      ))}
                    </div>
                  );
                })()}

                {/* 전체 발행 기록 */}
                <div className="card">
                  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14}}>
                    <div className="card-title" style={{margin:0}}>📋 전체 발행 기록</div>
                    <div style={{display:"flex",gap:8,alignItems:"center"}}>
                      <button onClick={checkPostRanks} disabled={rankChecking} style={{padding:"6px 12px",borderRadius:8,border:"none",background:rankChecking?"var(--card2)":"linear-gradient(135deg,#00c896,#00a5ff)",color:rankChecking?"var(--text3)":"#fff",cursor:rankChecking?"default":"pointer",fontSize:12,fontWeight:800,fontFamily:"inherit",whiteSpace:"nowrap"}}>{rankChecking?"📈 확인 중...":"📈 순위 성과"}</button>
                      <span style={{fontSize:13,color:"var(--text2)"}}>총 {history.length}건</span>
                      {history.length>0&&<button className="btn btn-danger btn-sm" onClick={async()=>{if(!confirm("전체 삭제할까요?"))return;await deleteAllHistory(ADM_HISTORY_UID);setHistory([]);}}>🗑 전체삭제</button>}
                    </div>
                  </div>
                  {history.length===0?(
                    <div style={{textAlign:"center",padding:"24px",color:"var(--text2)"}}>
                      <div style={{fontSize:32,marginBottom:8}}>📋</div>
                      <div style={{fontSize:14,fontWeight:700}}>아직 발행 기록이 없어요</div>
                    </div>
                  ):history.map((h,i)=>(
                    <div key={h.id} style={{display:"flex",alignItems:"center",gap:10,padding:"12px 0",borderBottom:"1px solid var(--border)",animationDelay:`${i*.04}s`}}>
                      <span style={{fontSize:20,flexShrink:0}}>{h.platform==="neighbor"?"🤝":h.platform==="naver"?"🟢":"🟠"}</span>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontSize:13,fontWeight:700,color:"var(--text)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{h.title}</div>
                        <div style={{fontSize:11,color:"var(--text2)",marginTop:2}}>{new Date(h.published_at).toLocaleString("ko-KR")}</div>
                        {(()=>{const ln=scLogNoOf(h.post_url);const rd=ln?rankData[ln]:null;if(!rd)return null;const diff=(rd.prev!=null&&rd.rank!=null)?rd.prev-rd.rank:null;return(<div style={{fontSize:11,marginTop:3,display:"flex",gap:6,flexWrap:"wrap"}}><span style={{fontWeight:800,color:rd.rank!=null?"#00c896":"var(--text3)"}}>{rd.rank!=null?`🔍 현재 ${rd.rank}위`:"🔍 순위권 밖"}</span>{diff!=null&&diff!==0&&<span style={{fontWeight:800,color:diff>0?"#00c896":"#ff6b6b"}}>{diff>0?`▲${diff}`:`▼${-diff}`}</span>}</div>);})()}
                      </div>
                      <span style={{fontSize:11,fontWeight:700,padding:"3px 8px",borderRadius:99,flexShrink:0,
                        background:h.status==="success"?"var(--accent-bg)":h.status==="fail"?"rgba(255,71,87,.1)":"rgba(255,179,71,.1)",
                        color:h.status==="success"?"var(--accent-text)":h.status==="fail"?"var(--danger)":"var(--warn)"}}>
                        {h.status==="success"?"✅ 성공":h.status==="fail"?"❌ 실패":"⏳ 대기"}
                      </span>
                      {h.post_url&&<a href={h.post_url} target="_blank" rel="noopener noreferrer" style={{fontSize:12,color:"var(--accent-text)",fontWeight:700,flexShrink:0}}>보기</a>}
                      <button style={{padding:"4px 10px",borderRadius:7,border:"1px solid rgba(255,71,87,.3)",background:"transparent",color:"var(--danger)",cursor:"pointer",fontSize:12,fontWeight:700,flexShrink:0}} onClick={async()=>{await deleteHistory(h.id);setHistory(prev=>prev.filter(x=>x.id!==h.id));}}>삭제</button>
                          {h.status!=="fail"&&(
                            <button onClick={async()=>{
                              let c:any=(h as any).content;
                              if(typeof c==="string"){ try{c=JSON.parse(c);}catch{c=null;} }
                              // 목록엔 content를 안 싣는다(성능) → 이 한 건만 DB에서 단건 조회로 보충
                              if(!c){ try{ showToast("📄 발행했던 글·이미지를 불러오는 중…"); c=await getHistoryContent(h.id); }catch{ c=null; } }
                              if(c){
                                setPubTitle(c.title||h.title||"");
                                if(c.content)setGenContent(c.content);
                                if(Array.isArray(c.blocks))setBlocks(c.blocks.map((b:any)=>b.type==="text"?{type:"text",id:uid(),content:b.content}:b.type==="image"?{type:"image",id:uid(),src:b.src,alt:b.alt||"",position:"center",source:"auto"}:b.type==="image-pair"?{type:"image-pair",id:uid(),images:b.images}:null).filter(Boolean) as any);
                                if(c.imageUrl)setThumbnail(c.imageUrl);
                                if(Array.isArray(c.tags))setHashtags(c.tags.map((t:string)=>t.startsWith("#")?t:"#"+t));
                                if(c.visibility)setVisibility(c.visibility);
                                if(c.pubScope)setPubScope(c.pubScope);
                                setTab("publish");
                                showToast("✅ 글·이미지 통째로 복원 완료! 발행 버튼만 누르면 돼요");
                              }else{
                                setPubTitle(h.title||"");setTab("publish");
                                showToast("제목만 복원됐어요 (이전 발행은 내용 미저장)");
                              }
                            }} style={{padding:"4px 10px",borderRadius:7,border:"1px solid rgba(0,200,120,.3)",background:"transparent",color:"var(--success)",cursor:"pointer",fontSize:12,fontWeight:700,flexShrink:0}}>🔄 재발행</button>
                          )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ───── 📷 사진 글쓰기 ───── */}
            {tab === "photo" && (
              <div className="photo-root">
                <UsageGuide theme={theme==="dark"?"dark":"light"} subtitle="사진만 올리면 그 사진으로 블로그 글을 만들어줄게요." steps={[{ico:"👤",title:"발행 계정 선택",desc:"‘네이버 발행 계정’에서 올릴 계정을 ◉ 로 골라요."},{ico:"📷",title:"사진 올리기",desc:"글에 넣을 사진을 업로드해요(최대 20장)."},{ico:"✨",title:"생성·발행",desc:"핵심 포인트를 적고 생성하면 사진 글이 만들어져요."}]} />
                <div className="photo-story">
                  <div className="photo-story-step s1">
                    <span className="photo-story-ico">📸</span>
                    <div className="photo-story-num">STEP 1</div>
                    <div className="photo-story-title">사진 업로드</div>
                    <div className="photo-story-desc">내 사진을 최대 20장</div>
                    <span className="photo-story-arrow">›</span>
                  </div>
                  <div className="photo-story-step s2">
                    <span className="photo-story-ico">✏️</span>
                    <div className="photo-story-num">STEP 2</div>
                    <div className="photo-story-title">키포인트 입력</div>
                    <div className="photo-story-desc">장소, 가격, 느낌</div>
                    <span className="photo-story-arrow">›</span>
                  </div>
                  <div className="photo-story-step s3">
                    <span className="photo-story-ico">🌸</span>
                    <div className="photo-story-num">STEP 3</div>
                    <div className="photo-story-title">AI 글 생성</div>
                    <div className="photo-story-desc">사진 분석 기반 글</div>
                  </div>
                </div>
                <div className="card" style={{padding:"18px",marginBottom:14}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
                    <label className="inp-label" style={{margin:0}}>📷 사진 업로드 <span style={{fontSize:11,color:"var(--text3)"}}>(최대 20장)</span></label>
                    {photoFiles.length>0&&<button onClick={()=>setPhotoFiles([])} style={{fontSize:11,color:"#FF6B9D",background:"none",border:"none",cursor:"pointer",fontFamily:"inherit"}}>전체 삭제</button>}
                  </div>
                  <div className={`photo-drop${photoDragOver?" drag-over":""}`}
                    onClick={()=>{const inp=document.createElement("input");inp.type="file";inp.multiple=true;inp.accept="image/*";inp.onchange=e=>handlePhotoUpload((e.target as HTMLInputElement).files);inp.click();}}
                    onDragOver={e=>{e.preventDefault();setPhotoDragOver(true);}}
                    onDragLeave={()=>setPhotoDragOver(false)}
                    onDrop={e=>{e.preventDefault();setPhotoDragOver(false);handlePhotoUpload(e.dataTransfer.files);}}>
                    <div className="photo-drop-ico"><span className="flower-deco">🌸</span></div>
                    <div className="photo-drop-title">사진을 여기에 끌어다 놓거나 클릭하세요</div>
                    <div className="photo-drop-desc">JPG, PNG 지원 · 최대 20장 · {photoFiles.length}/20장</div>
                  </div>
                  {photoFiles.length>0&&(
                    <div className="photo-grid">
                      {photoFiles.map((f,i)=>(
                        <div key={f.id} className="photo-thumb">
                          <img src={f.src} alt={f.name}/>
                          {i===0&&<div style={{position:"absolute",bottom:4,left:4,fontSize:9,fontWeight:800,background:"#FF6B9D",color:"#fff",padding:"2px 6px",borderRadius:99}}>대표</div>}
                          <button className="photo-thumb-del" onClick={()=>setPhotoFiles(p=>p.filter(x=>x.id!==f.id))}>✕</button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div className="card" style={{padding:"18px",marginBottom:14}}>
                  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
                    <label className="inp-label" style={{margin:0}}>✏️ 키포인트 <span style={{fontSize:11,color:"var(--text3)"}}>(선택사항)</span></label>
                    <button onClick={()=>setPhotoGuideModal("example")} style={{padding:"5px 12px",borderRadius:20,background:"linear-gradient(135deg,#FF6B9D,#C77DFF)",color:"#fff",border:"none",cursor:"pointer",fontSize:11,fontWeight:800,fontFamily:"inherit",whiteSpace:"nowrap",flexShrink:0}}>📝 예시 보기</button>
                  </div>
                  <textarea className="photo-keypoints" placeholder="예시: 강원도 홍천 맛집, 갈비탕 12,000원, 웨이팅 30분, 주차 가능" value={photoKeypoints} onChange={e=>setPhotoKeypoints(e.target.value)}/>
                </div>
                <div className="card" style={{padding:"18px",marginBottom:14}}>
                  <div style={{marginBottom:14}}>
                    <label className="inp-label">✍️ 글 스타일</label>
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:7}}>
                      {WRITE_STYLES.map(s=>(
                        <button key={s.id} onClick={()=>{setWriteStyle(s.id);localStorage.setItem("publy_adm_write_style",s.id);}}
                          style={{padding:"10px 12px",borderRadius:10,border:`1.5px solid ${writeStyle===s.id?"#FF6B9D":"var(--border)"}`,background:writeStyle===s.id?"#FF6B9D22":"var(--bg)",cursor:"pointer",textAlign:"left",fontFamily:"inherit"}}>
                          <div style={{fontSize:13,fontWeight:700,color:writeStyle===s.id?"#FF6B9D":"var(--text)"}}>{s.i} {s.id}</div>
                          <div style={{fontSize:11,color:"var(--text3)",marginTop:2}}>{s.desc}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="inp-label">🎭 말투 설정</label>
                    <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                      {PERSONA_STYLES.map(p=>(
                        <button key={p.id} onClick={()=>{setPersona(p.id);localStorage.setItem("publy_adm_persona",p.id);}}
                          style={{padding:"6px 11px",borderRadius:20,border:`1.5px solid ${persona===p.id?"#C77DFF":"var(--border)"}`,background:persona===p.id?"#C77DFF22":"var(--bg)",cursor:"pointer",fontFamily:"inherit",fontSize:12,fontWeight:persona===p.id?700:500,color:persona===p.id?"#C77DFF":"var(--text2)",whiteSpace:"nowrap"}}>
                          {p.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                <button className="photo-gen-btn" onClick={generateFromPhotos} disabled={photoGenerating||photoFiles.length===0}>
                  {photoGenerating?<><span className="sp-w spinner" style={{width:18,height:18,marginRight:8}}/>AI가 사진을 분석하고 있어요...</>:<><span className="flower-deco">🌸</span> 사진으로 글 생성하기</>}
                </button>
                {photoGenerating&&(
                  <button onClick={()=>setPhotoGenerating(false)} style={{width:"100%",marginTop:8,padding:"10px",borderRadius:12,border:"1px solid var(--border)",background:"var(--bg2)",color:"var(--text2)",cursor:"pointer",fontSize:13,fontWeight:700,fontFamily:"inherit"}}>⏹️ 생성 취소</button>
                )}
                {photoGenDone&&genContent&&(
                  <div style={{marginTop:20}}>
                    <div style={{padding:"12px 16px",borderRadius:14,background:"linear-gradient(135deg,#FF6B9D11,#C77DFF11)",border:"1px solid #FF6B9D33",marginBottom:12}}>
                      <div style={{fontSize:13,fontWeight:800,color:"#FF6B9D",marginBottom:4}}>🎉 글 생성 완료! {genContent.length.toLocaleString()}자 · 사진 {photoFiles.length}장 기반</div>
                      <div style={{display:"flex",gap:8}}>
                        <button onClick={()=>openPreview()} style={{padding:"7px 14px",borderRadius:9,border:"1px solid #C77DFF",background:"#C77DFF11",color:"#C77DFF",cursor:"pointer",fontSize:12,fontWeight:700,fontFamily:"inherit"}}>👁️ 미리보기</button>
                        <button onClick={()=>setTab("publish")} style={{padding:"7px 14px",borderRadius:9,border:"none",background:"linear-gradient(135deg,#FF6B9D,#C77DFF)",color:"#fff",cursor:"pointer",fontSize:12,fontWeight:700,fontFamily:"inherit"}}>🚀 발행하기 탭으로 →</button>
                      </div>
                    </div>
                    {qualityScore&&(
                      <div style={{padding:"14px 16px",borderRadius:12,background:"var(--card2)",border:"1px solid var(--border)",marginBottom:14}}>
                        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
                          <span style={{fontSize:12,fontWeight:800,color:"var(--text2)"}}>📊 SEO 품질 분석</span>
                          <span style={{fontSize:20,fontWeight:900,color:qualityScore.score>=80?"var(--success)":qualityScore.score>=55?"var(--warn)":"var(--danger)"}}>{qualityScore.score}점</span>
                        </div>
                        <div style={{display:"flex",flexDirection:"column",gap:6}}>
                          {qualityScore.items.map((item,idx2)=>(
                            <div key={idx2} style={{display:"flex",alignItems:"center",gap:8,padding:"6px 10px",borderRadius:8,background:item.pass?"rgba(0,255,150,.06)":"rgba(255,80,80,.06)"}}>
                              <span style={{fontSize:14,flexShrink:0}}>{item.pass?"✅":"❌"}</span>
                              <div style={{flex:1}}>
                                <div style={{fontSize:11,fontWeight:700,color:item.pass?"var(--success)":"var(--danger)"}}>{item.label}</div>
                                <div style={{fontSize:10,color:"var(--text3)"}}>{item.detail}</div>
                              </div>
                              <span style={{fontSize:10,color:"var(--text3)",flexShrink:0}}>{item.weight}점</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
                <div className="photo-guides">
                  <button className="photo-guide-btn" onClick={()=>setPhotoGuideModal("guide")}>📖 사용방법</button>
                  <button className="photo-guide-btn" style={{background:"linear-gradient(135deg,#FF8C00,#FF6B9D)"}} onClick={()=>setPhotoGuideModal("caution")}>⚠️ 유의할점</button>
                </div>
                <div style={{height:70}} aria-hidden="true" />
                {photoGuideModal&&(
                  <div onClick={()=>setPhotoGuideModal(null)} style={{position:"fixed",inset:0,zIndex:9999,background:"rgba(0,0,0,.6)",backdropFilter:"blur(4px)",display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
                    <div onClick={e=>e.stopPropagation()} style={{width:"100%",maxWidth:460,maxHeight:"85vh",overflowY:"auto",background:"var(--card)",borderRadius:18,border:"1px solid var(--border)"}}>
                      <div style={{position:"sticky",top:0,padding:"16px 20px",background:photoGuideModal==="caution"?"linear-gradient(135deg,#FF8C00,#FF6B9D)":"linear-gradient(135deg,#FF6B9D,#C77DFF)",color:"#fff",display:"flex",alignItems:"center",justifyContent:"space-between",gap:10}}>
                        <span style={{fontSize:16,fontWeight:900}}>{photoGuideModal==="caution"?"⚠️ 사진 글쓰기 유의할점":photoGuideModal==="example"?"✏️ 키포인트 예시":"📷 사진으로 글 쓰는 방법"}</span>
                        <button onClick={()=>setPhotoGuideModal(null)} style={{width:30,height:30,borderRadius:8,border:"none",background:"rgba(255,255,255,.25)",color:"#fff",cursor:"pointer",fontSize:16,fontWeight:900,flexShrink:0}}>✕</button>
                      </div>
                      <div style={{padding:"16px 18px",display:"flex",flexDirection:"column",gap:12}}>
                        {photoGuideModal==="example"?([["🍽️ 맛집","강원도 맛집, 고기집","강원도 홍천 태장동 / 한우 소갈비찜 / 2인 45,000원 / 웨이팅 40분 / 주차 무료"],["✈️ 여행","제주도 여행, 좋았다","제주 성산일출봉 / 오전 6시 / 입장료 5,000원 / 공항서 1시간"],["☕ 카페","서울 카페, 예뻤다","서울 성수동 리모델링 카페 / 아메리카노 6,500원 / 대기 없음"],["📦 제품","에어프라이어 구매","필립스 5.6L / 129,000원 / 6개월 사용 / 만족 9점"]] as [string,string,string][]).map(([cat,bad,good])=>(
                          <div key={cat} style={{background:"var(--bg)",borderRadius:12,padding:"13px 15px",border:"1px solid var(--border)"}}>
                            <div style={{fontSize:13,fontWeight:800,color:"#FF6B9D",marginBottom:7}}>{cat}</div>
                            <div style={{fontSize:12,color:"#e06",background:"rgba(255,80,80,.08)",borderRadius:8,padding:"7px 10px",marginBottom:5}}>❌ {bad}</div>
                            <div style={{fontSize:12,color:"var(--text)",background:"rgba(0,200,120,.1)",borderRadius:8,padding:"7px 10px",lineHeight:1.6}}>✅ {good}</div>
                          </div>
                        )):photoGuideModal==="guide"?([["1","사진을 올려주세요","업로드 버튼/드래그. 최대 20장, 첫 사진이 대표."],["2","키포인트 (선택)","장소·가격·시간 등 간단히. 안 적어도 사진만으로 써요."],["3","글 스타일·말투","맛집후기·여행기·감성일기·정보글 선택."],["4","🌸 글 생성하기","AI가 사진 분석해 글 작성(30초~1분)."],["5","블로그 발행","발행하기 탭에서 계정 선택 후 발행."]] as [string,string,string][]).map(([n,t,d])=>(
                          <div key={n} style={{background:"var(--bg)",borderRadius:12,padding:"13px 15px",border:"1px solid var(--border)"}}>
                            <div style={{fontSize:13.5,fontWeight:800,color:"#FF6B9D",marginBottom:5}}>{n}. {t}</div>
                            <div style={{fontSize:13,lineHeight:1.7,color:"var(--text2)"}}>{d}</div>
                          </div>
                        )):([["🔑 Gemini 키가 없다면?","설정 → AI 설정에서 Gemini 발급받기 → 키 입력·저장."],["⏱️ 분당 한도 초과","무료는 분당 제한. 1분 기다렸다 다시. 자주 나면 키 새로 발급."],["🖼️ 사진 주의","20장 올려도 분석은 처음 10장. 첫 사진=대표. 밝고 선명할수록 좋아요."],["⏳ 생성 시간","사진 많으면 30초~1분. 생성 중 다른 버튼 누르지 마세요."]] as [string,string][]).map(([t,d])=>(
                          <div key={t} style={{background:"var(--bg)",borderRadius:12,padding:"13px 15px",border:"1px solid var(--border)"}}>
                            <div style={{fontSize:13.5,fontWeight:800,color:"#FF8C00",marginBottom:5}}>{t}</div>
                            <div style={{fontSize:13,lineHeight:1.7,color:"var(--text2)"}}>{d}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

              </div>
            )}

            

            {/* ───── 🚀 자동발행 ───── */}
            {tab === "publish" && (
              <div style={{animation:"fadeUp .25s ease both"}}>
                <UsageGuide theme={theme==="dark"?"dark":"light"} subtitle="다 된 글을 블로그에 자동으로 올려줄게요." steps={[{ico:"👤",title:"계정·플랫폼 선택",desc:"네이버/티스토리와 올릴 계정을 골라요."},{ico:"🧩",title:"발행 방식",desc:"전체/본문+FAQ/본문만 중 골라요. 예약 발행도 돼요."},{ico:"🚀",title:"발행",desc:"🚀 발행 버튼을 누르면 블로그에 자동으로 올라가요."}]} />
                {!botOnline&&<div className="alert alert-danger" style={{margin:"12px 16px 0"}}>⚠️ 봇 오프라인 — PC에서 Publy 앱 실행 시 즉시 발행돼요.</div>}
                {renderAeoBanner()}

                {/* ── 발행 준비도 + 설정 스티키 바 ── */}
                <div className="pub-sticky-bar">
                  {/* 플랫폼 토글 - 항상 보임 */}
                  <div style={{display:"flex",gap:6,flexShrink:0}}>
                    {([{p:"naver",ico:"🟢",name:"네이버",c:"var(--naver)"},{p:"tistory",ico:"🟠",name:"티스토리",c:"var(--tistory)"}] as const).map(({p,ico,name,c})=>(
                      <button key={p} onClick={()=>{setPlatform(p);if(pubAccId)loadCategories(p);}}
                        style={{display:"flex",alignItems:"center",gap:5,padding:"6px 12px",borderRadius:8,border:`2px solid ${platform===p?c:"var(--border)"}`,background:platform===p?`${c}18`:"var(--bg)",cursor:"pointer",fontFamily:"inherit",fontSize:12,fontWeight:700,color:"var(--text)",whiteSpace:"nowrap",transition:"all .15s"}}>
                        <span>{ico}</span>{name}{platform===p&&<span style={{color:c}}>✓</span>}
                      </button>
                    ))}
                  </div>
                  <div style={{width:1,height:20,background:"var(--border)",flexShrink:0}}/>
                  {/* 준비도 체크 */}
                  <div className="pub-ready">
                    {[
                      {label:"제목",ok:!!pubTitle},
                      {label:"본문",ok:blocks.some(b=>b.type==="text"&&(b as TextBlock).content.trim().length>0)},
                      {label:imgGenType==="flow"?`Flow ${flowImgCount}장`:`이미지 ${blocks.filter(b=>b.type==="image"||(b.type==="image-pair")).length}장`,ok:imgGenType==="flow"||blocks.some(b=>b.type==="image"||(b.type==="image-pair"))},
                      {label:pubAccId?connAccs.find(a=>a.id===pubAccId)?.username||"계정":"계정 미선택",ok:!!pubAccId},
                    ].map(c=>(
                      <span key={c.label} className={`pub-ready-chip ${c.ok?"pub-ready-ok":"pub-ready-no"}`}>
                        {c.ok?"✅":"❌"} {c.label}
                      </span>
                    ))}
                    {imgGenType==="flow"&&<span style={{fontSize:11,padding:"3px 9px",borderRadius:99,background:"rgba(168,85,247,.15)",color:"#c084fc",border:"1px solid rgba(168,85,247,.3)",fontWeight:700}}>🎨 Flow 발행</span>}
                  </div>
                  <div style={{marginLeft:"auto",display:"flex",gap:8,alignItems:"center"}}>
                    <div style={{position:"relative"}}>
                      <button onClick={()=>setShowNaverMenu(v=>!v)} style={{display:"flex",alignItems:"center",gap:5,padding:"7px 12px",borderRadius:8,background:"#03C75A",color:"#fff",border:"none",cursor:"pointer",fontSize:12,fontWeight:700,fontFamily:"inherit",whiteSpace:"nowrap"}}>
                        📋 N복사 ▲
                      </button>
                      {showNaverMenu&&(
                        <>
                          <div style={{position:"fixed",inset:0,zIndex:40}} onClick={()=>setShowNaverMenu(false)}/>
                          <div style={{position:"absolute",top:38,right:0,zIndex:50,width:260,borderRadius:14,overflow:"hidden",background:"#1a1a2e",border:"1px solid rgba(255,255,255,.12)",boxShadow:"0 8px 32px rgba(0,0,0,.4)"}}>
                            {[
                              {label:"전체 복사",tag:"전체",color:"#03C75A",tagColor:"#fff",tip:"정보성 글·리뷰",fn:()=>{copyForNaver();setShowNaverMenu(false);}},
                              {label:"본문+FAQ",tag:"FAQ",color:"#fbbf24",tagColor:"#000",tip:"일반 블로그",fn:()=>{copyForNaverWithFaq();setShowNaverMenu(false);}},
                              {label:"본문만",tag:"본문",color:"#f472b6",tagColor:"#fff",tip:"체험단·맛집",fn:()=>{copyForNaverBodyOnly();setShowNaverMenu(false);}},
                            ].map((opt,i)=>(
                              <button key={i} onClick={opt.fn} style={{width:"100%",textAlign:"left",padding:"10px 14px",borderBottom:i<2?"1px solid rgba(255,255,255,.08)":"none",background:"transparent",cursor:"pointer",border:"none",fontFamily:"inherit",display:"flex",alignItems:"center",gap:8}}>
                                <span style={{fontSize:10,fontWeight:800,padding:"2px 7px",borderRadius:99,background:opt.color,color:opt.tagColor,flexShrink:0}}>{opt.tag}</span>
                                <div><div style={{fontSize:12,fontWeight:700,color:"#fff"}}>{opt.label}</div><div style={{fontSize:10,color:"rgba(255,255,255,.45)"}}>{opt.tip}</div></div>
                              </button>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                    <button onClick={()=>openPreview()} style={{display:"flex",alignItems:"center",gap:5,padding:"7px 12px",borderRadius:8,background:"oklch(.62 .22 300)",color:"#fff",border:"none",cursor:"pointer",fontSize:12,fontWeight:700,fontFamily:"inherit",whiteSpace:"nowrap"}}>
                      👁️ 미리보기
                    </button>
                    <button onClick={()=>setShowPublishPanel(v=>!v)} style={{display:"flex",alignItems:"center",gap:5,padding:"7px 12px",borderRadius:8,border:"1px solid var(--border)",background:showPublishPanel?"var(--accent-bg)":"var(--card)",color:showPublishPanel?"var(--accent-text)":"var(--text2)",cursor:"pointer",fontSize:12,fontWeight:700,fontFamily:"inherit",whiteSpace:"nowrap"}}>
                      ⚙️ 발행 설정 {showPublishPanel?"▲":"▼"}
                    </button>
                    <button onClick={handlePublish} disabled={publishing||!pubAccId||!pubTitle||!buildAdmPublishContent()||(scheduleOn&&!scheduleTime)}
                      style={{display:"flex",alignItems:"center",gap:5,padding:"7px 16px",borderRadius:8,border:"none",background:scheduleOn?"var(--warn)":"var(--accent)",color:"#000",cursor:"pointer",fontSize:13,fontWeight:800,fontFamily:"inherit",whiteSpace:"nowrap",opacity:(publishing||!pubAccId||!pubTitle)?.5:1}}>
                      {publishing?(scheduleOn?"예약 중...":"발행 중..."):scheduleOn?"⏰ 예약":"🚀 발행"}
                    </button>
                  </div>
                </div>

                {/* ── 발행 설정 패널 (접이식) ── */}
                {showPublishPanel&&(
                  <div style={{background:"var(--bg2)",borderBottom:"2px solid var(--accent-border)",padding:"16px"}}>
                    {renderAdmPublishPanel()}
                  </div>
                )}

                {pubMsg&&<div className={`alert ${pubMsg.includes("✅")?"alert-success":"alert-danger"}`} style={{margin:"12px 16px 0",fontSize:16,padding:"16px",lineHeight:1.6}}>{pubMsg}</div>}

                {/* ── 에디터 (전폭) ── */}
                <div style={{padding:"16px",display:"flex",flexDirection:"column",gap:16}}>

                    {/* 제목 */}
                    <div className="card" style={{padding:"14px 16px"}}>
                      <label className="inp-label">글 제목</label>
                      <input className="inp lg" placeholder="블로그 글 제목..." value={pubTitle} onChange={e=>setPubTitle(e.target.value)}/>
                    </div>

                    {/* 썸네일 + 인사말 접기 */}
                    <div className="card" style={{padding:0,overflow:"hidden"}}>
                      <button onClick={()=>setShowMeta(v=>!v)} style={{width:"100%",display:"flex",alignItems:"center",justifyContent:"space-between",padding:"14px 18px",background:"transparent",border:"none",cursor:"pointer",fontFamily:"inherit"}}>
                        <div style={{display:"flex",alignItems:"center",gap:10}}>
                          <span style={{fontSize:14,fontWeight:700,color:"var(--text)"}}>🖼️ 썸네일 · 인사말</span>
                          {thumbnail&&<span style={{fontSize:10,fontWeight:800,padding:"2px 8px",borderRadius:99,background:"var(--accent)",color:"#000"}}>썸네일 ✓</span>}
                          {!thumbnail&&getActiveImages().length===0&&<span style={{fontSize:11,color:"var(--text3)"}}>선택사항</span>}
                        </div>
                        <span style={{fontSize:16,color:"var(--text3)",transition:"transform .2s",display:"inline-block",transform:showMeta?"rotate(180deg)":"rotate(0deg)"}}>▼</span>
                      </button>
                      {showMeta&&(
                        <div style={{padding:"0 16px 16px",borderTop:"1px solid var(--border)",display:"flex",flexDirection:"column",gap:14,marginTop:4,paddingTop:16}}>
                          <div>
                            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
                              <label className="inp-label" style={{margin:0}}>🖼️ 썸네일</label>
                              {thumbnail&&<button onClick={()=>setThumbnail("")} style={{background:"transparent",border:"none",cursor:"pointer",color:"var(--text3)",fontSize:18}}>✕</button>}
                            </div>
                            {thumbnail?(
                              <div style={{position:"relative",borderRadius:12,overflow:"hidden",aspectRatio:"16/9"}}>
                                <img src={thumbnail} alt="썸네일" style={{width:"100%",height:"100%",objectFit:"cover",display:"block"}} onError={()=>setThumbnail("")}/>
                              </div>
                            ):(
                              <div style={{display:"flex",flexDirection:"column",gap:10}}>
                                {getActiveImages().length>0&&(
                                  <div>
                                    <div style={{fontSize:12,color:"var(--text3)",marginBottom:6}}>생성된 이미지에서 선택:</div>
                                    <div style={{display:"flex",gap:8,overflowX:"auto",paddingBottom:4}}>
                                      {getActiveImages().slice(0,6).map((src,i)=>(
                                        <button key={i} onClick={()=>setThumbnail(src)} style={{flexShrink:0,width:64,height:64,borderRadius:10,overflow:"hidden",border:"2px solid var(--border)",padding:0,cursor:"pointer"}}>
                                          <img src={src} alt="" style={{width:"100%",height:"100%",objectFit:"cover"}} onError={e=>{(e.target as HTMLImageElement).style.display="none";}}/>
                                        </button>
                                      ))}
                                    </div>
                                  </div>
                                )}
                                <button onClick={()=>thumbnailRef.current?.click()} style={{width:"100%",padding:"18px",borderRadius:12,border:"2px dashed var(--border)",background:"var(--bg)",cursor:"pointer",color:"var(--text3)",fontSize:13,fontFamily:"inherit"}}>📁 직접 업로드</button>
                              </div>
                            )}
                            <input ref={thumbnailRef} type="file" accept="image/*" style={{display:"none"}} onChange={e=>{const f=e.target.files?.[0];if(!f)return;const r=new FileReader();r.onload=ev=>setThumbnail(ev.target?.result as string);r.readAsDataURL(f);}}/>
                          </div>
                          <div>
                            <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                              <label className="inp-label" style={{marginBottom:0}}>💬 글쓴이 인사말 <span style={{fontWeight:400,color:"var(--text3)"}}>(한 번 저장하면 계속 사용)</span></label>
                              {savedGreeting && greeting.trim()===savedGreeting
                                ? <span style={{fontSize:11,fontWeight:800,color:"#2f9e5e",background:"rgba(47,158,94,.12)",borderRadius:99,padding:"2px 9px"}}>✓ 저장됨</span>
                                : savedGreeting
                                  ? <span style={{fontSize:11,fontWeight:800,color:"#e0952f",background:"rgba(224,149,47,.12)",borderRadius:99,padding:"2px 9px"}}>● 저장 안 된 변경</span>
                                  : null}
                            </div>
                            <textarea className="inp" rows={2} placeholder="안녕하세요! 오늘도 유용한 정보를 가지고 왔어요 😊" value={greeting} onChange={e=>setGreeting(e.target.value)} style={{resize:"none",fontSize:13,marginTop:6}}/>
                            <div style={{display:"flex",gap:6,marginTop:6}}>
                              <button type="button" onClick={saveGreeting} disabled={greeting.trim()===savedGreeting} style={{flex:1,padding:"9px",borderRadius:10,border:"none",cursor:greeting.trim()===savedGreeting?"default":"pointer",fontSize:12.5,fontWeight:800,fontFamily:"inherit",background:greeting.trim()===savedGreeting?"var(--card2)":"var(--accent)",color:greeting.trim()===savedGreeting?"var(--text3)":"#fff",opacity:greeting.trim()===savedGreeting?.7:1}}>💾 인사말 저장하기</button>
                              {savedGreeting && <button type="button" onClick={()=>{setGreeting("");localStorage.removeItem("publy_adm_greeting");setSavedGreeting("");showToast("저장된 인사말을 비웠어요","success");}} title="저장된 인사말 지우기" style={{padding:"9px 12px",borderRadius:10,border:"1px solid var(--border)",background:"var(--card)",color:"var(--text3)",cursor:"pointer",fontSize:12,fontWeight:700,fontFamily:"inherit"}}>비우기</button>}
                            </div>
                            <p style={{margin:"6px 2px 0",fontSize:11,color:"var(--text3)",lineHeight:1.55}}>저장하면 앞으로 <b style={{color:"var(--text2)"}}>모든 글의 썸네일 다음</b>에 자동으로 들어가요. 바꾸려면 고치고 다시 저장하면 돼요.</p>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* 이미지 삽입 */}
                    <div className="card" style={{padding:0,overflow:"hidden"}}>
                      <div style={{padding:"13px 16px",borderBottom:"1px solid var(--border)"}}>
                        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10}}>
                          <span style={{fontSize:15}}>🖼️</span>
                          <span style={{fontSize:14,fontWeight:700,color:"var(--text)"}}>이미지 삽입</span>
                        </div>
                        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:10}}>
                          {[{v:"auto",ico:"✨",label:"자동"},{v:"manual",ico:"📁",label:"수동"}].map(m=>(
                            <button key={m.v} onClick={()=>setImageMode(m.v as "auto"|"manual")} style={{padding:"10px 12px",borderRadius:10,border:`2px solid ${imageMode===m.v?"var(--accent)":"var(--border)"}`,background:imageMode===m.v?"var(--accent-bg)":"var(--bg)",cursor:"pointer",textAlign:"left",fontFamily:"inherit",transition:"all .15s"}}>
                              <div style={{display:"flex",alignItems:"center",gap:6}}>
                                <span>{m.ico}</span>
                                <span style={{fontSize:13,fontWeight:700,color:imageMode===m.v?"var(--accent-text)":"var(--text)"}}>{m.label}</span>
                                {imageMode===m.v&&blocks.filter(b=>b.type==="image").length>0&&<span style={{fontSize:10,fontWeight:700,padding:"1px 7px",borderRadius:99,background:"var(--accent-text)",color:"#000"}}>{blocks.filter(b=>b.type==="image").length}개</span>}
                              </div>
                            </button>
                          ))}
                        </div>
                        {imageMode==="auto"&&(
                          <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
                            <div style={{flex:1,padding:"8px 12px",borderRadius:8,background:"var(--bg2)",border:"1px solid var(--border)",fontSize:12,color:"var(--text3)"}}>
                              {getActiveImages().length>0?`${getActiveImages().length}개 준비됨`:"이미지 생성 먼저"}
                            </div>
                            {autoInserted?(
                              <button onClick={handleRemoveAutoImages} style={{padding:"8px 14px",borderRadius:8,border:"1px solid rgba(255,71,87,.4)",background:"rgba(255,71,87,.08)",color:"var(--danger)",cursor:"pointer",fontSize:12,fontWeight:700,fontFamily:"inherit"}}>✕ 제거</button>
                            ):(
                              <button onClick={handleAutoInsert} disabled={getActiveImages().length===0} style={{padding:"8px 14px",borderRadius:8,border:"none",background:"var(--accent)",color:"#000",cursor:"pointer",fontSize:12,fontWeight:700,fontFamily:"inherit",opacity:getActiveImages().length===0?.4:1}}>✨ 자동 삽입</button>
                            )}
                          </div>
                        )}
                        {imageMode==="manual"&&(
                          <div style={{display:"flex",gap:8}}>
                            <button onClick={()=>manualFileRef.current?.click()} style={{padding:"8px 14px",borderRadius:8,border:"1px solid var(--border)",background:"var(--bg2)",color:"var(--text2)",cursor:"pointer",fontSize:12,fontWeight:700,fontFamily:"inherit"}}>📁 파일 첨부</button>
                          </div>
                        )}
                        <input ref={manualFileRef} type="file" accept="image/*" style={{display:"none"}} onChange={e=>{
                          const f=e.target.files?.[0];if(!f)return;
                          const r=new FileReader();
                          r.onload=ev=>{
                            if(ev.target?.result){
                              const src=ev.target.result as string;
                              addManualImageBlock();
                              setBlocks(prev=>{
                                const last=prev[prev.length-1];
                                return prev.map(b=>b.id===last.id?({...b,src,alt:f.name} as ContentBlock):b);
                              });
                            }
                          };
                          r.readAsDataURL(f);e.target.value="";
                        }}/>
                      </div>

                      {/* 본문 편집 헤더 */}
                      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"12px 16px",borderBottom:"1px solid var(--border)"}}>
                        <div style={{display:"flex",alignItems:"center",gap:8}}>
                          <span style={{fontSize:14,fontWeight:700,color:"var(--text)"}}>📝 본문 편집</span>
                          <span style={{fontSize:11,padding:"2px 8px",borderRadius:99,background:"var(--bg2)",color:"var(--text3)"}}>{blocks.length}블록</span>
                        </div>
                        <div style={{display:"flex",gap:6}}>
                          <button onClick={()=>addTextBlock()} style={{padding:"5px 10px",borderRadius:7,border:"1px solid var(--border)",background:"var(--bg2)",color:"var(--text2)",cursor:"pointer",fontSize:11,fontWeight:700,fontFamily:"inherit"}}>+ 텍스트</button>
                          {imageMode==="manual"&&<button onClick={()=>addManualImageBlock()} style={{padding:"5px 10px",borderRadius:7,border:"1px solid var(--border)",background:"var(--bg2)",color:"var(--text2)",cursor:"pointer",fontSize:11,fontWeight:700,fontFamily:"inherit"}}>+ 이미지</button>}
                        </div>
                      </div>

                      {/* 블록 목록 */}
                      <div style={{padding:"12px 16px",display:"flex",flexDirection:"column",gap:10}}>
                        {blocks.map((block,idx)=>(
                          <div key={block.id}>
                            {block.type==="text"?(
                              <div style={{position:"relative"}}>
                                <textarea
                                  value={(block as TextBlock).content}
                                  onChange={e=>{
                                    updateBlock(block.id,{content:e.target.value});
                                    const el=e.target as HTMLTextAreaElement;
                                    const prev=el.style.height;
                                    el.style.height="0px";
                                    const next=el.scrollHeight+"px";
                                    if(prev!==next) el.style.height=next;
                                    else el.style.height=prev;
                                  }}
                                  placeholder="내용 입력..."
                                  style={{width:"100%",minHeight:80,padding:"10px 12px",borderRadius:10,border:"1px solid var(--border)",background:"var(--bg)",color:"var(--text)",fontSize:13,lineHeight:1.8,fontFamily:"inherit",resize:"none",outline:"none",boxSizing:"border-box"}}
                                />
                                <div style={{display:"flex",gap:5,marginTop:4,justifyContent:"flex-end"}}>
                                  {imageMode==="manual"&&<button onClick={()=>addManualImageBlock(block.id)} style={{padding:"3px 9px",borderRadius:6,border:"1px solid var(--border)",background:"var(--bg2)",color:"var(--text3)",cursor:"pointer",fontSize:11,fontFamily:"inherit"}}>🖼️</button>}
                                  <button onClick={()=>addTextBlock(block.id)} style={{padding:"3px 9px",borderRadius:6,border:"1px solid var(--border)",background:"var(--bg2)",color:"var(--text3)",cursor:"pointer",fontSize:11,fontFamily:"inherit"}}>+</button>
                                  {blocks.length>1&&<button onClick={()=>removeBlock(block.id)} style={{padding:"3px 9px",borderRadius:6,border:"1px solid rgba(255,71,87,.3)",background:"rgba(255,71,87,.06)",color:"var(--danger)",cursor:"pointer",fontSize:11,fontFamily:"inherit"}}>✕</button>}
                                </div>
                              </div>
                            ):(
                              <div style={{borderRadius:12,overflow:"hidden",border:`2px solid ${(block as SingleImageBlock).source==="auto"?"var(--accent-border)":"oklch(.75 .12 300 / 50%)"}`}}>
                                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"7px 12px",background:(block as SingleImageBlock).source==="auto"?"var(--accent-bg)":"oklch(.75 .12 300 / 8%)"}}>
                                  <span style={{fontSize:11,fontWeight:700,color:(block as SingleImageBlock).source==="auto"?"var(--accent-text)":"oklch(.75 .12 300)"}}>{(block as SingleImageBlock).source==="auto"?"✨ AI 생성":"📁 내 이미지"}</span>
                                  <div style={{display:"flex",gap:6,alignItems:"center"}}>
                                    <select value={(block as SingleImageBlock).position} onChange={e=>updateBlock(block.id,{position:e.target.value as "left"|"center"|"right"})} style={{fontSize:11,padding:"2px 6px",borderRadius:5,border:"1px solid var(--border)",background:"var(--bg)",color:"var(--text)"}}>
                                      <option value="left">왼쪽</option><option value="center">가운데</option><option value="right">오른쪽</option>
                                    </select>
                                    <button onClick={()=>removeBlock(block.id)} style={{background:"transparent",border:"none",color:"var(--text3)",cursor:"pointer",fontSize:14,lineHeight:1}}>✕</button>
                                  </div>
                                </div>
                                {(block as SingleImageBlock).src?(
                                  <div style={{padding:"8px 12px"}}>
                                    <img src={(block as SingleImageBlock).src} alt="" style={{width:"100%",borderRadius:8,display:"block",maxHeight:200,objectFit:"cover"}} onError={e=>{(e.target as HTMLImageElement).style.display="none";}}/>
                                  </div>
                                ):(
                                  <button onClick={()=>manualFileRef.current?.click()} style={{width:"100%",padding:"24px",background:"transparent",border:"none",cursor:"pointer",color:"var(--text3)",fontSize:13,fontFamily:"inherit"}}>📁 이미지 업로드</button>
                                )}
                                <div style={{padding:"0 12px 8px"}}>
                                  <input placeholder="이미지 설명 (alt)" value={(block as SingleImageBlock).alt} onChange={e=>updateBlock(block.id,{alt:e.target.value})} style={{width:"100%",padding:"5px 8px",borderRadius:7,border:"1px solid var(--border)",background:"var(--bg2)",color:"var(--text)",fontSize:11,fontFamily:"inherit",outline:"none",boxSizing:"border-box"}}/>
                                </div>
                              </div>
                            )}
                            {idx<blocks.length-1&&<div style={{display:"flex",alignItems:"center",margin:"4px 0"}}><div style={{flex:1,height:1,background:"var(--border)"}}/><span style={{margin:"0 8px",fontSize:10,color:"var(--text3)",opacity:.5}}>{idx+2}</span><div style={{flex:1,height:1,background:"var(--border)"}}/></div>}
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* 해시태그 */}
                    <div className="card" style={{padding:"14px 16px"}}>
                      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10}}>
                        <span style={{fontSize:15}}>#</span>
                        <span style={{fontSize:14,fontWeight:700,color:"var(--text)"}}>해시태그</span>
                      </div>
                      <div style={{display:"flex",flexWrap:"wrap",gap:7,marginBottom:10}}>
                        {hashtags.map((tag,i)=>(
                          <div key={i} style={{display:"flex",alignItems:"center",gap:5,padding:"5px 11px",borderRadius:99,background:"var(--accent-bg)",border:"1px solid var(--accent-border)",fontSize:12,fontWeight:600,color:"var(--accent-text)"}}>
                            {tag}<button onClick={()=>setHashtags(prev=>prev.filter((_,j)=>j!==i))} style={{background:"transparent",border:"none",cursor:"pointer",color:"var(--accent-text)",fontSize:13,lineHeight:1,padding:0}}>✕</button>
                          </div>
                        ))}
                      </div>
                      <div style={{display:"flex",gap:8}}>
                        <input className="inp" placeholder="#해시태그 입력" value={newTag} onChange={e=>setNewTag(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&newTag.trim()){if(hashtags.length>=8)return;setHashtags(prev=>[...prev,`#${newTag.replace("#","").trim()}`]);setNewTag("");}}} style={{flex:1}}/>
                        <button onClick={()=>{if(!newTag.trim()||hashtags.length>=8)return;setHashtags(prev=>[...prev,`#${newTag.replace("#","").trim()}`]);setNewTag("");}} className="btn btn-secondary" style={{padding:"0 16px",flexShrink:0}}>추가</button>
                      </div>
                    </div>
                </div>

              </div>
            )}

            {/* ===== ⚡ 원터치 발행 (관리자 · 무제한) ===== */}
            {tab === "onetouch" && (()=>{
              const OT="#7c3aed";
              const naverAccs=admAccs.filter(a=>a.is_connected&&a.platform==="naver");
              const kwList=otKeywords.split(/[\n,]+/).map(s=>s.trim()).filter(Boolean);
              const termMin=otCustomTerm.trim()?Math.max(1,parseInt(otCustomTerm,10)||otTermMin):otTermMin;
              const stepColor=(st?:string)=>st==="done"?"#00b487":st==="fail"?"#e5397f":st==="limit"?"#f59e0b":st==="run"?OT:"var(--text3)";
              return (
              <div style={{animation:"fadeUp .25s ease both"}}>
                <UsageGuide theme={theme==="dark"?"dark":"light"} accent={OT} subtitle="키워드만 넣으면 제목·글·이미지·카테고리까지 자동으로 만들어 순서대로 발행해요. (관리자는 무제한)" steps={[{ico:"⌨️",title:"키워드 입력",desc:"한 줄에 하나씩, 몇 개든."},{ico:"⏱️",title:"텀 설정",desc:"발행 간격(넉넉히)."},{ico:"⚡",title:"시작",desc:"봇이 알아서 — 로그로 확인."}]} />
                {renderAeoBanner()}
                {reviveState&&(
                  <div style={{margin:"12px 0",padding:"14px 16px",borderRadius:14,border:`1.5px solid ${reviveState.fail?"#ef4444":reviveState.done?"#00a878":OT}`,background:reviveState.fail?"rgba(239,68,68,.06)":reviveState.done?"rgba(0,168,120,.06)":`${OT}0d`}}>
                    <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
                      {!reviveState.done&&!reviveState.fail&&<span className="spinner"/>}
                      <span style={{fontSize:13.5,fontWeight:800,color:reviveState.fail?"#ef4444":reviveState.done?"#00a878":OT}}>✨ 글 살리기 {reviveState.done?"완료":reviveState.fail?"실패":"진행 중"}</span>
                      {(reviveState.done||reviveState.fail)&&<button onClick={()=>setReviveState(null)} style={{marginLeft:"auto",border:0,background:"transparent",color:"var(--text3)",cursor:"pointer",fontSize:16}}>✕</button>}
                    </div>
                    <div style={{fontSize:12,color:"var(--text2)",lineHeight:1.5,wordBreak:"break-all"}}>{reviveState.title}</div>
                    <div style={{fontSize:12,fontWeight:700,color:reviveState.fail?"#ef4444":"var(--text2)",marginTop:4}}>{reviveState.fail||reviveState.step}</div>
                  </div>
                )}
                {!botOnline&&<div className="alert alert-warn" style={{marginBottom:14}}>⚠️ PC에서 Publy 앱을 실행해야 발행이 가능합니다</div>}

                <div style={{marginBottom:14,padding:"12px 14px",borderRadius:12,background:`${OT}0d`,border:`1.5px solid ${OT}33`,fontSize:13,fontWeight:700,color:OT}}>✨ 관리자 계정은 <b>무제한</b> — 발행 한도 없이 원터치로 계속 발행할 수 있어요.</div>

                {/* 키워드 */}
                <div className="card" style={{marginBottom:14,border:`1.5px solid ${OT}33`}}>
                  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,flexWrap:"wrap",marginBottom:8}}>
                    <div style={{fontSize:15,fontWeight:800,color:OT}}>⌨️ 키워드 <span style={{fontSize:12,fontWeight:600,color:"var(--text3)"}}>· {otAiKw?"AI가 자동 생성":"한 줄에 하나씩"}</span></div>
                    <button onClick={()=>{const v=!otAiKw;setOtAiKw(v);localStorage.setItem("publy_adm_ot_aikw",v?"1":"0");}} disabled={otRunning}
                      style={{display:"flex",alignItems:"center",gap:8,padding:"6px 12px",borderRadius:99,border:`2px solid ${otAiKw?OT:"var(--border)"}`,background:otAiKw?`${OT}16`:"var(--bg)",cursor:otRunning?"default":"pointer",fontFamily:"inherit"}}>
                      <span style={{fontSize:12.5,fontWeight:800,color:otAiKw?OT:"var(--text2)"}}>✨ AI 자동추천 키워드</span>
                      <span style={{width:34,height:20,borderRadius:99,background:otAiKw?OT:"var(--border)",position:"relative",flexShrink:0}}>
                        <span style={{position:"absolute",top:2,left:otAiKw?16:2,width:16,height:16,borderRadius:99,background:"#fff",transition:"all .15s"}}/>
                      </span>
                    </button>
                  </div>
                  {otAiKw
                    ? <div style={{padding:"14px",borderRadius:12,background:`${OT}08`,border:`1.5px dashed ${OT}44`}}>
                        <div style={{fontSize:13,color:"var(--text2)",lineHeight:1.6,marginBottom:12}}>키워드 고민 없이! <b style={{color:OT}}>핫이슈 + SEO 최적화</b> 키워드를 정한 개수만큼 <b>아주 다양하게 자동 생성</b>해서 발행해요. <b>한 번 쓴 키워드는 14일간 다시 안 나와요.</b></div>
                        <div style={{fontSize:13,fontWeight:700,marginBottom:6}}>주제 카테고리 <span style={{fontSize:11,fontWeight:600,color:"var(--text3)"}}>· 여러 개 선택 (안 고르면 전체 다양하게)</span></div>
                        <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:14}}>
                          {OT_KW_CATS.map(c=>{const on=otAiCats.includes(c);return(
                            <button key={c} disabled={otRunning} onClick={()=>setOtAiCats(prev=>prev.includes(c)?prev.filter(x=>x!==c):[...prev,c])} style={{padding:"7px 12px",borderRadius:99,border:`1.5px solid ${on?OT:"var(--border)"}`,background:on?`${OT}16`:"var(--bg)",color:on?OT:"var(--text2)",cursor:otRunning?"default":"pointer",fontSize:12.5,fontWeight:700,fontFamily:"inherit"}}>{on?"✓ ":""}{c}</button>
                          );})}
                        </div>
                        <div style={{fontSize:13,fontWeight:700,marginBottom:6}}>생성 개수</div>
                        <div style={{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center",marginBottom:12}}>
                          {[1,3,5,10,15,20,30].map(n=>{const on=otAiKwCount===n;return(
                            <button key={n} disabled={otRunning} onClick={()=>setOtAiKwCount(n)} style={{minWidth:40,padding:"8px 10px",borderRadius:9,border:`2px solid ${on?OT:"var(--border)"}`,background:on?`${OT}16`:"var(--bg)",color:on?OT:"var(--text2)",cursor:otRunning?"default":"pointer",fontSize:13.5,fontWeight:800,fontFamily:"inherit"}}>{n}</button>
                          );})}
                          <span style={{fontSize:12,color:"var(--text3)",fontWeight:600,marginLeft:2}}>또는 직접</span>
                          <input type="number" min={1} max={30} disabled={otRunning} value={otAiKwCount} onChange={e=>setOtAiKwCount(Math.max(1,Math.min(30,parseInt(e.target.value)||5)))} style={{width:74,padding:"8px",borderRadius:8,border:"1px solid var(--border)",background:"var(--bg)",color:"var(--text)",fontFamily:"inherit"}}/>
                          <span style={{fontSize:13,color:"var(--text2)",fontWeight:700}}>개</span>
                        </div>
                        <button onClick={()=>{localStorage.setItem("publy_adm_ot_aikw_count",String(otAiKwCount));localStorage.setItem("publy_adm_ot_aikw","1");localStorage.setItem("publy_adm_ot_aicats",JSON.stringify(otAiCats));showToast(`✅ 저장! 시작하면 AI가 ${otAiKwCount}개 자동 생성해요${otAiCats.length?` (${otAiCats.length}개 주제)`:""}`);}} disabled={otRunning}
                          style={{padding:"9px 18px",borderRadius:9,border:"none",background:`linear-gradient(135deg,${OT},#c026d3)`,color:"#fff",cursor:otRunning?"default":"pointer",fontSize:13,fontWeight:800,fontFamily:"inherit"}}>💾 저장</button>
                        <div style={{fontSize:11.5,color:"var(--text3)",marginTop:10}}>👉 아래 <b style={{color:OT}}>⚡ 원터치 발행 시작</b>을 누르면 그 순간 {otAiKwCount}개{otAiCats.length?` (${otAiCats.join("·")})`:""}를 생성해서 순서대로 올려요.</div>
                      </div>
                    : <>
                        <textarea value={otKeywords} onChange={e=>setOtKeywords(e.target.value)} disabled={otRunning} placeholder={"예)\n원주 맛집\n겨울 제철 음식\n소상공인 정책자금 신청"} rows={6} style={{width:"100%",resize:"vertical",lineHeight:1.6,fontSize:14,padding:"10px 12px",borderRadius:10,border:"1px solid var(--border)",background:"var(--bg)",color:"var(--text)",fontFamily:"inherit"}}/>
                        <div style={{fontSize:12,color:"var(--text2)",marginTop:6}}>지금 <b style={{color:OT}}>{kwList.length}개</b> 키워드</div>
                      </>}
                </div>

                {/* 계정 */}
                <div className="card" style={{marginBottom:14}}>
                  <div style={{fontSize:15,fontWeight:800,marginBottom:4}}>🔗 발행 네이버 계정</div>
                  <div style={{fontSize:12.5,color:"var(--text2)",lineHeight:1.5,marginBottom:10}}>계정은 <b onClick={()=>setTab("accounts")} style={{color:OT,cursor:"pointer",textDecoration:"underline"}}>계정관리</b>에서 한 번만 연결하면 <b>일반 발행이랑 똑같이</b> 여기 자동으로 떠요. 원터치용으로 따로 로그인할 필요 없어요.</div>
                  {naverAccs.length===0
                    ? <div style={{fontSize:13,color:"var(--text2)"}}>연결된 네이버 계정이 없어요. <b onClick={()=>setTab("accounts")} style={{color:OT,cursor:"pointer",textDecoration:"underline"}}>계정관리</b>에서 먼저 연결해주세요.</div>
                    : naverAccs.map(a=>(
                      <label key={a.id} onClick={()=>!otRunning&&setPubAccId(a.id)} style={{display:"flex",alignItems:"center",gap:10,padding:"12px 14px",borderRadius:10,cursor:otRunning?"default":"pointer",marginBottom:6,background:pubAccId===a.id?`${OT}14`:"var(--bg)",border:`2px solid ${pubAccId===a.id?OT:"var(--border)"}`}}>
                        <div style={{width:18,height:18,borderRadius:99,border:`2px solid ${pubAccId===a.id?OT:"var(--border)"}`,display:"flex",alignItems:"center",justifyContent:"center"}}>{pubAccId===a.id&&<div style={{width:9,height:9,borderRadius:99,background:OT}}/>}</div>
                        <div><div style={{fontWeight:700,fontSize:14}}>{a.username}</div>{a.blog_name&&<div style={{fontSize:12,color:"var(--text3)"}}>{a.blog_name}</div>}</div>
                      </label>
                    ))}
                </div>

                {/* 글·이미지 설정 — 2컬럼: 왼쪽 설정 / 오른쪽 Flow 준비 */}
                <div className="card" style={{marginBottom:14}}>
                  <div style={{fontSize:15,fontWeight:800,marginBottom:10}}>✍️ 글·이미지 설정</div>
                  <div style={{display:"flex",gap:18,flexWrap:"wrap",alignItems:"flex-start"}}>
                    <div style={{flex:"1 1 320px",minWidth:0}}>
                      <div style={{fontSize:13,fontWeight:700,marginBottom:6}}>글 패턴</div>
                      <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:6}}>
                        {(()=>{const on=otWriteStyle==="자동";return(
                          <button disabled={otRunning} onClick={()=>{setOtWriteStyle("자동");localStorage.setItem("publy_adm_ot_style","자동");}} style={{padding:"9px 14px",borderRadius:10,border:`2px solid ${on?OT:"var(--border)"}`,background:on?`${OT}16`:"var(--bg)",color:on?OT:"var(--text2)",cursor:otRunning?"default":"pointer",fontSize:13,fontWeight:800,fontFamily:"inherit"}}>✨ 자동(키워드마다 AI가 선택)</button>
                        );})()}
                        {WRITE_STYLES.map(s=>{const on=otWriteStyle===s.id;return(
                          <button key={s.id} disabled={otRunning} onClick={()=>{setOtWriteStyle(s.id);localStorage.setItem("publy_adm_ot_style",s.id);}} style={{padding:"9px 14px",borderRadius:10,border:`2px solid ${on?OT:"var(--border)"}`,background:on?`${OT}16`:"var(--bg)",color:on?OT:"var(--text2)",cursor:otRunning?"default":"pointer",fontSize:13,fontWeight:800,fontFamily:"inherit"}}>{s.i} {s.id}</button>
                        );})}
                      </div>
                      <div style={{fontSize:11,color:"var(--text3)",marginBottom:14,lineHeight:1.5}}>{otWriteStyle==="자동"?"키워드 성격에 맞춰 맛집후기·여행기·감성일기·정보글 중 알아서 골라 써요.":"모든 키워드를 이 패턴으로 통일해서 써요."}</div>
                      <div style={{fontSize:13,fontWeight:700,marginBottom:6}}>글자수</div>
                      <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center",marginBottom:14}}>
                        {(["auto","manual"] as const).map(m=>{const on=otCharMode===m;return(
                          <button key={m} disabled={otRunning} onClick={()=>setOtCharMode(m)} style={{padding:"9px 14px",borderRadius:10,border:`2px solid ${on?OT:"var(--border)"}`,background:on?`${OT}16`:"var(--bg)",color:on?OT:"var(--text2)",cursor:otRunning?"default":"pointer",fontSize:13,fontWeight:800,fontFamily:"inherit"}}>{m==="auto"?"✨ 자동":"✍️ 직접"}</button>
                        );})}
                        {otCharMode==="manual"&&<><input type="number" min={500} max={5000} step={100} disabled={otRunning} value={otTargetChars} onChange={e=>setOtTargetChars(Math.max(500,Math.min(5000,parseInt(e.target.value)||1500)))} style={{width:100,padding:"8px",borderRadius:8,border:"1px solid var(--border)",background:"var(--bg)",color:"var(--text)",fontFamily:"inherit"}}/><span style={{fontSize:13,color:"var(--text2)",fontWeight:700}}>자</span></>}
                      </div>
                      <div style={{fontSize:13,fontWeight:700,marginBottom:6}}>이미지 방식</div>
                      <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                        {([["flow","🆓 Flow (무료)"],["ai","🎨 AI (유료 키)"]] as const).map(([m,l])=>{const on=otImgMode===m;return(
                          <button key={m} disabled={otRunning} onClick={()=>setOtImgMode(m)} style={{padding:"9px 14px",borderRadius:10,border:`2px solid ${on?OT:"var(--border)"}`,background:on?`${OT}16`:"var(--bg)",color:on?OT:"var(--text2)",cursor:otRunning?"default":"pointer",fontSize:13,fontWeight:800,fontFamily:"inherit"}}>{l}</button>
                        );})}
                      </div>
                      <div style={{marginTop:8,fontSize:12,color:"var(--text3)",lineHeight:1.5}}>{otImgMode==="flow"?"무료 Flow는 옆의 'Flow 준비'를 먼저 눌러 연결하세요.":"AI 이미지는 OpenAI/Replicate 키가 있어야 해요."}</div>
                    </div>
                    {otImgMode==="flow"&&(
                      <div style={{flex:"1 1 300px",minWidth:260,maxWidth:440,padding:"14px 16px",borderRadius:12,border:`1.5px solid ${OT}33`,background:`${OT}08`}}>
                        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,marginBottom:8,flexWrap:"wrap"}}>
                          <div style={{fontSize:13,fontWeight:800,color:OT}}>🎬 Flow 계정 <span style={{fontSize:11,fontWeight:600,color:"var(--text3)"}}>· 크레딧 떨어지면 전환</span></div>
                          <div style={{display:"flex",gap:6}}>
                            <button onClick={handleFlowConnectAll} disabled={flowLaunching} style={{fontSize:11,fontWeight:800,padding:"5px 10px",borderRadius:8,border:`1px solid ${OT}55`,background:"var(--bg)",color:OT,cursor:flowLaunching?"wait":"pointer",fontFamily:"inherit"}}>전체 연결</button>
                            <button onClick={()=>{const id=(flowSlots.reduce((m,s)=>Math.max(m,s.id),-1))+1; setFlowSlots(p=>[...p,{id,name:`계정 ${id+1}`}]);}} disabled={flowLaunching} style={{fontSize:11,fontWeight:800,padding:"5px 10px",borderRadius:8,border:`1px solid ${OT}55`,background:"var(--bg)",color:OT,cursor:"pointer",fontFamily:"inherit"}}>➕ 계정 추가</button>
                          </div>
                        </div>
                        <div style={{fontSize:11,color:"var(--text3)",lineHeight:1.5,marginBottom:10}}>계정마다 <b>최초 1회</b> [로그인] → 이후 [전환]으로 바로 사용.</div>
                        <div style={{display:"flex",flexDirection:"column",gap:6}}>
                          {flowSlots.map(s=>{const active=flowSlot===s.id; const ready=!!flowSlotReady[s.id]; return(
                            <div key={s.id} style={{display:"flex",alignItems:"center",gap:8,padding:"9px 11px",borderRadius:10,background:active?`${OT}14`:"var(--bg)",border:`2px solid ${active?OT:"var(--border)"}`}}>
                              <span style={{fontSize:15}}>{ready?"✅":"⚪"}</span>
                              <input value={s.name} onChange={e=>setFlowSlots(p=>p.map(x=>x.id===s.id?{...x,name:e.target.value}:x))} disabled={otRunning} style={{flex:1,minWidth:0,fontSize:12.5,fontWeight:700,padding:"4px 6px",borderRadius:6,border:"1px solid var(--border)",background:"var(--card)",color:"var(--text)",fontFamily:"inherit"}}/>
                              {active
                                ? <span style={{fontSize:10.5,fontWeight:800,color:OT,padding:"3px 7px",borderRadius:99,background:`${OT}18`}}>사용 중</span>
                                : <button onClick={()=>{setFlowSlot(s.id);handleFlowLaunchChrome(s.id);}} disabled={flowLaunching} style={{fontSize:11,fontWeight:800,padding:"5px 9px",borderRadius:7,border:`1px solid ${OT}55`,background:"var(--card)",color:OT,cursor:"pointer",fontFamily:"inherit",whiteSpace:"nowrap"}}>전환</button>}
                              <button onClick={()=>handleFlowLaunchChrome(s.id)} disabled={flowLaunching} style={{fontSize:11,fontWeight:800,padding:"5px 9px",borderRadius:7,border:"none",background:"linear-gradient(135deg,#a855f7,#7c3aed)",color:"#fff",cursor:flowLaunching?"wait":"pointer",fontFamily:"inherit",whiteSpace:"nowrap"}}>{ready?"열기":"로그인"}</button>
                              {flowSlots.length>1&&<button onClick={()=>{setFlowSlots(p=>p.filter(x=>x.id!==s.id)); if(flowSlot===s.id)setFlowSlot(flowSlots.find(x=>x.id!==s.id)?.id||0);}} disabled={otRunning} style={{fontSize:13,padding:"2px 6px",borderRadius:6,border:"none",background:"transparent",color:"var(--text3)",cursor:"pointer"}}>✕</button>}
                            </div>
                          );})}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* 💬 글쓴이 인사말 (발행하기와 동일 저장소 · 썸네일 바로 밑 자동) */}
                <div className="card" style={{marginBottom:14}}>
                  <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                    <label className="inp-label" style={{marginBottom:0}}>💬 글쓴이 인사말 <span style={{fontWeight:400,color:"var(--text3)"}}>(한 번 저장하면 발행하기·원터치 모두 계속 사용)</span></label>
                    {savedGreeting && greeting.trim()===savedGreeting
                      ? <span style={{fontSize:11,fontWeight:800,color:"#2f9e5e",background:"rgba(47,158,94,.12)",borderRadius:99,padding:"2px 9px"}}>✓ 저장됨</span>
                      : savedGreeting ? <span style={{fontSize:11,fontWeight:800,color:"#e0952f",background:"rgba(224,149,47,.12)",borderRadius:99,padding:"2px 9px"}}>● 저장 안 된 변경</span> : null}
                  </div>
                  <div style={{fontSize:11,color:"var(--text3)",lineHeight:1.6,margin:"6px 0"}}>수동이든 예약이든 <b>모든 글의 썸네일 바로 밑</b>에 자동으로 들어가요.</div>
                  <textarea className="inp" rows={2} placeholder="안녕하세요! 오늘도 유용한 정보를 가지고 왔어요 😊" value={greeting} onChange={e=>setGreeting(e.target.value)} disabled={otRunning} style={{resize:"none",fontSize:13}}/>
                  <div style={{display:"flex",gap:6,marginTop:6}}>
                    <button type="button" onClick={saveGreeting} disabled={otRunning||greeting.trim()===savedGreeting} style={{flex:1,padding:"9px",borderRadius:10,border:"none",cursor:greeting.trim()===savedGreeting?"default":"pointer",fontSize:12.5,fontWeight:800,fontFamily:"inherit",background:greeting.trim()===savedGreeting?"var(--card2)":OT,color:greeting.trim()===savedGreeting?"var(--text3)":"#fff",opacity:greeting.trim()===savedGreeting?.7:1}}>💾 인사말 저장하기</button>
                    {savedGreeting && <button type="button" onClick={()=>{setGreeting("");localStorage.removeItem("publy_adm_greeting");setSavedGreeting("");showToast("저장된 인사말을 비웠어요","success");}} disabled={otRunning} style={{padding:"9px 12px",borderRadius:10,border:"1px solid var(--border)",background:"var(--card)",color:"var(--text3)",cursor:"pointer",fontSize:12,fontWeight:700,fontFamily:"inherit"}}>비우기</button>}
                  </div>
                </div>

                {/* 텀 + 이미지 + 카테고리 */}
                <div className="card" style={{marginBottom:14}}>
                  <div style={{fontSize:15,fontWeight:800,marginBottom:10}}>⏱️ 발행 텀 <span style={{fontSize:12,fontWeight:600,color:"var(--text3)"}}>· 글 하나 올리고 다음까지 기다리는 시간</span></div>
                  <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:10}}>
                    {[[10,"10분"],[30,"30분"],[60,"1시간"],[120,"2시간"]].map(([m,l])=>{const on=!otCustomTerm.trim()&&otTermMin===m;return(
                      <button key={m as number} disabled={otRunning} onClick={()=>{setOtTermMin(m as number);setOtCustomTerm("");}} style={{padding:"9px 16px",borderRadius:10,border:`2px solid ${on?OT:"var(--border)"}`,background:on?`${OT}16`:"var(--bg)",color:on?OT:"var(--text2)",cursor:otRunning?"default":"pointer",fontSize:14,fontWeight:800,fontFamily:"inherit"}}>{l}</button>
                    );})}
                    <div style={{display:"flex",alignItems:"center",gap:6,padding:"0 4px"}}>
                      <input type="number" min={1} disabled={otRunning} value={otCustomTerm} onChange={e=>setOtCustomTerm(e.target.value)} placeholder="직접" style={{width:80,padding:"8px",borderRadius:8,border:"1px solid var(--border)",background:"var(--bg)",color:"var(--text)",fontFamily:"inherit"}}/>
                      <span style={{fontSize:13,color:"var(--text2)",fontWeight:700}}>분</span>
                    </div>
                  </div>
                  {termMin<10&&<div style={{fontSize:12,color:"#f59e0b",fontWeight:700,marginBottom:8}}>⚠️ 너무 짧으면 네이버가 스팸으로 볼 수 있어요.</div>}
                  <div style={{fontSize:11.5,color:"var(--text3)",marginBottom:8,lineHeight:1.5}}>🛡️ 계정 보호를 위해 실제 발행 간격은 설정값에서 <b>조금씩 랜덤(±15%)</b>으로 흔들려요.</div>
                  <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
                    <span style={{fontSize:13,fontWeight:700}}>🖼️ 글당 이미지</span>
                    {[1,2,3,4,5].map(n=>(
                      <button key={n} disabled={otRunning} onClick={()=>setOtImgCount(n)} style={{width:38,height:38,borderRadius:10,border:`2px solid ${otImgCount===n?OT:"var(--border)"}`,background:otImgCount===n?`${OT}16`:"var(--bg)",color:otImgCount===n?OT:"var(--text2)",cursor:otRunning?"default":"pointer",fontSize:14,fontWeight:800,fontFamily:"inherit"}}>{n}</button>
                    ))}
                    <span style={{fontSize:12,color:"var(--text3)"}}>장</span>
                  </div>
                  <div style={{marginTop:12,padding:"10px 12px",borderRadius:10,background:`${OT}0d`,border:`1px solid ${OT}22`,fontSize:12.5,color:"var(--text2)",lineHeight:1.5}}>📂 <b style={{color:OT}}>카테고리는 자동</b> — 글 주제에 맞는 네이버 카테고리를 AI가 골라 넣어요.</div>
                </div>

                {otPaused&&!otRunning&&(
                  <div style={{marginBottom:12,padding:"16px",borderRadius:14,border:"2px solid #f59e0b",background:"rgba(245,158,11,.08)"}}>
                    <div style={{fontSize:14.5,fontWeight:800,color:"#f59e0b",marginBottom:6}}>{otPaused.reason==="stopped"?`⏸ 멈췄어요 — 남은 ${otPaused.kws.length-otPaused.idx}개 (${otPaused.idx+1}번째 키워드부터)`:`⏸ Flow 크레딧 부족으로 멈췄어요 (${otPaused.idx+1}번째 키워드에서)`}</div>
                    <div style={{fontSize:12.5,color:"var(--text2)",lineHeight:1.6,marginBottom:10}}>{otPaused.reason==="stopped"?<><b>발행 텀을 바꾸려면</b> 위 <b>텀 설정</b>에서 바꾼 뒤 <b>이어가기</b>를 누르면 <b>남은 키워드부터</b> 새 텀으로 계속돼요.</>:<>다른 Flow 계정으로 <b>전환</b>한 뒤 <b>이어가기</b>를 누르면 <b>멈춘 그 키워드부터</b> 계속돼요.</>}</div>
                    {otPaused.reason!=="stopped"&&<div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:10}}>
                      {flowSlots.map(s=>{const active=flowSlot===s.id;return(
                        <button key={s.id} onClick={()=>{setFlowSlot(s.id);handleFlowLaunchChrome(s.id);}} disabled={flowLaunching} style={{fontSize:12,fontWeight:800,padding:"7px 12px",borderRadius:8,border:`2px solid ${active?"#f59e0b":"var(--border)"}`,background:active?"rgba(245,158,11,.14)":"var(--bg)",color:active?"#f59e0b":"var(--text2)",cursor:"pointer",fontFamily:"inherit"}}>{flowSlotReady[s.id]?"✅ ":""}{s.name}{active?" ·사용중":""}</button>
                      );})}
                    </div>}
                    <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                      <button onClick={()=>runOneTouch(otPaused)} style={{flex:1,minWidth:160,padding:"13px",borderRadius:11,border:"none",background:"linear-gradient(135deg,#f59e0b,#f97316)",color:"#fff",fontSize:15,fontWeight:900,fontFamily:"inherit",cursor:"pointer"}}>▶ 이어가기 ({otPaused.kws.length-otPaused.idx}개 남음)</button>
                      <button onClick={()=>{setOtPaused(null);setOtLiveLog(prev=>[...prev,`[${new Date().toLocaleTimeString("ko-KR")}] 이어가기 안 함 — 새 키워드로 다시 시작할 수 있어요`].slice(-300));}} style={{padding:"13px 18px",borderRadius:11,border:"1px solid var(--border)",background:"var(--bg)",color:"var(--text3)",fontSize:13,fontWeight:700,fontFamily:"inherit",cursor:"pointer"}}>취소 (이어가기 안 함)</button>
                    </div>
                  </div>
                )}
                {/* ⏰ 예약 발행 */}
                <div className="card" style={{marginBottom:12,border:`1.5px solid ${otSchedOn?"#7c3aed":"var(--border)"}`,background:otSchedOn?"rgba(124,58,237,.05)":undefined}}>
                  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,flexWrap:"wrap"}}>
                    <div style={{display:"flex",alignItems:"center",gap:8}}>
                      {otSchedOn&&<span style={{width:9,height:9,borderRadius:"50%",background:"#7c3aed",boxShadow:"0 0 7px #7c3aed",animation:"pulse 1.3s ease-in-out infinite"}}/>}
                      <span style={{fontSize:14,fontWeight:800,color:otSchedOn?"#7c3aed":"var(--text)"}}>⏰ 예약 발행</span>
                    </div>
                    <div style={{display:"flex",alignItems:"center",gap:8}}>
                      <span style={{fontSize:12.5,fontWeight:800,color:otSchedOn?"#7c3aed":"var(--text3)"}}>{otSchedOn?"켜짐":"꺼짐"}</span>
                      <button onClick={()=>{const v=!otSchedOn; if(v&&!(otAiKw||kwList.length>0)){showToast("먼저 키워드를 넣거나 AI 자동추천을 켜주세요","error");return;} if(v&&!pubAccId){showToast("발행할 네이버 계정을 먼저 선택해주세요","error");return;} setOtSchedOn(v); /* armStamp 무효화 방지 */}}
                        title={otSchedOn?"예약 끄기":"예약 켜기"} style={{flexShrink:0,width:52,height:28,borderRadius:16,border:"none",cursor:"pointer",background:otSchedOn?"#7c3aed":"var(--border)",position:"relative",transition:"all .2s"}}>
                        <span style={{position:"absolute",top:3,left:otSchedOn?27:3,width:22,height:22,borderRadius:"50%",background:"#fff",transition:"all .2s",boxShadow:"0 1px 3px rgba(0,0,0,.3)"}}/>
                      </button>
                    </div>
                  </div>
                  <div style={{display:"flex",alignItems:"center",gap:12,flexWrap:"wrap",marginTop:12}}>
                    <div style={{display:"flex",flexDirection:"column",gap:4}}>
                      <span style={{fontSize:11.5,fontWeight:700,color:"var(--text3)"}}>발행 시각</span>
                      <input type="time" value={otSchedTime} disabled={otSchedOn} onChange={e=>{setOtSchedTime(e.target.value);localStorage.setItem("publy_adm_ot_sched_time",e.target.value);}} style={{padding:"12px 14px",borderRadius:10,border:`2px solid ${otSchedOn?"var(--border)":"#7c3aed55"}`,background:"var(--bg)",color:"var(--text)",fontFamily:"inherit",fontSize:20,fontWeight:800,letterSpacing:1,minWidth:150,opacity:otSchedOn?.6:1}}/>
                    </div>
                    <label style={{display:"flex",alignItems:"center",gap:7,cursor:"pointer",fontSize:13,fontWeight:700,color:"var(--text2)",alignSelf:"flex-end",paddingBottom:12}}>
                      <input type="checkbox" checked={otSchedDaily} disabled={otSchedOn} onChange={e=>{setOtSchedDaily(e.target.checked);localStorage.setItem("publy_adm_ot_sched_daily",e.target.checked?"1":"0");}} style={{width:18,height:18,accentColor:"#7c3aed"}}/>
                      매일 이 시각에 반복
                    </label>
                  </div>
                  <div style={{fontSize:11.5,color:"var(--text3)",lineHeight:1.55,marginTop:10}}>
                    {otSchedOn
                      ? <>✅ 예약 <b style={{color:"#7c3aed"}}>켜짐</b> — <b style={{color:"#7c3aed"}}>{otSchedTime}</b>{otSchedDaily?" 마다":"에"} 지금 설정으로 <b>자동 시작</b>해요. <b>노트북만 켜두면</b> 자리에 없어도 돼요 — 그 시각까지 <b>절전으로 안 꺼지게</b> 막아둬요.</>
                      : <>① 위 <b>시각</b>과 <b>반복</b>을 정하고 → ② 오른쪽 위 <b style={{color:"#7c3aed"}}>토글을 켜야</b> 예약이 작동해요. 켜면 그 시각에 원터치가 자동 시작되고, 노트북이 안 꺼지게 막아요.</>}
                  </div>
                </div>
                {!otRunning
                  ? (()=>{const ready=(otAiKw?otAiKwCount>0:kwList.length>0)&&!!pubAccId&&botOnline; return (
                    <button onClick={()=>runOneTouch()} disabled={!ready} style={{width:"100%",padding:"16px",borderRadius:14,border:"none",background:ready?`linear-gradient(135deg,${OT},#c026d3)`:"var(--border)",color:"#fff",fontSize:17,fontWeight:900,fontFamily:"inherit",cursor:ready?"pointer":"default",boxShadow:ready?`0 6px 20px ${OT}44`:"none"}}>⚡ 원터치 발행 시작 {otAiKw?`(AI ${otAiKwCount}개 자동생성)`:(kwList.length>0?`(${kwList.length}개)`:"")}</button>
                  );})()
                  : <button onClick={stopOneTouch} style={{width:"100%",padding:"16px",borderRadius:14,border:"none",background:"linear-gradient(135deg,#ef4444,#f43f5e)",color:"#fff",fontSize:17,fontWeight:900,fontFamily:"inherit",cursor:"pointer"}}>⏹ 전체 중단 {otNextAt&&`· 다음 발행까지 ${Math.max(0,Math.ceil((otNextAt-Date.now())/60000))}분`}</button>}

                {/* 로그 — 항상 표시 + 저장 */}
                <div className="card" style={{marginTop:14}}>
                  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,marginBottom:10}}>
                    <div style={{fontSize:15,fontWeight:800}}>📋 진행 상황 · 로그 {otRunning&&<span style={{fontSize:11,fontWeight:800,color:"#fff",background:OT,padding:"2px 9px",borderRadius:99,marginLeft:6}}>작업 중</span>}</div>
                    {otLog.length>0&&!otRunning&&<button onClick={()=>{setOtLog([]);try{localStorage.removeItem("publy_adm_ot_log");}catch{}}} style={{fontSize:11,padding:"5px 10px",borderRadius:8,border:"1px solid var(--border)",background:"var(--card2)",color:"var(--text3)",cursor:"pointer",fontWeight:700,fontFamily:"inherit"}}>🗑 기록 지우기</button>}
                  </div>
                  {otLog.length===0
                    ? <div style={{fontSize:12.5,color:"var(--text3)",padding:"14px 0",textAlign:"center"}}>아직 작업 기록이 없어요. 키워드를 넣고 <b style={{color:OT}}>원터치 발행 시작</b>을 누르면 여기에 단계별 진행이 쌓여요.</div>
                    : otLog.map((r,i)=>(
                      <div key={r.id} style={{display:"flex",alignItems:"center",gap:10,padding:"11px 12px",borderRadius:10,marginBottom:6,background:"var(--bg)",border:`1px solid ${r.status==="done"?"#00b48733":r.status==="fail"?"#e5397f33":r.status==="limit"?"#f59e0b33":"var(--border)"}`}}>
                        <div style={{width:24,height:24,borderRadius:99,flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:800,background:`${stepColor(r.status)}1a`,color:stepColor(r.status)}}>{i+1}</div>
                        <div style={{flex:1,minWidth:0}}>
                          <div style={{fontSize:13.5,fontWeight:700,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{r.title||r.kw}</div>
                          <div style={{fontSize:12,color:stepColor(r.status),fontWeight:600,marginTop:1}}>{r.step}{r.cat&&r.status!=="fail"&&<span style={{color:"var(--text3)"}}> · 📂 {r.cat}</span>}{r.at&&<span style={{color:"var(--text3)"}}> · {r.at}</span>}</div>
                        </div>
                        {r.postUrl&&<a href={r.postUrl} target="_blank" rel="noreferrer" style={{flexShrink:0,fontSize:12,fontWeight:800,color:OT,textDecoration:"none",padding:"5px 10px",borderRadius:8,border:`1px solid ${OT}44`}}>🔗 보기</a>}
                      </div>
                    ))}
                  </div>
                <div style={{height:otDockOpen?"46vh":"70px"}}/>
              </div>
              );
            })()}

            {/* ⚡ 관리자 원터치 로그 — 화면 하단 넓게 고정 */}
            {tab === "onetouch" && (
              <div className="ot-logdock">
                <div className="ot-logdock-head">
                  <span style={{fontSize:14.5,fontWeight:900,color:"#7c3aed"}}>📋 원터치 로그</span>
                  {otRunning
                    ? <span style={{fontSize:11,fontWeight:800,color:"#fff",background:"#7c3aed",padding:"3px 10px",borderRadius:99}}>작업 중{otNextAt?` · 다음 ${Math.max(0,Math.ceil((otNextAt-Date.now())/60000))}분`:""}</span>
                    : <span style={{fontSize:11,fontWeight:700,color:"var(--text3)"}}>{otLiveLog.length>0?"대기 중 (지난 기록)":"대기 중"}</span>}
                  <span style={{marginLeft:"auto",display:"flex",gap:6,flexWrap:"wrap"}}>
                    <button className="ot-logdock-btn" onClick={()=>{const t=otLiveLog.join("\n"); if(!t){showToast("복사할 로그가 없어요","info");return;} navigator.clipboard.writeText(t).then(()=>showToast("📋 로그 전체를 복사했어요")).catch(()=>showToast("복사 실패","error"));}}>📋 전체 복사</button>
                    {otRunning&&<button className="ot-logdock-btn" style={{borderColor:"#ef4444",color:"#ef4444",fontWeight:900}} onClick={stopOneTouch}>⏹ 중단</button>}
                    {!otRunning&&otLiveLog.length>0&&<button className="ot-logdock-btn" onClick={()=>{setOtLiveLog([]);try{localStorage.removeItem("publy_adm_ot_livelog");}catch{}}}>🗑 지우기</button>}
                    <button className="ot-logdock-btn" onClick={()=>setOtDockOpen(v=>!v)}>{otDockOpen?"▽ 접기":"△ 펼치기"}</button>
                  </span>
                </div>
                {otDockOpen&&<div className="ot-logdock-body" style={{height:"40vh"}} ref={el=>{if(el&&otRunning)el.scrollTop=el.scrollHeight;}}>
                  {otLiveLog.length===0
                    ? <span style={{color:"var(--text3)"}}>아직 작업 기록이 없어요.{"\n"}키워드를 넣고 "⚡ 원터치 발행 시작"을 누르면 여기에 제목→본문→이미지→발행까지 모든 진행이 실시간으로 쌓여요.</span>
                    : otLiveLog.join("\n")}
                </div>}
              </div>
            )}

            {tab === "accounts" && (
              <div style={{animation:"fadeUp .25s ease both"}}>
                {!botOnline&&<div className="alert alert-warn">⚠️ PC에서 Publy 앱을 실행해야 계정 연결이 가능합니다</div>}
                <div className="card">
                  <div className="card-title">➕ 계정 추가</div>
                  <div style={{display:"grid",gridTemplateColumns:"100px 1fr 1fr",gap:10,marginBottom:12}}>
                    <div><label className="inp-label">플랫폼</label><select className="inp" value={newPlat} onChange={e=>setNewPlat(e.target.value as any)}><option value="naver">네이버</option><option value="tistory">티스토리</option></select></div>
                    <div><label className="inp-label">아이디</label><input className="inp" placeholder="블로그 아이디" value={newUser} onChange={e=>setNewUser(e.target.value)}/></div>
                    <div><label className="inp-label">비밀번호</label><div style={{position:"relative"}}><input className="inp" type={showPw?"text":"password"} placeholder="비밀번호" value={newPw} onChange={e=>setNewPw(e.target.value)} style={{paddingRight:40}}/><button type="button" onClick={()=>setShowPw(v=>!v)} style={{position:"absolute",right:10,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",cursor:"pointer",fontSize:18,color:"var(--text3)"}}>{showPw?"🙈":"👁️"}</button></div></div>
                  </div>
                  <div style={{marginBottom:14}}><label className="inp-label">블로그명 <span style={{color:"var(--text3)",fontWeight:400}}>(티스토리만)</span></label><input className="inp" placeholder="예: myblog" value={newBlog} onChange={e=>setNewBlog(e.target.value)}/></div>
                  <button className="btn btn-primary" onClick={handleAddAcc} disabled={addingAcc||!newUser||!newPw}>{addingAcc?<><span className="spinner"/>추가 중...</>:<>➕ 계정 추가</>}</button>
                </div>
                {admAccs.filter(a=>a.platform!=="google").map((a,i)=>(
                  <div key={a.id} style={{animationDelay:`${i*.06}s`}}>
                    <div className={`acc-card ${a.is_connected?(a.platform==="naver"?"connected-naver":"connected-tistory"):""}`}>
                      <span style={{fontSize:28}}>{a.platform==="naver"?"🟢":"🟠"}</span>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontSize:15,fontWeight:700,color:"var(--text)"}}>{a.username}</div>
                        <div style={{fontSize:11,color:"var(--text2)"}}>{a.platform}{a.blog_name&&` · ${a.blog_name}`}</div>
                      </div>
                      <span style={{fontSize:11,fontWeight:700,padding:"4px 10px",borderRadius:99,background:a.is_connected?"var(--accent-bg)":"var(--card-hover)",color:a.is_connected?"var(--accent-text)":"var(--text2)",border:"1px solid"}}>
                        {a.is_connected?"✅ 연결됨":"미연결"}
                      </span>
                      <button className="btn btn-secondary btn-sm" onClick={()=>handleConnect(a)} disabled={!!connId||!botOnline}>
                        {connId===a.id?<><span className="spinner spinner-white"/>연결 중...</>:a.is_connected?"재연결":"연결"}
                      </button>
                      <button className="btn btn-sm" style={{background:"rgba(248,81,73,.1)",color:"var(--danger)",border:"1px solid rgba(248,81,73,.3)"}}
                        onClick={async()=>{if(!confirm("삭제할까요?"))return;await botFetch(`${BOT}/api/session/${a.platform}/${ADM_UID}`,{method:"DELETE"}).catch(()=>{});await supabase.from("publy_accounts").delete().eq("id",a.id);getAccounts(ADM_UID).then(setAdmAccs);}}>
                        🗑
                      </button>
                      <button onClick={()=>setEditingCatAccId(editingCatAccId===a.id?null:a.id)} style={{padding:"5px 11px",borderRadius:8,border:"1px solid var(--border)",background:"var(--bg2)",color:"var(--text2)",cursor:"pointer",fontSize:12,fontWeight:700,fontFamily:"inherit",flexShrink:0}}>
                        📂 카테고리 {(accCats[a.id]||[]).length>0?`(${(accCats[a.id]||[]).length})`:""}
                      </button>
                    </div>

                    {editingCatAccId===a.id&&(
                      <div style={{margin:"-8px 0 8px",padding:"14px 16px",borderRadius:"0 0 14px 14px",background:"var(--bg2)",border:"1px solid var(--border)",borderTop:"none"}}>
                        <div style={{fontSize:12,fontWeight:700,color:"var(--text3)",marginBottom:10}}>📂 {a.username} 카테고리</div>
                        <div style={{display:"flex",flexWrap:"wrap",gap:7,marginBottom:10}}>
                          {(accCats[a.id]||[]).length===0?(
                            <span style={{fontSize:12,color:"var(--text3)"}}>등록된 카테고리 없음</span>
                          ):(accCats[a.id]||[]).map((cat,ci)=>(
                            <div key={ci} style={{display:"flex",alignItems:"center",gap:5,padding:"5px 12px",borderRadius:99,background:"var(--accent-bg)",border:"1px solid var(--accent-border)",fontSize:13,fontWeight:600,color:"var(--accent-text)"}}>
                              {cat}<button onClick={()=>removeCatFromAcc(a.id,cat)} style={{background:"transparent",border:"none",cursor:"pointer",color:"var(--accent-text)",fontSize:14,lineHeight:1,padding:0}}>✕</button>
                            </div>
                          ))}
                        </div>
                        <div style={{display:"flex",gap:8}}>
                          <input className="inp" placeholder="카테고리명 입력" value={catInput} onChange={e=>setCatInput(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")addCatToAcc(a.id);}} style={{flex:1,fontSize:13}}/>
                          <button onClick={()=>addCatToAcc(a.id)} className="btn btn-primary" style={{padding:"0 16px",flexShrink:0}}>추가</button>
                        </div>
                        {botOnline&&<button onClick={async()=>{await loadCategories(a.platform);setEditingCatAccId(a.id);}} style={{marginTop:8,width:"100%",padding:"8px",borderRadius:9,border:"1px solid var(--border)",background:"var(--bg)",color:"var(--text2)",cursor:"pointer",fontSize:12,fontWeight:700,fontFamily:"inherit"}}>🔄 봇에서 자동 불러오기</button>}
                      </div>
                    )}
                  </div>
                ))}

                {/* ===== 🎨 Google Flow 계정 연결 ===== */}
                <GoogleFlowCard botOnline={botOnline} botUrl={BOT} userId={ADM_UID} />
              </div>
            )}

            {/* ───── 📊 블로그 순위 ───── */}
            {tab === "rank" && (
              <div style={{animation:"fadeUp .25s ease both",height:"calc(100vh - 60px - 40px)",display:"flex",flexDirection:"column"}}>
                <div style={{padding:"14px 16px 10px",display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0}}>
                  <div>
                    <div style={{fontSize:16,fontWeight:900,color:"var(--text)"}}>📊 블로그 순위 확인</div>
                    <div style={{fontSize:12,color:"var(--text3)",marginTop:2}}>내 네이버 블로그 키워드 순위를 확인해요</div>
                  </div>
                  <button onClick={()=>setShowRankInfo(true)}
                    style={{padding:"7px 14px",borderRadius:8,border:"none",background:"linear-gradient(135deg,#ff6b9d,#ff4081)",color:"#fff",cursor:"pointer",fontSize:12,fontWeight:800,fontFamily:"inherit",whiteSpace:"nowrap",boxShadow:"0 3px 10px rgba(255,64,129,.35)",flexShrink:0}}>
                    💡 키 입력 안내
                  </button>
                </div>
                <div style={{flex:1,overflow:"hidden",border:"1px solid var(--border)",borderLeft:"none",borderRight:"none",borderBottom:"none"}}>
                  <iframe src="https://rank.xn--zk5biyyw.com/" style={{width:"100%",height:"100%",border:"none",display:"block"}} title="블로그 순위 확인" allow="clipboard-read; clipboard-write"/>
                </div>
              </div>
            )}

            {/* ───── 👥 회원 관리 ───── */}
            {tab === "users" && (
              <div style={{animation:"fadeUp .25s ease both"}}>

                {/* 전체 오류확인 */}
                <div style={{display:"flex",justifyContent:"flex-end",marginBottom:12}}>
                  <button onClick={()=>{setShowAllErrors(true);loadErrorLogs();}} style={{padding:"8px 16px",borderRadius:20,background:unreadErrors>0?"#dc2626":theme==="dark"?"#263241":"#ffffff",color:unreadErrors>0?"#fff":theme==="dark"?"#f8fafc":"#172033",border:`2px solid ${unreadErrors>0?"#f87171":theme==="dark"?"#94a3b8":"#64748b"}`,boxShadow:theme==="dark"?"0 0 0 1px rgba(255,255,255,.08),0 3px 12px rgba(0,0,0,.35)":"0 2px 8px rgba(15,23,42,.12)",cursor:"pointer",fontSize:12,fontWeight:800,fontFamily:"inherit",display:"flex",alignItems:"center",gap:6}}>
                    🚨 전체 오류확인 {unreadErrors>0?`(새 오류 ${unreadErrors}건)`:""}
                  </button>
                </div>

                {/* 서브탭 */}
                <div style={{display:"flex",gap:6,marginBottom:14,background:"var(--card)",border:"1px solid var(--border)",borderRadius:12,padding:4}}>
                  {([{k:"list",l:"👥 회원 목록"},{k:"referral",l:"🔗 래퍼럴 현황"}] as const).map(t=>(
                    <button key={t.k} onClick={()=>{
                      setUsersSubTab(t.k);
                      if(t.k==="referral"&&referralData.length===0){
                        setReferralLoading(true);
                        getReferrals().then(d=>{setReferralData(d);setReferralLoading(false);}).catch(()=>setReferralLoading(false));
                      }
                    }}
                      style={{flex:1,padding:"9px",borderRadius:9,border:"none",cursor:"pointer",fontSize:13,fontWeight:700,fontFamily:"inherit",
                        background:usersSubTab===t.k?"var(--accent-bg)":"transparent",
                        color:usersSubTab===t.k?"var(--accent-text)":"var(--text2)",
                        borderBottom:usersSubTab===t.k?"2px solid var(--accent)":"2px solid transparent",
                        transition:"all .15s"}}>
                      {t.l}
                    </button>
                  ))}
                </div>

                {/* 회원 목록 */}
                {usersSubTab==="list"&&<>
                <div className="card" style={{padding:"14px 16px",marginBottom:14,display:"flex",gap:10,alignItems:"center"}}>
                  <input className="inp" style={{flex:1}} placeholder="🔍 이름, 이메일, 연락처 검색..." value={search} onChange={e=>setSearch(e.target.value)}/>
                  <button onClick={exportToExcel} disabled={users.length===0}
                    style={{flexShrink:0,padding:"10px 16px",borderRadius:10,border:"1px solid rgba(0,200,100,.4)",background:"rgba(0,200,100,.08)",color:"#00c864",cursor:"pointer",fontSize:12,fontWeight:800,fontFamily:"inherit",whiteSpace:"nowrap",display:"flex",alignItems:"center",gap:6}}>
                    📥 엑셀 저장 ({users.length}명)
                  </button>
                </div>
                {loading ? (
                  <div style={{textAlign:"center",padding:40,color:"var(--text2)"}}>
                    <span className="spinner spinner-white" style={{width:24,height:24,borderTopColor:"var(--text2)"}}/>
                    <div style={{marginTop:12}}>회원 정보 불러오는 중...</div>
                  </div>
                ) : filteredUsers.length === 0 ? (
                  <div className="empty"><div className="empty-ico">👥</div><div className="empty-title">회원이 없어요</div></div>
                ) : (
                  <div className="user-table">
                    {filteredUsers.map((u,i) => (
                      <div key={u.id}>
                        <div className={`user-row ${selUser?.id===u.id?"selected-row":""}`} onClick={()=>setSelUser(selUser?.id===u.id?null:u)} style={{animationDelay:`${i*.03}s`}}>
                          <div className="user-avatar">{(u.name||u.email)[0].toUpperCase()}</div>
                          <div className="user-info">
                            <div className="user-name-row">
                              {u.name||"이름없음"}
                              <span className={`plan-chip plan-${u.plan}`}>{PLAN_LABELS[u.plan]||u.plan}</span>
                              {!u.is_active&&<span className="inactive-chip">비활성</span>}
                            </div>
                            <div className="user-email-row">{u.email}</div>
                          </div>
                          <div style={{textAlign:"right",flexShrink:0}}>
                            {/* 오늘 발행 수 / 하루 한도 — 회원 대시보드와 동일한 일일 기준(자정 지나면 0, 건수 초기화 눌러도 0). liveUsage=오늘 실시간 사용량 */}
                            {(()=>{ const du = liveUsage.find(x=>x.userId===u.id)?.publish ?? 0; const lim = PLAN_QUOTA[u.plan] ?? 2; const unlimited = lim >= 9999; return (
                              <div className="quota-mini" title="오늘 발행한 글 수 / 하루 한도. 자정이 지나면 0으로 초기화되고, 아래 '건수 초기화'를 눌러도 0이 돼요.">{unlimited ? <>{du} <span style={{color:"var(--text3)",fontWeight:500}}>· 무제한</span></> : <>{du}/{lim}</>}</div>
                            ); })()}
                            <div style={{fontSize:10,color:"var(--text3)",marginTop:2}}>누적 발행 {u.history_count??0}건</div>
                            <div style={{fontSize:10,color: u.last_seen && (Date.now()-new Date(u.last_seen).getTime())<300000 ? "var(--success)" : "var(--text3)",marginTop:2,fontWeight:600}}>🕒 {timeAgo(u.last_seen)}</div>
                          </div>
                          <span style={{fontSize:16,color:"var(--text3)"}}>{selUser?.id===u.id?"▲":"▼"}</span>
                        </div>

                        {selUser?.id === u.id && (
                          <div className="detail-panel" style={{borderRadius:0,borderTop:"none",margin:0}}>
                            <div className="detail-header">
                              <div className="user-avatar" style={{width:44,height:44,fontSize:18}}>{(u.name||u.email)[0].toUpperCase()}</div>
                              <div>
                                <div style={{fontSize:16,fontWeight:800}}>{u.name||"이름없음"}</div>
                                <div style={{fontSize:12,color:"var(--text2)",fontFamily:"monospace"}}>{u.email}</div>
                              </div>
                              <div style={{marginLeft:"auto",display:"flex",gap:8,flexWrap:"wrap"}}>
                                <button className="btn btn-secondary btn-sm" onClick={()=>toggleCrawl(u)}>🔍 크롤링 {u.crawl_enabled!==false?"허용됨":"잠김"}</button>
                                <button className="btn btn-secondary btn-sm" onClick={()=>toggleInflow(u)} style={{borderColor:u.inflow_enabled===true?"#2563eb":undefined,color:u.inflow_enabled===true?"#2563eb":undefined}}>🆕 트래픽 유입 {u.inflow_enabled===true?"허용됨":"잠김"}</button>
                                <button className="btn btn-secondary btn-sm" onClick={()=>toggleInflowReview(u)} style={{borderColor:u.inflow_review_enabled===true?"#dc2626":undefined,color:u.inflow_review_enabled===true?"#dc2626":undefined}}>✍️ 리뷰작성 {u.inflow_review_enabled===true?"허용됨":"잠김"}</button>
                                <button className="btn btn-secondary btn-sm" onClick={()=>togglePlace360(u)}>🏪 플레이스 365 {u.place360_enabled!==false?"허용됨":"잠김"}</button>
                                <button className="btn btn-secondary btn-sm" onClick={()=>toggleActive(u)}>{u.is_active?"비활성화":"활성화"}</button>
                                <button className="btn btn-secondary btn-sm" onClick={()=>resetQuota(u.id)}>건수 초기화</button>
                                <button onClick={()=>{setErrorFilter(u.id);loadErrorLogs(u.id);setShowAllErrors(true);}} style={{padding:"4px 10px",borderRadius:6,background:"var(--danger)",color:"#fff",border:"none",cursor:"pointer",fontSize:11,fontWeight:700,fontFamily:"inherit"}}>🚨 오류확인</button>
                                <button className="btn btn-primary btn-sm" onClick={()=>saveUser(u)} disabled={saving===u.id}>{saving===u.id?<><span className="spinner"/>저장 중...</>:"💾 저장"}</button>
                              </div>
                            </div>

                            <div className="detail-grid">
                              <div className="detail-field"><span className="field-label">플랜</span>
                                <select className="field-inp" value={editMap[u.id]?.plan??u.plan} onChange={e=>setEditMap(p=>({...p,[u.id]:{...p[u.id],plan:e.target.value}}))}>
                                  <option value="free">FREE — 하루 2건 · 계정 1개 · 7일</option>
                                  <option value="basic">BASIC — 하루 6건 · 계정 2개 · 30일</option>
                                  <option value="pro">PRO — 하루 15건 · 계정 3개 · 30일</option>
                                  <option value="unlimited">무제한 — 모든 기능 한도 없음</option>
                                </select>
                              </div>
                              <div className="detail-field"><span className="field-label">네이버 키워드 분석</span>
                                <div style={{display:"flex",alignItems:"center",gap:8}}>
                                  <span style={{fontSize:12,color:"var(--text2)"}}>
                                    {`한도: ${NAVER_DAILY_LIMIT[editMap[u.id]?.plan??u.plan]??5}회/일`}
                                  </span>
                                  <span style={{fontSize:11,color:"var(--text3)"}}>(개인키 있으면 무제한)</span>
                                </div>
                              </div>
                              {/* ★이 등급의 모든 기능 한도 한눈에 (새 기능 추가 시 여기에 다 나와야 함) */}
                              {(()=>{ const pl=editMap[u.id]?.plan??u.plan; const unlim=pl==="unlimited"||pl==="admin"; const fmt=(n:number)=>unlim?"무제한":String(n);
                                const rows=[
                                  {label:"✍️ 하루 발행",val:`${fmt(PLAN_CONFIG[pl]?.dailyPublish??2)}건`},
                                  {label:"🤝 서이추",val:`${fmt(NEIGHBOR_DAILY_LIMIT[pl]??10)}건/일`},
                                  {label:"❤️ 공감·댓글",val:`${fmt(ENGAGE_DAILY_LIMIT[pl]??10)}건/일`},
                                  {label:"💬 답방",val:`${fmt(REPLY_DAILY_LIMIT[pl]??10)}건/일`},
                                  {label:"📈 블로그 지수 진단",val:`${fmt(BLOGSCORE_DAILY_LIMIT[pl]??1)}회/일`},
                                  {label:"✨ 이 글 살리기",val:`${fmt(REVIVE_DAILY_LIMIT[pl]??1)}회/일`},
                                  {label:"🆕 트래픽 유입",val:`${fmt(INFLOW_DAILY_LIMIT[pl]??30)}회/일`},
                                  {label:"🔍 크롤링 발굴",val:`${fmt(CRAWL_DAILY_LIMIT[pl]??5)}명/일`},
                                  {label:"✉️ 크롤링 이메일",val:`${fmt(EMAIL_DAILY_LIMIT[pl]??5)}통/일`},
                                  {label:"💬 크롤링 댓글",val:`${fmt(COMMENT_DAILY_LIMIT[pl]??3)}개/일`},
                                  {label:"🗺️ 플레이스 역추적",val:`${(PLACE_BLOGGER_LIMIT[pl]??0)>=9999?"무제한":`${PLACE_BLOGGER_LIMIT[pl]??10}명`}/업체`},
                                  {label:"🏪 360 등록 매장",val:`${fmt(PLACE360_STORE_LIMIT[pl]??1)}개`},
                                  {label:"🩺 360 매장 진단",val:`${fmt(PLACE360_DAILY_DIAGNOSIS_LIMIT[pl]??1)}회/일`},
                                  {label:"📍 360 순위 측정",val:`${fmt(PLACE360_RANK_DAILY_LIMIT[pl]??3)}회/일`},
                                  {label:"👀 360 고객 화면 확인",val:`${fmt(PLACE_DETAIL_DAILY_LIMIT[pl]??2)}회/일`},
                                  {label:"🗣️ 플레이스 리뷰답글",val:`${fmt(PLACE_REPLY_DAILY_LIMIT[pl]??5)}건/일`},
                                  {label:"📈 360 기록 보관",val:`${fmt(PLACE360_HISTORY_DAYS[pl]??30)}일`},
                                  {label:"💞 품앗이 계정",val:`${fmt(PUMASI_ACCOUNT_LIMIT[pl]??2)}개`},
                                  {label:"💞 품앗이 계정당 글",val:`${fmt(PUMASI_POSTS_LIMIT[pl]??3)}개`},
                                ];
                                return (
                                <div className="detail-field" style={{gridColumn:"1 / -1"}}>
                                  <span className="field-label">📊 이 등급의 기능별 한도</span>
                                  <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(150px,1fr))",gap:6,marginTop:4,padding:"10px 12px",borderRadius:10,background:"var(--bg)",border:"1px solid var(--border)"}}>
                                    {rows.map(r=>(
                                      <div key={r.label} style={{display:"flex",justifyContent:"space-between",gap:6,fontSize:11.5}}>
                                        <span style={{color:"var(--text2)"}}>{r.label}</span>
                                        <b style={{color:unlim?"#8b5cf6":"var(--accent-text)",whiteSpace:"nowrap"}}>{r.val}</b>
                                      </div>
                                    ))}
                                  </div>
                                  <div style={{fontSize:10.5,color:"var(--text3)",marginTop:5}}>플랜을 바꾸면 위 한도가 자동으로 적용돼요. (자정 초기화)</div>
                                </div>
                                );
                              })()}
                              <div className="detail-field"><span className="field-label">총 발행 건수</span>
                                <input className="field-inp" type="number" value={editMap[u.id]?.quota??u.quota?.total_quota??10} onChange={e=>setEditMap(p=>({...p,[u.id]:{...p[u.id],quota:e.target.value}}))}/>
                              </div>
                              <div className="detail-field"><span className="field-label">현재 만료일</span>
                                <input className="field-inp" readOnly tabIndex={-1}
                                  value={u.quota?.reset_date ? `${new Date(u.quota.reset_date).toLocaleDateString("ko-KR")} (${(()=>{const e=new Date(u.quota!.reset_date);e.setHours(0,0,0,0);const t=new Date();t.setHours(0,0,0,0);const dl=Math.round((e.getTime()-t.getTime())/86400000);return dl<0?"만료됨":dl===0?"오늘 만료":"D-"+dl;})()})` : "기간 없음"}
                                  style={{color:"var(--text3)",cursor:"default"}}/>
                              </div>
                              <div className="detail-field"><span className="field-label">만료일 연장 (일)</span>
                                <input className="field-inp" type="number" placeholder="예: 30" value={editMap[u.id]?.days??""} onChange={e=>setEditMap(p=>({...p,[u.id]:{...p[u.id],days:e.target.value}}))}/>
                                {editMap[u.id]?.days && u.quota?.reset_date && (
                                  <div style={{fontSize:11,color:"#8B5CF6",fontWeight:700,marginTop:5}}>
                                    → {(()=>{const d=new Date(u.quota!.reset_date);d.setDate(d.getDate()+Number(editMap[u.id].days||0));return d.toLocaleDateString("ko-KR");})()} 까지 사용 가능
                                  </div>
                                )}
                              </div>
                              <div className="detail-field"><span className="field-label">연락처</span>
                                <input className="field-inp" value={editMap[u.id]?.phone??u.phone??""} onChange={e=>setEditMap(p=>({...p,[u.id]:{...p[u.id],phone:e.target.value}}))} placeholder="010-0000-0000"/>
                              </div>
                            </div>
                            <div className="detail-field" style={{marginBottom:14}}>
                              <span className="field-label">메모</span>
                              <textarea className="field-inp" rows={2} style={{resize:"none"}} value={editMap[u.id]?.memo??u.memo??""} onChange={e=>setEditMap(p=>({...p,[u.id]:{...p[u.id],memo:e.target.value}}))} placeholder="관리자 메모..."/>
                            </div>

                            {/* 결제 내역 */}
                            <div style={{marginBottom:14}}>
                              <div className="card-title" style={{marginBottom:10}}>💳 결제 등록</div>
                              <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:8}}>
                                <input className="field-inp" style={{flex:1,minWidth:100}} type="number" placeholder="금액" value={newPayAmt} onChange={e=>setNewPayAmt(e.target.value)}/>
                                <input className="field-inp" style={{flex:2,minWidth:140}} placeholder="메모 (선택)" value={newPayNote} onChange={e=>setNewPayNote(e.target.value)}/>
                              </div>
                              <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                                {(["basic","pro"] as const).map(plan=>(
                                  <button key={plan} className="btn btn-secondary btn-sm" onClick={()=>addPayment(u.id,plan)} disabled={addingPay}>
                                    {addingPay?<><span className="spinner spinner-white"/>처리 중...</>:<>{PLAN_LABELS[plan]} 등록</>}
                                  </button>
                                ))}
                              </div>
                              {(u.payments||[]).length>0&&(
                                <div style={{marginTop:10,border:"1px solid var(--border)",borderRadius:8,overflow:"hidden"}}>
                                  {(u.payments||[]).slice(0,5).map((p:any,i:number)=>(
                                    <div key={i} style={{display:"flex",alignItems:"center",gap:8,padding:"10px 12px",borderBottom:i<Math.min((u.payments||[]).length,5)-1?"1px solid var(--border)":"none",fontSize:12}}>
                                      <span style={{color:"var(--success)",fontWeight:700}}>{p.amount?.toLocaleString()}원</span>
                                      <span className={`plan-chip plan-${p.plan}`}>{PLAN_LABELS[p.plan]||p.plan}</span>
                                      <span style={{color:"var(--text2)",marginLeft:"auto",fontFamily:"monospace"}}>{new Date(p.created_at).toLocaleDateString("ko-KR")}</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>

                            {/* 메모 */}
                            <div>
                              <div className="card-title" style={{marginBottom:10}}>📝 메모</div>
                              <div style={{display:"flex",gap:8,marginBottom:10}}>
                                <input className="field-inp" style={{flex:1}} placeholder="메모 추가..." value={newNote} onChange={e=>setNewNote(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addNote(u.id)}/>
                                <button className="btn btn-primary btn-sm" onClick={()=>addNote(u.id)}>추가</button>
                              </div>
                              {(u.notes||[]).slice(0,5).map((n:any,i:number)=>(
                                <div key={i} style={{padding:"9px 12px",borderRadius:8,background:"var(--bg)",border:"1px solid var(--border)",marginBottom:6,fontSize:13,color:"var(--text)"}}>
                                  <div style={{marginBottom:3}}>{n.content}</div>
                                  <div style={{fontSize:10,color:"var(--text3)",fontFamily:"monospace"}}>{new Date(n.created_at).toLocaleString("ko-KR")}</div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                </>}

                {/* 래퍼럴 현황 */}
                {usersSubTab==="referral"&&(
                  <div>
                    {referralLoading?(
                      <div style={{textAlign:"center",padding:40,color:"var(--text2)"}}>
                        <span className="spinner" style={{width:24,height:24,borderTopColor:"var(--accent)"}}/>
                        <div style={{marginTop:12}}>래퍼럴 데이터 불러오는 중...</div>
                      </div>
                    ):referralData.length===0?(
                      <div style={{textAlign:"center",padding:"40px 20px",color:"var(--text3)"}}>
                        <div style={{fontSize:36,marginBottom:12}}>🔗</div>
                        <div style={{fontSize:15,fontWeight:700,color:"var(--text2)",marginBottom:6}}>아직 래퍼럴 데이터가 없어요</div>
                        <div style={{fontSize:12}}>초대 링크로 가입한 회원이 생기면 여기에 표시돼요</div>
                      </div>
                    ):(
                      <>
                        {/* 요약 */}
                        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(130px,1fr))",gap:10,marginBottom:14}}>
                          {[
                            {label:"래퍼럴 발생 수",value:`${referralData.length}명`,color:"var(--accent-text)"},
                            {label:"총 초대된 회원",value:`${referralData.reduce((s,r)=>s+r.referred.length,0)}명`,color:"var(--success)"},
                          ].map((s,i)=>(
                            <div key={i} style={{padding:"12px 16px",borderRadius:12,background:"var(--card)",border:"1px solid var(--border)",textAlign:"center"}}>
                              <div style={{fontSize:22,fontWeight:900,color:s.color,fontFamily:"'Space Grotesk',sans-serif"}}>{s.value}</div>
                              <div style={{fontSize:11,color:"var(--text3)",marginTop:4,fontWeight:600}}>{s.label}</div>
                            </div>
                          ))}
                        </div>

                        {/* 래퍼럴 트리 */}
                        {[...referralData].sort((a,b)=>b.referred.length-a.referred.length).map((r,i)=>(
                          <div key={i} className="card" style={{marginBottom:10}}>
                            {/* 추천인 */}
                            <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:12}}>
                              <div style={{width:36,height:36,borderRadius:10,background:"var(--accent-bg)",border:"1px solid var(--accent-border)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,fontWeight:900,color:"var(--accent-text)",flexShrink:0}}>
                                {(r.referrer?.name||r.referrer?.email||"?")[0].toUpperCase()}
                              </div>
                              <div style={{flex:1,minWidth:0}}>
                                <div style={{fontSize:13,fontWeight:700,color:"var(--text)"}}>{r.referrer?.name||"이름없음"}</div>
                                <div style={{fontSize:11,color:"var(--text3)"}}>{r.referrer?.email}</div>
                              </div>
                              <span style={{fontSize:12,fontWeight:800,padding:"4px 12px",borderRadius:99,background:"var(--accent-bg)",color:"var(--accent-text)",border:"1px solid var(--accent-border)",flexShrink:0}}>
                                {r.referred.length}명 초대
                              </span>
                            </div>
                            {/* 초대된 회원들 */}
                            <div style={{paddingLeft:16,borderLeft:"2px solid var(--accent-border)",display:"flex",flexDirection:"column",gap:8}}>
                              {r.referred.map((u,j)=>(
                                <div key={j} style={{display:"flex",alignItems:"center",gap:10}}>
                                  <div style={{width:28,height:28,borderRadius:8,background:"var(--card2)",border:"1px solid var(--border)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:700,color:"var(--text2)",flexShrink:0}}>
                                    {(u.name||u.email||"?")[0].toUpperCase()}
                                  </div>
                                  <div style={{flex:1,minWidth:0}}>
                                    <div style={{fontSize:12,fontWeight:600,color:"var(--text)"}}>{u.name||"이름없음"}</div>
                                    <div style={{fontSize:11,color:"var(--text3)"}}>{u.email}</div>
                                  </div>
                                  <span className={`plan-chip plan-${u.plan}`}>{PLAN_LABELS[u.plan]||u.plan}</span>
                                  <span style={{fontSize:11,color:"var(--text3)",flexShrink:0}}>{new Date(u.created_at).toLocaleDateString("ko-KR")}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* ───── 📅 콘텐츠 캘린더 ───── */}
            {tab === "calendar" && (
              <div style={{animation:"fadeUp .25s ease both"}}>
                <UsageGuide theme={theme==="dark"?"dark":"light"} subtitle="매일 뭘 쓸지 정해주고, 꾸준함도 챙겨줄게요." steps={[{ico:"🗓️",title:"글감 보기",desc:"날짜별 추천 주제와 핫이슈를 봐요."},{ico:"✍️",title:"글쓰기",desc:"글쓰기 버튼으로 바로 작성을 시작해요."},{ico:"🔥",title:"완료 체크",desc:"쓴 날은 체크! 며칠 연속 썼는지 스트릭도 쌓여요."}]} />
                {/* 🔥 오늘의 핫이슈 — 회원 대시보드와 동일 */}
                <div className="card" style={{marginBottom:14,border:"1.5px solid rgba(255,180,0,.35)",background:"linear-gradient(135deg,rgba(255,196,0,.06),rgba(255,146,10,.03))"}}>
                  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,flexWrap:"wrap",marginBottom:8}}>
                    <div className="card-title" style={{margin:0}}>🔥 오늘의 핫이슈 <span style={{fontSize:11,fontWeight:800,color:"#ff8c00",background:"rgba(255,180,0,.15)",padding:"2px 8px",borderRadius:99,marginLeft:4}}>무료</span></div>
                    <button onClick={()=>loadHotIssues(hotCat,{refreshed:true})} disabled={hotLoading} style={{fontSize:11,padding:"5px 10px",borderRadius:8,border:"1px solid var(--border)",background:"var(--card2)",color:"var(--text2)",cursor:"pointer",fontWeight:700,fontFamily:"inherit",transition:"all .15s"}} onMouseEnter={e=>{e.currentTarget.style.borderColor="#ff8c00";e.currentTarget.style.color="#ff8c00";}} onMouseLeave={e=>{e.currentTarget.style.borderColor="var(--border)";e.currentTarget.style.color="var(--text2)";}}>{hotLoading?"⏳ 불러오는 중...":"🔄 새로고침"}</button>
                  </div>
                  <div style={{fontSize:11.5,color:"var(--text2)",lineHeight:1.5,marginBottom:11}}>지금 <b>실시간·분야별로 뜨는 주제</b>예요. 관심 있는 걸 <b style={{color:"#ff8c00"}}>탭하면 아래 키워드에 바로 추가</b>돼요. (실시간=구글 트렌드, 분야별=연합뉴스 · 30분마다 갱신)</div>
                  <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:12}}>
                    {HOT_CATS.map(c=>(
                      <button key={c} onClick={()=>loadHotIssues(c)}
                        style={{padding:"6px 12px",borderRadius:99,border:`1.5px solid ${hotCat===c?"#ff8c00":"var(--border)"}`,background:hotCat===c?"rgba(255,140,0,.12)":"var(--bg)",color:hotCat===c?"#ff8c00":"var(--text2)",cursor:"pointer",fontSize:12,fontWeight:800,fontFamily:"inherit",transition:"all .15s"}}>
                        {c==="실시간"?"🔥 실시간":c}
                      </button>
                    ))}
                  </div>
                  {hotLoading ? <div style={{fontSize:12.5,color:"var(--text3)",padding:"10px 0"}}><span className="spinner"/> 인기 주제 불러오는 중...</div>
                    : hotItems.length===0 ? <div style={{fontSize:12.5,color:"var(--text3)",padding:"10px 0"}}>카테고리를 눌러 지금 뜨는 주제를 확인하세요.</div>
                    : (()=>{
                        const totalPages = Math.max(1, Math.ceil(hotItems.length / HOT_PAGE_SIZE));
                        const page = Math.min(hotPage, totalPages-1);
                        const start = page * HOT_PAGE_SIZE;
                        const pageItems = hotItems.slice(start, start + HOT_PAGE_SIZE);
                        const pgBtn = (active:boolean):React.CSSProperties=>({minWidth:30,padding:"5px 9px",borderRadius:8,border:`1.5px solid ${active?"#ff8c00":"var(--border)"}`,background:active?"rgba(255,140,0,.14)":"var(--card)",color:active?"#ff8c00":"var(--text2)",cursor:"pointer",fontSize:12,fontWeight:800,fontFamily:"inherit",transition:"all .12s"});
                        return (<>
                          <div style={{display:"flex",flexWrap:"wrap",gap:7}}>
                            {pageItems.map((it,li)=>{ const i=start+li; return (
                              <button key={i} onClick={()=>{setCalKeywords(prev=>{const list=prev.split(/[,\n]+/).map(s=>s.trim()).filter(Boolean); if(!list.includes(it)) list.push(it); return list.join(", ");}); showToast(`➕ "${it.slice(0,18)}" 키워드에 추가!`);}}
                                title="클릭하면 아래 키워드에 추가돼요"
                                style={{padding:"7px 12px",borderRadius:10,border:"1px solid var(--border)",background:"var(--card)",color:"var(--text)",cursor:"pointer",fontSize:12.5,fontWeight:600,fontFamily:"inherit",lineHeight:1.3,textAlign:"left",maxWidth:"100%",transition:"all .12s"}}
                                onMouseEnter={e=>{e.currentTarget.style.borderColor="#ff8c00";e.currentTarget.style.background="rgba(255,140,0,.08)";}}
                                onMouseLeave={e=>{e.currentTarget.style.borderColor="var(--border)";e.currentTarget.style.background="var(--card)";}}>
                                <span style={{color:"#ff8c00",fontWeight:800,marginRight:4}}>{i+1}</span>{it.length>34?it.slice(0,34)+"…":it}
                              </button>
                            );})}
                          </div>
                          {totalPages>1 && (
                            <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:5,marginTop:12,flexWrap:"wrap"}}>
                              <button onClick={()=>setHotPage(Math.max(0,page-1))} disabled={page===0} style={{...pgBtn(false),opacity:page===0?.4:1,cursor:page===0?"default":"pointer"}}>‹ 이전</button>
                              {Array.from({length:totalPages}).map((_,pi)=>(
                                <button key={pi} onClick={()=>setHotPage(pi)} style={pgBtn(page===pi)}>{pi+1}</button>
                              ))}
                              <button onClick={()=>setHotPage(Math.min(totalPages-1,page+1))} disabled={page===totalPages-1} style={{...pgBtn(false),opacity:page===totalPages-1?.4:1,cursor:page===totalPages-1?"default":"pointer"}}>다음 ›</button>
                              <span style={{fontSize:11,color:"var(--text3)",marginLeft:6}}>총 {hotItems.length}개</span>
                            </div>
                          )}
                        </>);
                      })()}
                  {/* ✍️ 별도 파이프라인 — 핫이슈로 '바로 글쓰기'(캘린더 스케줄 안 거침) */}
                  {hotItems.length>0 && (
                    <div style={{marginTop:12,padding:"12px 14px",borderRadius:12,background:"var(--card2)",border:"1px solid var(--border)"}}>
                      <div style={{fontSize:12.5,fontWeight:800,color:"var(--text)",marginBottom:8,display:"flex",alignItems:"center",gap:6}}>✍️ 핫이슈로 바로 글쓰기 <span style={{fontSize:11,fontWeight:600,color:"var(--text3)"}}>· 스케줄 안 거치고 지금 바로 써요</span></div>
                      <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                        <select value={quickKw} onChange={e=>setQuickKw(e.target.value)} style={{flex:1,minWidth:180,padding:"10px 12px",borderRadius:10,border:"1px solid var(--border)",background:"var(--card)",color:"var(--text)",fontSize:12.5,fontWeight:600,fontFamily:"inherit",outline:"none"}}>
                          <option value="">위 핫이슈에서 골라주세요…</option>
                          {hotItems.map((it,i)=><option key={i} value={it}>{i+1}. {it.length>42?it.slice(0,42)+"…":it}</option>)}
                        </select>
                        <button onClick={()=>{const kw=quickKw.trim(); if(!kw){showToast("먼저 핫이슈를 골라주세요");return;} setKeyword(kw);setSelectedTitle(kw);setPendingPromo(null);setTab("write");showToast(`✍️ "${kw.slice(0,16)}…" 바로 글쓰기로 이동!`);}}
                          style={{flexShrink:0,padding:"10px 18px",borderRadius:10,border:"none",background:"linear-gradient(135deg,#ff922e,#ff6a3d)",color:"#fff",fontSize:13,fontWeight:800,fontFamily:"inherit",cursor:"pointer",whiteSpace:"nowrap",boxShadow:"0 6px 16px -6px rgba(255,122,61,.5)"}}>바로 글쓰기 →</button>
                      </div>
                    </div>
                  )}
                </div>

                <div className="card">
                  <div className="card-title" style={{marginBottom:8}}>📅 콘텐츠 캘린더 생성</div>
                  <div style={{fontSize:12.5,color:"var(--text2)",lineHeight:1.6,marginBottom:16,padding:"11px 14px",borderRadius:11,background:"var(--card2)",border:"1px solid var(--border)"}}>
                    💡 <b>키워드만 넣으면 AI가 며칠치 발행 계획표를 자동으로</b> 짜줘요. 각 줄의 <b style={{color:"var(--accent-text)"}}>✍️ 글쓰기</b>를 누르면 그 제목으로 바로 글 생성으로 이동하고, <b>발행한 글은 ✓ 체크</b>하면 진행률·<b style={{color:"#ff7a30"}}>🔥 연속 발행일</b>이 쌓여요. <span style={{color:"var(--text3)"}}>계획표는 저장돼 다시 들어와도 유지돼요.</span>
                  </div>
                  <div style={{marginBottom:14}}>
                    <label className="inp-label">🔑 키워드 입력 (쉼표 또는 줄바꿈으로 구분)</label>
                    <textarea className="inp" rows={4} placeholder={"예: 다이어트 방법, 제주도 여행, 강남 맛집\n오징어 젓갈, 홈카페 레시피"}
                      value={calKeywords} onChange={e=>setCalKeywords(e.target.value)} style={{resize:"vertical"}}/>
                  </div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:14}}>
                    <div>
                      <label className="inp-label">📱 플랫폼</label>
                      <div style={{display:"flex",gap:8}}>
                        {(["naver","tistory"] as const).map(p=>(
                          <button key={p} onClick={()=>setCalPlatform(p)}
                            style={{flex:1,padding:"10px",borderRadius:10,border:`1.5px solid ${calPlatform===p?"var(--accent)":"var(--border)"}`,background:calPlatform===p?"var(--accent-bg)":"var(--bg)",cursor:"pointer",fontSize:13,fontWeight:700,fontFamily:"inherit",color:calPlatform===p?"var(--accent-text)":"var(--text2)",transition:"all .15s"}}>
                            {p==="naver"?"🟢 네이버":"🟠 티스토리"}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <label className="inp-label">📆 기간</label>
                      <div style={{display:"flex",gap:8}}>
                        {[7,14,30].map(d=>(
                          <button key={d} onClick={()=>setCalDays(d)}
                            style={{flex:1,padding:"10px",borderRadius:10,border:`1.5px solid ${calDays===d?"var(--accent)":"var(--border)"}`,background:calDays===d?"var(--accent-bg)":"var(--bg)",cursor:"pointer",fontSize:13,fontWeight:700,fontFamily:"inherit",color:calDays===d?"var(--accent-text)":"var(--text2)",transition:"all .15s"}}>
                            {d}일
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                  <button className="btn btn-primary btn-full" onClick={generateCalendar} disabled={calLoading||!calKeywords.trim()}>
                    {calLoading?<><span className="spinner"/>AI 스케줄 생성 중...</>:"✨ AI 스케줄 자동 생성"}
                  </button>
                </div>

                {calSchedule.length>0&&(()=>{
                  const todayStr=new Date().toISOString().slice(0,10);
                  const total=calSchedule.length;
                  const doneCount=calSchedule.filter(s=>calCompleted[s.date]).length;
                  const pct=total?Math.round(doneCount/total*100):0;
                  const doneDates=new Set(calSchedule.filter(s=>calCompleted[s.date]).map(s=>s.date));
                  let streak=0; const cur=new Date();
                  if(!doneDates.has(todayStr)) cur.setDate(cur.getDate()-1);
                  while(doneDates.has(cur.toISOString().slice(0,10))){streak++;cur.setDate(cur.getDate()-1);}
                  const todayItem=calSchedule.find(s=>s.date===todayStr);
                  const todayDone=todayItem&&!!calCompleted[todayItem.date];
                  const cheer=pct===100?"🎉 완주했어요! 정말 대단해요":pct>=70?"🔥 거의 다 왔어요, 조금만 더!":pct>=40?"👍 절반 넘었어요, 이 페이스 유지!":pct>0?"💪 시작이 반이에요":"✨ 오늘 한 편부터 가볍게 시작해요";
                  return(
                  <>
                    <div className="card" style={{marginBottom:14,animation:"fadeUp .2s ease both"}}>
                      <div style={{display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
                        <div style={{display:"flex",alignItems:"center",gap:9,padding:"10px 15px",borderRadius:13,background:"linear-gradient(135deg,rgba(255,107,53,.14),rgba(255,159,63,.10))",border:"1px solid rgba(255,127,50,.28)"}}>
                          <span style={{fontSize:26,filter:streak>0?"none":"grayscale(1) opacity(.5)"}}>🔥</span>
                          <div><div style={{fontSize:22,fontWeight:900,color:"#ff7a30",lineHeight:1}}>{streak}<span style={{fontSize:12,marginLeft:2}}>일</span></div><div style={{fontSize:10.5,color:"var(--text3)",fontWeight:700,marginTop:2}}>연속 발행</div></div>
                        </div>
                        <div style={{flex:1,minWidth:160}}>
                          <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",marginBottom:6}}>
                            <span style={{fontSize:13,fontWeight:800,color:"var(--text)"}}>{cheer}</span>
                            <span style={{fontSize:12,fontWeight:800,color:"var(--accent-text)"}}>{doneCount}/{total} · {pct}%</span>
                          </div>
                          <div style={{height:10,borderRadius:99,background:"var(--card2)",overflow:"hidden"}}>
                            <div style={{height:"100%",width:`${pct}%`,borderRadius:99,background:"linear-gradient(90deg,#03c75a,#00a5ff)",transition:"width .5s cubic-bezier(.2,.8,.2,1)"}}/>
                          </div>
                        </div>
                      </div>
                      {todayItem&&(
                        <div style={{marginTop:13,padding:"13px 15px",borderRadius:12,background:todayDone?"rgba(3,199,90,.08)":"var(--accent-bg)",border:`1.5px solid ${todayDone?"rgba(3,199,90,.35)":"var(--accent-border)"}`,display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
                          <div style={{flex:1,minWidth:180}}>
                            <div style={{fontSize:11,fontWeight:800,color:todayDone?"var(--success)":"var(--accent-text)",marginBottom:3}}>{todayDone?"✅ 오늘 글 완료!":"📌 오늘 쓸 글"}</div>
                            <div style={{fontSize:14,fontWeight:800,color:"var(--text)",lineHeight:1.35,textDecoration:todayDone?"line-through":"none",opacity:todayDone?.6:1}}>{todayItem.title}</div>
                            <div style={{fontSize:11,color:"var(--text3)",marginTop:3}}>🔑 {todayItem.keyword} · {todayItem.style}</div>
                          </div>
                          {!todayDone&&<button onClick={()=>writeFromSchedule(todayItem)} className="btn btn-primary" style={{padding:"11px 18px",fontSize:13,whiteSpace:"nowrap"}}>✍️ 지금 쓰기 →</button>}
                        </div>
                      )}
                    </div>

                    <div className="card" style={{marginTop:0,padding:0,overflow:"hidden",animation:"fadeUp .2s ease both"}}>
                      <div style={{padding:"14px 16px",borderBottom:"1px solid var(--border)",display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,flexWrap:"wrap"}}>
                        <div className="card-title" style={{margin:0}}>📋 {total}일치 발행 스케줄</div>
                        <div style={{display:"flex",gap:8}}>
                          <button onClick={()=>{
                            const csv=["날짜,키워드,제목,스타일,수익유형,완료",...calSchedule.map(s=>`${s.date},${s.keyword},"${s.title}",${s.style},${s.adType},${calCompleted[s.date]?"완료":""}`)].join("\n");
                            const a=document.createElement("a");a.href=URL.createObjectURL(new Blob(["﻿"+csv],{type:"text/csv"}));a.download="콘텐츠캘린더.csv";a.click();
                          }} style={{padding:"6px 14px",borderRadius:8,border:"1px solid var(--border)",background:"var(--card2)",color:"var(--text2)",cursor:"pointer",fontSize:12,fontWeight:700,fontFamily:"inherit"}}>📥 CSV</button>
                          <button onClick={()=>{if(window.confirm("이 스케줄을 지울까요? 완료 기록도 함께 삭제돼요.")){setCalSchedule([]);setCalCompleted({});setCalDone(false);localStorage.removeItem("publy_adm_cal_schedule");localStorage.removeItem("publy_adm_cal_done");}}}
                            style={{padding:"6px 14px",borderRadius:8,border:"1px solid var(--border)",background:"var(--card2)",color:"var(--text3)",cursor:"pointer",fontSize:12,fontWeight:700,fontFamily:"inherit"}}>🗑 초기화</button>
                        </div>
                      </div>
                      <div style={{overflowX:"auto"}}>
                        <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                          <thead>
                            <tr style={{background:"var(--bg2)"}}>
                              {["","날짜","키워드","제목","스타일","수익",""].map((h,hi)=>(
                                <th key={hi} style={{padding:"9px 12px",textAlign:"left",fontWeight:700,color:"var(--text3)",whiteSpace:"nowrap",borderBottom:"1px solid var(--border)"}}>{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {calSchedule.map((s,i)=>{
                              const d=new Date(s.date);
                              const dow=["일","월","화","수","목","금","토"][d.getDay()];
                              const isWeekend=d.getDay()===0||d.getDay()===6;
                              const done=!!calCompleted[s.date];
                              const isToday=s.date===todayStr;
                              return(
                                <tr key={i} style={{borderBottom:"1px solid var(--border)",transition:"background .1s",background:isToday?"var(--accent-bg)":done?"rgba(3,199,90,.05)":"",opacity:done?.6:1}}
                                  onMouseEnter={e=>(e.currentTarget.style.background=isToday?"var(--accent-bg)":"var(--card-hover)")}
                                  onMouseLeave={e=>(e.currentTarget.style.background=isToday?"var(--accent-bg)":done?"rgba(3,199,90,.05)":"")}>
                                  <td style={{padding:"10px 8px 10px 12px",whiteSpace:"nowrap"}}>
                                    <button onClick={()=>toggleCalDone(s.date)} title={done?"완료 취소":"발행 완료 표시"}
                                      style={{width:24,height:24,borderRadius:7,border:`2px solid ${done?"var(--success)":"var(--border)"}`,background:done?"var(--success)":"transparent",color:"#fff",cursor:"pointer",fontSize:13,fontWeight:900,display:"flex",alignItems:"center",justifyContent:"center",padding:0,lineHeight:1}}>{done?"✓":""}</button>
                                  </td>
                                  <td style={{padding:"10px 12px",whiteSpace:"nowrap"}}>
                                    <span style={{fontWeight:700,color:isWeekend?"var(--warn)":"var(--text)",textDecoration:done?"line-through":"none"}}>{s.date}</span>
                                    <span style={{fontSize:10,marginLeft:4,color:"var(--text3)"}}>({dow})</span>
                                    {isToday&&<span style={{fontSize:9,marginLeft:5,padding:"1px 6px",borderRadius:99,background:"var(--accent)",color:"#000",fontWeight:900}}>오늘</span>}
                                  </td>
                                  <td style={{padding:"10px 12px",color:"var(--accent-text)",fontWeight:700,whiteSpace:"nowrap"}}>{s.keyword}</td>
                                  <td style={{padding:"10px 12px",color:"var(--text)",maxWidth:260,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",textDecoration:done?"line-through":"none"}}>{s.promo&&<span title={`${s.promo.name} 소개가 글 마지막에 자연스럽게 들어가요`} style={{fontSize:9,fontWeight:800,color:"#03c75a",background:"rgba(3,199,90,.12)",padding:"1px 6px",borderRadius:99,marginRight:5}}>🌿추천</span>}{s.title}</td>
                                  <td style={{padding:"10px 12px",whiteSpace:"nowrap"}}>
                                    <span style={{fontSize:11,padding:"2px 8px",borderRadius:99,background:"var(--card2)",color:"var(--text2)",border:"1px solid var(--border)"}}>{s.style}</span>
                                  </td>
                                  <td style={{padding:"10px 12px",whiteSpace:"nowrap"}}>
                                    <span style={{fontSize:11,padding:"2px 8px",borderRadius:99,
                                      background:s.adType==="adpost"?"rgba(3,199,90,.1)":"rgba(66,133,244,.1)",
                                      color:s.adType==="adpost"?"var(--naver)":"#4285F4",
                                      border:`1px solid ${s.adType==="adpost"?"rgba(3,199,90,.3)":"rgba(66,133,244,.3)"}`}}>
                                      {s.adType==="adpost"?"애드포스트":"애드센스"}
                                    </span>
                                  </td>
                                  <td style={{padding:"10px 12px",whiteSpace:"nowrap"}}>
                                    <button onClick={()=>regenCalItem(i)} disabled={calRegenIdx===i} title="이 제목이 맘에 안 들면 새로 추천받기"
                                      style={{padding:"4px 9px",borderRadius:7,border:"1px solid var(--border)",background:"var(--card2)",color:"var(--text2)",cursor:calRegenIdx===i?"default":"pointer",fontSize:11,fontWeight:700,fontFamily:"inherit",marginRight:5}}>
                                      {calRegenIdx===i?"🔄...":"🔄 재추천"}
                                    </button>
                                    <button onClick={()=>writeFromSchedule(s)}
                                      style={{padding:"4px 10px",borderRadius:7,border:"1px solid var(--accent-border)",background:"var(--accent-bg)",color:"var(--accent-text)",cursor:"pointer",fontSize:11,fontWeight:700,fontFamily:"inherit",whiteSpace:"nowrap"}}>
                                      ✍️ 글쓰기 →
                                    </button>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </>
                  );
                })()}
              </div>
            )}

            {/* ───── 🐞 버그 신고 ───── */}
            {tab === "bug" && (
              <div style={{animation:"fadeUp .25s ease both"}}>
                <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:14,flexWrap:"wrap"}}>
                  <div style={{fontSize:18,fontWeight:900,color:"var(--text)"}}>🐞 버그 신고</div>
                  <div style={{display:"flex",gap:6,background:"var(--card)",border:"1px solid var(--border)",borderRadius:10,padding:4}}>
                    {([{k:"open",l:"미처리"},{k:"all",l:"전체"}] as const).map(f=>(
                      <button key={f.k} onClick={()=>setBugFilter(f.k)} style={{padding:"6px 14px",borderRadius:7,border:"none",cursor:"pointer",fontSize:12,fontWeight:800,fontFamily:"inherit",background:bugFilter===f.k?"var(--danger)":"transparent",color:bugFilter===f.k?"#fff":"var(--text2)"}}>{f.l}</button>
                    ))}
                  </div>
                  <button onClick={loadBugReports} style={{marginLeft:"auto",padding:"7px 14px",borderRadius:8,border:"1px solid var(--border)",background:"var(--card2)",color:"var(--text2)",cursor:"pointer",fontSize:12,fontWeight:700,fontFamily:"inherit"}}>🔄 새로고침</button>
                </div>
                {bugLoading?(
                  <div style={{padding:"40px",textAlign:"center",color:"var(--text3)"}}>불러오는 중...</div>
                ):(()=>{
                  const list=bugReports.filter(b=>bugFilter==="all"||b.status!=="resolved");
                  return list.length===0?(
                    <div style={{padding:"40px",textAlign:"center",color:"var(--text3)",fontSize:14}}>{bugFilter==="open"?"미처리 신고가 없어요. 👍":"신고 내역이 없어요."}</div>
                  ):(
                    <div style={{display:"flex",flexDirection:"column",gap:10}}>
                      {list.map(b=>(
                        <div key={b.id} style={{border:`1px solid ${b.status==="resolved"?"var(--border)":"rgba(248,81,73,.35)"}`,borderRadius:12,padding:"14px 16px",background:"var(--card)"}}>
                          <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
                            <span style={{fontSize:14,fontWeight:800,color:"var(--text)"}}>{b.user_name||"(이름없음)"}</span>
                            <span style={{fontSize:12,color:"var(--text3)"}}>{b.user_email||b.user_id?.slice(0,8)}</span>
                            {b.app_version&&<span style={{fontSize:11,fontWeight:700,padding:"2px 8px",borderRadius:99,background:"var(--card2)",color:"var(--text2)",border:"1px solid var(--border)"}}>v{b.app_version}</span>}
                            <span style={{fontSize:11,fontWeight:700,padding:"2px 8px",borderRadius:99,background:b.status==="resolved"?"rgba(63,185,80,.12)":"rgba(248,81,73,.12)",color:b.status==="resolved"?"#3fb950":"#f85149"}}>{b.status==="resolved"?"처리완료":"미처리"}</span>
                            <span style={{marginLeft:"auto",fontSize:11,color:"var(--text3)"}}>{new Date(b.created_at).toLocaleString("ko-KR")}</span>
                          </div>
                          {b.memo&&<div style={{marginTop:8,fontSize:13,color:"var(--text)",lineHeight:1.6,whiteSpace:"pre-wrap"}}>{b.memo}</div>}
                          {b.status!=="resolved"&&(
                            <input value={bugReply[b.id]??""} onChange={e=>setBugReply(p=>({...p,[b.id]:e.target.value}))}
                              placeholder="회원에게 보낼 답변 (선택) — 예: v2.0.27에서 수정했어요"
                              style={{width:"100%",marginTop:10,padding:"9px 12px",borderRadius:9,border:"1px solid var(--border)",background:"var(--bg)",color:"var(--text)",fontSize:12,fontFamily:"inherit",boxSizing:"border-box",outline:"none"}}/>
                          )}
                          {b.status==="resolved"&&b.admin_reply&&<div style={{marginTop:8,fontSize:12,color:"var(--text3)"}}>💬 보낸 답변: {b.admin_reply}</div>}
                          <div style={{display:"flex",gap:8,marginTop:10,flexWrap:"wrap"}}>
                            <button onClick={()=>setBugExpanded(bugExpanded===b.id?null:b.id)} style={{padding:"6px 12px",borderRadius:8,border:"1px solid var(--border)",background:"var(--bg)",color:"var(--text2)",cursor:"pointer",fontSize:12,fontWeight:700,fontFamily:"inherit"}}>{bugExpanded===b.id?"로그 접기":"📄 로그 보기"}</button>
                            {b.log_text&&<button onClick={async()=>{try{await navigator.clipboard.writeText(b.log_text||"");showToast("📋 로그가 복사되었습니다.","success");}catch{showToast("로그 복사에 실패했어요.","error");}}} style={{padding:"6px 12px",borderRadius:8,border:"1px solid var(--border)",background:"var(--bg)",color:"var(--text2)",cursor:"pointer",fontSize:12,fontWeight:700,fontFamily:"inherit"}}>📋 로그 복사</button>}
                            <button onClick={async()=>{await updateBugReportStatus(b.id,b.status==="resolved"?"open":"resolved",bugReply[b.id]);loadBugReports();}} style={{padding:"6px 12px",borderRadius:8,border:"none",background:b.status==="resolved"?"var(--card2)":"#3fb950",color:b.status==="resolved"?"var(--text2)":"#fff",cursor:"pointer",fontSize:12,fontWeight:800,fontFamily:"inherit"}}>{b.status==="resolved"?"미처리로":"✓ 처리완료 (회원에게 알림)"}</button>
                            <button onClick={async()=>{if(confirm("이 신고를 삭제할까요?")){await deleteBugReport(b.id);loadBugReports();}}} style={{padding:"6px 12px",borderRadius:8,border:"1px solid rgba(248,81,73,.3)",background:"transparent",color:"var(--danger)",cursor:"pointer",fontSize:12,fontWeight:700,fontFamily:"inherit"}}>삭제</button>
                          </div>
                          {bugExpanded===b.id&&(
                            <pre style={{marginTop:10,padding:"12px",borderRadius:10,background:"var(--bg)",border:"1px solid var(--border)",color:"var(--text2)",fontSize:11,lineHeight:1.5,maxHeight:360,overflow:"auto",whiteSpace:"pre-wrap",wordBreak:"break-all"}}>{b.log_text||"(로그 없음)"}</pre>
                          )}
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>
            )}

            {/* ───── 📊 통계 ───── */}
            {tab === "live" && (()=>{
              const nameOf = (uid:string)=>{ const u = users.find(u=>u.id===uid); return u ? (u.name||u.email||uid.slice(0,8)) : uid.slice(0,8); };
              const planOf = (uid:string)=>{ const u = users.find(u=>u.id===uid); return u?.plan || "-"; };
              const sum = liveUsage.reduce((a,r)=>({publish:a.publish+r.publish,neighbor:a.neighbor+r.neighbor,engage:a.engage+r.engage,reply:a.reply+r.reply,blogscore:a.blogscore+r.blogscore}),{publish:0,neighbor:0,engage:0,reply:0,blogscore:0});
              const cards = [
                {label:"✍️ 발행", value:sum.publish, color:"var(--accent-text)"},
                {label:"🤝 서이추", value:sum.neighbor, color:"#00b8d4"},
                {label:"❤️ 공감·댓글", value:sum.engage, color:"#e5397f"},
                {label:"💬 답방", value:sum.reply, color:"#8b5cf6"},
                {label:"📈 지수 진단", value:sum.blogscore, color:"#00c896"},
              ];
              const active = liveUsage.filter(r=>r.total>0);
              return (
              <div style={{animation:"fadeUp .25s ease both"}}>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:10,marginBottom:16}}>
                  <div>
                    <div style={{fontSize:19,fontWeight:900,color:"var(--text)"}}>📡 실시간 사용현황 <span style={{fontSize:12,fontWeight:600,color:"var(--text3)"}}>(오늘 · 자정 초기화)</span></div>
                    <div style={{fontSize:12,color:"var(--text3)",marginTop:4}}>회원들이 지금 각 기능을 얼마나 쓰고 있는지 실시간으로 봐요. {liveUpdatedAt && `· 마지막 갱신 ${liveUpdatedAt.toLocaleTimeString("ko-KR",{hour12:false})}`}</div>
                  </div>
                  <div style={{display:"flex",gap:8,alignItems:"center"}}>
                    <button onClick={()=>setLiveAuto(v=>!v)} style={{padding:"8px 14px",borderRadius:9,border:`1.5px solid ${liveAuto?"var(--success)":"var(--border)"}`,background:liveAuto?"rgba(0,214,143,.1)":"transparent",color:liveAuto?"var(--success)":"var(--text2)",cursor:"pointer",fontSize:12,fontWeight:700,fontFamily:"inherit"}}>{liveAuto?"🟢 자동 갱신 켜짐":"⚪ 자동 갱신 꺼짐"}</button>
                    <button onClick={loadLiveUsage} disabled={liveLoading} style={{padding:"8px 16px",borderRadius:9,border:"none",background:"var(--accent)",color:"#000",cursor:"pointer",fontSize:12,fontWeight:800,fontFamily:"inherit"}}>{liveLoading?"불러오는 중...":"🔄 새로고침"}</button>
                  </div>
                </div>

                {/* 오늘 전체 합계 카드 */}
                <div className="stats-grid" style={{marginBottom:16}}>
                  {cards.map((c,i)=>(
                    <div key={i} className="stats-card">
                      <div className="stats-num" style={{color:c.color}}>{c.value.toLocaleString()}</div>
                      <div className="stats-label">{c.label}</div>
                      <div className="stats-sub">오늘 전체 합계</div>
                    </div>
                  ))}
                </div>

                {/* 회원별 사용량 표 */}
                <div className="card">
                  <div className="card-title" style={{marginBottom:12}}>👤 지금 활동 중인 회원 <span style={{fontSize:12,fontWeight:600,color:"var(--text3)"}}>({active.length}명)</span></div>
                  {liveLoading && liveUsage.length===0 ? (
                    <div style={{padding:"40px",textAlign:"center",color:"var(--text3)"}}>불러오는 중...</div>
                  ) : active.length===0 ? (
                    <div style={{padding:"40px",textAlign:"center",color:"var(--text3)",fontSize:13}}>오늘 아직 활동한 회원이 없어요.</div>
                  ) : (
                    <div style={{overflowX:"auto"}}>
                      <table style={{width:"100%",borderCollapse:"collapse",fontSize:13,minWidth:560}}>
                        <thead><tr style={{borderBottom:"2px solid var(--border)"}}>
                          {["회원","등급","✍️발행","🤝서이추","❤️공감","💬답방","📈진단","합계"].map((h,i)=>(
                            <th key={h} style={{padding:"9px 10px",textAlign:i<2?"left":"right",fontWeight:700,color:"var(--text3)",whiteSpace:"nowrap"}}>{h}</th>
                          ))}
                        </tr></thead>
                        <tbody>
                          {active.map(r=>(
                            <tr key={r.userId} style={{borderBottom:"1px solid var(--border)"}}>
                              <td style={{padding:"9px 10px",fontWeight:600,color:"var(--text)",whiteSpace:"nowrap"}}>{nameOf(r.userId)}</td>
                              <td style={{padding:"9px 10px"}}><span className={`plan-chip plan-${planOf(r.userId)}`}>{PLAN_LABELS[planOf(r.userId)]||planOf(r.userId)}</span></td>
                              <td style={{padding:"9px 10px",textAlign:"right",color:r.publish?"var(--text)":"var(--text3)"}}>{r.publish||"-"}</td>
                              <td style={{padding:"9px 10px",textAlign:"right",color:r.neighbor?"var(--text)":"var(--text3)"}}>{r.neighbor||"-"}</td>
                              <td style={{padding:"9px 10px",textAlign:"right",color:r.engage?"var(--text)":"var(--text3)"}}>{r.engage||"-"}</td>
                              <td style={{padding:"9px 10px",textAlign:"right",color:r.reply?"var(--text)":"var(--text3)"}}>{r.reply||"-"}</td>
                              <td style={{padding:"9px 10px",textAlign:"right",color:r.blogscore?"var(--text)":"var(--text3)"}}>{r.blogscore||"-"}</td>
                              <td style={{padding:"9px 10px",textAlign:"right",fontWeight:800,color:"var(--accent-text)"}}>{r.total}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {/* 📡 회원 로그 뷰어 — 회원 검색 → 현재 진행 로그 실시간(회원이 신고 안 해도) */}
                <div className="card" style={{marginTop:16}}>
                  <div className="card-title" style={{marginBottom:6}}>📡 회원 로그 실시간 보기</div>
                  <div style={{fontSize:12,color:"var(--text3)",marginBottom:12}}>회원을 검색해 고르면, 그 회원이 지금 돌리고 있는 작업 로그를 실시간으로 봐요. (회원이 따로 보내지 않아도 자동으로 올라와요)</div>
                  <input className="inp" placeholder="🔍 회원 이름·이메일로 검색" value={logSearch} onChange={e=>setLogSearch(e.target.value)} style={{marginBottom:10}} />
                  {(()=>{ const q=logSearch.trim().toLowerCase();
                    const runningIds = new Set(logRunning.map(r=>r.user_id));
                    const list = users.filter(u=>!q || (u.name||"").toLowerCase().includes(q) || (u.email||"").toLowerCase().includes(q))
                      .sort((a,b)=>Number(runningIds.has(b.id))-Number(runningIds.has(a.id))).slice(0,12);
                    return (
                    <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:14}}>
                      {list.length===0? <span style={{fontSize:13,color:"var(--text3)",padding:"8px 0"}}>검색 결과가 없어요.</span> :
                       list.map(u=>{ const run=runningIds.has(u.id); const sel=logUserId===u.id; return (
                        <button key={u.id} onClick={()=>{setLogUserId(u.id);getLiveLog(u.id).then(setLogRow);}}
                          style={{padding:"8px 13px",borderRadius:99,border:`1.5px solid ${sel?"var(--accent)":"var(--border)"}`,background:sel?"var(--accent-bg)":"var(--bg)",color:sel?"var(--accent-text)":"var(--text)",cursor:"pointer",fontSize:12.5,fontWeight:700,fontFamily:"inherit",display:"flex",alignItems:"center",gap:6}}>
                          {run&&<span style={{width:7,height:7,borderRadius:"50%",background:"var(--success)",boxShadow:"0 0 0 3px rgba(0,214,143,.2)"}}/>}
                          {u.name||u.email}{run&&<span style={{fontSize:10,color:"var(--success)",fontWeight:800}}>작업중</span>}
                        </button>
                      );})}
                    </div>
                    );
                  })()}
                  {logUserId && (()=>{ const u=users.find(x=>x.id===logUserId); const running=logRow?.is_running; const ago=logRow?Math.round((Date.now()-new Date(logRow.updated_at).getTime())/1000):0;
                    return (
                    <div>
                      <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap",marginBottom:8}}>
                        <span style={{fontSize:14,fontWeight:800,color:"var(--text)"}}>{u?.name||u?.email}</span>
                        {logRow?.context&&<span style={{fontSize:11,fontWeight:800,padding:"3px 9px",borderRadius:99,background:"var(--accent-bg)",color:"var(--accent-text)"}}>{logRow.context}</span>}
                        <span style={{fontSize:11,fontWeight:800,color:running?"var(--success)":"var(--text3)"}}>{running?"🟢 지금 작업 중":`⚪ 대기 · ${ago}초 전 갱신`}</span>
                        <button onClick={()=>getLiveLog(logUserId).then(setLogRow)} style={{marginLeft:"auto",padding:"6px 12px",borderRadius:8,border:"1px solid var(--border)",background:"var(--bg)",color:"var(--text2)",cursor:"pointer",fontSize:11.5,fontWeight:700,fontFamily:"inherit"}}>🔄 새로고침</button>
                        <button onClick={async()=>{try{await navigator.clipboard.writeText(logRow?.log_text||"");showToast("📋 로그 복사됨","success");}catch{}}} style={{padding:"6px 12px",borderRadius:8,border:"1px solid var(--border)",background:"var(--bg)",color:"var(--text2)",cursor:"pointer",fontSize:11.5,fontWeight:700,fontFamily:"inherit"}}>📋 복사</button>
                      </div>
                      <pre style={{margin:0,padding:"14px",borderRadius:12,background:theme==="dark"?"#0d1117":"#0d1117",color:"#b1bac4",border:"1px solid var(--border)",fontSize:11.5,lineHeight:1.6,maxHeight:420,overflow:"auto",whiteSpace:"pre-wrap",wordBreak:"break-all",fontFamily:"ui-monospace,SFMono-Regular,Menlo,monospace"}}>{logRow?.log_text?logRow.log_text.split(/\r?\n/).map((l,i)=><div key={i} style={{color:/❌|실패|오류|error/i.test(l)?"#f85149":/✅|완료|성공/i.test(l)?"#3fb950":undefined}}>{l||" "}</div>):"아직 이 회원의 로그가 없어요. 회원이 작업(발행·이미지 등)을 시작하면 여기 실시간으로 떠요."}</pre>
                    </div>
                    );
                  })()}
                </div>
              </div>
              );
            })()}

            {tab === "stats" && (
              <div style={{animation:"fadeUp .25s ease both"}}>

                {/* 서브탭 */}
                <div style={{display:"flex",gap:6,marginBottom:16,background:"var(--card)",border:"1px solid var(--border)",borderRadius:12,padding:4}}>
                  {([{k:"mine",l:"👤 내 통계"},{k:"all",l:"👥 전체 통계"}] as const).map(t=>(
                    <button key={t.k} onClick={()=>setStatsSubTab(t.k)}
                      style={{flex:1,padding:"9px",borderRadius:9,border:"none",cursor:"pointer",fontSize:13,fontWeight:700,fontFamily:"inherit",
                        background:statsSubTab===t.k?"var(--accent-bg)":"transparent",
                        color:statsSubTab===t.k?"var(--accent-text)":"var(--text2)",
                        borderBottom:statsSubTab===t.k?"2px solid var(--accent)":"2px solid transparent",
                        transition:"all .15s"}}>
                      {t.l}
                    </button>
                  ))}
                </div>

                {/* 내 통계 */}
                {statsSubTab==="mine"&&(()=>{
                  const now=new Date();
                  const thisWeek=history.filter(h=>{const d=new Date(h.published_at);return(now.getTime()-d.getTime())/(1000*60*60*24)<=7;});
                  const thisMonth=history.filter(h=>new Date(h.published_at).getMonth()===now.getMonth()&&new Date(h.published_at).getFullYear()===now.getFullYear());
                  const success=history.filter(h=>h.status==="success");
                  const successRate=history.length>0?Math.round((success.length/history.length)*100):0;
                  const naverCnt=success.filter(h=>h.platform==="naver").length;
                  const tistoryCnt=success.filter(h=>h.platform==="tistory").length;
                  const estViews=success.length*120;
                  const estRevenue=Math.round(estViews*0.35);
                  return(
                    <div>
                      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(120px,1fr))",gap:10,marginBottom:14}}>
                        {[
                          {label:"이번 주 발행",value:`${thisWeek.length}건`,color:"var(--accent-text)"},
                          {label:"이번 달 발행",value:`${thisMonth.length}건`,color:"var(--info)"},
                          {label:"누적 발행",value:`${history.length}건`,color:"var(--success)"},
                          {label:"성공률",value:`${successRate}%`,color:successRate>=80?"var(--success)":successRate>=50?"var(--warn)":"var(--danger)"},
                          {label:"예상 누적 조회",value:`${estViews.toLocaleString()}회`,color:"var(--purple)"},
                          {label:"예상 수익",value:`₩${estRevenue.toLocaleString()}`,color:"var(--warn)"},
                        ].map((s,i)=>(
                          <div key={i} style={{padding:"12px 14px",borderRadius:12,background:"var(--card)",border:"1px solid var(--border)",textAlign:"center"}}>
                            <div style={{fontSize:18,fontWeight:900,color:s.color,fontFamily:"'Space Grotesk',sans-serif"}}>{s.value}</div>
                            <div style={{fontSize:11,color:"var(--text3)",marginTop:4,fontWeight:600}}>{s.label}</div>
                          </div>
                        ))}
                      </div>
                      <div className="card">
                        <div className="card-title" style={{marginBottom:14}}>📋 플랫폼별 발행</div>
                        <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                          <div style={{flex:1,minWidth:120,padding:"12px 16px",borderRadius:10,background:"rgba(3,199,90,.08)",border:"1px solid rgba(3,199,90,.2)"}}>
                            <div style={{fontSize:11,color:"var(--naver)",fontWeight:700,marginBottom:4}}>🟢 네이버</div>
                            <div style={{fontSize:22,fontWeight:900,color:"var(--naver)"}}>{naverCnt}건</div>
                          </div>
                          <div style={{flex:1,minWidth:120,padding:"12px 16px",borderRadius:10,background:"rgba(255,107,53,.08)",border:"1px solid rgba(255,107,53,.2)"}}>
                            <div style={{fontSize:11,color:"var(--tistory)",fontWeight:700,marginBottom:4}}>🟠 티스토리</div>
                            <div style={{fontSize:22,fontWeight:900,color:"var(--tistory)"}}>{tistoryCnt}건</div>
                          </div>
                        </div>
                      </div>

                    </div>
                  );
                })()}

                {/* 전체 통계 */}
                {statsSubTab==="all"&&(
                  <div>
                    <div className="stats-grid">
                      {[
                        {label:"전체 회원",value:users.length,sub:"가입 회원 수",color:"var(--accent-text)"},
                        {label:"활성 회원",value:users.filter(u=>u.is_active).length,sub:"현재 이용 중",color:"var(--success)"},
                        {label:"PRO 회원",value:users.filter(u=>u.plan==="pro").length,sub:"최상위 플랜",color:"var(--info)"},
                        {label:"BASIC 회원",value:users.filter(u=>u.plan==="basic").length,sub:"기본 플랜",color:"var(--warn)"},
                        {label:"FREE 회원",value:users.filter(u=>u.plan==="free").length,sub:"무료 플랜",color:"var(--text2)"},
                        {label:"총 발행 건수",value:users.reduce((s,u)=>s+(u.history_count||0),0),sub:"전체 합산",color:"var(--danger)"},
                      ].map((s,i)=>(
                        <div key={i} className="stats-card">
                          <div className="stats-num" style={{color:s.color}}>{s.value.toLocaleString()}</div>
                          <div className="stats-label">{s.label}</div>
                          <div className="stats-sub">{s.sub}</div>
                        </div>
                      ))}
                    </div>
                    <div className="card">
                      <div className="card-title">📋 플랜 분포</div>
                      {(["pro","basic","free"] as const).map(plan=>{
                        const cnt = users.filter(u=>u.plan===plan).length;
                        const pct = users.length>0?Math.round((cnt/users.length)*100):0;
                        return (
                          <div key={plan} style={{marginBottom:14}}>
                            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:5}}>
                              <span style={{fontSize:13,fontWeight:600}}><span className={`plan-chip plan-${plan}`}>{PLAN_LABELS[plan]}</span></span>
                              <span style={{fontSize:12,fontWeight:700,color:"var(--text2)"}}>{cnt}명 ({pct}%)</span>
                            </div>
                            <div style={{height:8,background:"var(--border)",borderRadius:99,overflow:"hidden"}}>
                              <div style={{height:"100%",width:`${pct}%`,background:plan==="pro"?"var(--info)":plan==="basic"?"var(--warn)":"var(--text3)",borderRadius:99,transition:"width .6s"}}/>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <div className="card">
                      <div className="card-title">🏆 발행 TOP 10</div>
                      {[...users].sort((a,b)=>(b.history_count||0)-(a.history_count||0)).slice(0,10).map((u,i)=>(
                        <div key={u.id} style={{display:"flex",alignItems:"center",gap:12,padding:"10px 0",borderBottom:"1px solid var(--border)"}}>
                          <span style={{fontSize:16,fontWeight:900,color:i<3?"var(--warn)":"var(--text3)",width:24,textAlign:"center"}}>{i+1}</span>
                          <div className="user-avatar" style={{width:30,height:30,fontSize:12}}>{(u.name||u.email)[0].toUpperCase()}</div>
                          <div style={{flex:1,minWidth:0}}>
                            <div style={{fontSize:13,fontWeight:700,color:"var(--text)"}}>{u.name||"이름없음"}</div>
                            <div style={{fontSize:11,color:"var(--text2)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{u.email}</div>
                          </div>
                          <span style={{fontSize:14,fontWeight:800,color:"var(--accent-text)"}}>{u.history_count||0}건</span>
                        </div>
                      ))}
                    </div>

                    {/* 오늘 기능별 사용 통계 (실시간 현황 데이터 재활용) */}
                    {(()=>{
                      const s = liveUsage.reduce((a,r)=>({publish:a.publish+r.publish,neighbor:a.neighbor+r.neighbor,engage:a.engage+r.engage,reply:a.reply+r.reply,blogscore:a.blogscore+r.blogscore}),{publish:0,neighbor:0,engage:0,reply:0,blogscore:0});
                      const feats = [
                        {label:"✍️ 발행", value:s.publish, color:"var(--accent-text)"},
                        {label:"🤝 서이추", value:s.neighbor, color:"#00b8d4"},
                        {label:"❤️ 공감·댓글", value:s.engage, color:"#e5397f"},
                        {label:"💬 답방", value:s.reply, color:"#8b5cf6"},
                        {label:"📈 지수 진단", value:s.blogscore, color:"#00c896"},
                      ];
                      const maxV = Math.max(1,...feats.map(f=>f.value));
                      return (
                        <div className="card">
                          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12,flexWrap:"wrap",gap:8}}>
                            <div className="card-title" style={{margin:0}}>⚡ 오늘 기능별 사용량 <span style={{fontSize:11,fontWeight:600,color:"var(--text3)"}}>(자정 초기화)</span></div>
                            <button onClick={loadLiveUsage} style={{padding:"6px 12px",borderRadius:8,border:"1px solid var(--border)",background:"var(--bg)",color:"var(--text2)",cursor:"pointer",fontSize:11.5,fontWeight:700,fontFamily:"inherit"}}>🔄 새로고침</button>
                          </div>
                          {feats.map((f,i)=>(
                            <div key={i} style={{marginBottom:12}}>
                              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:5}}>
                                <span style={{fontSize:13,fontWeight:700,color:"var(--text2)"}}>{f.label}</span>
                                <span style={{fontSize:13,fontWeight:800,color:f.color}}>{f.value.toLocaleString()}건</span>
                              </div>
                              <div style={{height:8,background:"var(--border)",borderRadius:99,overflow:"hidden"}}>
                                <div style={{height:"100%",width:`${(f.value/maxV)*100}%`,background:f.color,borderRadius:99,transition:"width .6s"}}/>
                              </div>
                            </div>
                          ))}
                          <div style={{fontSize:11,color:"var(--text3)",marginTop:4,lineHeight:1.5}}>💡 오늘 하루 전체 회원이 각 기능을 사용한 합계예요. 더 자세한 실시간 회원별 현황은 <b style={{color:"var(--accent-text)"}}>📡 실시간 현황</b> 탭에서 볼 수 있어요.</div>
                        </div>
                      );
                    })()}
                  </div>
                )}
              </div>
            )}

            {/* ───── ↩️ 답방 관리 ───── */}
            {tab === "reply_manage" && (
              <div style={{animation:"fadeUp .25s ease both"}}>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:10,marginBottom:16}}>
                  <div>
                    <div style={{fontSize:19,fontWeight:900,color:"var(--text)"}}>↩️ 답방 관리</div>
                    <div style={{fontSize:12,color:"var(--text3)",marginTop:4}}>회원들이 내 블로그 댓글에 남긴 답글(대댓글) 이력이에요. {replyHistory.length>0&&`· 총 ${replyHistory.length}건`}</div>
                  </div>
                  <button onClick={()=>{setReplyLoading(true);getAllReplyHistory().then(d=>{setReplyHistory(d);setReplyLoading(false);});}} disabled={replyLoading} style={{padding:"8px 16px",borderRadius:9,border:"none",background:"var(--accent)",color:"#000",cursor:"pointer",fontSize:12,fontWeight:800,fontFamily:"inherit"}}>{replyLoading?"불러오는 중...":"🔄 새로고침"}</button>
                </div>
                <div className="card">
                  {replyLoading&&replyHistory.length===0 ? <div style={{padding:"40px",textAlign:"center",color:"var(--text3)"}}>불러오는 중...</div>
                  : replyHistory.length===0 ? <div style={{padding:"40px",textAlign:"center",color:"var(--text3)",fontSize:13}}>아직 답방 이력이 없어요.</div>
                  : <div style={{overflowX:"auto"}}><table style={{width:"100%",borderCollapse:"collapse",fontSize:13,minWidth:560}}>
                      <thead><tr style={{borderBottom:"2px solid var(--border)"}}>{["회원","글 제목","결과","메시지","시각"].map(h=><th key={h} style={{padding:"9px 10px",textAlign:"left",fontWeight:700,color:"var(--text3)",whiteSpace:"nowrap"}}>{h}</th>)}</tr></thead>
                      <tbody>{replyHistory.map(r=>(<tr key={r.id} style={{borderBottom:"1px solid var(--border)"}}>
                        <td style={{padding:"9px 10px",fontWeight:600,whiteSpace:"nowrap"}}>{r.user_name||r.user_email||r.user_id.slice(0,8)}</td>
                        <td style={{padding:"9px 10px",maxWidth:220,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}} title={r.post_title}>{r.post_title||"-"}</td>
                        <td style={{padding:"9px 10px"}}><span style={{fontSize:11.5,fontWeight:700,color:r.status==="success"?"var(--success)":r.status==="fail"?"var(--danger)":"var(--text3)"}}>{r.status==="success"?"✅ 성공":r.status==="fail"?"❌ 실패":"⏭️ 스킵"}</span></td>
                        <td style={{padding:"9px 10px",color:"var(--text2)",maxWidth:200,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}} title={r.message}>{r.message||"-"}</td>
                        <td style={{padding:"9px 10px",color:"var(--text3)",whiteSpace:"nowrap"}}>{new Date(r.created_at).toLocaleString("ko-KR",{month:"numeric",day:"numeric",hour:"2-digit",minute:"2-digit"})}</td>
                      </tr>))}</tbody></table></div>}
                </div>
              </div>
            )}

            {/* ───── 📈 지수 관리 ───── */}
            {tab === "blogscore_manage" && (
              <div style={{animation:"fadeUp .25s ease both"}}>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:10,marginBottom:16}}>
                  <div>
                    <div style={{fontSize:19,fontWeight:900,color:"var(--text)"}}>📈 지수 관리</div>
                    <div style={{fontSize:12,color:"var(--text3)",marginTop:4}}>회원들의 블로그 건강검진 진단 이력이에요. 저품질 의심 회원을 한눈에 볼 수 있어요. {blogscoreHistory.length>0&&`· 총 ${blogscoreHistory.length}건`}</div>
                  </div>
                  <button onClick={()=>{setBlogscoreLoading(true);getAllBlogscoreHistory().then(d=>{setBlogscoreHistory(d);setBlogscoreLoading(false);});}} disabled={blogscoreLoading} style={{padding:"8px 16px",borderRadius:9,border:"none",background:"var(--accent)",color:"#000",cursor:"pointer",fontSize:12,fontWeight:800,fontFamily:"inherit"}}>{blogscoreLoading?"불러오는 중...":"🔄 새로고침"}</button>
                </div>
                <div className="card">
                  {blogscoreLoading&&blogscoreHistory.length===0 ? <div style={{padding:"40px",textAlign:"center",color:"var(--text3)"}}>불러오는 중...</div>
                  : blogscoreHistory.length===0 ? <div style={{padding:"40px",textAlign:"center",color:"var(--text3)",fontSize:13}}>아직 진단 이력이 없어요.</div>
                  : <div style={{overflowX:"auto"}}><table style={{width:"100%",borderCollapse:"collapse",fontSize:13,minWidth:560}}>
                      <thead><tr style={{borderBottom:"2px solid var(--border)"}}>{["회원","블로그","총 글","이웃","저품질","진단 시각"].map(h=><th key={h} style={{padding:"9px 10px",textAlign:"left",fontWeight:700,color:"var(--text3)",whiteSpace:"nowrap"}}>{h}</th>)}</tr></thead>
                      <tbody>{blogscoreHistory.map(r=>(<tr key={r.id} style={{borderBottom:"1px solid var(--border)"}}>
                        <td style={{padding:"9px 10px",fontWeight:600,whiteSpace:"nowrap"}}>{r.user_name||r.user_email||r.user_id.slice(0,8)}</td>
                        <td style={{padding:"9px 10px",color:"var(--text2)",whiteSpace:"nowrap"}}>{r.blog_id||"-"}</td>
                        <td style={{padding:"9px 10px"}}>{r.total_posts?.toLocaleString()||"-"}</td>
                        <td style={{padding:"9px 10px"}}>{r.neighbors?.toLocaleString()||"-"}</td>
                        <td style={{padding:"9px 10px"}}>{r.low_quality_suspected===true?<span style={{fontSize:11.5,fontWeight:800,color:"var(--danger)"}}>🔴 의심</span>:r.low_quality_suspected===false?<span style={{fontSize:11.5,color:"var(--success)"}}>정상</span>:<span style={{color:"var(--text3)"}}>-</span>}</td>
                        <td style={{padding:"9px 10px",color:"var(--text3)",whiteSpace:"nowrap"}}>{new Date(r.created_at).toLocaleString("ko-KR",{month:"numeric",day:"numeric",hour:"2-digit",minute:"2-digit"})}</td>
                      </tr>))}</tbody></table></div>}
                </div>
              </div>
            )}

            {/* ───── 자동화 탭 keep-alive: 방문한 탭은 숨기기만(작업·데이터 유지) ───── */}
            {visitedAutoTabs.has("neighbor") && (
              <div style={{ display: tab === "neighbor" ? "block" : "none" }}>
                <NeighborPage theme={theme} userId={ADM_HISTORY_UID} plan="admin" singleTab isActive={tab === "neighbor"} />
              </div>
            )}
            {visitedAutoTabs.has("engage") && (
              <div style={{ display: tab === "engage" ? "block" : "none" }}>
                <NeighborPage theme={theme} userId={ADM_HISTORY_UID} plan="admin" initialTab="engage" singleTab isActive={tab === "engage"} />
              </div>
            )}
            {visitedAutoTabs.has("reply") && (
              <div style={{ display: tab === "reply" ? "block" : "none" }}>
                <NeighborPage theme={theme} userId={ADM_HISTORY_UID} plan="admin" initialTab="reply" singleTab isActive={tab === "reply"} />
              </div>
            )}
            {visitedAutoTabs.has("pumasi") && (
              <div style={{ display: tab === "pumasi" ? "block" : "none" }}>
                <NeighborPage theme={theme} userId={ADM_HISTORY_UID} plan="admin" initialTab="pumasi" singleTab isActive={tab === "pumasi"} />
              </div>
            )}
            {visitedAutoTabs.has("blogscore") && (
              <div style={{ display: tab === "blogscore" ? "block" : "none" }}>
                <NeighborPage theme={theme} userId={ADM_HISTORY_UID} plan="admin" initialTab="score" singleTab isActive={tab === "blogscore"} />
              </div>
            )}

            {/* ───── 📋 서이추 관리 ───── */}
            {tab === "neighbor_manage" && (
              <div style={{animation:"fadeUp .25s ease both"}}>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16,flexWrap:"wrap",gap:10}}>
                  <div>
                    <div style={{fontSize:20,fontWeight:900,color:"var(--text)"}}>📋 서이추 회원 관리</div>
                    <div style={{fontSize:13,color:"var(--text3)",marginTop:2}}>전체 회원의 서이추 신청 현황</div>
                  </div>
                  <button onClick={()=>{setNeighborLoading(true);getAllNeighborHistory().then(d=>{setNeighborHistory(d);setNeighborLoading(false);});}}
                    style={{padding:"8px 16px",borderRadius:10,border:"1px solid var(--border)",background:"var(--card2)",color:"var(--text2)",cursor:"pointer",fontSize:12,fontWeight:700,fontFamily:"inherit"}}>
                    🔄 새로고침
                  </button>
                </div>

                {/* 요약 카드 */}
                <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(130px,1fr))",gap:10,marginBottom:16}}>
                  {[
                    {label:"전체 신청",value:neighborHistory.length,color:"var(--text)"},
                    {label:"✅ 성공",value:neighborHistory.filter(h=>h.status==="success").length,color:"var(--success)"},
                    {label:"❌ 실패",value:neighborHistory.filter(h=>h.status==="fail").length,color:"var(--danger)"},
                    {label:"⏭️ 스킵",value:neighborHistory.filter(h=>h.status==="skip").length,color:"var(--text3)"},
                  ].map((s,i)=>(
                    <div key={i} style={{padding:"14px 16px",borderRadius:14,background:"var(--card)",border:"1px solid var(--border)",textAlign:"center"}}>
                      <div style={{fontSize:24,fontWeight:900,color:s.color,fontFamily:"'Space Grotesk',sans-serif"}}>{s.value}</div>
                      <div style={{fontSize:11,color:"var(--text3)",marginTop:4,fontWeight:600}}>{s.label}</div>
                    </div>
                  ))}
                </div>

                {/* 검색 + 필터 */}
                <div style={{display:"flex",gap:8,marginBottom:12,flexWrap:"wrap"}}>
                  <input className="inp" placeholder="회원 이름/이메일/블로그ID 검색"
                    value={neighborSearch} onChange={e=>setNeighborSearch(e.target.value)}
                    style={{flex:1,minWidth:200,fontSize:13}} />
                  {(["all","success","fail","skip"] as const).map(f=>(
                    <button key={f} onClick={()=>setNeighborFilter(f)}
                      style={{padding:"8px 14px",borderRadius:9,border:`1.5px solid ${neighborFilter===f?"var(--accent)":"var(--border)"}`,background:neighborFilter===f?"var(--accent-bg)":"transparent",color:neighborFilter===f?"var(--accent-text)":"var(--text2)",cursor:"pointer",fontSize:12,fontWeight:700,fontFamily:"inherit"}}>
                      {f==="all"?"전체":f==="success"?"✅ 성공":f==="fail"?"❌ 실패":"⏭️ 스킵"}
                    </button>
                  ))}
                </div>

                {/* 테이블 */}
                <div className="card" style={{padding:0,overflow:"hidden"}}>
                  {neighborLoading ? (
                    <div style={{padding:"40px",textAlign:"center",color:"var(--text3)"}}>
                      <span className="spinner" style={{marginRight:8}}/>불러오는 중...
                    </div>
                  ) : (()=>{
                    const filtered = neighborHistory
                      .filter(h => neighborFilter === "all" || h.status === neighborFilter)
                      .filter(h => !neighborSearch || 
                        (h.user_name||"").includes(neighborSearch) ||
                        (h.user_email||"").includes(neighborSearch) ||
                        h.target_blog_id.includes(neighborSearch) ||
                        h.keyword.includes(neighborSearch)
                      );
                    return filtered.length === 0 ? (
                      <div style={{padding:"40px",textAlign:"center",color:"var(--text3)",fontSize:14}}>
                        데이터가 없습니다
                      </div>
                    ) : (
                      <div style={{overflowX:"auto",maxHeight:520,overflowY:"auto"}}>
                        <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                          <thead>
                            <tr style={{background:"var(--bg2)",position:"sticky",top:0}}>
                              {["회원","키워드","블로그ID","상태","메시지","일시"].map(h=>(
                                <th key={h} style={{padding:"10px 12px",textAlign:"left",fontWeight:700,color:"var(--text3)",whiteSpace:"nowrap",borderBottom:"1px solid var(--border)"}}>{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {filtered.map((h,i)=>(
                              <tr key={h.id} style={{borderBottom:"1px solid var(--border)"}}
                                onMouseEnter={e=>(e.currentTarget.style.background="var(--card-hover)")}
                                onMouseLeave={e=>(e.currentTarget.style.background="")}>
                                <td style={{padding:"10px 12px",whiteSpace:"nowrap"}}>
                                  <div style={{fontWeight:700,color:"var(--text)",fontSize:12}}>{h.user_name||"-"}</div>
                                  <div style={{fontSize:10,color:"var(--text3)"}}>{h.user_email||"-"}</div>
                                </td>
                                <td style={{padding:"10px 12px",color:"var(--accent-text)",fontWeight:700}}>{h.keyword}</td>
                                <td style={{padding:"10px 12px"}}>
                                  <a href={h.target_url} target="_blank" rel="noreferrer"
                                    style={{color:"var(--info)",textDecoration:"none",fontWeight:600}}>{h.target_blog_id}</a>
                                </td>
                                <td style={{padding:"10px 12px",whiteSpace:"nowrap"}}>
                                  <span style={{fontSize:11,padding:"3px 9px",borderRadius:99,fontWeight:700,
                                    background:h.status==="success"?"rgba(0,214,143,.12)":h.status==="fail"?"rgba(255,83,99,.12)":"rgba(120,120,120,.12)",
                                    color:h.status==="success"?"var(--success)":h.status==="fail"?"var(--danger)":"var(--text3)"}}>
                                    {h.status==="success"?"✅ 성공":h.status==="fail"?"❌ 실패":"⏭️ 스킵"}
                                  </span>
                                </td>
                                <td style={{padding:"10px 12px",color:"var(--text2)",fontSize:11,maxWidth:180,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{h.message||"-"}</td>
                                <td style={{padding:"10px 12px",color:"var(--text3)",whiteSpace:"nowrap",fontSize:11}}>
                                  {new Date(h.created_at).toLocaleString("ko-KR")}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    );
                  })()}
                </div>
              </div>
            )}

            {/* ───── 💬 공감·댓글 관리 ───── */}
            {tab === "engage_manage" && (
              <div style={{animation:"fadeUp .25s ease both"}}>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16,flexWrap:"wrap",gap:10}}>
                  <div>
                    <div style={{fontSize:20,fontWeight:900,color:"var(--text)"}}>💬 공감·댓글 회원 관리</div>
                    <div style={{fontSize:13,color:"var(--text3)",marginTop:2}}>전체 회원의 공감·댓글 작업 현황</div>
                  </div>
                  <button onClick={()=>{setEngageLoading(true);getAllEngageHistory().then(d=>{setEngageHistory(d);setEngageLoading(false);});}}
                    style={{padding:"8px 16px",borderRadius:10,border:"1px solid var(--border)",background:"var(--card2)",color:"var(--text2)",cursor:"pointer",fontSize:12,fontWeight:700,fontFamily:"inherit"}}>
                    🔄 새로고침
                  </button>
                </div>

                {/* 요약 카드 */}
                <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(130px,1fr))",gap:10,marginBottom:16}}>
                  {[
                    {label:"전체 작업",value:engageHistory.length,color:"var(--text)"},
                    {label:"✅ 성공",value:engageHistory.filter(h=>h.status==="success").length,color:"var(--success)"},
                    {label:"❤️ 공감",value:engageHistory.filter(h=>h.liked).length,color:"#ff6b9d"},
                    {label:"💬 댓글",value:engageHistory.filter(h=>h.commented).length,color:"var(--info)"},
                    {label:"❌ 실패",value:engageHistory.filter(h=>h.status==="fail").length,color:"var(--danger)"},
                    {label:"⏭️ 스킵",value:engageHistory.filter(h=>h.status==="skip").length,color:"var(--text3)"},
                  ].map((s,i)=>(
                    <div key={i} style={{padding:"14px 16px",borderRadius:14,background:"var(--card)",border:"1px solid var(--border)",textAlign:"center"}}>
                      <div style={{fontSize:22,fontWeight:900,color:s.color,fontFamily:"'Space Grotesk',sans-serif"}}>{s.value}</div>
                      <div style={{fontSize:11,color:"var(--text3)",marginTop:4,fontWeight:600}}>{s.label}</div>
                    </div>
                  ))}
                </div>

                {/* 검색 + 필터 */}
                <div style={{display:"flex",gap:8,marginBottom:12,flexWrap:"wrap"}}>
                  <input className="inp" placeholder="회원 이름/이메일/블로그ID/키워드 검색"
                    value={engageSearch} onChange={e=>setEngageSearch(e.target.value)}
                    style={{flex:1,minWidth:200,fontSize:13}} />
                  {(["all","success","fail","skip"] as const).map(f=>(
                    <button key={f} onClick={()=>setEngageFilter(f)}
                      style={{padding:"8px 14px",borderRadius:9,border:`1.5px solid ${engageFilter===f?"var(--accent)":"var(--border)"}`,background:engageFilter===f?"var(--accent-bg)":"transparent",color:engageFilter===f?"var(--accent-text)":"var(--text2)",cursor:"pointer",fontSize:12,fontWeight:700,fontFamily:"inherit"}}>
                      {f==="all"?"전체":f==="success"?"✅ 성공":f==="fail"?"❌ 실패":"⏭️ 스킵"}
                    </button>
                  ))}
                </div>

                {/* 테이블 */}
                <div className="card" style={{padding:0,overflow:"hidden"}}>
                  {engageLoading ? (
                    <div style={{padding:"40px",textAlign:"center",color:"var(--text3)"}}>
                      <span className="spinner" style={{marginRight:8}}/>불러오는 중...
                    </div>
                  ) : (()=>{
                    const filtered = engageHistory
                      .filter(h => engageFilter === "all" || h.status === engageFilter)
                      .filter(h => !engageSearch ||
                        (h.user_name||"").includes(engageSearch) ||
                        (h.user_email||"").includes(engageSearch) ||
                        h.target_blog_id.includes(engageSearch) ||
                        h.keyword.includes(engageSearch)
                      );
                    return filtered.length === 0 ? (
                      <div style={{padding:"40px",textAlign:"center",color:"var(--text3)",fontSize:14}}>
                        데이터가 없습니다
                      </div>
                    ) : (
                      <div style={{overflowX:"auto",maxHeight:520,overflowY:"auto"}}>
                        <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                          <thead>
                            <tr style={{background:"var(--bg2)",position:"sticky",top:0}}>
                              {["회원","키워드","블로그ID","공감","댓글","상태","일시"].map(h=>(
                                <th key={h} style={{padding:"10px 12px",textAlign:"left",fontWeight:700,color:"var(--text3)",whiteSpace:"nowrap",borderBottom:"1px solid var(--border)"}}>{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {filtered.map((h,i)=>(
                              <tr key={h.id||i} style={{borderBottom:"1px solid var(--border)"}}
                                onMouseEnter={e=>(e.currentTarget.style.background="var(--card-hover)")}
                                onMouseLeave={e=>(e.currentTarget.style.background="")}>
                                <td style={{padding:"10px 12px",whiteSpace:"nowrap"}}>
                                  <div style={{fontWeight:700,color:"var(--text)",fontSize:12}}>{h.user_name||"-"}</div>
                                  <div style={{fontSize:10,color:"var(--text3)"}}>{h.user_email||"-"}</div>
                                </td>
                                <td style={{padding:"10px 12px",color:"var(--accent-text)",fontWeight:700}}>{h.keyword}</td>
                                <td style={{padding:"10px 12px"}}>
                                  <a href={h.post_url||`https://blog.naver.com/${h.target_blog_id}`} target="_blank" rel="noreferrer"
                                    style={{color:"var(--info)",textDecoration:"none",fontWeight:600}}>{h.target_blog_id}</a>
                                </td>
                                <td style={{padding:"10px 12px",textAlign:"center",fontSize:15}}>{h.liked?"❤️":"—"}</td>
                                <td style={{padding:"10px 12px",textAlign:"center",fontSize:15}}>{h.commented?"💬":"—"}</td>
                                <td style={{padding:"10px 12px",whiteSpace:"nowrap"}}>
                                  <span style={{fontSize:11,padding:"3px 9px",borderRadius:99,fontWeight:700,
                                    background:h.status==="success"?"rgba(0,214,143,.12)":h.status==="fail"?"rgba(255,83,99,.12)":"rgba(120,120,120,.12)",
                                    color:h.status==="success"?"var(--success)":h.status==="fail"?"var(--danger)":"var(--text3)"}}>
                                    {h.status==="success"?"✅ 성공":h.status==="fail"?"❌ 실패":"⏭️ 스킵"}
                                  </span>
                                </td>
                                <td style={{padding:"10px 12px",color:"var(--text3)",whiteSpace:"nowrap",fontSize:11}}>
                                  {new Date(h.created_at).toLocaleString("ko-KR")}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    );
                  })()}
                </div>
              </div>
            )}

            {/* ───── 📱 인스타 DM (관리자 직접 사용) ───── */}
            {/* ⚠️ 인스타 DM 안전 수칙 팝업 */}
            {showInstaWarn&&(
              <div style={{position:"fixed",inset:0,zIndex:9999,background:"rgba(0,0,0,.78)",backdropFilter:"blur(8px)",display:"flex",alignItems:"center",justifyContent:"center",padding:16}} onClick={()=>setShowInstaWarn(false)}>
                <div onClick={e=>e.stopPropagation()} style={{width:"100%",maxWidth:440,background:"var(--card)",border:"1px solid var(--border)",borderRadius:18,overflow:"hidden",boxShadow:"0 20px 60px rgba(0,0,0,.4)"}}>
                  <div style={{padding:"20px 22px",background:"linear-gradient(135deg,#FF6B9D,#C77DFF)",color:"#fff"}}>
                    <div style={{fontSize:18,fontWeight:900,display:"flex",alignItems:"center",gap:8}}>⚠️ 인스타 DM 안전 수칙</div>
                    <div style={{fontSize:12,opacity:.92,marginTop:4}}>계정을 지키려면 꼭 읽어주세요</div>
                  </div>
                  <div style={{padding:"18px 22px",display:"flex",flexDirection:"column",gap:11}}>
                    {[
                      ["🐢","천천히, 소량부터","인스타는 자동 DM을 약관으로 제한하고 봇 탐지가 엄격해요. 처음엔 하루 10~20개로 시작하세요."],
                      ["🌱","계정 워밍업 필수","만든 지 얼마 안 됐거나 활동이 적은 계정은 차단 위험이 큽니다. 평소처럼 게시·소통을 병행하세요."],
                      ["⏱️","발송 간격 충분히","봇이 자동으로 수십 초~분 단위 랜덤 딜레이를 줍니다. 간격을 너무 짧게 바꾸지 마세요."],
                      ["✍️","문구는 조금씩 다르게","똑같은 문구 대량 발송은 스팸으로 분류돼 차단·신고 위험이 커져요."],
                      ["🛑","제한 오면 즉시 중단","'액션 차단'·로그인 경고가 뜨면 바로 멈추고 며칠 쉬세요."],
                    ].map(([ic,t,d],i)=>(
                      <div key={i} style={{display:"flex",gap:11,alignItems:"flex-start"}}>
                        <span style={{fontSize:18,flexShrink:0}}>{ic}</span>
                        <div>
                          <div style={{fontSize:13,fontWeight:800,color:"var(--text)"}}>{t}</div>
                          <div style={{fontSize:12,color:"var(--text3)",lineHeight:1.5,marginTop:1}}>{d}</div>
                        </div>
                      </div>
                    ))}
                    <div style={{fontSize:11,color:"var(--text3)",background:"rgba(255,107,157,.07)",border:"1px solid rgba(255,107,157,.2)",borderRadius:8,padding:"9px 11px",lineHeight:1.5}}>
                      ⓘ 본 기능 사용으로 발생하는 계정 제재의 책임은 사용자에게 있습니다.
                    </div>
                    <label style={{display:"flex",alignItems:"center",gap:8,fontSize:12,color:"var(--text2)",cursor:"pointer",marginTop:2}}>
                      <input type="checkbox" onChange={e=>{if(e.target.checked)localStorage.setItem("insta_dm_warn_hide","1");else localStorage.removeItem("insta_dm_warn_hide");}}/>
                      다시 보지 않기
                    </label>
                    <button onClick={()=>setShowInstaWarn(false)} style={{marginTop:4,padding:"13px",borderRadius:11,border:"none",background:"linear-gradient(135deg,#FF6B9D,#C77DFF)",color:"#fff",fontSize:14,fontWeight:800,fontFamily:"inherit",cursor:"pointer"}}>
                      확인했어요 👍
                    </button>
                  </div>
                </div>
              </div>
            )}

            {tab === "insta_dm" && (
              <div style={{animation:"fadeUp .25s ease both"}}>
                <UsageGuide theme={theme==="dark"?"dark":"light"} subtitle="인스타에서 관심 고객을 찾아 DM을 보내요." steps={[{ico:"📱",title:"인스타 로그인",desc:"인스타 계정으로 로그인해요."},{ico:"🔍",title:"대상 수집",desc:"키워드로 보낼 대상을 모아요."},{ico:"✉️",title:"메시지 발송",desc:"메시지를 적고 천천히 안전하게 보내요."}]} />

                {/* 헤더 */}
                <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",marginBottom:20,flexWrap:"wrap",gap:12}}>
                  <div>
                    <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:6}}>
                      <div style={{width:44,height:44,borderRadius:14,background:"linear-gradient(135deg,#FF6B9D,#C77DFF)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:22,boxShadow:"0 4px 16px rgba(255,107,157,.35)"}}>📱</div>
                      <div>
                        <div style={{fontSize:20,fontWeight:900,color:"var(--text)"}}>인스타그램 DM 발송</div>
                        <div style={{fontSize:12,color:"var(--text3)",marginTop:2}}>키워드·팔로워 기반 타겟 크롤링 → 체험단 DM 자동 발송</div>
                      </div>
                    </div>
                  </div>
                  <button onClick={()=>{setDmLoading(true);getInstaDmTargets(ADM_UID).then(d=>{setDmTargets(d);setDmLoading(false);});}}
                    style={{padding:"8px 16px",borderRadius:10,border:"1px solid var(--border)",background:"var(--card)",color:"var(--text2)",cursor:"pointer",fontSize:12,fontWeight:700,fontFamily:"inherit",display:"flex",alignItems:"center",gap:6}}>
                    🔄 새로고침
                  </button>
                </div>

                {/* 사용 가이드 카드 */}
                <div style={{padding:"16px 20px",borderRadius:16,background:"linear-gradient(135deg,rgba(255,107,157,.08),rgba(199,125,255,.08))",border:"1px solid rgba(255,107,157,.2)",marginBottom:18}}>
                  <div style={{fontSize:13,fontWeight:800,color:"#FF6B9D",marginBottom:10,display:"flex",alignItems:"center",gap:6}}>💡 사용 방법 &amp; 주의사항</div>
                  <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(200px,1fr))",gap:10}}>
                    {[
                      {step:"STEP 1",ico:"🔍",title:"타겟 크롤링",desc:"키워드와 팔로워 범위를 설정해 인스타 계정을 수집해요. 로컬 봇이 실행 중이어야 해요."},
                      {step:"STEP 2",ico:"✍️",title:"DM 문구 작성",desc:"AI로 체험단 모집 문구를 생성하거나 직접 입력해요. 1,000자 이내로 작성하세요."},
                      {step:"STEP 3",ico:"🚀",title:"발송 실행",desc:"하루 계정당 60개 이하 발송. 2~5분 랜덤 간격으로 자동 발송돼요."},
                      {step:"⚠️",ico:"🛡️",title:"안전 규칙",desc:"동일 메시지 반복 금지. 스팸 신고 누적 시 계정 제한될 수 있어요."},
                    ].map((s,i)=>(
                      <div key={i} style={{padding:"12px 14px",borderRadius:12,background:"rgba(255,255,255,.04)",border:"1px solid rgba(255,255,255,.08)"}}>
                        <div style={{fontSize:10,fontWeight:800,color:"rgba(255,107,157,.7)",marginBottom:4,letterSpacing:".05em"}}>{s.step}</div>
                        <div style={{fontSize:13,fontWeight:700,color:"var(--text)",marginBottom:4}}>{s.ico} {s.title}</div>
                        <div style={{fontSize:11,color:"var(--text3)",lineHeight:1.6}}>{s.desc}</div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* 오늘 발송 현황 */}
                <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(110px,1fr))",gap:10,marginBottom:18}}>
                  {[
                    {label:"전체 타겟",value:dmTargets.length,color:"var(--text)"},
                    {label:"⏳ 대기",value:dmTargets.filter(t=>t.status==="pending").length,color:"var(--info)"},
                    {label:"✅ 발송완료",value:dmTargets.filter(t=>t.status==="sent").length,color:"var(--success)"},
                    {label:"❌ 실패",value:dmTargets.filter(t=>t.status==="fail").length,color:"var(--danger)"},
                    {label:"⏭️ 스킵",value:dmTargets.filter(t=>t.status==="skip").length,color:"var(--text3)"},
                  ].map((s,i)=>(
                    <div key={i} style={{padding:"14px 16px",borderRadius:14,background:"var(--card)",border:"1px solid var(--border)",textAlign:"center"}}>
                      <div style={{fontSize:22,fontWeight:900,color:s.color,fontFamily:"'Space Grotesk',sans-serif",lineHeight:1}}>{s.value}</div>
                      <div style={{fontSize:10,color:"var(--text3)",marginTop:5,fontWeight:600}}>{s.label}</div>
                    </div>
                  ))}
                </div>

                {/* 서브탭 */}
                <div style={{display:"flex",gap:4,marginBottom:16,background:"var(--card)",border:"1px solid var(--border)",borderRadius:12,padding:4}}>
                  {([{k:"targets",l:"🎯 타겟 관리"},{k:"history",l:"📨 발송 이력"},{k:"settings",l:"⚙️ 발송 설정"}] as const).map(t=>(
                    <button key={t.k} onClick={()=>{setDmSubTab(t.k);if(t.k==="history")getInstaDmHistory(ADM_UID).then(setDmHistory as any);}}
                      style={{flex:1,padding:"9px",borderRadius:9,border:"none",cursor:"pointer",fontSize:12,fontWeight:700,fontFamily:"inherit",
                        background:dmSubTab===t.k?"linear-gradient(135deg,rgba(255,107,157,.15),rgba(199,125,255,.15))":"transparent",
                        color:dmSubTab===t.k?"#FF6B9D":"var(--text2)",
                        borderBottom:dmSubTab===t.k?"2px solid #FF6B9D":"2px solid transparent",transition:"all .15s"}}>
                      {t.l}
                    </button>
                  ))}
                </div>

                {/* 타겟 관리 */}
                {dmSubTab==="targets" && <>
                  {/* 계정 연결 */}
                  <div className="card" style={{marginBottom:14}}>
                    <div className="card-title" style={{color:"#FF6B9D"}}>🔗 인스타 계정 연결 {dmSessionOk&&<span style={{fontSize:11,color:"var(--success)",fontWeight:700,marginLeft:6}}>● 연결됨</span>}</div>
                    <div style={{fontSize:11,color:"var(--text3)",marginBottom:10}}>발송·크롤링은 로컬 봇(:3335)에서 실행돼요. 연결 시 창이 뜨면 2단계 인증/캡차는 직접 통과시켜 주세요.</div>
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr auto",gap:8,alignItems:"end"}}>
                      <div><label className="inp-label">인스타 아이디</label><input className="inp" placeholder="@내계정" value={dmAccount} onChange={e=>setDmAccount(e.target.value)} onBlur={()=>checkDmSession(dmAccount.trim().replace(/^@/,""))}/></div>
                      <div><label className="inp-label">비밀번호</label><div style={{position:"relative"}}><input className="inp" type={showDmIgPw?"text":"password"} placeholder="비밀번호" value={dmIgPw} onChange={e=>setDmIgPw(e.target.value)} style={{paddingRight:40}}/><button type="button" onClick={()=>setShowDmIgPw(v=>!v)} aria-label="비밀번호 보기" style={{position:"absolute",right:10,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",cursor:"pointer",fontSize:18,color:"var(--text3)"}}>{showDmIgPw?"🙈":"👁️"}</button></div></div>
                      <button onClick={connectIg} disabled={dmConnecting} style={{padding:"11px 18px",borderRadius:10,border:"none",background:dmConnecting?"var(--border)":"linear-gradient(135deg,#FF6B9D,#C77DFF)",color:"#fff",cursor:dmConnecting?"default":"pointer",fontSize:13,fontWeight:800,fontFamily:"inherit",whiteSpace:"nowrap"}}>{dmConnecting?"연결 중...":dmSessionOk?"재연결":"계정 연결"}</button>
                    </div>
                  </div>
                  {/* 타겟 추가 */}
                  <div className="card" style={{marginBottom:14}}>
                    <div className="card-title" style={{color:"#FF6B9D"}}>🔍 타겟 크롤링 설정</div>
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:12}}>
                      <div>
                        <label className="inp-label">키워드 <span style={{color:"var(--text3)",fontSize:11}}>(예: 맛집 체험단, 뷰티 리뷰어)</span></label>
                        <input className="inp" placeholder="키워드를 입력하세요" value={dmKeyword} onChange={e=>setDmKeyword(e.target.value)}/>
                      </div>
                      <div>
                        <label className="inp-label">발송 인스타 계정</label>
                        <input className="inp" placeholder="@계정명" value={dmAccount} onChange={e=>setDmAccount(e.target.value)}/>
                      </div>
                    </div>
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:12}}>
                      <div>
                        <label className="inp-label">팔로워 최소</label>
                        <input className="inp" type="number" placeholder="500" value={dmFollowerMin} onChange={e=>setDmFollowerMin(e.target.value)}/>
                      </div>
                      <div>
                        <label className="inp-label">팔로워 최대</label>
                        <input className="inp" type="number" placeholder="50000" value={dmFollowerMax} onChange={e=>setDmFollowerMax(e.target.value)}/>
                      </div>
                    </div>
                    <button onClick={crawlIg} disabled={dmRunning} style={{padding:"11px 20px",borderRadius:10,border:"none",background:dmRunning?"var(--border)":"linear-gradient(135deg,#FF6B9D,#C77DFF)",color:"#fff",cursor:dmRunning?"default":"pointer",fontSize:13,fontWeight:800,fontFamily:"inherit",display:"flex",alignItems:"center",gap:8,boxShadow:"0 4px 16px rgba(255,107,157,.3)"}}>
                      {dmRunning?"수집 중...":<>✨ 크롤링 시작</>}
                    </button>
                  </div>

                  {/* 발송 실행 + 실시간 로그 */}
                  <div className="card" style={{marginBottom:14}}>
                    <div className="card-title" style={{color:"#FF6B9D"}}>🚀 DM 발송 실행</div>
                    <div style={{fontSize:11,color:"var(--text3)",marginBottom:10}}>'대기중' 타겟 {dmTargets.filter(t=>t.status==="pending").length}개에게 아래 'DM 문구'로 발송해요. 간격은 봇이 자동 랜덤(40~90초) 적용합니다.</div>
                    <div style={{display:"flex",gap:8,marginBottom:dmLogs.length?12:0}}>
                      {!dmRunning ? (
                        <button onClick={sendIg} style={{flex:1,padding:"13px",borderRadius:11,border:"none",background:"linear-gradient(135deg,#FF6B9D,#C77DFF)",color:"#fff",cursor:"pointer",fontSize:14,fontWeight:800,fontFamily:"inherit"}}>🚀 발송 시작</button>
                      ) : (
                        <button onClick={stopDm} style={{flex:1,padding:"13px",borderRadius:11,border:"1px solid var(--danger)",background:"rgba(248,81,73,.08)",color:"var(--danger)",cursor:"pointer",fontSize:14,fontWeight:800,fontFamily:"inherit"}}>⏹️ 중단</button>
                      )}
                    </div>
                    {dmLogs.length>0&&(
                      <div ref={dmLogRef} onScroll={()=>{const el=dmLogRef.current; if(el) dmStick.current=el.scrollHeight-el.scrollTop-el.clientHeight<48;}} style={{background:"var(--bg)",border:"1px solid var(--border)",borderRadius:10,padding:"10px 12px",maxHeight:220,overflowY:"auto",fontSize:11.5,fontFamily:"monospace",lineHeight:1.7,color:"var(--text2)"}}>
                        {dmLogs.map((l,i)=>(<div key={i}>{l}</div>))}
                      </div>
                    )}
                  </div>

                  {/* 직접 추가 */}
                  <div className="card" style={{marginBottom:14}}>
                    <div className="card-title">📝 직접 계정 추가</div>
                    <div style={{display:"flex",gap:8}}>
                      <input className="inp" style={{flex:1}} placeholder="@계정명 (쉼표 또는 줄바꿈으로 여러 개 입력)" value={dmTargetInput} onChange={e=>setDmTargetInput(e.target.value)}/>
                      <button onClick={async()=>{
                        const list=dmTargetInput.split(/[,\n]/).map(s=>s.trim().replace(/^@/,"")).filter(Boolean);
                        for(const u of list){
                          await addInstaDmTarget({user_id:ADM_UID,username:u,followers:0,bio:"",keywords:dmKeyword,status:"pending",instagram_account:dmAccount});
                        }
                        setDmTargetInput("");
                        getInstaDmTargets(ADM_UID).then(setDmTargets);
                      }} style={{padding:"11px 18px",borderRadius:10,border:"none",background:"var(--accent)",color:"#000",cursor:"pointer",fontSize:13,fontWeight:800,fontFamily:"inherit",whiteSpace:"nowrap"}}>
                        ➕ 추가
                      </button>
                    </div>
                  </div>

                  {/* 필터 + 목록 */}
                  <div style={{display:"flex",gap:8,marginBottom:10,flexWrap:"wrap"}}>
                    <input className="inp" style={{flex:1,minWidth:160,fontSize:12}} placeholder="🔍 계정명 검색" value={dmSearch} onChange={e=>setDmSearch(e.target.value)}/>
                    {(["all","pending","sent","fail","skip"] as const).map(f=>(
                      <button key={f} onClick={()=>setDmFilter(f)}
                        style={{padding:"8px 13px",borderRadius:9,border:`1.5px solid ${dmFilter===f?"#FF6B9D":"var(--border)"}`,background:dmFilter===f?"rgba(255,107,157,.1)":"transparent",color:dmFilter===f?"#FF6B9D":"var(--text2)",cursor:"pointer",fontSize:11,fontWeight:700,fontFamily:"inherit"}}>
                        {f==="all"?"전체":f==="pending"?"⏳ 대기":f==="sent"?"✅ 발송":f==="fail"?"❌ 실패":"⏭️ 스킵"}
                      </button>
                    ))}
                  </div>

                  <div className="card" style={{padding:0,overflow:"hidden"}}>
                    {dmLoading ? (
                      <div style={{padding:40,textAlign:"center",color:"var(--text3)"}}><span className="spinner" style={{marginRight:8}}/>불러오는 중...</div>
                    ) : (()=>{
                      const filtered = dmTargets
                        .filter(t=>dmFilter==="all"||t.status===dmFilter)
                        .filter(t=>!dmSearch||t.username.includes(dmSearch));
                      return filtered.length===0 ? (
                        <div style={{padding:40,textAlign:"center",color:"var(--text3)",fontSize:14}}>
                          <div style={{fontSize:32,marginBottom:8}}>🎯</div>
                          타겟이 없어요. 크롤링하거나 직접 추가해주세요.
                        </div>
                      ) : (
                        <div style={{overflowX:"auto",maxHeight:480,overflowY:"auto"}}>
                          <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                            <thead>
                              <tr style={{background:"var(--bg2)",position:"sticky",top:0}}>
                                {["계정","팔로워","키워드","상태","발송계정","삭제"].map(h=>(
                                  <th key={h} style={{padding:"10px 12px",textAlign:"left",fontWeight:700,color:"var(--text3)",whiteSpace:"nowrap",borderBottom:"1px solid var(--border)"}}>{h}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {filtered.map(t=>(
                                <tr key={t.id} style={{borderBottom:"1px solid var(--border)"}}
                                  onMouseEnter={e=>(e.currentTarget.style.background="var(--card-hover)")}
                                  onMouseLeave={e=>(e.currentTarget.style.background="")}>
                                  <td style={{padding:"10px 12px"}}>
                                    <a href={`https://instagram.com/${t.username}`} target="_blank" rel="noreferrer"
                                      style={{color:"#FF6B9D",fontWeight:700,textDecoration:"none"}}>@{t.username}</a>
                                  </td>
                                  <td style={{padding:"10px 12px",color:"var(--text2)"}}>{t.followers>0?t.followers.toLocaleString():"-"}</td>
                                  <td style={{padding:"10px 12px",color:"var(--accent-text)",fontWeight:600}}>{t.keywords||"-"}</td>
                                  <td style={{padding:"10px 12px"}}>
                                    <span style={{fontSize:11,padding:"3px 9px",borderRadius:99,fontWeight:700,
                                      background:t.status==="sent"?"rgba(0,214,143,.12)":t.status==="fail"?"rgba(255,83,99,.12)":t.status==="pending"?"rgba(88,166,255,.12)":"rgba(120,120,120,.12)",
                                      color:t.status==="sent"?"var(--success)":t.status==="fail"?"var(--danger)":t.status==="pending"?"var(--info)":"var(--text3)"}}>
                                      {t.status==="sent"?"✅ 발송":t.status==="fail"?"❌ 실패":t.status==="pending"?"⏳ 대기":"⏭️ 스킵"}
                                    </span>
                                  </td>
                                  <td style={{padding:"10px 12px",color:"var(--text3)",fontSize:11}}>{t.instagram_account||"-"}</td>
                                  <td style={{padding:"10px 12px"}}>
                                    <button onClick={async()=>{await deleteInstaDmTarget(t.id);setDmTargets(p=>p.filter(x=>x.id!==t.id));}}
                                      style={{padding:"4px 10px",borderRadius:7,border:"1px solid rgba(248,81,73,.3)",background:"rgba(248,81,73,.08)",color:"var(--danger)",cursor:"pointer",fontSize:11,fontWeight:700,fontFamily:"inherit"}}>삭제</button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      );
                    })()}
                  </div>
                </>}

                {/* 발송 이력 */}
                {dmSubTab==="history" && <>
                  <div className="card" style={{padding:0,overflow:"hidden"}}>
                    <div style={{padding:"14px 16px",borderBottom:"1px solid var(--border)",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                      <div style={{fontWeight:800,fontSize:13}}>📨 발송 이력</div>
                      <span style={{fontSize:12,color:"var(--text3)"}}>{dmHistory.length}건</span>
                    </div>
                    {dmHistory.length===0 ? (
                      <div style={{padding:40,textAlign:"center",color:"var(--text3)"}}>발송 이력이 없어요</div>
                    ) : (
                      <div style={{overflowX:"auto",maxHeight:520,overflowY:"auto"}}>
                        <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                          <thead>
                            <tr style={{background:"var(--bg2)",position:"sticky",top:0}}>
                              {["수신 계정","발송 계정","메시지","상태","일시"].map(h=>(
                                <th key={h} style={{padding:"10px 12px",textAlign:"left",fontWeight:700,color:"var(--text3)",borderBottom:"1px solid var(--border)"}}>{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {dmHistory.map(h=>(
                              <tr key={h.id} style={{borderBottom:"1px solid var(--border)"}}
                                onMouseEnter={e=>(e.currentTarget.style.background="var(--card-hover)")}
                                onMouseLeave={e=>(e.currentTarget.style.background="")}>
                                <td style={{padding:"10px 12px"}}>
                                  <a href={`https://instagram.com/${h.target_username}`} target="_blank" rel="noreferrer"
                                    style={{color:"#FF6B9D",fontWeight:700,textDecoration:"none"}}>@{h.target_username}</a>
                                </td>
                                <td style={{padding:"10px 12px",color:"var(--text2)",fontSize:11}}>{h.instagram_account||"-"}</td>
                                <td style={{padding:"10px 12px",color:"var(--text2)",maxWidth:200,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{h.message}</td>
                                <td style={{padding:"10px 12px"}}>
                                  <span style={{fontSize:11,padding:"3px 9px",borderRadius:99,fontWeight:700,
                                    background:h.status==="sent"?"rgba(0,214,143,.12)":"rgba(255,83,99,.12)",
                                    color:h.status==="sent"?"var(--success)":"var(--danger)"}}>
                                    {h.status==="sent"?"✅ 발송":"❌ 실패"}
                                  </span>
                                </td>
                                <td style={{padding:"10px 12px",color:"var(--text3)",fontSize:11,whiteSpace:"nowrap"}}>{new Date(h.created_at).toLocaleString("ko-KR")}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </>}

                {/* 발송 설정 */}
                {dmSubTab==="settings" && <>
                  <div className="card" style={{marginBottom:14}}>
                    <div className="card-title" style={{color:"#FF6B9D"}}>⚙️ DM 발송 설정</div>
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
                      <div style={{padding:"16px",borderRadius:12,background:"var(--bg)",border:"1px solid var(--border)"}}>
                        <div style={{fontSize:12,fontWeight:800,color:"var(--text2)",marginBottom:8}}>⏱️ 발송 간격</div>
                        <div style={{fontSize:13,color:"var(--text)",marginBottom:4}}>최소 <b style={{color:"var(--accent)"}}>2분</b> ~ 최대 <b style={{color:"var(--accent)"}}>5분</b> 랜덤</div>
                        <div style={{fontSize:11,color:"var(--text3)"}}>일정 간격은 봇 탐지 위험. 랜덤 딜레이로 자연스러운 발송.</div>
                      </div>
                      <div style={{padding:"16px",borderRadius:12,background:"var(--bg)",border:"1px solid var(--border)"}}>
                        <div style={{fontSize:12,fontWeight:800,color:"var(--text2)",marginBottom:8}}>📊 하루 한도</div>
                        <div style={{fontSize:13,color:"var(--text)",marginBottom:4}}>계정당 최대 <b style={{color:"#FF6B9D"}}>60개</b>/일</div>
                        <div style={{fontSize:11,color:"var(--text3)"}}>오래된 계정 기준. 신규 계정은 20~30개 권장.</div>
                      </div>
                      <div style={{padding:"16px",borderRadius:12,background:"var(--bg)",border:"1px solid var(--border)"}}>
                        <div style={{fontSize:12,fontWeight:800,color:"var(--text2)",marginBottom:8}}>🔐 DM 문구 원칙</div>
                        <div style={{fontSize:11,color:"var(--text3)",lineHeight:1.7}}>
                          ✅ 첫 메시지에 링크 포함 금지<br/>
                          ✅ 1,000자 이내 작성<br/>
                          ✅ 스팸성 표현 지양<br/>
                          ✅ 개인화된 느낌 유지
                        </div>
                      </div>
                      <div style={{padding:"16px",borderRadius:12,background:"rgba(248,81,73,.06)",border:"1px solid rgba(248,81,73,.2)"}}>
                        <div style={{fontSize:12,fontWeight:800,color:"var(--danger)",marginBottom:8}}>⚠️ 주의사항</div>
                        <div style={{fontSize:11,color:"var(--text3)",lineHeight:1.7}}>
                          ❌ 동일 메시지 대량 발송 금지<br/>
                          ❌ 신고 누적 시 계정 정지<br/>
                          ❌ 로컬 PC에서만 실행<br/>
                          ❌ VPN 사용 비권장
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="card">
                    <div className="card-title">✍️ DM 문구 템플릿</div>
                    <div style={{marginBottom:8}}>
                      <label className="inp-label">발송할 DM 메시지 <span style={{color:"var(--text3)",fontSize:11}}>({dmMessage.length}/1000자)</span></label>
                      <textarea className="inp" rows={6} placeholder={"안녕하세요! 저는 [브랜드명]의 [담당자명]이에요 😊\n\n○○님의 콘텐츠를 보고 연락드렸어요.\n저희 제품 체험단 기회를 드리고 싶어서요!\n\n무료로 제품 보내드리고 솔직한 리뷰만 부탁드려요.\n관심 있으시면 답장 주세요 🙏"}
                        value={dmMessage} onChange={e=>{if(e.target.value.length<=1000)setDmMessage(e.target.value);}}
                        style={{resize:"vertical",fontFamily:"inherit"}}/>
                    </div>
                    <div style={{display:"flex",gap:8}}>
                      <button onClick={async()=>{
                        const key=localStorage.getItem("publy_adm_gemini_key")||"";
                        if(!key){alert("설정탭에서 Gemini API 키를 먼저 입력해주세요");return;}
                        const r=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${key}`,
                          {method:"POST",headers:{"Content-Type":"application/json"},
                           body:JSON.stringify({contents:[{parts:[{text:`인스타그램 체험단 모집 DM을 작성해줘. 제품 키워드: "${dmKeyword||"뷰티/식품"}". 조건: 1000자 이내, 링크 미포함, 친근한 말투, 자연스럽게, 브랜드명은 [브랜드명]으로 표시. DM 내용만 출력.`}]}],generationConfig:{maxOutputTokens:500}})});
                        const d=await r.json();
                        const text=d.candidates?.[0]?.content?.parts?.[0]?.text||"";
                        if(text)setDmMessage(text.slice(0,1000));
                      }} style={{padding:"10px 18px",borderRadius:9,border:"none",background:"linear-gradient(135deg,#4285F4,#0F9D58)",color:"#fff",cursor:"pointer",fontSize:12,fontWeight:800,fontFamily:"inherit",display:"flex",alignItems:"center",gap:6}}>
                        ✨ AI 문구 생성
                      </button>
                      <button onClick={()=>setDmMessage("")}
                        style={{padding:"10px 14px",borderRadius:9,border:"1px solid var(--border)",background:"transparent",color:"var(--text2)",cursor:"pointer",fontSize:12,fontWeight:700,fontFamily:"inherit"}}>
                        초기화
                      </button>
                    </div>
                  </div>
                </>}
              </div>
            )}

            {/* ───── 📊 DM 회원관리 ───── */}
            {tab === "insta_dm_manage" && (
              <div style={{animation:"fadeUp .25s ease both"}}>

                <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",marginBottom:20,flexWrap:"wrap",gap:12}}>
                  <div>
                    <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:6}}>
                      <div style={{width:44,height:44,borderRadius:14,background:"linear-gradient(135deg,#C77DFF,#FF6B9D)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:22,boxShadow:"0 4px 16px rgba(199,125,255,.35)"}}>📊</div>
                      <div>
                        <div style={{fontSize:20,fontWeight:900,color:"var(--text)"}}>DM 회원 관리</div>
                        <div style={{fontSize:12,color:"var(--text3)",marginTop:2}}>회원별 인스타 DM 한도 설정 및 사용량 관리</div>
                      </div>
                    </div>
                  </div>
                  <button onClick={()=>{setDmManageLoading(true);Promise.all([getAllInstaDmHistory(),getAllInstaDmQuotas()]).then(([h,q])=>{setDmHistory(h);setDmQuotas(q);setDmManageLoading(false);});}}
                    style={{padding:"8px 16px",borderRadius:10,border:"1px solid var(--border)",background:"var(--card)",color:"var(--text2)",cursor:"pointer",fontSize:12,fontWeight:700,fontFamily:"inherit",display:"flex",alignItems:"center",gap:6}}>
                    🔄 새로고침
                  </button>
                </div>

                {/* 기능 설명 */}
                <div style={{padding:"14px 18px",borderRadius:14,background:"linear-gradient(135deg,rgba(199,125,255,.08),rgba(255,107,157,.08))",border:"1px solid rgba(199,125,255,.2)",marginBottom:18}}>
                  <div style={{fontSize:12,fontWeight:800,color:"#C77DFF",marginBottom:8}}>📋 관리자 기능 안내</div>
                  <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))",gap:8}}>
                    {[
                      {ico:"🔢",txt:"회원별 하루 DM 발송 한도를 개별 조정할 수 있어요"},
                      {ico:"🔛",txt:"회원의 DM 기능을 켜고 끌 수 있어요 (플랜과 무관)"},
                      {ico:"📈",txt:"오늘 사용량과 누적 발송 이력을 실시간으로 확인해요"},
                      {ico:"🗂️",txt:"전체 회원의 DM 발송 이력을 통합 조회할 수 있어요"},
                    ].map((item,i)=>(
                      <div key={i} style={{display:"flex",gap:8,alignItems:"flex-start",padding:"8px 10px",borderRadius:10,background:"rgba(255,255,255,.04)"}}>
                        <span style={{fontSize:16,flexShrink:0}}>{item.ico}</span>
                        <span style={{fontSize:11,color:"var(--text2)",lineHeight:1.6}}>{item.txt}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* 서브탭 */}
                <div style={{display:"flex",gap:4,marginBottom:16,background:"var(--card)",border:"1px solid var(--border)",borderRadius:12,padding:4}}>
                  {([{k:"quotas",l:"🔢 한도 관리"},{k:"history",l:"📨 전체 발송 이력"}] as const).map(t=>(
                    <button key={t.k} onClick={()=>setDmManageSubTab(t.k)}
                      style={{flex:1,padding:"9px",borderRadius:9,border:"none",cursor:"pointer",fontSize:12,fontWeight:700,fontFamily:"inherit",
                        background:dmManageSubTab===t.k?"linear-gradient(135deg,rgba(199,125,255,.15),rgba(255,107,157,.15))":"transparent",
                        color:dmManageSubTab===t.k?"#C77DFF":"var(--text2)",
                        borderBottom:dmManageSubTab===t.k?"2px solid #C77DFF":"2px solid transparent",transition:"all .15s"}}>
                      {t.l}
                    </button>
                  ))}
                </div>

                {/* 한도 관리 */}
                {dmManageSubTab==="quotas" && <>
                  {dmManageLoading ? (
                    <div style={{padding:40,textAlign:"center",color:"var(--text3)"}}><span className="spinner" style={{marginRight:8}}/>불러오는 중...</div>
                  ) : dmQuotas.length===0 ? (
                    <div className="card">
                      <div style={{padding:40,textAlign:"center",color:"var(--text3)"}}>
                        <div style={{fontSize:32,marginBottom:8}}>📊</div>
                        DM을 사용한 회원이 없어요
                      </div>
                    </div>
                  ) : (
                    <div className="card" style={{padding:0,overflow:"hidden"}}>
                      <div style={{overflowX:"auto"}}>
                        <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                          <thead>
                            <tr style={{background:"var(--bg2)"}}>
                              {["회원","플랜","오늘 사용","하루 한도","활성화","한도 조정"].map(h=>(
                                <th key={h} style={{padding:"11px 14px",textAlign:"left",fontWeight:700,color:"var(--text3)",borderBottom:"1px solid var(--border)",whiteSpace:"nowrap"}}>{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {dmQuotas.map(q=>(
                              <tr key={q.id} style={{borderBottom:"1px solid var(--border)"}}
                                onMouseEnter={e=>(e.currentTarget.style.background="var(--card-hover)")}
                                onMouseLeave={e=>(e.currentTarget.style.background="")}>
                                <td style={{padding:"11px 14px"}}>
                                  <div style={{fontWeight:700,color:"var(--text)"}}>{q.user_name||"-"}</div>
                                  <div style={{fontSize:10,color:"var(--text3)"}}>{q.user_email||"-"}</div>
                                </td>
                                <td style={{padding:"11px 14px"}}>
                                  <span style={{fontSize:11,padding:"3px 9px",borderRadius:99,fontWeight:700,
                                    background:q.plan==="pro"?"rgba(0,255,136,.1)":q.plan==="basic"?"rgba(88,166,255,.1)":"rgba(120,120,120,.1)",
                                    color:q.plan==="pro"?"var(--accent)":q.plan==="basic"?"var(--info)":"var(--text3)"}}>
                                    {(q.plan||"free").toUpperCase()}
                                  </span>
                                </td>
                                <td style={{padding:"11px 14px"}}>
                                  <div style={{display:"flex",alignItems:"center",gap:6}}>
                                    <div style={{flex:1,height:6,borderRadius:99,background:"var(--border)",maxWidth:80}}>
                                      <div style={{height:"100%",borderRadius:99,background:q.used_today>=(q.daily_limit*.8)?"var(--danger)":"#FF6B9D",width:`${Math.min(100,(q.used_today/Math.max(1,q.daily_limit))*100)}%`,transition:"width .3s"}}/>
                                    </div>
                                    <span style={{fontSize:12,fontWeight:700,color:"var(--text)"}}>{q.used_today}/{q.daily_limit}</span>
                                  </div>
                                </td>
                                <td style={{padding:"11px 14px",fontWeight:700,color:"var(--text)"}}>{q.daily_limit}개/일</td>
                                <td style={{padding:"11px 14px"}}>
                                  <button onClick={async()=>{await upsertInstaDmQuota(q.user_id,{is_enabled:!q.is_enabled});setDmQuotas(p=>p.map(x=>x.id===q.id?{...x,is_enabled:!x.is_enabled}:x));}}
                                    style={{padding:"5px 12px",borderRadius:99,border:"none",cursor:"pointer",fontSize:11,fontWeight:800,fontFamily:"inherit",
                                      background:q.is_enabled?"rgba(0,255,136,.1)":"rgba(120,120,120,.1)",
                                      color:q.is_enabled?"var(--success)":"var(--text3)"}}>
                                    {q.is_enabled?"🟢 활성":"⚫ 비활성"}
                                  </button>
                                </td>
                                <td style={{padding:"11px 14px"}}>
                                  <div style={{display:"flex",gap:6,alignItems:"center"}}>
                                    {[10,30,60,100].map(n=>(
                                      <button key={n} onClick={async()=>{await upsertInstaDmQuota(q.user_id,{daily_limit:n});setDmQuotas(p=>p.map(x=>x.id===q.id?{...x,daily_limit:n}:x));}}
                                        style={{padding:"4px 10px",borderRadius:7,border:`1.5px solid ${q.daily_limit===n?"#FF6B9D":"var(--border)"}`,background:q.daily_limit===n?"rgba(255,107,157,.12)":"transparent",color:q.daily_limit===n?"#FF6B9D":"var(--text3)",cursor:"pointer",fontSize:11,fontWeight:700,fontFamily:"inherit"}}>
                                        {n}
                                      </button>
                                    ))}
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </>}

                {/* 전체 발송 이력 */}
                {dmManageSubTab==="history" && <>
                  <div className="card" style={{padding:0,overflow:"hidden"}}>
                    <div style={{padding:"14px 16px",borderBottom:"1px solid var(--border)",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                      <div style={{fontWeight:800,fontSize:13}}>📨 전체 발송 이력</div>
                      <span style={{fontSize:12,color:"var(--text3)"}}>{dmHistory.length}건</span>
                    </div>
                    {dmManageLoading ? (
                      <div style={{padding:40,textAlign:"center",color:"var(--text3)"}}><span className="spinner" style={{marginRight:8}}/>불러오는 중...</div>
                    ) : dmHistory.length===0 ? (
                      <div style={{padding:40,textAlign:"center",color:"var(--text3)"}}>발송 이력이 없어요</div>
                    ) : (
                      <div style={{overflowX:"auto",maxHeight:520,overflowY:"auto"}}>
                        <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                          <thead>
                            <tr style={{background:"var(--bg2)",position:"sticky",top:0}}>
                              {["회원","수신 계정","발송 계정","메시지","상태","일시"].map(h=>(
                                <th key={h} style={{padding:"10px 12px",textAlign:"left",fontWeight:700,color:"var(--text3)",borderBottom:"1px solid var(--border)",whiteSpace:"nowrap"}}>{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {dmHistory.map(h=>(
                              <tr key={h.id} style={{borderBottom:"1px solid var(--border)"}}
                                onMouseEnter={e=>(e.currentTarget.style.background="var(--card-hover)")}
                                onMouseLeave={e=>(e.currentTarget.style.background="")}>
                                <td style={{padding:"10px 12px"}}>
                                  <div style={{fontWeight:700,fontSize:12}}>{h.user_name||"-"}</div>
                                  <div style={{fontSize:10,color:"var(--text3)"}}>{h.user_email||"-"}</div>
                                </td>
                                <td style={{padding:"10px 12px"}}>
                                  <a href={`https://instagram.com/${h.target_username}`} target="_blank" rel="noreferrer"
                                    style={{color:"#FF6B9D",fontWeight:700,textDecoration:"none"}}>@{h.target_username}</a>
                                </td>
                                <td style={{padding:"10px 12px",color:"var(--text2)",fontSize:11}}>{h.instagram_account||"-"}</td>
                                <td style={{padding:"10px 12px",color:"var(--text2)",maxWidth:160,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{h.message}</td>
                                <td style={{padding:"10px 12px"}}>
                                  <span style={{fontSize:11,padding:"3px 9px",borderRadius:99,fontWeight:700,
                                    background:h.status==="sent"?"rgba(0,214,143,.12)":"rgba(255,83,99,.12)",
                                    color:h.status==="sent"?"var(--success)":"var(--danger)"}}>
                                    {h.status==="sent"?"✅ 발송":"❌ 실패"}
                                  </span>
                                </td>
                                <td style={{padding:"10px 12px",color:"var(--text3)",fontSize:11,whiteSpace:"nowrap"}}>{new Date(h.created_at).toLocaleString("ko-KR")}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </>}
              </div>
            )}

            {/* ───── 🔐 설정 ───── */}
            {tab === "proxy" && (() => {
              const inputStyle: React.CSSProperties = {padding:"10px 12px",borderRadius:8,border:"1px solid var(--border)",background:"var(--bg)",color:"var(--text)",fontSize:14,fontFamily:"inherit",outline:"none"};
              const statBox: React.CSSProperties = {background:"var(--card)",border:"1px solid var(--border)",borderRadius:10,padding:"10px 16px",fontSize:13,color:"var(--text2)"};
              const totalAssigned = Object.values(proxyAssign).reduce((a,b)=>a+b.length,0);
              return (
              <div style={{maxWidth:920}}>
                <h2 style={{fontSize:20,fontWeight:800,margin:"0 0 4px"}}>🌐 프록시 IP 관리</h2>
                <p style={{color:"var(--text2)",fontSize:13,margin:"0 0 16px",lineHeight:1.6}}>계정이 많으면 같은 IP로 나가 네이버가 한 사람으로 묶어 차단해요. IP(프록시)를 등록하고 계정을 배정하면, 그 계정은 <b>항상 이 IP로만</b> 접속합니다. 배정 안 된 계정은 지금처럼 내 IP로 접속해요(안전).</p>

                <div style={{background:"var(--card)",border:"1px solid var(--border)",borderRadius:12,padding:14,marginBottom:16,fontSize:13,lineHeight:1.8,color:"var(--text2)"}}>
                  💡 업체에서 받은 IP 정보 <b style={{color:"var(--text)"}}>(주소:포트 · 아이디 · 비밀번호)</b>를 아래에 등록하세요. 한 IP에 여러 계정을 묶을 수 있어요(예: IP 1개에 계정 3개). <b style={{color:"var(--text)"}}>🔍 검사</b>로 실제로 잘 나가는지(나가는 IP·속도) 확인해요.
                </div>

                <div style={{display:"flex",gap:12,marginBottom:16,flexWrap:"wrap"}}>
                  <div style={statBox}>등록된 IP <b style={{color:"var(--text)"}}>{proxies.length}</b>개</div>
                  <div style={statBox}>배정된 계정 <b style={{color:"var(--text)"}}>{totalAssigned}</b>개</div>
                  <div style={statBox}>정상 <b style={{color:"var(--success)"}}>{proxies.filter(p=>p.last_ok===true).length}</b> · 실패 <b style={{color:"var(--danger)"}}>{proxies.filter(p=>p.last_ok===false).length}</b></div>
                </div>

                {/* 🌐 프록시 사용량 실시간 대시보드 (B: 접속 카운트 + A: DataImpulse 실잔량) */}
                <div style={{background:"var(--card)",border:"1px solid var(--border)",borderRadius:12,padding:16,marginBottom:16}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12,flexWrap:"wrap",gap:8}}>
                    <span style={{fontSize:15,fontWeight:800}}>📊 프록시 사용량</span>
                    <button onClick={loadProxyUsage} style={{padding:"6px 12px",borderRadius:8,border:"1px solid var(--border)",background:"var(--bg)",color:"var(--text2)",fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>↻ 새로고침</button>
                  </div>
                  <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))",gap:12}}>
                    <div style={{background:"var(--bg)",border:"1px solid var(--border)",borderRadius:10,padding:"12px 14px"}}>
                      <div style={{fontSize:12,color:"var(--text2)",fontWeight:700,marginBottom:4}}>오늘 접속</div>
                      <div style={{fontSize:24,fontWeight:900,color:"var(--accent-text,#2563eb)"}}>{proxyUsageToday.toLocaleString()}<span style={{fontSize:13,color:"var(--text2)",fontWeight:600}}> 회</span></div>
                    </div>
                    <div style={{background:"var(--bg)",border:"1px solid var(--border)",borderRadius:10,padding:"12px 14px"}}>
                      <div style={{fontSize:12,color:"var(--text2)",fontWeight:700,marginBottom:4}}>최근 7일</div>
                      <div style={{fontSize:24,fontWeight:900}}>{proxyUsageHist.reduce((s,d)=>s+d.count,0).toLocaleString()}<span style={{fontSize:13,color:"var(--text2)",fontWeight:600}}> 회</span></div>
                    </div>
                    <div style={{background:"var(--bg)",border:"1px solid var(--border)",borderRadius:10,padding:"12px 14px"}}>
                      <div style={{fontSize:12,color:"var(--text2)",fontWeight:700,marginBottom:4}}>💰 남은 잔액(DataImpulse)</div>
                      <div style={{fontSize:20,fontWeight:900,color:"var(--success)"}}>{diBalance?.balance!=null?`$${diBalance.balance}`:(diToken?"조회 중…":"토큰 미등록")}</div>
                      {diBalance?.traffic_left_gb!=null && <div style={{fontSize:12,color:"var(--text2)",fontWeight:600,marginTop:2}}>트래픽 {diBalance.traffic_left_gb}GB 남음</div>}
                    </div>
                  </div>
                  {/* 7일 미니 막대 그래프 */}
                  <div style={{display:"flex",alignItems:"flex-end",gap:4,height:44,marginTop:14}}>
                    {(()=>{ const mx=Math.max(1,...proxyUsageHist.map(d=>d.count)); return proxyUsageHist.map((d,i)=>(
                      <div key={i} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:3}}>
                        <div title={`${d.label}: ${d.count}회`} style={{width:"100%",height:`${Math.max(3,(d.count/mx)*34)}px`,background:"linear-gradient(180deg,#3b82f6,#22d3ee)",borderRadius:3}} />
                        <span style={{fontSize:9,color:"var(--text3)"}}>{d.label}</span>
                      </div>
                    )); })()}
                  </div>
                  {/* DataImpulse 토큰 입력(A 활성화) */}
                  <div style={{display:"flex",gap:8,marginTop:14,flexWrap:"wrap",alignItems:"center"}}>
                    <input value={diToken} onChange={e=>setDiToken(e.target.value)} placeholder="DataImpulse API 토큰(붙여넣으면 실잔액 표시)" style={{...inputStyle,flex:1,minWidth:220}} />
                    <button onClick={async()=>{ await saveDataImpulseToken(diToken); const b=await fetchDataImpulseBalance(); setDiBalance(b); showToast(b?"실잔액을 불러왔어요":"토큰 저장됨(응답 확인 필요)", b?"success":"info"); }} style={{padding:"10px 16px",borderRadius:8,border:"none",background:"var(--accent,#2563eb)",color:"#fff",fontSize:13,fontWeight:800,cursor:"pointer",fontFamily:"inherit"}}>저장·조회</button>
                  </div>
                  <p style={{fontSize:11,color:"var(--text3)",margin:"8px 0 0",lineHeight:1.5}}>※ '오늘 접속'은 봇이 프록시로 나간 횟수예요. '남은 잔액'은 DataImpulse 대시보드에서 API 토큰을 발급해 넣으면 실시간으로 보여요.</p>
                </div>

                <div style={{background:"var(--card)",border:"1px solid var(--border)",borderRadius:12,padding:16,marginBottom:20}}>
                  <div style={{fontWeight:700,marginBottom:10}}>＋ 새 IP 등록</div>
                  <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))",gap:10}}>
                    <input placeholder="별칭 (선택, 예: IP-1)" value={newProxy.label} onChange={e=>setNewProxy({...newProxy,label:e.target.value})} style={inputStyle}/>
                    <input placeholder="주소:포트 (예: 1.2.3.4:8000)" value={newProxy.server} onChange={e=>setNewProxy({...newProxy,server:e.target.value})} style={inputStyle}/>
                    <input placeholder="아이디 (선택)" value={newProxy.username} onChange={e=>setNewProxy({...newProxy,username:e.target.value})} style={inputStyle}/>
                    <input placeholder="비밀번호 (선택)" value={newProxy.password} onChange={e=>setNewProxy({...newProxy,password:e.target.value})} style={inputStyle}/>
                  </div>
                  <button className="btn btn-primary btn-sm" style={{marginTop:12}} onClick={handleAddProxy}>＋ 등록하기</button>
                </div>

                {proxies.length===0 && <div style={{textAlign:"center",color:"var(--text3)",padding:40,fontSize:14}}>아직 등록된 IP가 없어요. 위에서 업체 IP를 등록해주세요.</div>}

                {proxies.map(p => {
                  const cnt = (proxyAssign[p.id]||[]).length;
                  const checking = proxyChecking[p.id];
                  const badge = p.last_ok===true ? {t:"🟢 정상",c:"var(--success)"} : p.last_ok===false ? {t:"🔴 실패",c:"var(--danger)"} : {t:"⚪ 미검사",c:"var(--text3)"};
                  return (
                    <div key={p.id} style={{background:"var(--card)",border:"1px solid var(--border)",borderRadius:12,padding:16,marginBottom:14}}>
                      <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
                        <div style={{fontWeight:700,fontSize:15}}>{p.label||p.server}</div>
                        <span style={{fontSize:12,fontWeight:700,color:badge.c}}>{badge.t}</span>
                        <span style={{fontSize:12,color:"var(--text3)"}}>· 계정 {cnt}개</span>
                        <div style={{marginLeft:"auto",display:"flex",gap:8}}>
                          <button className="btn btn-secondary btn-sm" disabled={checking} onClick={()=>handleCheckProxy(p)}>{checking?"검사 중…":"🔍 검사"}</button>
                          <button className="btn btn-sm" style={{color:"var(--danger)",border:"1px solid var(--border)",background:"transparent"}} onClick={()=>handleDeleteProxy(p)}>삭제</button>
                        </div>
                      </div>
                      <div style={{fontSize:12,color:"var(--text2)",marginTop:6}}>
                        {p.server}{p.username?` · ${p.username}`:""}
                        {p.last_ip && <> · 나가는 IP <b style={{color:"var(--text)"}}>{p.last_ip}</b></>}
                        {p.last_ms!=null && <> · {p.last_ms}ms</>}
                        {p.last_checked_at && <> · {new Date(p.last_checked_at).toLocaleString("ko-KR")}</>}
                      </div>
                      <div style={{marginTop:12}}>
                        <div style={{fontSize:12,fontWeight:600,marginBottom:6}}>이 IP를 쓸 회원 선택 <span style={{color:"var(--text3)",fontWeight:400}}>(이름·아이디로 검색 → 체크하면 배정 · 오른쪽 칩으로 기능별 on/off)</span></div>
                        <input value={proxyUserSearch} onChange={e=>setProxyUserSearch(e.target.value)} placeholder="🔍 회원 검색 (이름·아이디·이메일·전화)" style={{...inputStyle,width:"100%",marginBottom:8,boxSizing:"border-box"}}/>
                        {(()=>{
                          const q=proxyUserSearch.trim().toLowerCase();
                          const hits=(users as any[]).filter(u=>!q||`${u.name||""} ${u.phone||""} ${u.email||""}`.toLowerCase().includes(q));
                          if(!hits.length) return <div style={{fontSize:12,color:"var(--text3)",padding:"4px 0"}}>{q?"검색 결과가 없어요.":"회원이 없어요."}</div>;
                          return <div style={{display:"flex",flexDirection:"column",gap:6}}>
                            {hits.map((u:any)=>{
                              const mine=(proxyAssign[p.id]||[]).find(x=>x.userId===u.id);
                              const onThis=!!mine;
                              const otherPid=!onThis && Object.entries(proxyAssign).find(([pid,arr])=>pid!==p.id && arr.some(x=>x.userId===u.id))?.[0];
                              const idPart=(u.email||"").split("@")[0];
                              return (
                                <div key={u.id} style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap",padding:"6px 8px",borderRadius:8,border:`1px solid ${onThis?"var(--success)":"var(--border)"}`,background:onThis?"rgba(0,214,143,.06)":"transparent"}}>
                                  <button onClick={()=>toggleProxyAccount([u.id],p.id,onThis)} style={{display:"flex",alignItems:"center",gap:8,background:"transparent",border:"none",cursor:"pointer",color:"var(--text)",fontFamily:"inherit",fontSize:13,padding:0,flex:1,minWidth:150,textAlign:"left"}}>
                                    <span style={{fontSize:15}}>{onThis?"☑️":"⬜"}</span>
                                    <span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}><b>{u.name||"(이름없음)"}</b>{idPart?<span style={{color:"var(--text2)"}}> · {idPart}</span>:null}{u.email?<span style={{color:"var(--text3)",fontSize:11}}> ({u.email})</span>:null}</span>
                                    {otherPid && !onThis && <span style={{fontSize:10,color:"var(--text3)",marginLeft:4}}>다른 IP에 배정됨(누르면 이동)</span>}
                                  </button>
                                  {onThis && mine && (
                                    <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
                                      {PROXY_FEATURES.map(f => {
                                        const fon = (mine.features||[]).includes(f.k);
                                        return (
                                          <button key={f.k} onClick={()=>toggleProxyFeature([u.id],f.k,mine.features||[])}
                                            style={{fontSize:11,padding:"3px 9px",borderRadius:99,cursor:"pointer",fontFamily:"inherit",fontWeight:600,
                                              border:`1px solid ${fon?"var(--danger)":"var(--border)"}`,
                                              background:fon?"rgba(248,81,73,.1)":"transparent",
                                              color:fon?"var(--danger)":"var(--text3)"}}>
                                            {fon?"● ":"○ "}{f.l}
                                          </button>
                                        );
                                      })}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>;
                        })()}
                      </div>
                    </div>
                  );
                })}
              </div>
              );
            })()}

            {tab === "settings" && (
              <div style={{animation:"fadeUp .25s ease both"}}>

                {/* 큰 글씨 모드 */}
                <div className="card">
                  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                    <div>
                      <div className="card-title" style={{marginBottom:4}}>🔠 큰 글씨 모드</div>
                      <div style={{fontSize:12,color:"var(--text3)"}}>어르신·시력 불편한 분께 추천 — 전체 글씨 크기 확대</div>
                    </div>
                    <button onClick={()=>{const next=fontMode==="normal"?"large":"normal";setFontMode(next);localStorage.setItem("publy_adm_font_mode",next);}}
                      style={{padding:"8px 20px",borderRadius:99,border:"none",cursor:"pointer",fontSize:13,fontWeight:800,fontFamily:"inherit",transition:"all .2s",
                        background:fontMode==="large"?"var(--accent)":"var(--card2)",
                        color:fontMode==="large"?"#000":"var(--text2)",
                        boxShadow:fontMode==="large"?"0 3px 12px rgba(0,255,157,.3)":"none"}}>
                      {fontMode==="large"?"✅ 켜짐":"OFF"}
                    </button>
                  </div>
                </div>

                {/* 공지 발송 */}
                <div className="card">
                  <div className="card-title" style={{marginBottom:4}}>📢 전체 공지 발송</div>
                  <div style={{fontSize:12,color:"var(--text3)",marginBottom:12}}>저장하면 모든 회원이 다음 접속 시 팝업으로 확인해요</div>
                  <div style={{display:"flex",flexDirection:"column",gap:10}}>
                    <div>
                      <label className="inp-label">공지 제목</label>
                      <input className="inp" placeholder="예: 서비스 점검 안내" value={noticeTitle} onChange={e=>setNoticeTitle(e.target.value)}/>
                    </div>
                    <div>
                      <label className="inp-label">공지 내용</label>
                      <textarea className="inp" rows={4} placeholder="회원들에게 전달할 내용을 입력해주세요" value={noticeBody} onChange={e=>setNoticeBody(e.target.value)} style={{resize:"vertical"}}/>
                    </div>
                    <div style={{display:"flex",gap:8}}>
                      <button className="btn btn-primary" disabled={noticeSaving||!noticeTitle||!noticeBody} onClick={async()=>{
                        setNoticeSaving(true);setNoticeMsg("");
                        try{
                          const val=JSON.stringify({title:noticeTitle,body:noticeBody,active:true,created_at:Date.now().toString()});
                          await supabase.from("publy_settings").upsert({key:"global_notice",value:val},{onConflict:"key"});
                          setNoticeMsg("✅ 공지가 발송됐어요!");showToast("📢 공지 발송 완료!");
                        }catch(e:any){setNoticeMsg("❌ "+e.message);}
                        finally{setNoticeSaving(false);setTimeout(()=>setNoticeMsg(""),3000);}
                      }}>{noticeSaving?<><span className="spinner"/>발송 중...</>:"📢 공지 발송"}</button>
                      <button className="btn btn-secondary" onClick={async()=>{
                        await supabase.from("publy_settings").upsert({key:"global_notice",value:JSON.stringify({active:false})},{onConflict:"key"});
                        showToast("공지가 비활성화됐어요");
                      }}>비활성화</button>
                    </div>
                    {noticeMsg&&<div className={`alert ${noticeMsg.includes("✅")?"alert-success":"alert-danger"}`} style={{margin:0}}>{noticeMsg}</div>}
                  </div>
                </div>

                <div className="card">
                  <div className="card-title">✨ 글쓰기 AI</div>
                  <div className="ai-grid">
                    {ADM_WRITE_AI.map(item=>(
                      <button key={item.id} className={`ai-card ${writeAI===item.id?"selected":""}`}
                        style={{borderColor:writeAI===item.id?item.color:"var(--border)",background:writeAI===item.id?`${item.color}12`:"var(--bg)"}}
                        onClick={()=>{setWriteAI(item.id);localStorage.setItem("publy_adm_write_ai",item.id);}}>
                        <div className="ai-card-top">
                          <div className="ai-logo" style={{background:writeAI===item.id?item.color:`${item.color}20`,color:writeAI===item.id?"#000":item.color}}>{item.logo}</div>
                          {writeAI===item.id?<span className="ai-sel-badge" style={{background:item.color}}>✓ 선택됨</span>:item.free?<span className="ai-free-badge">무료</span>:<span className="ai-paid-badge">유료</span>}
                        </div>
                        <div className="ai-name">{item.label}</div><div className="ai-sub">{item.sub}</div>
                      </button>
                    ))}
                  </div>
                  <div className="card-title">🖼️ 이미지 AI</div>
                  <div className="ai-grid">
                    {ADM_IMAGE_AI.map(item=>(
                      <button key={item.id} className={`ai-card ${imageAI===item.id?"selected":""}`}
                        style={{borderColor:imageAI===item.id?item.color:"var(--border)",background:imageAI===item.id?`${item.color}12`:"var(--bg)"}}
                        onClick={()=>{setImageAI(item.id);localStorage.setItem("publy_adm_image_ai",item.id);}}>
                        <div className="ai-card-top">
                          <div className="ai-logo" style={{background:imageAI===item.id?item.color:`${item.color}20`,color:imageAI===item.id?"#000":item.color}}>{item.logo}</div>
                          {imageAI===item.id?<span className="ai-sel-badge" style={{background:item.color}}>✓ 선택됨</span>:<span className="ai-paid-badge">유료</span>}
                        </div>
                        <div className="ai-name">{item.label}</div><div className="ai-sub">{item.sub}</div>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="card">
                  <div className="card-title">🔑 API 키 관리</div>
                  <div className="key-section" style={{background:"var(--accent-bg)",borderColor:"var(--accent-border)"}}>
                    <div className="key-section-title" style={{color:"var(--accent-text)"}}>📝 글쓰기 키</div>
                    {ADM_WRITE_AI.map(k=><AdmKeyInput key={k.id} k={k}/>)}
                  </div>
                  <div className="key-section" style={{background:"rgba(139,92,246,.07)",borderColor:"rgba(139,92,246,.2)"}}>
                    <div className="key-section-title" style={{color:"#8b5cf6"}}>🖼️ 이미지 키</div>
                    {ADM_IMAGE_AI.map(k=><AdmKeyInput key={k.id} k={k}/>)}
                  </div>
                </div>

                <div className="card">
                  <div className="card-title">🔐 관리자 비밀번호 변경</div>
                  <div style={{display:"flex",flexDirection:"column",gap:10}}>
                    <div><label className="inp-label">새 비밀번호</label><div style={{position:"relative"}}><input className="inp" type={showPw1?"text":"password"} value={newPw1} onChange={e=>setNewPw1(e.target.value)} placeholder="새 비밀번호 입력" style={{paddingRight:40}}/><button type="button" onClick={()=>setShowPw1(v=>!v)} style={{position:"absolute",right:10,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",cursor:"pointer",fontSize:18,color:"var(--text3)"}}>{showPw1?"🙈":"👁️"}</button></div></div>
                    <div><label className="inp-label">비밀번호 확인</label><div style={{position:"relative"}}><input className="inp" type={showPw2?"text":"password"} value={newPw2} onChange={e=>setNewPw2(e.target.value)} placeholder="비밀번호 재입력" style={{paddingRight:40}}/><button type="button" onClick={()=>setShowPw2(v=>!v)} style={{position:"absolute",right:10,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",cursor:"pointer",fontSize:18,color:"var(--text3)"}}>{showPw2?"🙈":"👁️"}</button></div></div>
                    <button className="btn btn-primary" style={{alignSelf:"flex-start"}} onClick={changeAdminPw}>🔐 비밀번호 변경</button>
                    {pwMsg&&<div className={`alert ${pwMsg.includes("✅")?"alert-success":"alert-danger"}`} style={{margin:0}}>{pwMsg}</div>}
                  </div>
                </div>

                {/* 네이버 API 공용 키 (관리자) */}
                <div className="card">
                  <div className="card-title" style={{marginBottom:4}}>🟢 네이버 검색광고 API (공용 키)</div>
                  <div style={{fontSize:11,color:"var(--text3)",marginBottom:12}}>회원 개인 키 없을 때 이 키 사용 · 전체 회원 공유</div>
                  <div style={{display:"flex",flexDirection:"column",gap:8}}>
                    {[
                      {label:"Customer ID",key:"naver_customer_id",ph:"123456789"},
                      {label:"Access License",key:"naver_access_license",ph:"xxxx-xxxx-xxxx"},
                      {label:"Secret Key",key:"naver_secret_key",ph:"secret"},
                    ].map(f=>(
                      <div key={f.key}>
                        <label className="inp-label">{f.label}</label>
                        <input className="inp" placeholder={f.ph} value={(adminNaverKeys as any)[f.key]||""} onChange={e=>setAdminNaverKeys(p=>({...p,[f.key]:e.target.value}))}/>
                      </div>
                    ))}
                    <div className="card-title" style={{marginBottom:4,marginTop:8}}>📊 네이버 DataLab API (공용)</div>
                    <div style={{fontSize:12,color:"var(--text3)",marginBottom:8,padding:"8px 12px",borderRadius:8,background:"rgba(0,214,143,.08)",border:"1px solid rgba(0,214,143,.2)"}}>
                      💡 이 키는 <strong style={{color:"var(--success)"}}>서이추 블로그 수집</strong>에 사용됩니다.<br/>
                      입력해두면 모든 회원이 키 없이 자동으로 수집 가능합니다.<br/>
                      <span style={{fontSize:11,color:"var(--text3)"}}>네이버 개발자센터 → 앱 등록 → 검색 API 사용 설정</span>
                    </div>
                    {[
                      {label:"Client ID",key:"naver_datalab_client_id",ph:"Client ID"},
                      {label:"Client Secret",key:"naver_datalab_client_secret",ph:"Client Secret"},
                    ].map(f=>(
                      <div key={f.key}>
                        <label className="inp-label">{f.label}</label>
                        <input className="inp" placeholder={f.ph} value={(adminNaverKeys as any)[f.key]||""} onChange={e=>setAdminNaverKeys(p=>({...p,[f.key]:e.target.value}))}/>
                      </div>
                    ))}
                    <button className="btn btn-primary" style={{alignSelf:"flex-start"}} disabled={adminNaverSaving} onClick={async()=>{
                      setAdminNaverSaving(true); setAdminNaverMsg("");
                      try{
                        await saveAdminNaverApiKeys(adminNaverKeys);
                        setAdminNaverMsg("✅ 저장 완료! 전체 회원에게 적용됩니다");
                        setTimeout(()=>setAdminNaverMsg(""),4000);
                      }catch(e:any){setAdminNaverMsg("❌ "+e.message);}
                      finally{setAdminNaverSaving(false);}
                    }}>
                      {adminNaverSaving?<><span className="spinner"/>저장 중...</>:"💾 공용 키 저장"}
                    </button>
                    {adminNaverMsg&&<div className={`alert ${adminNaverMsg.includes("✅")?"alert-success":"alert-danger"}`} style={{margin:0}}>{adminNaverMsg}</div>}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* 블로그 순위 키 안내 팝업 */}
        {showRankInfo&&(
          <div style={{position:"fixed",inset:0,zIndex:9000,background:"rgba(0,0,0,.85)",display:"flex",alignItems:"center",justifyContent:"center",padding:20}} onClick={()=>setShowRankInfo(false)}>
            <div style={{width:"100%",maxWidth:440,borderRadius:20,background:"#1a1f2e",border:"1px solid #2d3548",overflow:"hidden",animation:"fadeUp .25s ease",boxShadow:"0 24px 60px rgba(0,0,0,.7)"}} onClick={e=>e.stopPropagation()}>
              <div style={{background:"linear-gradient(135deg,#ff6b9d,#ff4081)",padding:"20px 24px",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                <div>
                  <div style={{fontSize:18,fontWeight:900,color:"#fff"}}>🔑 API 키 안내</div>
                  <div style={{fontSize:12,color:"rgba(255,255,255,.85)",marginTop:3}}>블로그 순위 확인 서비스 사용 전 꼭 읽어주세요</div>
                </div>
                <button onClick={()=>setShowRankInfo(false)} style={{background:"rgba(255,255,255,.25)",border:"none",color:"#fff",width:32,height:32,borderRadius:8,cursor:"pointer",fontSize:16,fontFamily:"inherit"}}>✕</button>
              </div>
              <div style={{padding:20,display:"flex",flexDirection:"column",gap:10}}>
                {[
                  {ico:"⚠️",title:"키가 매번 초기화돼요",desc:"이 서비스는 API 키를 브라우저 localStorage에 저장해요.\n창을 닫거나 새로고침하면 키가 사라지기 때문에\n들어갈 때마다 다시 입력해야 해요."},
                  {ico:"🔑",title:"어떤 키가 필요해요?",desc:"네이버 검색 API의\n• Client ID\n• Client Secret\n두 가지가 필요해요."},
                  {ico:"🔗",title:"키 발급 방법",desc:"네이버 개발자센터 (developers.naver.com) 에서\n애플리케이션 등록 후\n'검색' 권한을 추가하면 발급받을 수 있어요."},
                  {ico:"💡",title:"팁",desc:"DataLab API 키랑 달라요!\n검색광고 API 키가 아닌\n'네이버 오픈API' 키를 사용해야 해요."},
                ].map((item,i)=>(
                  <div key={i} style={{display:"flex",gap:12,padding:"12px 14px",borderRadius:12,background:"#242938"}}>
                    <span style={{fontSize:22,flexShrink:0,lineHeight:1}}>{item.ico}</span>
                    <div>
                      <div style={{fontSize:13,fontWeight:800,color:"#ffffff",marginBottom:4}}>{item.title}</div>
                      <div style={{fontSize:12,color:"#a0aec0",lineHeight:1.7,whiteSpace:"pre-line"}}>{item.desc}</div>
                    </div>
                  </div>
                ))}
                <a href="https://developers.naver.com/apps/#/list" target="_blank" rel="noreferrer"
                  style={{display:"flex",alignItems:"center",justifyContent:"center",gap:6,padding:"12px",borderRadius:12,background:"rgba(3,199,90,.1)",border:"1px solid rgba(3,199,90,.3)",color:"#03C75A",fontSize:13,fontWeight:800,textDecoration:"none"}}>
                  🔗 네이버 개발자센터에서 키 발급하기 →
                </a>
              </div>
              <div style={{padding:"0 20px 20px"}}>
                <button onClick={()=>setShowRankInfo(false)} style={{width:"100%",padding:"13px",borderRadius:12,border:"none",background:"linear-gradient(135deg,#ff6b9d,#ff4081)",color:"#fff",fontSize:15,fontWeight:800,cursor:"pointer",fontFamily:"inherit"}}>
                  알겠어요! 👍
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 황금 키워드 분석 설명 팝업 */}
        {showKwInfo&&(
          <div style={{position:"fixed",inset:0,zIndex:9000,background:"rgba(0,0,0,.85)",display:"flex",alignItems:"center",justifyContent:"center",padding:20}} onClick={()=>setShowKwInfo(false)}>
            <div style={{width:"100%",maxWidth:460,borderRadius:20,background:"#1a1f2e",border:"1px solid #2d3548",overflow:"hidden",animation:"fadeUp .25s ease",boxShadow:"0 24px 60px rgba(0,0,0,.7)"}} onClick={e=>e.stopPropagation()}>
              <div style={{background:"linear-gradient(135deg,#ff6b9d,#ff4081)",padding:"20px 24px",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                <div>
                  <div style={{fontSize:18,fontWeight:900,color:"#fff"}}>📊 황금 키워드 분석</div>
                  <div style={{fontSize:12,color:"rgba(255,255,255,.85)",marginTop:3}}>네이버 실데이터 기반 키워드 점수 분석</div>
                </div>
                <button onClick={()=>setShowKwInfo(false)} style={{background:"rgba(255,255,255,.25)",border:"none",color:"#fff",width:32,height:32,borderRadius:8,cursor:"pointer",fontSize:16,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"inherit"}}>✕</button>
              </div>
              <div style={{padding:20,display:"flex",flexDirection:"column",gap:10}}>
                {[
                  {ico:"🎯",title:"어떤 기능이야?",desc:"네이버 검색광고 API로 실제 검색량·경쟁도·CPC를 가져와서 내 키워드가 얼마나 좋은지 점수로 보여줘요"},
                  {ico:"⭐",title:"황금점수 계산 방법",desc:"경쟁 낮음(35%) + 검색량 1천~3만(25%) + 클릭률(15%) + CPC 단가(25%)\n+ 구매의도 단어·롱테일 키워드 보너스"},
                  {ico:"👆",title:"어떻게 써?",desc:"점수 높은 키워드 클릭 → 키워드 자동 입력\n\"제목 추천 →\" 버튼으로 바로 SEO 제목 생성!"},
                  {ico:"💻",title:"봇이 필요해요",desc:"PC에서 Publy 봇이 실행 중이어야 사용 가능해요"},
                ].map((item,i)=>(
                  <div key={i} style={{display:"flex",gap:12,padding:"12px 14px",borderRadius:12,background:"#242938"}}>
                    <span style={{fontSize:22,flexShrink:0,lineHeight:1}}>{item.ico}</span>
                    <div>
                      <div style={{fontSize:13,fontWeight:800,color:"#ffffff",marginBottom:4}}>{item.title}</div>
                      <div style={{fontSize:12,color:"#a0aec0",lineHeight:1.7,whiteSpace:"pre-line"}}>{item.desc}</div>
                    </div>
                  </div>
                ))}
              </div>
              <div style={{padding:"0 20px 20px"}}>
                <button onClick={()=>setShowKwInfo(false)} style={{width:"100%",padding:"13px",borderRadius:12,border:"none",background:"linear-gradient(135deg,#ff6b9d,#ff4081)",color:"#fff",fontSize:15,fontWeight:800,cursor:"pointer",fontFamily:"inherit",boxShadow:"0 4px 14px rgba(255,64,129,.4)"}}>
                  알겠어요! 👍
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 모바일 탭바 */}
        <div className="mob-tabs">
          {TABS.map(t=>(
            <button key={t.k} className={`mob-tab ${tab===t.k?"active":""}`} onClick={()=>setTab(t.k as any)}>
              <span className="mob-tab-ico">{t.i}</span>
              <span className="mob-tab-lbl">{t.l}</span>
            </button>
          ))}
        </div>

      </div>

      {/* ── 전체화면 미리보기 모달 ── */}
      

      {/* 에러 로그 팝업 */}
      {showAllErrors&&(
        <div role="presentation" style={{position:"fixed",inset:0,zIndex:9999,background:theme==="dark"?"rgba(0,0,0,.82)":"rgba(15,23,42,.55)",display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
          <div role="dialog" aria-modal="true" aria-labelledby="error-log-title" style={{background:theme==="dark"?"#111827":"#ffffff",color:theme==="dark"?"#f8fafc":"#172033",borderRadius:20,width:"100%",maxWidth:780,maxHeight:"80vh",boxShadow:"0 18px 60px rgba(0,0,0,.65)",display:"flex",flexDirection:"column",overflow:"hidden",border:`2px solid ${theme==="dark"?"#64748b":"#cbd5e1"}`}}>
            {/* 헤더 */}
            <div style={{padding:"16px 20px",borderBottom:"1px solid var(--border)",display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0}}>
              <div style={{display:"flex",alignItems:"center",gap:12}}>
                <span style={{fontSize:20}}>🚨</span>
                <div>
                  <div id="error-log-title" style={{fontSize:15,fontWeight:800,color:theme==="dark"?"#ffffff":"#0f172a"}}>
                    {errorFilter ? `회원 오류 내역` : "전체 오류 내역"}
                  </div>
                  <div style={{fontSize:11,color:theme==="dark"?"#cbd5e1":"#475569"}}>{errorLogsLoading?"불러오는 중...":`${errorLogs.length}건`}</div>
                </div>
              </div>
              <div style={{display:"flex",gap:8,alignItems:"center"}}>
                {errorFilter&&<button onClick={()=>{setErrorFilter(null);loadErrorLogs();}} style={{padding:"5px 12px",borderRadius:8,background:"var(--bg2)",border:"1px solid var(--border)",cursor:"pointer",fontSize:11,fontFamily:"inherit",color:"var(--text2)"}}>전체 보기</button>}
                <button onClick={()=>markErrorsAsRead().then(()=>{setUnreadErrors(0);setErrorLogs(p=>p.map(l=>({...l,is_read:true})));loadErrorLogs(errorFilter||undefined);})} style={{padding:"5px 12px",borderRadius:8,background:"var(--bg2)",border:"1px solid var(--border)",cursor:"pointer",fontSize:11,fontFamily:"inherit",color:"var(--text2)"}}>모두 읽음</button>
                <button aria-label="오류 로그 닫기" title="닫기" onClick={()=>{setShowAllErrors(false);setErrorFilter(null);}} style={{width:36,height:36,borderRadius:8,background:theme==="dark"?"#334155":"#f1f5f9",border:`2px solid ${theme==="dark"?"#94a3b8":"#64748b"}`,cursor:"pointer",fontSize:20,fontWeight:900,color:theme==="dark"?"#ffffff":"#0f172a",lineHeight:1}}>✕</button>
              </div>
            </div>
            {/* 목록 */}
            <div style={{flex:1,overflowY:"auto",padding:"12px 16px"}}>
              {errorLogsLoading?(
                <div style={{textAlign:"center",padding:"40px 20px",color:theme==="dark"?"#e2e8f0":"#334155",fontSize:13}}>오류 로그를 불러오는 중...</div>
              ):errorLogsError?(
                <div role="alert" style={{padding:"16px",borderRadius:10,background:theme==="dark"?"#450a0a":"#fef2f2",border:"1px solid #ef4444",color:theme==="dark"?"#fecaca":"#991b1b",fontSize:13,fontWeight:700}}>🚨 {errorLogsError}<br/><span style={{fontSize:11,fontWeight:500}}>publy_error_logs의 SELECT 권한/RLS 정책을 확인하세요.</span></div>
              ):errorLogs.length===0?(
                <div style={{textAlign:"center",padding:"40px 20px",color:theme==="dark"?"#cbd5e1":"#475569",fontSize:13}}>오류 내역이 없어요 ✅</div>
              ):(
                <div style={{display:"flex",flexDirection:"column",gap:8}}>
                  {errorLogs.map(log=>(
                    <div key={log.id} style={{padding:"12px 14px",borderRadius:12,background:log.is_read?(theme==="dark"?"#1e293b":"#f8fafc"):(theme==="dark"?"#3f1218":"#fff1f2"),border:`1px solid ${log.is_read?(theme==="dark"?"#475569":"#cbd5e1"):"#ef4444"}`,display:"flex",gap:12,alignItems:"flex-start"}}>
                      {!log.is_read&&<span style={{width:8,height:8,borderRadius:"50%",background:"#f85149",flexShrink:0,marginTop:4}}/>}
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4,flexWrap:"wrap"}}>
                          <span style={{fontSize:12,fontWeight:800,color:theme==="dark"?"#ffffff":"#0f172a"}}>{log.user_name||"이름없음"}</span>
                          <span style={{fontSize:11,color:theme==="dark"?"#cbd5e1":"#475569"}}>{log.user_email}</span>
                          <span style={{fontSize:10,padding:"2px 8px",borderRadius:99,background:"var(--accent-bg)",color:"var(--accent-text)",fontWeight:700}}>{log.feature}</span>
                          <span style={{fontSize:10,color:theme==="dark"?"#cbd5e1":"#475569",marginLeft:"auto"}}>{new Date(log.created_at).toLocaleString("ko-KR")}</span>
                        </div>
                        <div style={{fontSize:12,color:theme==="dark"?"#fca5a5":"#b91c1c",fontWeight:600,wordBreak:"break-all",lineHeight:1.6}}>{log.error_message}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── 재연결 비밀번호 입력 모달 (window.prompt 대체) — 회원과 동일 ── */}
      {pwPrompt&&(
        <div style={{position:"fixed",inset:0,zIndex:10000,background:"rgba(0,0,0,.75)",display:"flex",alignItems:"center",justifyContent:"center",padding:20}}
          onClick={()=>{ pwPromptResolve.current?.(null); pwPromptResolve.current=null; setPwPrompt(null); }}>
          <div style={{width:"100%",maxWidth:400,borderRadius:20,background:theme==="dark"?"#111927":"#ffffff",border:`1px solid ${theme==="dark"?"#26313f":"#e3e9f2"}`,overflow:"hidden",animation:"fadeUp .25s ease",boxShadow:"0 24px 60px rgba(0,0,0,.5)"}} onClick={e=>e.stopPropagation()}>
            <div style={{padding:"18px 22px 14px",background:"linear-gradient(135deg,#16a34a,#00cc80)",display:"flex",alignItems:"center",gap:10}}>
              <span style={{fontSize:24}}>🔒</span>
              <div><div style={{fontSize:16,fontWeight:900,color:"#ffffff"}}>세션이 만료되었어요</div>
              <div style={{fontSize:12,color:"rgba(255,255,255,.9)",marginTop:2}}>{pwPrompt.acc.platform==="naver"?"네이버":"티스토리"} 비밀번호를 다시 입력해주세요</div></div>
            </div>
            <div style={{padding:"20px 22px"}}>
              <div style={{fontSize:12,color:theme==="dark"?"#8fa3bd":"#647084",marginBottom:6}}>계정: <b style={{color:theme==="dark"?"#eaf1fb":"#111a28"}}>{pwPrompt.acc.username}</b></div>
              <div style={{position:"relative",marginBottom:14}}>
                <input type={showPwPrompt?"text":"password"} autoFocus placeholder="비밀번호" value={pwPrompt.value}
                  onChange={e=>setPwPrompt(p=>p?{...p,value:e.target.value}:p)}
                  onKeyDown={e=>{ if(e.key==="Enter"&&pwPrompt.value){ pwPromptResolve.current?.(pwPrompt.value); pwPromptResolve.current=null; setPwPrompt(null); } }}
                  style={{width:"100%",boxSizing:"border-box",fontSize:14,padding:"12px 44px 12px 14px",borderRadius:10,border:`1.5px solid ${theme==="dark"?"#33404f":"#d2dbe8"}`,background:theme==="dark"?"#18212f":"#f5f8fc",color:theme==="dark"?"#eaf1fb":"#111a28",fontFamily:"inherit"}}/>
                <button type="button" onClick={()=>setShowPwPrompt(v=>!v)} aria-label="비밀번호 보기" style={{position:"absolute",right:10,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",cursor:"pointer",fontSize:18,color:theme==="dark"?"#8fa3bd":"#647084"}}>{showPwPrompt?"🙈":"👁️"}</button>
              </div>
              <div style={{display:"flex",gap:8}}>
                <button onClick={()=>{ pwPromptResolve.current?.(null); pwPromptResolve.current=null; setPwPrompt(null); }}
                  style={{flex:1,padding:"11px",borderRadius:10,border:`1px solid ${theme==="dark"?"#33404f":"#d2dbe8"}`,background:theme==="dark"?"#18212f":"#f5f8fc",color:theme==="dark"?"#8fa3bd":"#647084",cursor:"pointer",fontSize:13,fontWeight:700,fontFamily:"inherit"}}>취소</button>
                <button disabled={!pwPrompt.value} onClick={()=>{ pwPromptResolve.current?.(pwPrompt.value); pwPromptResolve.current=null; setPwPrompt(null); }}
                  style={{flex:2,padding:"11px",borderRadius:10,border:"none",background:pwPrompt.value?"#16a34a":(theme==="dark"?"#26313f":"#d2dbe8"),color:pwPrompt.value?"#fff":(theme==="dark"?"#8fa3bd":"#647084"),cursor:pwPrompt.value?"pointer":"not-allowed",fontSize:13,fontWeight:800,fontFamily:"inherit"}}>🔗 재연결</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 토스트 알림 */}
      <div className="toast-wrap">
        {toasts.map(t=>(
          <div key={t.id} className={`toast toast-${t.type}`}>{t.msg}</div>
        ))}
      </div>
    </>
  );
}
