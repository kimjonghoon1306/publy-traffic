import React, { useState, useEffect, useCallback, useRef } from "react";
import GoogleFlowCard from "../GoogleFlowCard";
import { PublyUser, getQuota, getHistory, getAccounts, PublyQuota, PublyHistory, PublyAccount, upsertAccount, useQuota, refundQuota, addHistory, getHistoryContent, deleteHistory, deleteAllHistory, deleteFailedHistory, changeUserPassword, getNaverApiKeys, saveNaverApiKeys, NaverApiKeys, checkNaverQuota, incrementNaverQuota, getNaverDailyUsage, NAVER_DAILY_LIMIT, getUserNaverApiKeys, logError, PLAN_CONFIG, checkDailyPublishQuota, incrementDailyPublish, getDailyPublishUsage, getNeighborDailyUsage, NEIGHBOR_DAILY_LIMIT, getEngageDailyUsage, ENGAGE_DAILY_LIMIT, InstaDmTarget, InstaDmHistory, InstaDmQuota, getInstaDmTargets, addInstaDmTarget, deleteInstaDmTarget, getInstaDmHistory, addInstaDmHistory, getInstaDmQuota, upsertInstaDmQuota, incrementInstaDmUsage, INSTA_DM_DAILY_LIMIT, getReplyDailyUsage, REPLY_DAILY_LIMIT, pushLiveLog, getWeeklyActivity, WeeklyActivity, getActivityByRange, ActivityRange } from "../lib/supabase";
import { supabase, submitBugReportRow, getMyResolvedBugAlerts, markBugNotified, PublyBugReport, getPlace360Access } from "../lib/supabase";
import { markTitleChanged, checkReviveQuota, incrementReviveQuota } from "../lib/supabase";
import { getTrafficLicenses } from "../lib/supabase";
import NeighborPage from "./NeighborPage";
import CrawlCenter from "../components/CrawlCenter";
import InflowCenter from "../components/InflowCenter";
import Place360 from "../components/Place360";
import PlaceReview from "../components/PlaceReview";
import { botFetch, BotEventStream } from "../lib/botApi";
import WebInstallNotice from "../WebInstallNotice";
import UsageGuide from "../components/UsageGuide";
import Daebaekseo, { DAEBAEKSEO_VERSION } from "../components/Daebaekseo";
import dodoImg from "../assets/dodo.png";

type MainTab = "control" | "keyword" | "write" | "image" | "photo" | "publish" | "onetouch" | "manage" | "accounts" | "rank" | "blogscore" | "calendar" | "settings" | "neighbor" | "engage" | "reply" | "pumasi" | "insta_dm" | "crawl" | "inflow" | "place" | "place_reply";
type OnPartnerProduct = {id:string|null;name:string;image:string;price:number|null;available:boolean;partnerUrl:string;shopUrl:string};
type OnPartnerPlacement = "auto"|"adpost"|"after_first"|"middle"|"before_last"|"bottom";
type PublishConcept = "full" | "body_faq" | "body_only";
const ONPARTNER_PLACEMENT_INFO:Record<OnPartnerPlacement,{label:string;desc:string}>={
  auto:{label:"✨ 자동 추천",desc:"글 흐름을 분석해 구매 관심이 높아지는 본문 약 60% 지점에 배치해요. 애드포스트 선택 중에는 광고 예상 구간 뒤로 자동 조정해요."},
  adpost:{label:"📰 애드포스트형",desc:"예상 광고 영역과 바로 붙지 않도록 충분한 본문이 지난 약 70% 지점에 상품 카드를 배치해요."},
  after_first:{label:"첫 번째 소제목 뒤",desc:"도입과 첫 설명을 읽은 직후 상품을 빠르게 보여줘요."},
  middle:{label:"본문 정중앙",desc:"정보와 경험이 쌓인 본문 중간에 상품 카드를 배치해요."},
  before_last:{label:"마지막 소제목 앞",desc:"후기 결론으로 넘어가기 직전에 자연스럽게 구매를 안내해요."},
  bottom:{label:"본문 하단 (FAQ·관련글 전)",desc:"글 전체의 맨끝이 아니라 본문이 끝나고 질문답변·관련글·해시태그가 시작되기 직전에 배치해요."}
};

import { AEO_RULES, AEO_FAQ_FORMAT, AEO_TITLE_RULE, ensureAeoIntroSummary } from "../lib/aeo";
const BOT = "http://127.0.0.1:3363";
const INSTA_BOT = "http://127.0.0.1:3365";
const BATCH = 30;
const MAX_TITLES = 90;
const MAX_KW = 90;
// ★실검증(2026-08-24): 2.0-flash·2.0-flash-lite·1.5-flash는 구글이 폐기(404). 살아있는 모델만 사용(각 한도 별도라 분산).
const GEMINI_MODELS = ["gemini-2.5-flash","gemini-2.5-flash-lite","gemini-flash-latest","gemini-flash-lite-latest"];
const PLAN_LABELS: Record<string,string> = {free:"FREE",basic:"BASIC",pro:"PRO",unlimited:"무제한",admin:"ADMIN"};
// ★네이버 하루 안전 권장치(계정 제재 방지). 무제한/관리자도 사용량을 이 기준으로 보여줌 — 락이 아니라 참고 경고용.
const NAVER_SAFE_NEIGHBOR = 100;   // 서이추
const NAVER_SAFE_ENGAGE = 100;     // 공감·댓글
const NAVER_SAFE_PUMASI = 50;      // 품앗이
// ⚡ 원터치 AI 키워드 주제 카테고리(여러 개 선택 → 그 안에서만 생성)
const OT_KW_CATS = ["맛집","여행","재테크·부업","건강·운동","육아","뷰티","패션","인테리어","IT·가전","정책자금","반려동물","자기계발","음식·레시피","문화·연예","스포츠","자동차","교육","부동산"];
// 만료일까지 남은 일수 — 자정 기준으로 계산해 시각과 무관하게 항상 동일한 값(상단/하단 D-day 일치)
function daysUntil(dateStr?: string): number | null {
  if (!dateStr) return null;
  const end = new Date(dateStr); end.setHours(0,0,0,0);
  const today = new Date(); today.setHours(0,0,0,0);
  return Math.round((end.getTime() - today.getTime()) / 86400000);
}
function formatDaysLeft(dateStr?: string): string {
  const days = daysUntil(dateStr);
  if (days === null) return "—";
  if (days <= 0) return "오늘 만료";
  return `D-${days}`;
}
function formatKstDateTime(date = new Date(), withSeconds = false): string {
  return new Date(date.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, withSeconds ? 19 : 16);
}

// datetime-local은 타임존 정보가 없으므로 전송/큐 저장 전에 KST offset을 명시한다.
function kstScheduleIso(localValue: string): string | undefined {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(localValue)) return undefined;
  const normalized = localValue.length === 16 ? `${localValue}:00` : localValue;
  const iso = `${normalized}+09:00`;
  return Number.isNaN(Date.parse(iso)) ? undefined : iso;
}

const WRITE_AI_LIST = [
  {id:"gemini",label:"Gemini Flash",sub:"무료",placeholder:"AIza...",storageKey:"publy_gemini_key",link:"https://aistudio.google.com/app/apikey",color:"#4285F4",logo:"G",free:true},
  {id:"groq",  label:"Groq Llama 3",sub:"무료",placeholder:"gsk_...",storageKey:"publy_groq_key",  link:"https://console.groq.com/keys",          color:"#F55036",logo:"L",free:true},
  {id:"openai",label:"GPT-4o",       sub:"유료",placeholder:"sk-...", storageKey:"publy_openai_key",link:"https://platform.openai.com/api-keys",   color:"#10A37F",logo:"O",free:false},
];
const IMAGE_AI_LIST = [
  {id:"openai_img",label:"DALL-E 3",         sub:"유료",placeholder:"sk-...", storageKey:"publy_openai_key",   link:"https://platform.openai.com/api-keys",     color:"#10A37F",logo:"O"},
  {id:"replicate", label:"Flux (Replicate)", sub:"유료",placeholder:"r8_...", storageKey:"publy_replicate_key",link:"https://replicate.com/account", color:"#8B5CF6",logo:"R"},
];
const WRITE_STYLES = [
  {id:"감성일기", i:"📔", desc:"감성·경험 중심 에세이체"},
  {id:"정보글",  i:"📋", desc:"SEO 최적화 정보 전달"},
  {id:"맛집후기",i:"🍽️", desc:"음식·분위기·가격 묘사"},
  {id:"여행기",  i:"✈️", desc:"일정·팁·감성 여행 스토리"},
] as const;
type WriteStyle = typeof WRITE_STYLES[number]["id"];
// ★ 스타일마다 글의 "방향"이 확실히 달라지게 — 구조·어조·시작·초점·문장끝을 서로 다르게 지정.
//   (endTone은 아래 프롬프트의 공통 문장끝 규칙을 스타일별로 덮어씀 → 정보글이 감성글로 끌려가지 않게)
const WRITE_STYLE_GUIDE: Record<WriteStyle,string> = {
  "감성일기":`[글의 방향: 감성일기]
• 목적: 정보 전달이 아니라 '그날의 감정과 경험'을 나누는 개인 에세이.
• 시작: 그날의 장면·기분으로 훅 (예: "요즘 마음이 복잡했는데, 그날따라…").
• 구조: 시간 흐름(그날 아침→그 순간→돌아보며). 흐름을 끊지 않는 자연스러운 질문형 소제목 4~5개로 구간을 나누기.
• 본문 중간: 경험 흐름 사이에 독자에게 필요한 가격·시간·이용법·선택 팁 중 맞는 내용을 3개 항목으로 짧게 한 번 삽입. 글 끝에 정보만 몰아넣지 않기.
• 초점: 오감·감정·내면의 변화. 글 전체를 스펙 나열로 만들지 말고 독자에게 말 걸며 공감 유도.
• 금지: 표, 근거 없는 수치, 본문 끝에만 붙이는 뻔한 정보 모음.`,
  "정보글":`[글의 방향: 정보글]
• 목적: 독자가 '검색해서 답을 얻으러 온' 실용 정보 제공. 감성 최소.
• 시작: 문제 정의/핵심 결론 먼저 (예: "결론부터 말하면 …").
• 구조: 소제목으로 논리 구획 + 번호 목록(1. 2. 3.) 적극 사용. 비교·기준·수치·표현 위주.
• 초점: 정확한 정보·근거·주의사항·자주 묻는 질문. SEO 키워드 자연 반복.
• 어조: 담백하고 신뢰감 있게. 과한 감탄사·이모지 자제. (감성 회고 금지)`,
  "맛집후기":`[글의 방향: 맛집후기]
• 목적: 실제 다녀온 사람의 생생한 방문기. 먹고 싶게 만드는 게 핵심.
• 시작: 방문 계기/첫인상 (예: "웨이팅 30분 감수하고 다녀왔어요").
• 구조: 위치·분위기 → 주문한 메뉴 → 맛/식감/향 묘사 → 총평·재방문 의향을 기본으로 하되, 가격·주차·웨이팅 정보 블록은 매번 앞·중간·후반 중 위치를 바꾸기.
• 초점: 맛·비주얼·식감을 오감으로 묘사 + 가격/주차/웨이팅/영업시간 실정보 반드시.
• 금지: 안 먹어본 듯한 두루뭉술. 구체 메뉴명·가격 필수.`,
  "여행기":`[글의 방향: 여행기]
• 목적: 따라 떠나고 싶게 만드는 여정 스토리 + 실전 팁.
• 시작: 떠난 이유/설렘 (예: "훌쩍 떠난 1박2일, 여기 진짜였어요").
• 구조: 여행지 소개와 여정 흐름을 중심으로 쓰되, 이동·비용·코스·준비물 정보 블록은 매번 앞·중간·후반 중 위치와 순서를 바꾸기.
• 초점: 현장 분위기 감성 묘사 + 교통비·입장료·숙박비 등 실비용, 포토스팟 위치.
• 금지: 정보만 나열(감성 없이)하거나, 감성만 있고 팁 없는 글.`,
};
// 스타일별 문장끝/어조 — 공통 규칙(~해요,~거든요…)이 정보글까지 감성체로 만들지 않도록 덮어씀
const WRITE_STYLE_ENDTONE: Record<WriteStyle,string> = {
  "감성일기":"문장 끝: ~했어요, ~더라고요, ~거든요, ~잖아요 를 섞어 잔잔하고 다정하게.",
  "정보글":  "문장 끝: ~합니다, ~입니다 중심의 담백한 정보체. 감성 회고·과한 감탄 금지.",
  "맛집후기":"문장 끝: ~했어요, ~더라고요, ~네요 로 생생하게. 맛 표현은 구체적으로.",
  "여행기":  "문장 끝: ~했어요, ~더라고요, ~거든요 로 여정을 들려주듯.",
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
  {id:"young_w",  label:"👩 20대 여성",  color:"#f472b6", prompt:"20대 여성이 친한 친구에게 카톡 보내듯 친근하고 감성적으로 작성해줘. 이모지 적절히 사용하고 공감과 감성을 자극하는 표현을 써줘. '~했어요', '~더라고요', '~거든요' 말투로."},
  {id:"young_m",  label:"👨 20대 남성",  color:"#60a5fa", prompt:"20대 남성이 친구에게 솔직하게 말하듯 써줘. 직접적이고 핵심만 짚는 문체로 유머와 현실적인 조언을 섞어서. '~했어요', '~임', '~거든요' 자연스럽게."},
  {id:"mid_w",    label:"👩‍🦳 40대 여성", color:"#fb923c", prompt:"40대 주부나 직장맘이 또래 친구에게 진심으로 알려주듯 따뜻하고 실용적으로 써줘. 경험에서 우러나온 조언과 공감을 담아줘. '~해요', '~하더라고요', '~이에요' 말투로."},
  {id:"mid_m",    label:"👨‍🦳 40대 남성", color:"#34d399", prompt:"40대 직장인 남성이 후배에게 조언해주듯 신뢰감 있고 경험 기반으로 써줘. 핵심 정보를 명확하게 전달하되 딱딱하지 않게. '~합니다', '~했어요', '~거든요' 섞어서."},
  {id:"mom",      label:"👩‍👧 엄마",      color:"#f9a8d4", prompt:"자상한 엄마가 아이에게 설명해주듯 따뜻하고 걱정 어린 마음으로 써줘. 안전과 건강을 먼저 생각하고 실용적인 조언과 따뜻한 격려를 담아줘."},
  {id:"expert",   label:"🎓 전문가",     color:"#a78bfa", prompt:"해당 분야 전문가가 신뢰감 있게 써줘. 전문 지식을 쉬운 말로 풀어서 근거와 데이터를 적극 활용하고 독자가 실제로 적용할 수 있는 실용적 조언을 담아줘."},
  {id:"teacher",  label:"👨‍🏫 선생님",    color:"#4ade80", prompt:"친절한 선생님이 학생에게 설명해주듯 차근차근 이해하기 쉽게 써줘. 단계별로 설명하고 어려운 개념은 쉬운 예시로 풀어서."},
  {id:"reporter", label:"📰 기자",       color:"#94a3b8", prompt:"신문 기자가 심층 취재 기사 쓰듯 객관적이고 사실 기반으로 써줘. 핵심 정보를 앞에 배치하고 신뢰감 있는 문체로."},
] as const;
type PersonaStyle = typeof PERSONA_STYLES[number]["id"];
// ── 계정 안전 워밍업: 계정 나이(연결일~오늘)에 따라 하루 안전 활동량을 단계별로 권장 ──
//    새 계정에 갑자기 많은 서이추·공감을 하면 네이버가 스팸으로 보고 제재 → 천천히 늘려 계정 보호.
const WARMUP_STAGES = [
  {maxDay:2,       stage:1, label:"새싹", emoji:"🌱", neighbor:10, engage:10, color:"#22c55e"},
  {maxDay:6,       stage:2, label:"성장", emoji:"🌿", neighbor:20, engage:20, color:"#10b981"},
  {maxDay:13,      stage:3, label:"안정", emoji:"🌳", neighbor:40, engage:40, color:"#06b6d4"},
  {maxDay:29,      stage:4, label:"숙련", emoji:"⭐", neighbor:70, engage:70, color:"#3b82f6"},
  {maxDay:Infinity,stage:5, label:"완료", emoji:"🏆", neighbor:100,engage:100,color:"#8b5cf6"},
] as const;
function getWarmup(connectedAt?: string){
  const ageDays = connectedAt ? Math.max(0, Math.floor((Date.now()-new Date(connectedAt).getTime())/86400000)) : 0;
  const s = WARMUP_STAGES.find(w=>ageDays<=w.maxDay) ?? WARMUP_STAGES[WARMUP_STAGES.length-1];
  const progress = Math.min(100, Math.round((ageDays/30)*100)); // 30일이면 워밍업 완주
  return {ageDays, stage:s.stage, label:s.label, emoji:s.emoji, neighbor:s.neighbor, engage:s.engage, color:s.color, progress, done:s.stage===5};
}

// 🚦 트래픽 단품 앱 — 트래픽 유입만 노출. (플레이스/블로그/스토어는 유입 화면 안 서브탭)
//   퍼블리의 발행·서이추·플레이스365 등 나머지 탭은 이 제품에서 숨긴다. 계정·설정만 필수로 유지.
const NAV_GROUPS = [
  {label:"트래픽",boxed:true,tabs:[
    {k:"inflow",i:"🚦",l:"트래픽 유입"},
  ]},
  {label:"계정·설정",tabs:[
    {k:"accounts",i:"🔗",l:"계정 관리"},{k:"settings",i:"⚙️",l:"설정"},
  ]},
] as const satisfies ReadonlyArray<{label:string;boxed?:boolean;tabs:ReadonlyArray<{k:MainTab;i:string;l:string;shine?:boolean}>}>;
const MAIN_TABS: ReadonlyArray<{k:MainTab;i:string;l:string}> = NAV_GROUPS.flatMap(group=>
  group.tabs as unknown as ReadonlyArray<{k:MainTab;i:string;l:string}>
);

const DM_TEMPLATES = [
  {label:"🎁 체험단 제안",message:"안녕하세요, [이름]님 😊 콘텐츠를 인상 깊게 보고 연락드렸어요. [브랜드명]의 [상품명]을 직접 체험해 보실 수 있도록 제안드리고 싶어요. 관심 있으시면 편하게 답장 부탁드려요!"},
  {label:"🤝 협찬 제안",message:"안녕하세요, [이름]님. [브랜드명] 담당자입니다. [이름]님의 콘텐츠 분위기와 저희 [상품명]이 잘 어울릴 것 같아 협업을 제안드려요. 자세한 내용이 궁금하시면 답장 부탁드립니다 😊"},
  {label:"💬 부드러운 첫인사",message:"안녕하세요, [이름]님 😊 평소 콘텐츠를 잘 보고 있어요. 함께 재미있는 콘텐츠를 만들어볼 수 있을 것 같아 조심스럽게 연락드렸습니다. 괜찮으시면 간단한 제안 내용을 보내드려도 될까요?"},
] as const;

function KeyInput({k}:{k:any; [x:string]:any}) {
  const [val,setVal]=useState(()=>localStorage.getItem(k.storageKey)||"");
  const [show,setShow]=useState(false);
  const [saved,setSaved]=useState(false);
  function save(){if(!val.trim())return;localStorage.setItem(k.storageKey,val.trim());setSaved(true);setTimeout(()=>setSaved(false),2500);}
  return (
    <div style={{marginBottom:10,padding:"12px 14px",borderRadius:12,border:"1px solid var(--border)",background:"var(--bg)"}}>
      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
        <div style={{width:24,height:24,borderRadius:7,background:`${k.color}20`,color:k.color,display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:900,flexShrink:0}}>{k.logo}</div>
        <span style={{fontSize:13,fontWeight:700,color:"var(--text)"}}>{k.label}</span>
        <span style={{fontSize:10,color:"var(--text2)"}}>{k.sub}</span>
        <a href={k.link} target="_blank" rel="noopener noreferrer" style={{marginLeft:"auto",fontSize:11,color:"var(--accent-text)",textDecoration:"none",fontWeight:600}}>키 발급 →</a>
      </div>
      <div style={{display:"flex",gap:6}}>
        <input className="inp" type={show?"text":"password"} placeholder={k.placeholder} value={val} onChange={e=>setVal(e.target.value)} style={{flex:1,fontSize:13,padding:"9px 12px"}}/>
        <button className="btn-ghost" onClick={()=>setShow(s=>!s)}>{show?"숨김":"표시"}</button>
        <button style={{padding:"9px 16px",borderRadius:8,border:"none",background:saved?"#f0417a":"var(--accent)",color:"#000",cursor:"pointer",fontSize:12,fontWeight:800,fontFamily:"inherit",transition:"all .2s"}} onClick={save}>{saved?"✓":"저장"}</button>
      </div>
    </div>
  );
}
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;600;700;800;900&family=Space+Grotesk:wght@500;700;800&family=JetBrains+Mono:wght@400;500&display=swap');
*{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent;}
@keyframes fadeUp{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}
@keyframes spin{to{transform:rotate(360deg)}}
@keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-7px)}}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
@keyframes dlFloat{0%,100%{transform:translateY(0) scale(1)}50%{transform:translateY(-5px) scale(1.02)}}
@keyframes guideFloat{0%,100%{transform:translateY(0)}50%{transform:translateY(-4px)}}
@keyframes guideIn{from{opacity:0;transform:scale(.92) translateY(20px)}to{opacity:1;transform:scale(1) translateY(0)}}
@keyframes imgIn{from{opacity:0;transform:scale(.88)}to{opacity:1;transform:scale(1)}}
.app.dark{
  /* 웜 에스프레소 다크(너무 어둡지 않게) + 로즈 포인트 — 2026-08-28 리디자인 */
  --bg:#241e17;--bg2:#2b2419;--card:#2e271e;--card2:#352d22;--card-hover:#3b3227;
  --border:#43392e;--border2:#52463a;--border-focus:#ff6fa1;
  --text:#f6eddd;--text2:#c6b7a1;--text3:#a99d8b;
  --accent:#ff6fa1;--accent-dim:rgba(255,111,161,.1);--accent-30:rgba(255,111,161,.3);
  --accent-text:#ff8fb4;--accent-bg:rgba(255,111,161,.1);--accent-border:rgba(255,111,161,.28);
  --pink:#FF6B9D;--pink-bg:rgba(255,107,157,.1);--pink-border:rgba(255,107,157,.28);
  --yellow:#FFD93D;--yellow-bg:rgba(255,217,61,.08);--yellow-border:rgba(255,217,61,.25);
  --purple:#c3a6ff;--purple-bg:rgba(195,166,255,.1);
  --naver:#03C75A;--tistory:#FF6B35;
  --danger:#ff7a6b;--warn:#ffb454;--info:#f0b657;--success:#5fd39b;
  --header-bg:rgba(36,30,23,.94);--shadow:0 4px 24px rgba(0,0,0,.4);
  --g-fg:#f6eddd;--g-fg2:rgba(246,237,221,.72);--g-green:#ff6fa1;--g-yellow:#FFD93D;--g-pink:#FF6B9D;--g-surface:#2a2318;--g-surface2:#322a1e;--g-line:rgba(255,255,255,.08);
}
.app.light{
  /* 웜 페이퍼 라이트 + 로즈 포인트 — 2026-08-28 리디자인 */
  --bg:#f3efe6;--bg2:#fffdf8;--card:#fffdf8;--card2:#f8f3ea;--card-hover:#f1ebe0;
  --border:#e9e1d3;--border2:#dccfba;--border-focus:#f0417a;
  --text:#241d16;--text2:#6d6353;--text3:#a99d89;
  --accent:#f0417a;--accent-dim:rgba(240,65,122,.08);--accent-30:rgba(240,65,122,.3);
  --accent-text:#c62c62;--accent-bg:rgba(240,65,122,.08);--accent-border:rgba(240,65,122,.25);
  --pink:#e0396d;--pink-bg:rgba(224,57,109,.07);--pink-border:rgba(224,57,109,.25);
  --yellow:#b57e12;--yellow-bg:rgba(181,126,18,.08);--yellow-border:rgba(181,126,18,.25);
  --purple:#6d4fcc;--purple-bg:rgba(109,79,204,.07);
  --naver:#03C75A;--tistory:#FF6B35;
  --danger:#cf222e;--warn:#9a6700;--info:#c62c62;--success:#1a7f37;
  --header-bg:rgba(243,239,230,.95);--shadow:0 2px 12px rgba(60,45,30,.07);
  --g-fg:#241d16;--g-fg2:#6d6353;--g-green:#0a8f57;--g-yellow:#956e00;--g-pink:#d6336c;--g-surface:#fffdf8;--g-surface2:#f5efe4;--g-line:#e9e1d3;
}
.app{width:100vw;height:100dvh;font-family:'Noto Sans KR',sans-serif;color:var(--text);background:var(--bg);display:flex;flex-direction:column;overflow:hidden;transition:background .2s,color .2s;}
*::-webkit-scrollbar{width:5px;}*::-webkit-scrollbar-thumb{background:var(--border2);border-radius:99px;}
.header{min-height:58px;flex-shrink:0;display:flex;align-items:center;flex-wrap:wrap;padding:8px 16px;gap:10px;background:var(--header-bg);border-bottom:1px solid var(--border);backdrop-filter:blur(24px);position:sticky;top:0;z-index:100;}
.logo{display:flex;align-items:center;gap:9px;text-decoration:none;flex-shrink:0;}
.logo-ico{width:34px;height:34px;border-radius:10px;background:linear-gradient(135deg,#f0417a,#ff8a4c);display:flex;align-items:center;justify-content:center;flex-shrink:0;box-shadow:0 2px 12px rgba(240,65,122,.4);}
.logo-text{font-size:17px;font-weight:900;letter-spacing:.18em;color:var(--accent-text);font-family:'Space Grotesk',sans-serif;}
.header-mid{display:flex;align-items:center;gap:8px;flex:1;justify-content:center;flex-wrap:wrap;}
.plat-btn{padding:5px 12px;border-radius:99px;border:1.5px solid;font-size:11px;font-weight:700;cursor:pointer;font-family:'Noto Sans KR',sans-serif;transition:all .15s;white-space:nowrap;flex-shrink:0;}
.plat-btn-naver{background:rgba(3,199,90,.1);color:var(--naver);border-color:rgba(3,199,90,.4);}
.plat-btn-naver-off{background:transparent;color:var(--text2);border-color:var(--border);}
.plat-btn-tistory{background:rgba(255,107,53,.1);color:var(--tistory);border-color:rgba(255,107,53,.4);}
.plat-btn-tistory-off{background:transparent;color:var(--text2);border-color:var(--border);}
.header-right{display:flex;align-items:center;gap:6px;margin-left:auto;}
.server-chip{display:flex;align-items:center;gap:5px;padding:5px 12px;border-radius:99px;font-size:11px;font-weight:700;border:1px solid;white-space:nowrap;}
.server-on{background:rgba(0,214,143,.1);color:var(--success);border-color:rgba(0,214,143,.3);}
.server-off{background:rgba(120,120,120,.06);color:var(--text2);border-color:var(--border);}
.proxy-chip{background:rgba(245,180,30,.14);color:#d99400;border-color:rgba(245,180,30,.45);}
.proxy-chip .dot{background:#f5b41e;box-shadow:0 0 6px #f5b41e;animation:proxyBlink 1s ease-in-out infinite;}
@keyframes proxyBlink{0%,100%{opacity:1;transform:scale(1);}50%{opacity:.25;transform:scale(.7);}}
.proxy-mini{display:flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:99px;background:rgba(245,180,30,.14);border:1px solid rgba(245,180,30,.45);flex-shrink:0;}
.proxy-mini .dot{width:8px;height:8px;background:#f5b41e;box-shadow:0 0 6px #f5b41e;animation:proxyBlink 1s ease-in-out infinite;}
.dot{width:6px;height:6px;border-radius:50%;flex-shrink:0;}
.dot-on{background:var(--success);box-shadow:0 0 6px var(--success);animation:pulse 1.5s ease-in-out infinite;}
.dot-off{background:var(--text3);}
.quota-chip{display:flex;align-items:center;gap:7px;padding:5px 12px;border-radius:99px;background:var(--card);border:1px solid var(--border);font-size:12px;font-weight:600;color:var(--text2);white-space:nowrap;}
.quota-bar-bg{width:56px;height:4px;background:var(--border);border-radius:99px;overflow:hidden;}
.quota-bar-fill{height:100%;background:var(--accent);border-radius:99px;transition:width .4s;}
.plan-badge{font-size:10px;font-weight:800;padding:3px 10px;border-radius:99px;letter-spacing:.08em;}
.plan-free{background:rgba(120,120,120,.1);color:var(--text2);border:1px solid var(--border);}
.plan-basic{background:rgba(77,166,255,.1);color:var(--info);border:1px solid rgba(77,166,255,.25);}
.plan-pro{background:rgba(0,214,143,.1);color:var(--success);border:1px solid rgba(0,214,143,.25);}
.icon-btn{width:36px;height:36px;border-radius:9px;display:flex;align-items:center;justify-content:center;border:1px solid var(--border);background:transparent;color:var(--text2);cursor:pointer;font-size:15px;transition:all .15s;}
.icon-btn:hover{background:var(--card-hover);color:var(--text);border-color:var(--border-focus);}
.icon-btn:active{transform:scale(.9);}
@keyframes publySpin{to{transform:rotate(360deg);}}
.user-chip{display:flex;align-items:center;gap:7px;padding:5px 12px;border-radius:99px;background:var(--card);border:1px solid var(--border);cursor:pointer;font-size:12px;font-weight:600;color:var(--text);transition:all .15s;max-width:140px;}
.user-chip:hover{border-color:var(--border-focus);}
.user-avatar{width:22px;height:22px;border-radius:7px;background:var(--accent-bg);border:1px solid var(--accent-border);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;color:var(--accent-text);flex-shrink:0;}
.user-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.logout-btn{padding:6px 13px;border-radius:8px;border:1px solid var(--border);background:transparent;color:var(--text2);cursor:pointer;font-size:12px;font-weight:600;font-family:'Noto Sans KR',sans-serif;transition:all .15s;}
.logout-btn:hover{border-color:var(--danger);color:var(--danger);}
.dl-btn{display:inline-flex;align-items:center;gap:7px;padding:8px 16px;border-radius:99px;border:none;background:linear-gradient(135deg,#f0417a,#ff8a4c);color:#000;font-size:12px;font-weight:800;font-family:'Noto Sans KR',sans-serif;cursor:pointer;text-decoration:none;animation:dlFloat 2.5s ease-in-out infinite;white-space:nowrap;flex-shrink:0;box-shadow:0 3px 14px rgba(240,65,122,.35);}
.guide-open-btn{display:inline-flex;align-items:center;gap:6px;padding:8px 15px;border-radius:99px;border:none;background:linear-gradient(135deg,#FF6B9D,#FF3D7F);color:#fff;font-size:12px;font-weight:800;font-family:'Noto Sans KR',sans-serif;cursor:pointer;animation:guideFloat 2.8s ease-in-out infinite;white-space:nowrap;flex-shrink:0;box-shadow:0 3px 14px rgba(255,61,127,.35);}
.video-open-btn{display:inline-flex;align-items:center;gap:6px;padding:8px 15px;border-radius:99px;border:1px solid var(--border);background:transparent;color:var(--text2);font-size:12px;font-weight:800;font-family:'Noto Sans KR',sans-serif;cursor:pointer;white-space:nowrap;flex-shrink:0;transition:all .15s;}
.video-open-btn:hover{border-color:#FF3D7F;color:#FF6B9D;}
.video-overlay{position:fixed;inset:0;z-index:300;background:rgba(0,0,0,.9);display:flex;align-items:center;justify-content:center;padding:2vh;}
.video-frame{position:relative;width:100%;max-width:1000px;aspect-ratio:16/9;max-height:96vh;border-radius:16px;overflow:hidden;box-shadow:0 20px 80px rgba(0,0,0,.6);background:#000;}
.video-frame iframe,.video-frame video{width:100%;height:100%;border:none;display:block;}
.video-close{position:absolute;top:12px;right:12px;z-index:5;width:40px;height:40px;border-radius:50%;border:1px solid rgba(255,255,255,.25);background:rgba(20,12,20,.55);backdrop-filter:blur(8px);color:#fff;font-size:16px;cursor:pointer;display:flex;align-items:center;justify-content:center;}
.layout{flex:1;display:flex;overflow:hidden;min-height:0;}
.sidebar{position:relative;flex-shrink:0;z-index:50;width:210px;background:var(--bg2);border-right:1px solid var(--border);display:flex;flex-direction:column;padding:12px 8px;gap:2px;overflow-y:auto;}
.nav-lbl{font-size:9px;font-weight:800;letter-spacing:.13em;text-transform:uppercase;color:var(--text3);padding:5px 11px 7px;margin-top:4px;}
/* 플레이스 세트: 플레이스365+리뷰답글을 테두리로 묶어 한 눈에 */
.nav-box{margin:8px 6px;padding:6px 6px 7px;border:1.5px solid var(--accent-soft,rgba(240,65,122,.35));border-radius:12px;background:linear-gradient(180deg,rgba(240,65,122,.06),rgba(240,65,122,.02));position:relative;}
.nav-box-lbl{font-size:9px;font-weight:800;letter-spacing:.13em;text-transform:uppercase;color:#16856b;padding:2px 6px 6px;display:flex;align-items:center;gap:4px;}
.nav-box-lbl::before{content:"🏪";font-size:11px;}
.dark .nav-box{border-color:rgba(34,168,128,.4);background:linear-gradient(180deg,rgba(34,168,128,.08),rgba(34,168,128,.02));}
.dark .nav-box-lbl{color:#5fd3ac;}
.nav-item{display:flex;align-items:center;gap:10px;padding:11px 12px;border-radius:9px;border:none;cursor:pointer;width:100%;font-size:13px;font-weight:500;font-family:'Noto Sans KR',sans-serif;color:var(--text2);background:transparent;transition:all .15s;text-align:left;position:relative;}
.nav-item:hover{background:var(--card-hover);color:var(--text);}
.nav-item.active{background:var(--accent-bg);color:var(--accent-text);font-weight:700;border:1px solid var(--accent-border);}
.nav-item.active::before{content:'';position:absolute;left:0;top:22%;bottom:22%;width:3px;border-radius:99px;background:var(--accent);}
.nav-ico{font-size:16px;flex-shrink:0;}
.nav-badge{margin-left:auto;font-size:10px;font-weight:800;padding:2px 7px;border-radius:99px;background:var(--accent-bg);color:var(--accent-text);border:1px solid var(--accent-border);}
.sidebar-foot{margin-top:auto;padding:12px 6px 4px;border-top:1px solid var(--border);display:grid;grid-template-columns:1fr 1fr;gap:6px;}
.stat-card{padding:10px 12px;border-radius:11px;background:var(--card);border:1px solid var(--border);}
.stat-num{font-size:22px;font-weight:900;color:var(--text);line-height:1;font-family:'Space Grotesk',sans-serif;}
.stat-lbl{font-size:9px;color:var(--text2);margin-top:3px;font-weight:600;}
.main{flex:1;overflow-y:auto;padding:20px;min-width:0;}
.card{background:var(--card);border:1px solid var(--border);border-radius:16px;padding:20px 22px;margin-bottom:14px;transition:border-color .15s;box-shadow:var(--shadow);}
.card:hover{border-color:var(--border2);}
.card-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:8px;}
.card-title{font-size:12px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:var(--text2);display:flex;align-items:center;gap:7px;}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;padding:12px 22px;border-radius:10px;border:none;font-size:14px;font-weight:700;font-family:'Noto Sans KR',sans-serif;cursor:pointer;transition:all .15s;white-space:nowrap;}
.btn:disabled{opacity:.42;cursor:not-allowed;}
.btn-primary{background:linear-gradient(135deg,var(--accent),#ff8a4c);color:#000;box-shadow:0 3px 14px var(--accent-30);}
.btn-primary:hover:not(:disabled){filter:brightness(1.08);transform:translateY(-1px);}
.btn-secondary{background:var(--card2);color:var(--text);border:1px solid var(--border);}
.btn-secondary:hover:not(:disabled){background:var(--card-hover);border-color:var(--border2);}
.btn-danger{background:rgba(255,83,99,.1);color:var(--danger);border:1px solid rgba(255,83,99,.3);}
.btn-danger:hover:not(:disabled){background:rgba(255,83,99,.18);}
.btn-full{width:100%;}
.btn-xl{padding:16px 28px;font-size:16px;border-radius:12px;}
.btn-sm{padding:8px 16px;font-size:12px;border-radius:8px;}
.btn-ghost{padding:8px 13px;border-radius:8px;border:1px solid var(--border);background:transparent;color:var(--text2);cursor:pointer;font-size:12px;font-family:'Noto Sans KR',sans-serif;transition:all .15s;}
.btn-ghost:hover{background:var(--card-hover);color:var(--text);}
.btn-stop{background:rgba(255,83,99,.1);color:var(--danger);border:1.5px solid rgba(255,83,99,.35);padding:9px 18px;border-radius:99px;font-size:13px;font-weight:800;font-family:'Noto Sans KR',sans-serif;cursor:pointer;display:inline-flex;align-items:center;gap:7px;transition:all .15s;}
.btn-stop:hover{background:rgba(255,83,99,.2);}
.flow-nav{display:flex;align-items:center;justify-content:center;gap:10px;margin:20px 0 4px;flex-wrap:wrap;}
.flow-btn{display:inline-flex;align-items:center;gap:8px;padding:14px 26px;border-radius:99px;border:none;font-size:15px;font-weight:800;font-family:'Noto Sans KR',sans-serif;cursor:pointer;transition:all .18s;}
.flow-btn:hover:not(:disabled){transform:translateY(-2px);}
.flow-btn:disabled{opacity:.4;cursor:not-allowed;}
.flow-btn-g{background:linear-gradient(135deg,var(--accent),#ff8a4c);color:#000;box-shadow:0 4px 20px var(--accent-30);}
.flow-btn-skip{background:var(--card2);color:var(--text2);border:1px solid var(--border);}
.inp{width:100%;padding:12px 14px;border-radius:9px;border:1.5px solid var(--border);background:var(--bg);color:var(--text);font-size:14px;font-family:'Noto Sans KR',sans-serif;outline:none;transition:all .15s;}
.inp:focus{border-color:var(--border-focus);box-shadow:0 0 0 3px rgba(77,166,255,.12);}
.inp::placeholder{color:var(--text3);}
/* ★숫자 입력 화살표(스피너) 제거 — 오작동(값 흔들림) 방지, 직접 입력에 집중 */
.inp[type=number]::-webkit-outer-spin-button,.inp[type=number]::-webkit-inner-spin-button{-webkit-appearance:none;margin:0;}
.inp[type=number]{-moz-appearance:textfield;appearance:textfield;}
.inp.lg{font-size:17px;padding:15px 16px;}
.inp-label{font-size:12px;font-weight:700;color:var(--text2);display:block;margin-bottom:6px;}
select.inp{cursor:pointer;appearance:auto;}
.dark select.inp{color-scheme:dark;}.light select.inp{color-scheme:light;}
textarea.inp{resize:vertical;line-height:1.75;min-height:80px;}
.spinner{width:16px;height:16px;border-radius:50%;border:2.5px solid rgba(0,0,0,.15);border-top-color:#000;animation:spin .7s linear infinite;display:inline-block;flex-shrink:0;}
.sp-w{border-color:rgba(255,255,255,.2);border-top-color:#fff;}
.sp-g{border-color:rgba(240,65,122,.2);border-top-color:var(--accent);}
.steps{display:flex;border-radius:13px;overflow:hidden;border:1px solid var(--border);margin-bottom:20px;background:var(--bg2);}
.step-item{flex:1;padding:11px 8px;text-align:center;font-size:12px;font-weight:600;color:var(--text3);background:transparent;border-right:1px solid var(--border);transition:all .2s;}
.step-item:last-child{border-right:none;}
.step-item.done{background:rgba(0,214,143,.06);color:var(--success);}
.step-item.active{background:var(--accent-bg);color:var(--accent-text);font-weight:800;}
.step-n{font-size:9px;display:block;margin-bottom:2px;opacity:.7;font-family:'Space Grotesk',sans-serif;font-weight:700;}
.adtype-row{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px;}
.adtype-btn{padding:15px 16px;border-radius:13px;border:2px solid var(--border);background:var(--bg);cursor:pointer;text-align:left;font-family:'Noto Sans KR',sans-serif;transition:all .18s;position:relative;}
.adtype-btn.sel-adpost{border-color:var(--naver);background:rgba(3,199,90,.07);}
.adtype-btn.sel-adsense{border-color:var(--info);background:rgba(77,166,255,.07);}
.adtype-lbl{font-size:14px;font-weight:800;color:var(--text);margin-bottom:3px;}
.adtype-sub{font-size:11px;color:var(--text2);line-height:1.55;}
.title-grid{display:grid;gap:8px;grid-template-columns:repeat(auto-fill,minmax(270px,1fr));max-height:420px;overflow-y:auto;padding-right:3px;}
.title-card{padding:14px 15px;border-radius:11px;border:1.5px solid var(--border);background:var(--bg);cursor:pointer;text-align:left;font-family:'Noto Sans KR',sans-serif;transition:all .15s;position:relative;}
.title-card:hover{border-color:var(--border-focus);background:var(--card-hover);}
.title-card.sel{border-color:var(--accent);background:var(--accent-bg);}
.title-n{font-size:9px;color:var(--text3);margin-bottom:5px;font-family:'Space Grotesk',sans-serif;font-weight:600;}
.title-card.sel .title-n{color:var(--accent-text);}
.title-t{font-size:13px;font-weight:600;color:var(--text);line-height:1.55;}
.title-card.sel .title-t{color:var(--accent-text);font-weight:700;}
.title-chk{position:absolute;top:9px;right:9px;width:19px;height:19px;border-radius:50%;background:var(--accent);display:flex;align-items:center;justify-content:center;font-size:9px;color:#000;font-weight:900;}
.sel-banner{padding:12px 15px;border-radius:11px;background:var(--accent-bg);border:1.5px solid var(--accent-border);margin-bottom:14px;animation:fadeUp .2s ease both;}
.sel-banner-lbl{font-size:10px;color:var(--accent-text);font-weight:700;margin-bottom:3px;}
.sel-banner-txt{font-size:14px;font-weight:800;color:var(--text);}
.img-gallery{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;}
.img-tw{position:relative;}
.img-th{width:88px;height:88px;object-fit:cover;border-radius:11px;border:2px solid var(--border);display:block;animation:imgIn .25s ease both;}
.img-th.first{border-color:var(--accent);box-shadow:0 0 10px var(--accent-30);}
.img-tb{position:absolute;top:-7px;left:-4px;font-size:9px;font-weight:800;padding:2px 7px;border-radius:99px;background:var(--accent);color:#000;}
.img-td{position:absolute;top:-6px;right:-6px;width:19px;height:19px;border-radius:50%;background:var(--danger);border:none;color:#fff;cursor:pointer;font-size:10px;display:flex;align-items:center;justify-content:center;}
.img-td:hover{transform:scale(1.15);}
.img-prog{height:5px;background:var(--border);border-radius:99px;overflow:hidden;margin:10px 0 6px;}
.img-prog-fill{height:100%;background:linear-gradient(90deg,var(--accent),#ff8a4c);border-radius:99px;transition:width .4s;}
.concept-grid{display:grid;gap:10px;}
.concept-btn{padding:16px 18px;border-radius:13px;border:2px solid var(--border);background:var(--bg);cursor:pointer;text-align:left;font-family:'Noto Sans KR',sans-serif;transition:all .18s;}
.concept-btn.sel-full{border-color:var(--accent);background:var(--accent-bg);}
.concept-btn.sel-faq{border-color:var(--pink);background:var(--pink-bg);}
.concept-btn.sel-body{border-color:var(--yellow);background:var(--yellow-bg);}
.concept-ico{font-size:22px;margin-bottom:7px;}
.concept-name{font-size:15px;font-weight:800;color:var(--text);margin-bottom:4px;}
.concept-sub{font-size:12px;color:var(--text2);line-height:1.6;white-space:pre-line;}
.acc-card{display:flex;align-items:center;gap:10px;padding:14px 16px;border-radius:13px;border:1.5px solid var(--border);background:var(--card);margin-bottom:10px;animation:fadeUp .25s ease both;transition:all .18s;flex-wrap:wrap;}
.acc-card.conn-naver{border-color:rgba(3,199,90,.35);}
.acc-card.conn-tistory{border-color:rgba(255,107,53,.35);}
.hist-item{display:flex;align-items:center;gap:12px;padding:14px 0;border-bottom:1px solid var(--border);animation:fadeUp .25s ease both;}
.hist-info{flex:1;min-width:0;}
.hist-title{font-size:14px;font-weight:600;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.hist-meta{font-size:11px;color:var(--text2);margin-top:2px;font-family:'JetBrains Mono',monospace;}
.sbadge{font-size:11px;font-weight:700;padding:4px 11px;border-radius:99px;white-space:nowrap;}
.sbadge-ok{background:rgba(0,214,143,.1);color:var(--success);border:1px solid rgba(0,214,143,.25);}
.sbadge-fail{background:rgba(255,83,99,.1);color:var(--danger);border:1px solid rgba(255,83,99,.2);}
.sbadge-pend{background:rgba(255,159,63,.1);color:var(--warn);border:1px solid rgba(255,159,63,.25);}
.view-link{font-size:12px;color:var(--accent-text);text-decoration:none;padding:5px 12px;border-radius:8px;background:var(--accent-bg);border:1px solid var(--accent-border);flex-shrink:0;font-weight:600;}
.ai-grid{display:flex;gap:9px;flex-wrap:wrap;margin-bottom:16px;}
.ai-card{flex:1;min-width:120px;padding:13px 12px;border-radius:12px;border:2px solid var(--border);background:var(--bg);cursor:pointer;text-align:left;font-family:'Noto Sans KR',sans-serif;transition:all .2s;}
.ai-card.sel-ai{transform:translateY(-2px);}
.ai-card-top{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;}
.ai-logo{width:27px;height:27px;border-radius:7px;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:900;}
.ai-name{font-size:12px;font-weight:700;color:var(--text);}
.ai-sub{font-size:10px;color:var(--text2);margin-top:2px;}
.ai-sel-badge{font-size:9px;font-weight:800;padding:2px 7px;border-radius:99px;color:#000;}
.ai-free{font-size:9px;font-weight:800;padding:2px 7px;border-radius:99px;background:rgba(0,214,143,.12);color:var(--success);}
.ai-paid{font-size:9px;font-weight:800;padding:2px 7px;border-radius:99px;background:rgba(255,159,63,.12);color:var(--warn);}
.alert-box{padding:13px 16px;border-radius:11px;font-size:13px;margin-bottom:14px;display:flex;align-items:flex-start;gap:10px;line-height:1.6;font-weight:500;}
.alert-warn{background:rgba(255,159,63,.07);border:1px solid rgba(255,159,63,.25);color:var(--warn);}
.alert-info{background:rgba(77,166,255,.07);border:1px solid rgba(77,166,255,.25);color:var(--info);}
.alert-success{background:rgba(0,214,143,.07);border:1px solid rgba(0,214,143,.25);color:var(--success);}
.alert-danger{background:rgba(255,83,99,.07);border:1px solid rgba(255,83,99,.25);color:var(--danger);}
.empty-state{text-align:center;padding:56px 24px;animation:fadeUp .3s ease both;}
.empty-ico{font-size:52px;margin-bottom:14px;display:block;animation:float 3s ease-in-out infinite;}
.empty-title{font-size:18px;font-weight:800;color:var(--text);margin-bottom:8px;}
.empty-sub{font-size:14px;color:var(--text2);margin-bottom:22px;line-height:1.65;}
.key-section{padding:15px 17px;border-radius:12px;border:1px solid var(--border);margin-bottom:12px;}
.key-section-title{font-size:11px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:var(--text2);margin-bottom:12px;display:flex;align-items:center;gap:6px;}
.info-table{border:1px solid var(--border);border-radius:11px;overflow:hidden;}
.info-row{display:flex;align-items:center;justify-content:space-between;padding:13px 16px;border-bottom:1px solid var(--border);}
.info-row:last-child{border-bottom:none;}
.info-row:hover{background:var(--card-hover);}
.info-key{font-size:13px;color:var(--text2);}
.info-val{font-size:14px;font-weight:700;color:var(--text);}
.preview-overlay{position:fixed;inset:0;z-index:500;background:rgba(0,0,0,.85);display:flex;align-items:center;justify-content:center;padding:16px;}
.preview-inner{width:100%;max-width:720px;max-height:92vh;overflow-y:auto;background:#fff;border-radius:18px;padding:32px 28px;animation:guideIn .3s ease both;}
.guide-overlay{position:fixed;inset:0;z-index:999;background:rgba(0,0,0,.78);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;padding:max(12px,env(safe-area-inset-top)) 12px max(12px,env(safe-area-inset-bottom));}
.guide-modal{width:100%;max-width:560px;max-height:calc(100dvh - 24px - env(safe-area-inset-top) - env(safe-area-inset-bottom));border-radius:24px;overflow:hidden;display:flex;flex-direction:column;animation:guideIn .32s cubic-bezier(.34,1.56,.64,1) both;box-shadow:0 32px 80px rgba(0,0,0,.6);position:relative;}
.guide-header{padding:22px 22px 0;background:var(--g-surface2);flex-shrink:0;border-bottom:1px solid var(--g-line);}
.guide-logo-row{display:flex;align-items:center;gap:10px;margin-bottom:14px;}
.guide-logo-ico{width:40px;height:40px;border-radius:12px;background:linear-gradient(135deg,#f0417a,#ff8a4c);display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0;}
.guide-title{font-size:20px;font-weight:900;color:var(--g-fg);}
.guide-subtitle{font-size:12px;color:var(--g-fg2);margin-top:3px;}
.guide-tabs{display:flex;overflow-x:auto;scrollbar-width:none;}
.guide-tabs::-webkit-scrollbar{display:none;}
.guide-tab{padding:11px 16px;border:none;background:transparent;font-size:12px;font-weight:700;color:var(--g-fg2);cursor:pointer;font-family:'Noto Sans KR',sans-serif;white-space:nowrap;border-bottom:3px solid transparent;transition:all .15s;flex-shrink:0;}
.guide-tab.active{color:var(--g-yellow);border-bottom-color:var(--g-yellow);}
.guide-body{flex:1;overflow-y:auto;background:var(--g-surface);padding:18px 18px 22px;min-height:0;}
.guide-body::-webkit-scrollbar{width:4px;}
.guide-body::-webkit-scrollbar-thumb{background:var(--g-line);border-radius:99px;}
.guide-close{position:absolute;top:14px;right:16px;width:32px;height:32px;border-radius:99px;background:var(--g-surface2);border:1px solid var(--g-line);color:var(--g-fg);cursor:pointer;font-size:15px;display:flex;align-items:center;justify-content:center;z-index:10;}
.guide-close:hover{filter:brightness(.94);}
.g-step{border-radius:15px;padding:15px 15px;margin-bottom:10px;border:1.5px solid;}
.g-step-num{font-size:10px;font-weight:900;letter-spacing:.1em;text-transform:uppercase;margin-bottom:5px;display:flex;align-items:center;gap:6px;}
.g-step-title{font-size:15px;font-weight:900;margin-bottom:5px;line-height:1.3;}
.g-step-desc{font-size:13px;line-height:1.85;color:var(--g-fg2);}
.g-step-desc b{font-weight:900;color:var(--g-fg);}
.g-tip{margin-top:9px;padding:9px 12px;border-radius:9px;background:var(--g-surface2);font-size:12px;line-height:1.75;color:var(--g-fg2);}
.g-tip b{font-weight:800;color:var(--g-yellow);}
.g-btn{display:inline-flex;align-items:center;gap:7px;padding:10px 18px;border-radius:99px;border:none;font-size:13px;font-weight:800;font-family:'Noto Sans KR',sans-serif;cursor:pointer;margin-top:11px;transition:all .15s;}
.g-btn:hover{filter:brightness(1.1);transform:translateY(-1px);}
.guide-footer{padding:12px 18px;background:var(--g-surface2);border-top:1px solid var(--g-line);display:flex;align-items:center;justify-content:space-between;flex-shrink:0;gap:10px;flex-wrap:wrap;}
.guide-nav-btn{padding:9px 20px;border-radius:99px;border:1.5px solid;font-size:13px;font-weight:700;font-family:'Noto Sans KR',sans-serif;cursor:pointer;transition:all .15s;}
.guide-page{font-size:12px;color:var(--g-fg2);font-weight:600;}
.mob-bar{display:none;position:fixed;bottom:0;left:0;right:0;z-index:200;background:var(--header-bg);border-top:1px solid var(--border);backdrop-filter:blur(24px);padding:7px 4px max(12px,env(safe-area-inset-bottom));overflow-x:auto;overflow-y:hidden;-webkit-overflow-scrolling:touch;scrollbar-width:none;}
.mob-bar::-webkit-scrollbar{display:none;}
.mob-bar .mob-btn{flex:0 0 auto;min-width:60px;}
.mob-btn{flex:1;display:flex;flex-direction:column;align-items:center;gap:3px;padding:5px 2px;border:none;background:transparent;cursor:pointer;font-family:'Noto Sans KR',sans-serif;transition:all .15s;min-height:50px;border-radius:9px;}
.mob-btn-ico{font-size:21px;}
.mob-btn-lbl{font-size:11px;font-weight:600;color:var(--text2);}
.mob-btn.active{background:var(--accent-bg);}
.mob-btn.active .mob-btn-lbl{color:var(--accent-text);}
.img-split{display:grid;grid-template-columns:300px 1fr;gap:14px;align-items:start;}
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
  .pub-sticky-bar{flex-wrap:wrap;gap:6px;}
  .pub-ready{display:none;}
}
@media(max-width:900px){.sidebar{display:none;}.mob-bar{display:flex;}.main{padding-bottom:130px;}.layout{padding-left:0;}}
@media(max-width:768px){
  .header-mid{display:none;}.server-chip{display:none;}.quota-chip{display:none;}.dl-btn{display:none;}.main{padding:14px 12px calc(80px + env(safe-area-inset-bottom));}.card{padding:16px 14px;}
  .adtype-row{grid-template-columns:1fr 1fr;}.title-grid{grid-template-columns:1fr;}.ai-grid{flex-direction:column;}
  .btn-xl{padding:18px 22px;font-size:17px;}.btn{font-size:15px;padding:13px 18px;}.inp{font-size:16px;}.inp.lg{font-size:18px;}
  .concept-grid{grid-template-columns:1fr;}.steps .step-n{display:none;}.step-item{font-size:13px;padding:13px 6px;}
  .g-step-desc{font-size:14px !important;line-height:1.9 !important;}
  .g-step-title{font-size:16px !important;}
  .nav-item{padding:13px 12px;font-size:14px;}
  .guide-modal{max-width:100%;max-height:calc(100dvh - 20px - env(safe-area-inset-top) - env(safe-area-inset-bottom));border-radius:20px;}.guide-header{padding:16px 16px 0;}
  .guide-body{padding:14px 14px 18px;}.guide-footer{padding:10px 14px;}.preview-inner{padding:20px 14px;}
  .flow-nav{flex-direction:column;align-items:stretch;}.flow-btn{justify-content:center;}
  .pub-grid{grid-template-columns:1fr !important;}
  .pub-panel-desktop{display:none !important;}
  .pub-mobile-bar{display:flex !important;}
  .lg-hidden{display:block;}
  .img-split{grid-template-columns:1fr !important;}
  /* 캘린더 모바일 */
  .cal-grid{grid-template-columns:1fr !important;}
  /* 서이추 모바일 */
  .neighbor-grid{grid-template-columns:1fr !important;}
  /* 카운터 3분할 유지 */
  .counter-grid{grid-template-columns:repeat(3,1fr) !important;}
  .pub-sticky-bar{padding:10px 12px;overflow:hidden;}
  .pub-actions{width:100%;margin-left:0 !important;display:grid !important;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px !important;}
  .pub-actions>button,.pub-actions>div>button{width:100%;justify-content:center;padding:10px 7px !important;}
  .pub-actions>div{min-width:0;}
}
@media(max-width:480px){
  .header{padding:0 8px;gap:5px;}.user-name{display:none;}.logout-btn{display:none;}.quota-chip{display:none;}
  .header-right{gap:5px;min-width:0;flex-shrink:1;overflow:hidden;}
  .header-mid{display:none;}
  .dl-btn span:last-child{display:none;}.dl-btn{padding:9px 12px;}
  .guide-open-btn{font-size:11px;padding:6px 9px;}.guide-open-btn .guide-btn-text{display:none;}
  .video-open-btn{padding:6px 9px;}.video-open-btn .guide-btn-text{display:none;}
  .icon-btn{flex-shrink:0;}
  .video-frame{aspect-ratio:auto;width:100%;height:auto;max-height:92vh;}
  .adtype-row{grid-template-columns:1fr;}.guide-overlay{padding:6px;}
  .guide-modal{max-height:calc(100dvh - 12px - env(safe-area-inset-top) - env(safe-area-inset-bottom));border-radius:16px;}.guide-tab{font-size:11px;padding:9px 11px;}
  .acc-form-grid{grid-template-columns:1fr !important;}
  .pub-plat-grid{grid-template-columns:1fr !important;}
  /* 카카오 버튼 모바일 - 아이콘만 + 하단바 위로 */
  .kakao-float-text{display:none;}
  .kakao-float{padding:12px !important;border-radius:50% !important;width:48px;height:48px;justify-content:center;bottom:150px !important;right:16px !important;}
}
.on-service-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;}
.on-service-card{min-width:0;padding:14px;border-radius:14px;border:1px solid var(--border);background:var(--bg);color:var(--text);text-align:left;font-family:inherit;cursor:pointer;transition:transform .18s,border-color .18s;}
.on-service-card:hover{transform:translateY(-2px);border-color:var(--accent);}.on-service-card b{display:block;font-size:13px;margin:8px 0 4px;padding-right:50px}.on-service-card small{display:block;color:var(--text3);font-size:10px;line-height:1.55}.on-service-card em{display:block;color:var(--accent-text);font-size:10px;font-style:normal;font-weight:800;margin-top:9px}
.on-service-card.featured{position:relative;border:1.5px solid transparent;background:linear-gradient(var(--bg),var(--bg)) padding-box,linear-gradient(135deg,#f59e0b,#f7c948) border-box;box-shadow:0 3px 16px rgba(245,158,11,.18);}
.on-service-card.featured:hover{border-color:transparent;transform:translateY(-3px);box-shadow:0 8px 24px rgba(245,158,11,.32);}
.on-service-card.featured b{color:var(--text)}
.svc-badge{position:absolute;top:7px;right:7px;font-size:8px;font-weight:900;color:#6b3f00;background:linear-gradient(135deg,#ffdf6b,#f5b301);padding:2px 6px;border-radius:99px;box-shadow:0 1px 4px rgba(245,158,11,.4);letter-spacing:.2px;z-index:1;white-space:nowrap;}
.service-info-overlay{position:fixed;inset:0;z-index:9998;display:grid;place-items:center;padding:18px;background:rgba(0,0,0,.72);backdrop-filter:blur(7px)}.service-info-dialog{position:relative;width:min(590px,100%);max-height:88vh;overflow:auto;box-sizing:border-box;padding:27px;border:1px solid rgba(0,214,143,.38);border-radius:23px;background:var(--card);box-shadow:0 24px 80px rgba(0,0,0,.48)}.service-info-close{position:absolute;right:14px;top:10px;border:0;background:transparent;color:var(--text3);font-size:27px;cursor:pointer}.service-info-kicker{color:var(--accent-text);font-size:10px;font-weight:900;letter-spacing:.08em}.service-info-dialog h2{margin:7px 35px 8px 0;font-size:24px}.service-info-hook{color:var(--text2);font-size:14px;line-height:1.65}.service-info-benefits{display:grid;gap:8px;margin:18px 0}.service-info-benefit{padding:12px;border:1px solid var(--border);border-radius:12px;background:var(--bg)}.service-info-benefit b,.service-info-benefit span{display:block}.service-info-benefit b{font-size:13px}.service-info-benefit span{margin-top:3px;color:var(--text3);font-size:11px;line-height:1.5}.service-info-flow{padding:12px;border-radius:12px;background:rgba(0,214,143,.09);color:var(--accent-text);font-size:11px;font-weight:800;line-height:1.6}.service-info-footer{display:flex;align-items:center;gap:9px;margin-top:18px}.service-info-cta{flex:1;display:flex;justify-content:center;padding:13px;border:0;border-radius:12px;background:var(--accent);color:#02170f;font-size:13px;font-weight:900;text-decoration:none}.service-info-cta:disabled{opacity:.48}.service-info-coming{padding:8px 10px;border:1px solid rgba(255,80,150,.4);border-radius:999px;color:#ff5a9f;font-size:10px;font-weight:900;white-space:nowrap}
.service-info-overlay.service-info-dark{--card:#111820;--text:#e8f4ff;--text2:#a6bdd0;--text3:#7895aa;--bg:#0d1117;--border:#2a3a49;--accent:#00d68f;--accent-text:#21e6a4}.service-info-overlay.service-info-light{--card:#fff;--text:#0d1f2d;--text2:#3f596d;--text3:#607c91;--bg:#f2f6f9;--border:#cbd8e2;--accent:#00c781;--accent-text:#08794f}.service-info-dialog{color:var(--text)!important;background:var(--card)!important}.service-info-dialog h2,.service-info-benefit{color:var(--text)!important}.service-info-close{width:36px;height:36px;border:1px solid var(--border)!important;border-radius:10px;background:var(--bg)!important;color:var(--text)!important}
@media(max-width:640px){.on-service-grid{display:flex;gap:8px;overflow-x:auto;margin:0 -2px;padding:2px 2px 7px;scrollbar-width:none;scroll-snap-type:x proximity}.on-service-grid::-webkit-scrollbar{display:none}.on-service-card{flex:0 0 160px;min-height:84px;padding:10px 10px 10px 10px;display:grid;grid-template-columns:30px 1fr;column-gap:8px;scroll-snap-align:start}.on-service-card>span{grid-row:1/4;font-size:19px !important}.on-service-card b{font-size:12px;margin:0 0 2px;padding-right:34px}.on-service-card small{font-size:10px;line-height:1.35;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}.on-service-card em{font-size:10px;margin-top:4px}.svc-badge{top:6px;right:6px;font-size:7px;padding:1px 5px;letter-spacing:0}.service-info-dialog{padding:22px 16px;border-radius:19px}.service-info-dialog h2{font-size:21px}.service-info-footer{align-items:stretch;flex-direction:column}.service-info-cta{width:100%;box-sizing:border-box}.service-info-coming{text-align:center}}
.pub-sticky-bar{position:sticky;top:0;z-index:30;background:var(--card);border-bottom:1px solid var(--border);padding:10px 16px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;backdrop-filter:blur(12px);}
.toast-wrap{position:fixed;bottom:28px;right:24px;z-index:9999;display:flex;flex-direction:column;gap:8px;pointer-events:none;}
.toast{padding:12px 18px;border-radius:12px;font-size:13px;font-weight:700;font-family:'Noto Sans KR',sans-serif;box-shadow:0 4px 24px rgba(0,0,0,.35);animation:toastIn .25s ease;pointer-events:all;display:flex;align-items:center;gap:8px;max-width:320px;}
.toast-success{background:#1a2e1a;color:#4ade80;border:1px solid rgba(74,222,128,.25);}
.toast-error{background:#2e1a1a;color:#f87171;border:1px solid rgba(248,113,113,.25);}
.toast-info{background:#1a1f2e;color:#93c5fd;border:1px solid rgba(147,197,253,.25);}
@keyframes toastIn{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
.pub-ready{display:flex;align-items:center;gap:6px;flex-wrap:wrap;}
.pub-ready-chip{display:flex;align-items:center;gap:4px;padding:4px 10px;border-radius:99px;font-size:11px;font-weight:700;border:1px solid;}
.pub-ready-ok{background:rgba(0,214,143,.1);color:var(--success);border-color:rgba(0,214,143,.25);}
.pub-ready-no{background:rgba(255,83,99,.08);color:var(--danger);border-color:rgba(255,83,99,.2);}
.pub-settings-panel{border-top:1px solid var(--border);padding:16px;background:var(--card2);display:grid;grid-template-columns:1fr 1fr;gap:12px;}
@media(max-width:768px){.pub-settings-panel{grid-template-columns:1fr;}}
@media(max-width:900px){.right-panel{display:none;}}
.app.large{font-size:16px;}
/* 큰글씨 모드여도 대표 뱃지는 작게 고정(제목 안 가리게) */
.app.large .svc-badge{font-size:9px;padding:2px 7px;}
.app.large .on-service-card b{padding-right:56px;}
.app.large .nav-item{font-size:15px;padding:13px 12px;}
.app.large .card-title{font-size:14px;}
.app.large .inp{font-size:16px;padding:13px 14px;}
.app.large .inp-label{font-size:14px;}
.app.large .btn{font-size:15px;padding:13px 22px;}
.app.large .btn-sm{font-size:13px;padding:10px 16px;}
.app.large .flow-btn{font-size:16px;}

/* ══ 🎛️ 컨트롤타워 ══ */
.nav-new{margin-left:auto;font-size:9px;font-weight:900;letter-spacing:.5px;color:#fff;background:linear-gradient(135deg,#f43f5e,#f59e0b);padding:2px 7px;border-radius:99px;animation:navNewPulse 2s ease-in-out infinite;}
@keyframes navNewPulse{0%,100%{opacity:1}50%{opacity:.5}}
/* ★콘텐츠 캘린더 '금덩어리' 반짝 강조 — 골드 그라데이션 흐름 + 은은한 빛 테두리 */
.nav-item.nav-shine{position:relative;background:linear-gradient(100deg,rgba(255,196,0,.14),rgba(255,146,10,.10),rgba(255,196,0,.14));background-size:220% 100%;animation:navShineFlow 2.6s linear infinite;border:1px solid rgba(255,180,0,.35);border-radius:10px;overflow:hidden;}
.nav-item.nav-shine::after{content:"";position:absolute;top:0;left:-60%;width:45%;height:100%;background:linear-gradient(90deg,transparent,rgba(255,255,255,.55),transparent);transform:skewX(-20deg);animation:navShineSweep 2.6s ease-in-out infinite;}
.nav-item.nav-shine.active{border-color:rgba(255,180,0,.7);}
@keyframes navShineFlow{0%{background-position:0% 0}100%{background-position:220% 0}}
@keyframes navShineSweep{0%{left:-60%}45%,100%{left:130%}}
.nav-hot{margin-left:auto;font-size:9px;font-weight:900;letter-spacing:.5px;color:#3a2500;background:linear-gradient(135deg,#ffd85e,#ffab2e);padding:2px 7px;border-radius:99px;box-shadow:0 0 8px rgba(255,180,0,.6);animation:navHotGlow 1.6s ease-in-out infinite;}
/* 🔍 크롤링 탭 — 핑크 글자 + 통통 튀는 🔒 + hover 핑크 팝업(관리자 승인) */
.nav-crawl .nav-crawl-label{color:#ff6fa5;font-weight:900;}
.nav-crawl-lock{margin-left:auto;font-size:13px;animation:crawlBob 1.3s ease-in-out infinite;filter:drop-shadow(0 1px 3px rgba(255,111,165,.6));}
@keyframes crawlBob{0%,100%{transform:translateY(0)}50%{transform:translateY(-3px)}}
.nav-crawl-locked{border:1px dashed rgba(255,111,165,.45)!important;border-radius:9px;}
.nav-crawl-locked:hover{background:rgba(255,111,165,.09);}
.crawl-tip{position:absolute;left:6px;right:6px;bottom:calc(100% + 9px);transform:scale(.92);transform-origin:bottom center;text-align:center;white-space:normal;line-height:1.4;background:linear-gradient(135deg,#ff6fa5,#ff9ec4);color:#fff;font-size:11.5px;font-weight:700;padding:8px 11px;border-radius:11px;box-shadow:0 8px 22px rgba(255,111,165,.45);opacity:0;pointer-events:none;transition:all .2s cubic-bezier(.34,1.56,.64,1);z-index:200;}
.crawl-tip::before{content:'';position:absolute;top:100%;left:50%;transform:translateX(-50%);border:6px solid transparent;border-top-color:#ff9ec4;}
.nav-crawl-locked:hover .crawl-tip{opacity:1;transform:scale(1);}
@keyframes crawlPop{0%{opacity:0;transform:scale(.82) translateY(10px)}100%{opacity:1;transform:scale(1) translateY(0)}}
@keyframes navHotGlow{0%,100%{box-shadow:0 0 6px rgba(255,180,0,.5);transform:scale(1)}50%{box-shadow:0 0 14px rgba(255,180,0,.9);transform:scale(1.06)}}
/* 🎉 사진 글쓰기 완성 꽃가루 */
@keyframes confettiFall{0%{transform:translateY(-20px) rotate(0);opacity:1}100%{transform:translateY(105vh) rotate(720deg);opacity:.2}}
.nav-item.nav-control{font-weight:800;}
.nav-item.nav-soon{opacity:.6;}
.nav-item.nav-soon:hover{opacity:.8;}
.nav-soon-badge{margin-left:auto;font-size:9px;font-weight:800;letter-spacing:.3px;color:var(--text3);background:var(--card2);border:1px solid var(--border);padding:2px 7px;border-radius:99px;}
.nav-item.nav-control .nav-ico{filter:drop-shadow(0 0 6px var(--accent-30));}
/* 원터치 발행: 일렉트릭 퍼플 강조 + BEST 배지 */
.nav-item.nav-onetouch{font-weight:800;background:linear-gradient(100deg,rgba(124,58,237,.10),rgba(168,85,247,.06));border:1px solid rgba(124,58,237,.28);border-radius:10px;}
.nav-item.nav-onetouch:hover{background:linear-gradient(100deg,rgba(124,58,237,.16),rgba(168,85,247,.10));}
.nav-item.nav-onetouch.active{border-color:rgba(124,58,237,.6);}
.nav-item.nav-onetouch .nav-ico{filter:drop-shadow(0 0 6px rgba(124,58,237,.55));}
.nav-best{margin-left:auto;font-size:9px;font-weight:900;letter-spacing:.5px;color:#fff;background:linear-gradient(135deg,#7c3aed,#c026d3);padding:2px 7px;border-radius:99px;box-shadow:0 0 8px rgba(124,58,237,.55);animation:navHotGlow 1.7s ease-in-out infinite;}
/* ⚡ 원터치 로그 — 화면 하단에 넓게 고정. 스크롤 안 해도 항상 보임 */
.ot-logdock{position:fixed;left:218px;right:16px;bottom:14px;z-index:180;background:var(--card);border:1.5px solid rgba(124,58,237,.42);border-radius:16px;box-shadow:0 12px 46px rgba(0,0,0,.32);display:flex;flex-direction:column;overflow:hidden;}
.ot-logdock-head{display:flex;align-items:center;gap:8px;padding:11px 15px;border-bottom:1px solid var(--border);background:linear-gradient(135deg,rgba(124,58,237,.14),rgba(192,38,211,.06));flex-wrap:wrap;}
.ot-logdock-body{overflow-y:auto;padding:14px 17px;font-size:13px;line-height:1.75;white-space:pre-wrap;word-break:break-word;font-family:ui-monospace,'SF Mono',Menlo,monospace;color:var(--text);background:var(--bg);}
.ot-logdock-btn{font-size:12px;padding:6px 12px;border-radius:9px;border:1px solid var(--border);background:var(--bg2);color:var(--text2);cursor:pointer;font-weight:800;font-family:inherit;transition:all .15s;}
.ot-logdock-btn:hover{border-color:#7c3aed;color:#7c3aed;}
@media(max-width:900px){.ot-logdock{left:10px;right:10px;bottom:70px;}}
@media (max-width:640px){.loop-arrow{display:none!important;}}

.ct{display:flex;flex-direction:column;gap:20px;max-width:1120px;padding-bottom:20px;}
.ct-hero{display:flex;justify-content:space-between;align-items:flex-start;gap:20px;padding:26px 28px;border-radius:20px;background:linear-gradient(135deg,var(--accent-bg),transparent 65%),var(--card);border:1px solid var(--border);position:relative;overflow:hidden;}
.ct-hero::after{content:'';position:absolute;right:-50px;top:-50px;width:200px;height:200px;border-radius:50%;background:radial-gradient(circle,var(--accent-30),transparent 70%);pointer-events:none;}
.ct-hero-left{position:relative;z-index:1;}
.ct-hero-eyebrow{font-size:12px;font-weight:800;color:var(--accent-text);letter-spacing:.3px;margin-bottom:9px;}
.ct-hero-title{font-size:27px;font-weight:800;color:var(--text);margin:0 0 9px;line-height:1.25;}
.ct-hero-title b{color:var(--accent-text);}
.ct-hero-sub{font-size:13.5px;color:var(--text2);line-height:1.65;margin:0;max-width:580px;}
.ct-hero-sub b{color:var(--text);font-weight:700;}
.ct-hero-plan{flex-shrink:0;text-align:center;padding:16px 22px;border-radius:16px;background:var(--bg);border:1px solid var(--border);min-width:118px;position:relative;z-index:1;}
.ct-plan-badge{font-size:12px;font-weight:800;color:var(--accent-text);margin-bottom:7px;}
.ct-plan-days{font-size:23px;font-weight:800;color:var(--text);line-height:1;}
.ct-plan-lbl{font-size:11px;color:var(--text3);margin-top:5px;}

.ct-section{background:var(--card);border:1px solid var(--border);border-radius:18px;padding:20px 22px;}
.ct-sec-head{margin-bottom:16px;}
.ct-sec-title{font-size:17px;font-weight:800;color:var(--text);margin:0 0 5px;display:flex;align-items:center;gap:9px;flex-wrap:wrap;}
.ct-sec-desc{font-size:12.5px;color:var(--text2);line-height:1.6;margin:0;font-weight:500;}
.ct-sec-desc b{color:#00b487;}
.app.dark .ct-sec-desc b{color:#00e6a8;}
.ct-sec-desc b{color:var(--text2);font-weight:700;}
.ct-tag-soon{font-size:10px;font-weight:800;color:#f59e0b;background:rgba(245,158,11,.14);border:1px solid rgba(245,158,11,.32);padding:2px 9px;border-radius:99px;}

.ct-perf-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;}
.ct-perf-card{text-align:left;padding:16px 16px 14px;border-radius:15px;border:1px solid var(--border);background:var(--bg);cursor:pointer;transition:transform .15s,box-shadow .15s,border-color .15s;font-family:inherit;position:relative;overflow:hidden;}
.ct-perf-card::before{content:'';position:absolute;left:0;top:0;bottom:0;width:4px;background:var(--pc);}
.ct-perf-card:hover{transform:translateY(-3px);box-shadow:0 10px 26px rgba(0,0,0,.16);border-color:var(--pc);}
.ct-perf-card:active{transform:translateY(-1px);}
.ct-perf-top{display:flex;align-items:center;gap:7px;margin-bottom:10px;}
.ct-perf-ico{font-size:18px;}
.ct-perf-name{font-size:13px;font-weight:700;color:var(--text2);}
.ct-perf-num{font-size:30px;font-weight:800;color:var(--text);line-height:1;letter-spacing:-.5px;}
.ct-perf-lim{font-size:13px;font-weight:600;color:var(--text3);letter-spacing:0;}
.ct-perf-bar{height:6px;border-radius:99px;background:var(--card2);overflow:hidden;margin:12px 0 9px;}
.ct-perf-fill{height:100%;border-radius:99px;transition:width .6s ease;}
.ct-perf-hint{font-size:11px;color:var(--text2);line-height:1.4;}

.ct-acc-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px;}
.ct-acc-card{display:flex;align-items:center;gap:11px;padding:13px 15px;border-radius:13px;border:1px solid var(--border);background:var(--bg);}
.ct-acc-card.warn{border-color:rgba(245,158,11,.4);}
.ct-acc-dot{width:9px;height:9px;border-radius:50%;background:var(--success);box-shadow:0 0 0 3px rgba(0,214,143,.18);flex-shrink:0;}
.ct-acc-dot.off{background:#f59e0b;box-shadow:0 0 0 3px rgba(245,158,11,.18);}
.ct-acc-info{flex:1;min-width:0;}
.ct-acc-name{font-size:13.5px;font-weight:700;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.ct-acc-plat{font-size:11px;color:var(--text3);margin-top:2px;}
.ct-acc-status{font-size:11.5px;font-weight:700;color:var(--success);flex-shrink:0;}
.ct-acc-status.warn{color:#f59e0b;}

.ct-warm-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:12px;}
.ct-warm-card{padding:15px 17px;border-radius:15px;border:1px solid var(--border);border-left:4px solid var(--wc);background:var(--bg);}
.ct-warm-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:11px;flex-wrap:wrap;}
.ct-warm-acc{display:flex;align-items:center;gap:8px;min-width:0;}
.ct-warm-name{font-size:14px;font-weight:800;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:150px;}
.ct-warm-plat{font-size:10.5px;font-weight:700;color:var(--text3);background:var(--card2);padding:2px 8px;border-radius:99px;flex-shrink:0;}
.ct-warm-stage{font-size:12.5px;font-weight:700;color:var(--wc);flex-shrink:0;}
.ct-warm-stage b{color:var(--wc);}
.ct-warm-bar{height:8px;border-radius:99px;background:var(--card2);overflow:hidden;margin-bottom:10px;}
.ct-warm-fill{height:100%;border-radius:99px;background:var(--wc);transition:width .6s ease;}
.ct-warm-foot{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;}
.ct-warm-age{font-size:11.5px;font-weight:600;color:var(--text3);}
.ct-warm-rec{font-size:11.5px;color:var(--text2);}
.ct-warm-rec b{color:var(--wc);font-weight:800;}
.ct-warm-note{display:flex;gap:11px;align-items:flex-start;margin-top:13px;padding:13px 16px;border-radius:13px;background:linear-gradient(135deg,var(--accent-bg),transparent 80%),var(--bg);border:1px dashed var(--accent-border);}
.ct-warm-note-ico{font-size:18px;flex-shrink:0;line-height:1.4;}
.ct-warm-note div{font-size:12.5px;color:var(--text2);line-height:1.65;}
.ct-warm-note b{color:var(--accent-text);font-weight:800;}

.ct-quick-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:11px;}
.ct-quick-btn{display:flex;align-items:center;gap:11px;padding:15px 17px;border-radius:14px;border:1.5px solid var(--border);background:var(--bg);cursor:pointer;font-family:inherit;transition:all .15s;color:var(--text);}
.ct-quick-btn:hover{border-color:var(--qc);background:var(--card-hover);transform:translateY(-2px);}
.ct-quick-btn:active{transform:translateY(0);}
.ct-quick-ico{font-size:20px;width:38px;height:38px;display:flex;align-items:center;justify-content:center;border-radius:11px;background:color-mix(in srgb,var(--qc) 16%,transparent);flex-shrink:0;}
.ct-quick-lbl{flex:1;font-size:14px;font-weight:700;}
.ct-quick-arrow{color:var(--qc);font-weight:800;font-size:16px;}

.ct-recent{display:flex;flex-direction:column;gap:2px;}
.ct-recent-row{display:flex;align-items:center;gap:12px;padding:11px 12px;border-radius:10px;transition:background .12s;}
.ct-recent-row:hover{background:var(--card-hover);}
.ct-recent-badge{font-size:10.5px;font-weight:800;padding:3px 9px;border-radius:99px;flex-shrink:0;}
.ct-recent-badge.ct-success{color:var(--success);background:rgba(0,214,143,.14);}
.ct-recent-badge.ct-fail{color:var(--danger);background:rgba(255,90,90,.14);}
.ct-recent-badge.ct-pending{color:var(--text3);background:rgba(128,128,128,.14);}
.ct-recent-title{flex:1;min-width:0;font-size:13.5px;font-weight:600;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.ct-recent-plat{font-size:11.5px;color:var(--text3);flex-shrink:0;}
.ct-recent-time{font-size:11.5px;color:var(--text3);flex-shrink:0;min-width:42px;text-align:right;}

.ct-empty{padding:22px;text-align:center;color:var(--text2);font-size:13px;}
.ct-link{background:none;border:none;color:var(--accent-text);font-weight:800;cursor:pointer;font-family:inherit;font-size:13px;}

@media(max-width:768px){
  .ct-hero{flex-direction:column;padding:20px;}
  .ct-hero-plan{align-self:stretch;display:flex;align-items:center;justify-content:center;gap:12px;min-width:0;}
  .ct-hero-plan .ct-plan-days{font-size:20px;}
  .ct-hero-plan .ct-plan-lbl{margin-top:0;}
  .ct-hero-title{font-size:22px;}
  .ct-perf-grid{grid-template-columns:repeat(2,1fr);gap:10px;}
  .ct-perf-num{font-size:26px;}
  .ct-quick-grid{grid-template-columns:1fr;}
  .ct-acc-grid{grid-template-columns:1fr;}
  .ct-warm-grid{grid-template-columns:1fr;}
  .ct-recent-plat{display:none;}
}
.app.large .ct-hero-title{font-size:30px;}
.app.large .ct-perf-num{font-size:34px;}
.app.large .ct-quick-lbl{font-size:16px;}

/* ── 사진 글쓰기 꽃밭 테마 ── */
.photo-root{padding:24px 30px;max-width:none;margin:0;width:100%;}
/* 2026-08-28 리디자인: 파스텔 그라데이션 제거 → 깔끔한 웜 카드(얇은 보더·미세 그림자·hover) */
.photo-story{display:flex;gap:12px;margin-bottom:28px;}
.photo-story-step{flex:1;padding:20px 16px;text-align:center;position:relative;background:var(--card);border:1px solid var(--border);border-radius:16px;box-shadow:var(--shadow);transition:transform .18s,border-color .18s;}
.photo-story-step:hover{transform:translateY(-3px);border-color:var(--accent);}
.photo-story-step.s1,.photo-story-step.s2,.photo-story-step.s3{background:var(--card);}
.photo-story-ico{font-size:30px;margin-bottom:8px;display:block;}
.photo-story-num{font-size:10px;font-weight:900;letter-spacing:.1em;color:var(--accent-text);margin-bottom:4px;}
.photo-story-title{font-size:14px;font-weight:800;color:var(--text);margin-bottom:4px;}
.photo-story-desc{font-size:11.5px;color:var(--text3);line-height:1.5;}
.photo-story-arrow{position:absolute;right:-12px;top:50%;transform:translateY(-50%);font-size:18px;color:var(--accent);z-index:2;font-weight:900;}
/* 2026-08-28 탭별 개성: 컨테이너 로컬 --accent 오버라이드(사이드바·로고는 로즈 유지). 글생성=앰버 매거진 */
.app.light .tab-write{--accent:#c07d16;--accent-text:#a1670f;--accent-bg:rgba(192,125,22,.1);--accent-border:rgba(192,125,22,.3);--accent-30:rgba(192,125,22,.3);--accent-dim:rgba(192,125,22,.08);}
.app.dark .tab-write{--accent:#e7a53d;--accent-text:#f0b657;--accent-bg:rgba(231,165,61,.14);--accent-border:rgba(231,165,61,.32);--accent-30:rgba(231,165,61,.32);--accent-dim:rgba(231,165,61,.1);}
.app.light .tab-image{--accent:#6b46e8;--accent-text:#5a37cf;--accent-bg:rgba(107,70,232,.09);--accent-border:rgba(107,70,232,.28);--accent-30:rgba(107,70,232,.3);--accent-dim:rgba(107,70,232,.07);}
.app.dark .tab-image{--accent:#a992ff;--accent-text:#bda6ff;--accent-bg:rgba(169,146,255,.14);--accent-border:rgba(169,146,255,.32);--accent-30:rgba(169,146,255,.32);--accent-dim:rgba(169,146,255,.1);}
.app.light .tab-keyword{--accent:#2563eb;--accent-text:#1d4ed8;--accent-bg:rgba(37,99,235,.09);--accent-border:rgba(37,99,235,.28);--accent-30:rgba(37,99,235,.3);--accent-dim:rgba(37,99,235,.07);}
.app.dark .tab-keyword{--accent:#7aa2ff;--accent-text:#9cbcff;--accent-bg:rgba(122,162,255,.14);--accent-border:rgba(122,162,255,.32);--accent-30:rgba(122,162,255,.32);--accent-dim:rgba(122,162,255,.1);}
.app.light .tab-publish{--accent:#e0562f;--accent-text:#c0421f;--accent-bg:rgba(224,86,47,.09);--accent-border:rgba(224,86,47,.28);--accent-30:rgba(224,86,47,.3);--accent-dim:rgba(224,86,47,.07);}
.app.dark .tab-publish{--accent:#ff8a6b;--accent-text:#ffa588;--accent-bg:rgba(255,138,107,.14);--accent-border:rgba(255,138,107,.32);--accent-30:rgba(255,138,107,.32);--accent-dim:rgba(255,138,107,.1);}
.app.light .tab-manage{--accent:#4f46e5;--accent-text:#4338ca;--accent-bg:rgba(79,70,229,.09);--accent-border:rgba(79,70,229,.28);--accent-30:rgba(79,70,229,.3);--accent-dim:rgba(79,70,229,.07);}
.app.dark .tab-manage{--accent:#a5b4ff;--accent-text:#bcc6ff;--accent-bg:rgba(165,180,255,.14);--accent-border:rgba(165,180,255,.32);--accent-30:rgba(165,180,255,.32);--accent-dim:rgba(165,180,255,.1);}
.app.light .tab-calendar{--accent:#3f8f5f;--accent-text:#2f7a4c;--accent-bg:rgba(63,143,95,.1);--accent-border:rgba(63,143,95,.28);--accent-30:rgba(63,143,95,.3);--accent-dim:rgba(63,143,95,.07);}
.app.dark .tab-calendar{--accent:#6fca8f;--accent-text:#8ad9a5;--accent-bg:rgba(111,202,143,.14);--accent-border:rgba(111,202,143,.32);--accent-30:rgba(111,202,143,.32);--accent-dim:rgba(111,202,143,.1);}
.app.light .tab-insta{--accent:#c13584;--accent-text:#a12c6f;--accent-bg:rgba(193,53,132,.09);--accent-border:rgba(193,53,132,.28);--accent-30:rgba(193,53,132,.3);--accent-dim:rgba(193,53,132,.07);}
.app.dark .tab-insta{--accent:#e884b8;--accent-text:#f0a5cd;--accent-bg:rgba(232,132,184,.14);--accent-border:rgba(232,132,184,.32);--accent-30:rgba(232,132,184,.32);--accent-dim:rgba(232,132,184,.1);}
.app.light .tab-neighbor{--accent:#0891b2;--accent-text:#0b7a96;--accent-bg:rgba(8,145,178,.09);--accent-border:rgba(8,145,178,.28);--accent-30:rgba(8,145,178,.3);--accent-dim:rgba(8,145,178,.07);}
.app.dark .tab-neighbor{--accent:#4fd0e0;--accent-text:#79dced;--accent-bg:rgba(79,208,224,.14);--accent-border:rgba(79,208,224,.32);--accent-30:rgba(79,208,224,.32);--accent-dim:rgba(79,208,224,.1);}
.app.light .tab-engage{--accent:#e5397f;--accent-text:#c62c68;--accent-bg:rgba(229,57,127,.09);--accent-border:rgba(229,57,127,.28);--accent-30:rgba(229,57,127,.3);--accent-dim:rgba(229,57,127,.07);}
.app.dark .tab-engage{--accent:#ff7aa8;--accent-text:#ff9cbf;--accent-bg:rgba(255,122,168,.14);--accent-border:rgba(255,122,168,.32);--accent-30:rgba(255,122,168,.32);--accent-dim:rgba(255,122,168,.1);}
.app.light .tab-reply{--accent:#8b5cf6;--accent-text:#7444e0;--accent-bg:rgba(139,92,246,.09);--accent-border:rgba(139,92,246,.28);--accent-30:rgba(139,92,246,.3);--accent-dim:rgba(139,92,246,.07);}
.app.dark .tab-reply{--accent:#b39dff;--accent-text:#c7b6ff;--accent-bg:rgba(179,157,255,.14);--accent-border:rgba(179,157,255,.32);--accent-30:rgba(179,157,255,.32);--accent-dim:rgba(179,157,255,.1);}
.app.light .tab-pumasi{--accent:#ec4899;--accent-text:#cd2f7f;--accent-bg:rgba(236,72,153,.09);--accent-border:rgba(236,72,153,.28);--accent-30:rgba(236,72,153,.3);--accent-dim:rgba(236,72,153,.07);}
.app.dark .tab-pumasi{--accent:#ff8fc0;--accent-text:#ffaad2;--accent-bg:rgba(255,143,192,.14);--accent-border:rgba(255,143,192,.32);--accent-30:rgba(255,143,192,.32);--accent-dim:rgba(255,143,192,.1);}
.app.light .tab-blogscore{--accent:#12a594;--accent-text:#0e897b;--accent-bg:rgba(18,165,148,.09);--accent-border:rgba(18,165,148,.28);--accent-30:rgba(18,165,148,.3);--accent-dim:rgba(18,165,148,.07);}
.app.dark .tab-blogscore{--accent:#4fd6bf;--accent-text:#79e0ce;--accent-bg:rgba(79,214,191,.14);--accent-border:rgba(79,214,191,.32);--accent-30:rgba(79,214,191,.32);--accent-dim:rgba(79,214,191,.1);}
.photo-drop{border:2.5px dashed #FF6B9D55;border-radius:20px;padding:32px 20px;text-align:center;cursor:pointer;transition:all .2s;background:var(--bg);margin-bottom:16px;}
.photo-drop.drag-over,.photo-drop:hover{border-color:#FF6B9D;background:linear-gradient(135deg,#FF6B9D11,#C77DFF11);}
.photo-drop-ico{font-size:48px;margin-bottom:12px;}
.photo-drop-title{font-size:16px;font-weight:800;color:#FF6B9D;margin-bottom:6px;}
.photo-drop-desc{font-size:12px;color:var(--text3);}
.photo-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(100px,1fr));gap:8px;margin-bottom:16px;}
.photo-thumb{position:relative;aspect-ratio:1;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.12);}
.photo-thumb img{width:100%;height:100%;object-fit:cover;}
.photo-thumb-del{position:absolute;top:4px;right:4px;width:22px;height:22px;border-radius:50%;background:rgba(0,0,0,.6);color:#fff;border:none;cursor:pointer;font-size:12px;display:flex;align-items:center;justify-content:center;font-weight:700;}
.photo-keypoints{width:100%;min-height:80px;padding:14px;border-radius:14px;border:1.5px solid #C77DFF44;background:var(--bg);color:var(--text);font-size:14px;font-family:inherit;resize:vertical;outline:none;transition:all .2s;line-height:1.7;}
.photo-keypoints:focus{border-color:#C77DFF;background:var(--card);box-shadow:0 0 0 3px #C77DFF22;}
.photo-keypoints::placeholder{color:var(--text3);}
.photo-gen-btn{width:100%;padding:18px;border-radius:16px;border:none;cursor:pointer;font-size:16px;font-weight:900;font-family:inherit;transition:all .2s;background:linear-gradient(135deg,#f0417a,#ff6fa1);color:#fff;box-shadow:0 4px 20px rgba(255,107,157,.4);margin-top:8px;}
.photo-gen-btn:hover{transform:translateY(-2px);box-shadow:0 8px 28px rgba(255,107,157,.5);}
.photo-gen-btn:disabled{opacity:.6;cursor:not-allowed;transform:none;}
.photo-guides{display:flex;gap:8px;flex-wrap:wrap;justify-content:center;margin-top:18px;margin-bottom:8px;}
.photo-guide-btn{padding:10px 16px;border-radius:99px;background:linear-gradient(135deg,#f0417a,#ff6fa1);border:none;cursor:pointer;font-size:13px;font-weight:800;color:#fff;display:flex;align-items:center;gap:6px;transition:all .2s;white-space:nowrap;font-family:inherit;}
.photo-guide-btn:hover{transform:scale(1.05);}
/* 모바일: 좌하단 고정(결제문의는 우하단이라 안 겹침), 항상 보이게 */
@media(max-width:768px){
  .photo-guides{position:fixed;left:12px;bottom:150px;z-index:400;flex-direction:column;gap:8px;margin:0;width:auto;align-items:flex-start;}
  .photo-guide-btn{box-shadow:0 4px 16px rgba(255,107,157,.5);font-size:12px;padding:9px 14px;}
}
.photo-guide-modal{position:fixed;inset:0;z-index:200;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;padding:20px;}
.photo-guide-card{background:var(--card);border-radius:20px;padding:28px;max-width:420px;width:100%;max-height:80vh;overflow-y:auto;}
@keyframes flowerFloat{0%,100%{transform:translateY(0) rotate(0deg);}50%{transform:translateY(-6px) rotate(3deg);}}
.flower-deco{animation:flowerFloat 3s ease-in-out infinite;display:inline-block;}
`;
interface Props {
  user: PublyUser;
  onLogout: () => void;
  onAdminLogin: () => void;
  onThemeToggle: () => void;
  theme: string;
}
type ServiceInfoKey = "farm"|"trial"|"partner"|"publy"|"onai"|"oncatch"|"valhalla"|"gostop"|"sky"|"stickman"|"messenger"|"studio"|"honsa"|"news";
const PUBLY_SERVICE_INFO: Record<ServiceInfoKey,{icon:string;name:string;aliases?:string[];hook:string;summary:string;benefits:[string,string][];flow:string;cta:string;url?:string;coming?:boolean}> = {
  farm:{icon:"🌱",name:"온종일팜",hook:"홍보할 상품을 찾는 시간부터 줄이세요. 신선한 산지 상품이 콘텐츠의 소재와 구매 전환으로 이어집니다.",summary:"홍보할 산지 상품을 빠르게 찾아보세요.",benefits:[["신선한 상품 발견","제철 먹거리와 산지 상품을 한곳에서 고릅니다."],["콘텐츠가 구매로 연결","상품 상세 정보와 구매 흐름이 자연스럽게 이어집니다."],["온파트너와 수익화","고른 상품으로 추천 링크를 만들어 판매 성과를 쌓습니다."]],flow:"온종일팜 상품 선택 → 온파트너 링크 발급 → 퍼블리 홍보글 작성 → 구매 전환",cta:"온종일팜 이용하기",url:"https://app.yuanfnb.com/landing"},
  trial:{icon:"🎁",name:"온종일 체험단",aliases:["온종일체험단","온종일 체험단"],hook:"좋아하는 상품과 매장을 먼저 경험하고, 진짜 경험이 담긴 리뷰로 콘텐츠의 신뢰도를 키우세요.",summary:"상품을 체험하고 리뷰 경쟁력을 키워보세요.",benefits:[["상품·매장 직접 체험","관심 있는 캠페인을 골라 직접 경험합니다."],["리뷰 소재 확보","사진과 경험이 쌓여 블로그·SNS 글이 더 풍성해집니다."],["크리에이터 성장","포트폴리오와 브랜드 협업 기회를 넓힙니다."]],flow:"캠페인 발견 → 체험 신청 → 상품·매장 경험 → 리뷰 발행",cta:"신청하기",url:"https://pick.온종일.com"},
  partner:{icon:"🔗",name:"온파트너",hook:"내가 소개한 상품이 팔릴 때마다 링크가 수익이 됩니다. 플랫폼 제약 없이 내 콘텐츠가 있는 곳이면 시작할 수 있어요.",summary:"추천 링크를 퍼블리 글에 넣고 판매 수익을 만드세요.",benefits:[["링크 하나로 수익 추적","클릭·구매·수익을 회원 대시보드에서 확인합니다."],["사이트 제약 없음","네이버 블로그, 틱톡, 유튜브, 인스타그램, 개인 홈페이지 등 어디서든 활용합니다."],["퍼블리와 바로 연결","상품 링크를 넣으면 제품 소개와 제휴 안내가 글에 자동 반영됩니다."]],flow:"온종일팜 상품 선택 → 내 추천 링크 생성 → 퍼블리·SNS 홍보 → 판매 수익",cta:"온파트너 신청하기",url:"https://partner.yuanfnb.com/pages/signup.html"},
  publy:{icon:"🚀",name:"퍼블리",hook:"글쓰기부터 이미지, 발행, 예약까지 블로그 운영을 자동으로. 클릭 몇 번이면 네이버·티스토리에 완성된 글이 올라갑니다.",summary:"블로그 글 작성과 발행을 자동으로 해주는 프로그램이에요.",benefits:[["AI 글·이미지 자동 생성","키워드만 넣으면 SEO에 맞는 본문과 이미지를 만들어요."],["네이버·티스토리 자동 발행","예약 발행까지 지원해 컴퓨터를 꺼도 원하는 시간에 올라가요."],["이웃·공감 자동화","블로그 운영에 드는 반복 작업을 대신 처리해요."]],flow:"키워드 입력 → AI 글·이미지 생성 → 검토 → 자동 발행/예약",cta:"퍼블리 시작하기",url:"https://publy.blogautopro.com"},
  onai:{icon:"✨",name:"온종일AI",aliases:["온종일 AI"],hook:"챗GPT 같은 AI 검색에 내 브랜드가 노출되도록. AI가 추천하는 시대, 검색의 판이 바뀌고 있습니다.",summary:"AI 검색(챗GPT 등)에 노출되게 도와주는 컨설팅이에요.",benefits:[["AI 검색 최적화","AI가 답변에 내 브랜드를 인용하도록 콘텐츠를 설계해요."],["새로운 유입 채널","검색엔진을 넘어 AI 답변에서 오는 방문자를 잡아요."],["브랜드 신뢰 상승","AI가 추천하는 브랜드라는 인식을 만들어요."]],flow:"현황 진단 → AI 노출 콘텐츠 설계 → 적용 → 노출 성과 확인",cta:"온종일AI 상담하기",url:"https://ai.온종일.com"},
  oncatch:{icon:"🎮",name:"온캐치",hook:"게임하며 쌓은 재미가 혜택이 되는 애드버게임 플랫폼. 방치형 RPG부터 카드게임까지 한곳에 모았습니다.",summary:"여러 게임을 즐기며 혜택도 받는 무료 게임 플랫폼이에요.",benefits:[["다양한 무료 게임","방치형 RPG·슈팅·카드·퍼즐 등 여러 게임을 한곳에서 즐겨요."],["출석·랭킹·보상","매일 접속하고 순위에 도전하며 재화를 모아요."],["설치 없이 바로","웹에서 바로 실행되고 앱 설치도 가능해요."]],flow:"접속 → 게임 선택 → 플레이 → 랭킹·보상 획득",cta:"온캐치 즐기기",url:"https://game.온종일.com"},
  valhalla:{icon:"⚔️",name:"온 발할라 레전드",aliases:["발할라","발할라 레전드"],hook:"3D 실시간 액션으로 즐기는 방치형 RPG. 12개 직업과 화려한 필살기로 성장의 재미를 느껴보세요.",summary:"온캐치의 3D 방치형 액션 RPG 게임이에요.",benefits:[["실시간 3D 전투","12개 직업의 개성 있는 필살기와 진화·각성 성장."],["방치형 편의","자동 전투로 접속만 해도 캐릭터가 성장해요."],["랭킹·업적·지갑 연동","다른 유저와 경쟁하고 보상을 모아요."]],flow:"직업 선택 → 자동 성장 → 강화·각성 → 레이드·랭킹",cta:"발할라 플레이",url:"https://game.온종일.com/valhalla"},
  gostop:{icon:"🃏",name:"온캐치 고스톱",aliases:["고스톱"],hook:"언제 어디서든 즐기는 정통 화투 고스톱. 3D 카드 애니메이션과 똑똑한 AI 상대가 기다립니다.",summary:"온캐치의 정통 고스톱 카드게임이에요.",benefits:[["정통 화투 규칙","익숙한 고스톱을 그대로, 3D 카드 연출로."],["AI 상대와 대전","혼자서도 언제든 한 판 즐길 수 있어요."],["지갑·랭킹 연동","이기며 재화를 모으고 순위에 도전해요."]],flow:"입장 → AI와 대전 → 승리 보상 → 랭킹",cta:"고스톱 플레이",url:"https://game.온종일.com/gostop"},
  sky:{icon:"✈️",name:"하늘 수호대",aliases:["하늘수호대"],hook:"손끝으로 조종하는 세로 스크롤 비행 슈팅. 7종의 기체와 필살기로 하늘을 지켜내세요.",summary:"온캐치의 육성형 비행 슈팅 게임이에요.",benefits:[["7종 기체·필살기","기체마다 다른 필살기로 색다른 플레이."],["육성·강화","무한 강화와 기체 해금으로 점점 강해져요."],["손가락 가림 없는 조작","화면을 가리지 않는 드래그 조작과 타격감."]],flow:"기체 선택 → 스테이지 돌파 → 강화·해금 → 보스전",cta:"하늘 수호대 플레이",url:"https://game.온종일.com/sky"},
  stickman:{icon:"🥋",name:"스틱맨 액션",aliases:["스틱맨"],hook:"관절이 살아 움직이는 스틱맨 격투 액션. 주먹·발차기·베기로 통쾌한 타격감을 느껴보세요.",summary:"온캐치의 관절 스틱맨 격투 방치형 RPG예요.",benefits:[["살아있는 관절 액션","스켈레톤 애니메이션으로 부드러운 격투 동작."],["다양한 공격","주먹·발차기·베기·회전 등 통쾌한 액션."],["자동·수동 전투","방치와 조작을 오가며 즐겨요."]],flow:"전투 시작 → 웨이브 돌파 → 강화 → 도전",cta:"스틱맨 플레이",url:"https://game.온종일.com/stickman"},
  messenger:{icon:"💬",name:"온메신저",hook:"관리자가 안전하게 운영하는 커뮤니티 메신저. 친구·단체방·공지·알림까지 깔끔하게 한곳에서.",summary:"안전하게 운영되는 커뮤니티 채팅 메신저예요.",benefits:[["친구·단체방 채팅","1:1과 단체방을 자유롭게, 초대 링크로 간편하게."],["공지·알림","중요한 소식을 공지로 고정하고 푸시 알림을 받아요."],["안전한 운영","관리자 모니터링과 제재로 건강한 커뮤니티 유지."]],flow:"가입 → 친구·방 참여 → 대화·공지 → 알림",cta:"온메신저 시작하기",url:"https://talk.온종일.com"},
  studio:{icon:"🎬",name:"온종일 스튜디오",hook:"영상·디자인 작업을 한눈에 보여주는 포트폴리오. 우리가 만든 결과물로 신뢰를 전합니다.",summary:"온종일의 작품·영상 포트폴리오 사이트예요.",benefits:[["작품 쇼케이스","영상·디자인 결과물을 감각적으로 모아 보여줘요."],["신뢰 전달","실제 만든 결과물로 실력을 증명해요."],["의뢰 연결","마음에 든 작업을 바로 문의로 이어가요."]],flow:"작품 감상 → 관심 작업 확인 → 문의",cta:"스튜디오 둘러보기",url:"https://studio.온종일.com"},
  honsa:{icon:"🏢",name:"온종일 본사",aliases:["온종일닷컴","온종일 홈페이지"],hook:"콘텐츠·커머스·게임·AI까지, 여러 사업을 한 흐름으로 잇는 온종일. 브랜드의 시작점입니다.",summary:"온종일의 사업 전체를 소개하는 본사 사이트예요.",benefits:[["다양한 사업 소개","커머스·체험단·게임·AI 등 온종일의 사업을 한눈에."],["브랜드 신뢰","여러 서비스를 하나의 흐름으로 연결해요."],["파트너 연결","협업·제휴 문의를 바로 이어가요."]],flow:"사업 소개 확인 → 관심 서비스 이동 → 문의",cta:"온종일 살펴보기",url:"https://www.온종일.com"},
  news:{icon:"📰",name:"온종일뉴스",aliases:["온종일 뉴스"],hook:"정치 빼고 실생활에 진짜 도움 되는 소식만. AI·프랜차이즈·정부지원금·마케팅·무료 툴까지 쉽게 풀어드립니다.",summary:"실용 정보 중심의 온라인 뉴스예요.",benefits:[["실용 정보 특화","AI·창업·정부지원금·마케팅 등 바로 써먹는 정보."],["쉽고 신뢰 있게","어려운 소식도 친근하고 이해하기 쉽게 정리."],["트렌드를 빠르게","놓치기 쉬운 지원 사업·무료 툴 소식을 챙겨줘요."]],flow:"관심 주제 확인 → 기사 읽기 → 실생활 적용",cta:"온종일뉴스 보기",url:"https://news.온종일.com",coming:true}
};

export default function DashboardPage({user, onLogout, onAdminLogin, onThemeToggle, theme}: Props) {
  const [appVersion, setAppVersion] = useState("");
  const [serviceInfo, setServiceInfo] = useState<ServiceInfoKey|null>(null);
  useEffect(()=>{
    if(!serviceInfo)return;
    const close=(e:KeyboardEvent)=>{if(e.key==="Escape")setServiceInfo(null)};
    window.addEventListener("keydown",close);document.body.style.overflow="hidden";
    return()=>{window.removeEventListener("keydown",close);document.body.style.overflow=""};
  },[serviceInfo]);
  const logoTapCount = useRef(0);
  const logoTapTimer = useRef<ReturnType<typeof setTimeout>|null>(null);
  const handleLogoTap = () => {
    logoTapCount.current += 1;
    if (logoTapTimer.current) clearTimeout(logoTapTimer.current);
    if (logoTapCount.current >= 5) { logoTapCount.current = 0; onAdminLogin(); return; }
    logoTapTimer.current = setTimeout(() => { logoTapCount.current = 0; }, 1400);
  };
  const [tab, setTab] = useState<MainTab>("inflow");
  // 🎫 트래픽 라이선스 — 로그인 이메일로 컨트롤타워 승인 기능(place/blog/store) 조회.
  //   승인+미만료(서버시간)만 allowedFeatures로 InflowCenter에 전달 → 승인된 탭만 보임.
  const [allowedFeatures, setAllowedFeatures] = useState<("place"|"blog"|"store")[]>([]);
  const [licenseSaver, setLicenseSaver] = useState<string>("");
  const licSigRef = useRef<string>("");
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const lics = await getTrafficLicenses(user.email);
        if (!alive) return;
        const ok = lics.filter(l => (l.remain_sec ?? 0) > 0);
        const feats = ok.map(l => l.tool);
        const order: Record<string,number> = { normal: 0, save: 1, ultra: 2 };
        const strongest = ok.map(l => l.data_saver || "ultra").sort((a,b)=>(order[b]??2)-(order[a]??2))[0] || "";
        // 값이 실제로 바뀐 경우에만 setState → 2초 폴링이어도 불필요 리렌더 없음
        const sig = JSON.stringify([feats.slice().sort(), strongest]);
        if (sig !== licSigRef.current) { licSigRef.current = sig; setAllowedFeatures(feats); setLicenseSaver(strongest); }
      } catch {}
    };
    void load();
    const iv = window.setInterval(load, 2000); // 🔴 2초마다 재확인 — 관리자 승인/변경이 회원 앱에 즉시 반영(퍼블리처럼)
    return () => { alive = false; window.clearInterval(iv); };
  }, [user.email]);
  const [pageReady, setPageReady] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [showVideo, setShowVideo] = useState(false);   // 소개 영상 보기 모달
  const [showInstaWarn, setShowInstaWarn] = useState(false);
  const [guideTab, setGuideTab] = useState(0);
  const [botOnline, setBotOnline] = useState(false);
  // 봇에 실제로 저장된 세션 상태(플랫폼별) — 계정관리 "연결됨"이 거짓말하지 않게.
  const [realSession, setRealSession] = useState<{naver?:boolean;tistory?:boolean;google?:boolean}>({});
  const refreshSessionStatus = useCallback(async()=>{
    try{ const r=await botFetch(`${BOT}/api/session-status/${user.id}`,{signal:AbortSignal.timeout(3000)}); if(r.ok) setRealSession(await r.json()); }catch{}
  },[user.id]);
  useEffect(()=>{ if(botOnline) refreshSessionStatus(); },[botOnline,refreshSessionStatus]);
  // 인스타 DM
  const [dmTargets, setDmTargets] = useState<InstaDmTarget[]>([]);
  const [dmHistory, setDmHistory] = useState<InstaDmHistory[]>([]);
  const [dmQuota, setDmQuota] = useState<InstaDmQuota|null>(null);
  const [dmLoading, setDmLoading] = useState(false);
  const [dmSubTab, setDmSubTab] = useState<"send"|"history"|"guide">("guide");
  const [dmTargetInput, setDmTargetInput] = useState("");
  const [dmMessage, setDmMessage] = useState("");
  const [dmAccount, setDmAccount] = useState("");
  const [dmKeyword, setDmKeyword] = useState("");
  const [dmFilter, setDmFilter] = useState<"all"|"pending"|"sent"|"fail"|"skip">("all");
  // 인스타 봇 연동
  const [dmIgPw, setDmIgPw] = useState("");
  const [dmSessionOk, setDmSessionOk] = useState(false);
  const [dmConnecting, setDmConnecting] = useState(false);
  const [dmCrawlKw, setDmCrawlKw] = useState("");
  const [dmMinFollow, setDmMinFollow] = useState("1000");
  const [dmMaxFollow, setDmMaxFollow] = useState("50000");
  const [dmCrawlLimit, setDmCrawlLimit] = useState("30");
  const [dmLogs, setDmLogs] = useState<string[]>([]);
  const [dmRunning, setDmRunning] = useState(false);
  const esDmRef = useRef<BotEventStream|null>(null);
  const dmLog = (m:string)=>setDmLogs(p=>[...p.slice(-200), m]);
  // ★로그 자동 따라가기(맨 아래면 최신 추적, 위로 올리면 고정, 다시 내리면 재개)
  const dmLogRef = useRef<HTMLDivElement>(null);
  const dmStick = useRef(true);
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
    }catch(e:any){showToast("로컬 봇 서버에 연결 실패 (봇 실행 확인): "+e.message,"error");}
    setDmConnecting(false);
  };

  const crawlIg = ()=>{
    const acct=dmAccount.trim().replace(/^@/,"");
    if(!acct){showToast("발송 인스타 계정을 먼저 입력/연결해주세요","error");return;}
    if(!dmCrawlKw.trim()){showToast("검색 키워드를 입력해주세요","error");return;}
    setDmRunning(true);setDmLogs([]);
    const url=`${INSTA_BOT}/api/crawl?accountId=${encodeURIComponent(acct)}&keyword=${encodeURIComponent(dmCrawlKw.trim())}&limit=${encodeURIComponent(dmCrawlLimit||"30")}&minFollowers=${encodeURIComponent(dmMinFollow||"0")}&maxFollowers=${encodeURIComponent(dmMaxFollow||"0")}`;
    const es=new BotEventStream(url);esDmRef.current=es;
    es.onmessage=async e=>{
      const d=JSON.parse(e.data);
      if(d.type==="log")dmLog(d.msg);
      else if(d.type==="result"){await addInstaDmTarget({user_id:user.id,username:d.username,followers:d.followers||0,bio:"",keywords:dmCrawlKw,status:"pending",instagram_account:acct});}
      else if(d.type==="crawl_done"){dmLog(`🎉 ${d.results?.length||0}개 수집 완료`);getInstaDmTargets(user.id).then(setDmTargets);es.close();setDmRunning(false);}
      else if(d.type==="error"){dmLog("❌ "+d.msg);es.close();setDmRunning(false);}
    };
    es.onerror=()=>{es.close();setDmRunning(false);dmLog("⚠️ 연결 종료 (로컬 봇 실행 확인)");};
  };

  const sendIg = ()=>{
    const acct=dmAccount.trim().replace(/^@/,"");
    if(!acct){showToast("발송 인스타 계정을 입력/연결해주세요","error");return;}
    if(!dmMessage.trim()){showToast("DM 문구를 입력해주세요","error");return;}
    const igLimit=INSTA_DM_DAILY_LIMIT[user.plan]??5;
    if(instaUsed>=igLimit){setAlertPopup({type:"insta",used:instaUsed,limit:igLimit});return;}
    const remaining=Math.max(0,igLimit-instaUsed);
    const pend=dmTargets.filter(t=>t.status==="pending").slice(0,remaining).map(t=>({id:t.id,username:t.username}));
    if(!pend.length){showToast("발송할 '대기중' 타겟이 없어요","error");return;}
    setDmRunning(true);setDmLogs([]);
    const url=`${INSTA_BOT}/api/send?userId=${encodeURIComponent(user.id)}&accountId=${encodeURIComponent(acct)}&message=${encodeURIComponent(dmMessage)}&targets=${encodeURIComponent(JSON.stringify(pend))}`;
    const es=new BotEventStream(url);esDmRef.current=es;
    es.onmessage=e=>{
      const d=JSON.parse(e.data);
      if(d.type==="log")dmLog(d.msg);
      else if(d.type==="quota_info")dmLog(`💎 오늘 남은 한도 ${d.remaining}개`);
      else if(d.type==="quota_exceeded"){dmLog("🛑 오늘 한도 초과");setAlertPopup({type:"insta",used:d.used,limit:d.limit});es.close();setDmRunning(false);}
      else if(d.type==="progress")dmLog(`📊 진행 ${d.done} · 실패 ${d.fail}`);
      else if(d.type==="done"){dmLog("✅ 발송 작업 완료");getInstaDmTargets(user.id).then(setDmTargets);getInstaDmQuota(user.id).then(q=>{setDmQuota(q);const today=new Date().toISOString().slice(0,10);setInstaUsed(q&&q.reset_date===today?(q.used_today||0):0);});es.close();setDmRunning(false);}
      else if(d.type==="error"){dmLog("❌ "+d.msg);es.close();setDmRunning(false);}
    };
    es.onerror=()=>{es.close();setDmRunning(false);dmLog("⚠️ 연결 종료 (로컬 봇 실행 확인)");};
  };

  const stopDm = ()=>{ try{esDmRef.current?.close();}catch{} setDmRunning(false); dmLog("⏹️ 중단됨"); };
  const [quota, setQuota] = useState<PublyQuota|null>(null);
  const [dailyPublishUsed, setDailyPublishUsed] = useState(0);
  // 🔍 크롤링 = 기본 오픈(등급별 한도로 이미 제한됨). 관리자가 crawl_enabled=false로 명시 잠금할 때만 잠긴다.
  //   미설정(null/undefined)·true = 사용 가능. false만 잠김. (관리자 표시·토글도 동일 규칙으로 맞춤)
  const crawlEnabled = (user as any)?.crawl_enabled !== false;
  // 🆕 NEW 트래픽 유입 = 기본 잠금. 관리자가 inflow_enabled=true로 켠 회원만.
  const inflowEnabled = (user as any)?.inflow_enabled === true;
  const [place360Enabled, setPlace360Enabled] = useState(false);
  useEffect(() => { let active = true; getPlace360Access(user.id).then(enabled => { if (active) setPlace360Enabled(enabled); }); return () => { active = false; }; }, [user.id]);
  const [showCrawlLock, setShowCrawlLock] = useState(false);
  // 📖 퍼블리 대백서 — 로그인하면 자동 팝업(‘다시 안 보기’ 체크 전까지). 헤더 📚 버튼으로 언제든 다시.
  const [showDaebaekseo, setShowDaebaekseo] = useState(false);
  useEffect(()=>{ if(!user?.id) return; try{ if(localStorage.getItem("publy_guide_seen")&&localStorage.getItem("publy_daebaekseo_seen")!==String(DAEBAEKSEO_VERSION)) setShowDaebaekseo(true); }catch{} }, [user?.id]);
  const closeGuideAndOpenBook = () => {
    try { localStorage.setItem("publy_guide_seen", "1"); } catch {}
    setShowGuide(false);
    try { if (localStorage.getItem("publy_daebaekseo_seen") !== String(DAEBAEKSEO_VERSION)) setTimeout(() => setShowDaebaekseo(true), 250); } catch {}
  };
  const [neighborUsed, setNeighborUsed] = useState(0);
  const [replyUsed, setReplyUsed] = useState(0);
  const [engageUsed, setEngageUsed] = useState(0);
  const [instaUsed, setInstaUsed] = useState(0);
  const [alertPopup, setAlertPopup] = useState<{type:"expire"|"publish"|"insta"; daysLeft?:number; used?:number; limit?:number} | null>(null);
  // 🔒 무료체험(7일) 만료 = 전체 잠금. 무료 회원은 가입 후 7일간만 모든 기능 무료, 이후 결제 전까지 사용 불가(대시보드는 보이되 기능 잠김).
  const [locked, setLocked] = useState(false);
  // 재연결 비밀번호 입력 모달 (window.prompt는 Electron에서 안 뜸 → 커스텀 모달)
  const [pwPrompt, setPwPrompt] = useState<{acc:PublyAccount; value:string} | null>(null);
  const pwPromptResolve = useRef<((pw:string|null)=>void)|null>(null);
  function askPassword(acc:PublyAccount):Promise<string|null>{
    return new Promise((resolve)=>{ pwPromptResolve.current=resolve; setPwPrompt({acc,value:""}); });
  }
  const [accounts, setAccounts] = useState<PublyAccount[]>([]);
  const [history, setHistory] = useState<PublyHistory[]>([]);
  const [historyError, setHistoryError] = useState("");
  const [weekly, setWeekly] = useState<WeeklyActivity[]>([]);   // 📈 컨트롤타워 활동 그래프(선택 기간)
  const [actRange, setActRange] = useState<ActivityRange>("week");   // 주간/월간/1년
  const [histPeriod, setHistPeriod] = useState<"all"|"today"|"week"|"month">("all");   // 발행기록 기간 필터
  const [histStatus, setHistStatus] = useState<"all"|"success"|"fail">("all");          // 발행기록 상태 필터
  // 사진 글쓰기 안내 모달(모바일 최적화 — window.open 대신 앱 내 모달)
  const [photoGuideModal, setPhotoGuideModal] = useState<null|"guide"|"caution"|"example">(null);
  // 📈 성과 추적: 발행 글 현재 순위 + 이전 스냅샷 비교(로컬 저장)
  const [rankData, setRankData] = useState<Record<string,{rank:number|null;prev:number|null;at:number}>>(()=>{try{return JSON.parse(localStorage.getItem("publy_rank_track")||"{}");}catch{return{};}});
  const [rankChecking, setRankChecking] = useState(false);
  const scLogNoOf=(url?:string)=>url?.match(/(?:logNo=|\/)(\d{6,})(?:[/?&]|$)/)?.[1]||"";
  const scBlogIdOf=(url?:string)=>url?.match(/blog\.naver\.com\/([a-zA-Z0-9_-]+)/)?.[1]||"";
  async function checkPostRanks(){
    const naverPosts=history.filter(h=>h.status==="success"&&h.platform==="naver"&&h.post_url&&scLogNoOf(h.post_url)&&scBlogIdOf(h.post_url));
    if(naverPosts.length===0){showToast("순위를 확인할 네이버 발행 글이 없어요","error");return;}
    setRankChecking(true);
    try{
      const items=naverPosts.slice(0,30).map(h=>({title:h.title,blogId:scBlogIdOf(h.post_url),logNo:scLogNoOf(h.post_url)}));
      const r=await botFetch(`${BOT}/api/post-rank`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({items})});
      const d=await r.json();
      if(!d.ok) throw new Error(d.error||"조회 실패");
      setRankData(prev=>{
        const next={...prev};
        for(const rk of d.ranks){ const old=prev[rk.logNo]; next[rk.logNo]={rank:rk.rank,prev:old?old.rank:null,at:Date.now()}; }
        localStorage.setItem("publy_rank_track",JSON.stringify(next));
        return next;
      });
      showToast("📈 순위 성과를 확인했어요!");
    }catch(e:any){showToast("❌ "+e.message,"error");}
    finally{setRankChecking(false);}
  }
  const [adType, setAdType] = useState<"adpost"|"adsense">("adpost");
  const [platform, setPlatform] = useState<"naver"|"tistory">("naver");
  const [keyword, setKeyword] = useState("");
  const [keywords, setKeywords] = useState<string[]>(()=>{try{return JSON.parse(localStorage.getItem("publy_kws")||"[]");}catch{return [];}});
  const [targetChars, setTargetChars] = useState(1350);
  const [charMode, setCharMode] = useState<"auto"|"manual">("auto");

  // 플랫폼/타입별 랜덤 글자수 계산
  function calcTargetChars():number{
    if(charMode==="manual")return targetChars;
    if(platform==="tistory") return Math.floor(Math.random()*1000)+2000; // 2000~3000
    if(adType==="adpost"){
      if(/체험단|맛집|후기|리뷰|방문|다녀/.test(keyword))
        return Math.floor(Math.random()*700)+1800; // 1800~2500
      return Math.floor(Math.random()*500)+1500; // 1500~2000
    }
    return Math.floor(Math.random()*500)+1500; // 1500~2000
  }
  const [titles, setTitles] = useState<string[]>(()=>{try{return JSON.parse(localStorage.getItem("publy_titles")||"[]");}catch{return[];}});
  const [selectedTitle, setSelectedTitle] = useState("");
  // ★캘린더에서 넘어온 우리 서비스 홍보(글 본문에 자연스럽게 링크 삽입용). 글 생성 후 자동 해제.
  const [pendingPromo, setPendingPromo] = useState<{name:string;url:string;blurb:string}|null>(null);
  const [loadingTitles, setLoadingTitles] = useState(false);
  const [aiKeywordLoading, setAiKeywordLoading] = useState(false);
  const [kwData, setKwData] = useState<{keyword:string;volume:number;competition:string;cpc:number;clicks:number}[]>([]);
  const [loadingKw, setLoadingKw] = useState(false);

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

  function calcQualityScore(content:string, kw:string):{score:number;items:{label:string;pass:boolean;detail:string;weight:number}[]} | null {
    if(!content||content.length<100)return null;
    const items:{label:string;pass:boolean;detail:string;weight:number}[]=[];

    // 1. 글자수
    const charOk=content.length>=1200;
    items.push({label:"글자수",pass:charOk,detail:`${content.length.toLocaleString()}자 (권장 1,200자+)`,weight:20});

    // 2. 질문형 소제목 비율 — ★네이버는 ## 금지라 "짧은 독립 줄"도 소제목으로 인정
    const qWords=/하는법|방법|이유|이란|할까|될까|인가|인지|는지|어떻게|왜|무엇|뭐|어디|언제|누구|얼마|추천|고르는|좋을까|괜찮을까/;
    const headings=content.split("\n").map(l=>l.trim()).filter(l=>{
      const t=l.replace(/^#+\s*/,"");                       // ## 접두 제거
      if(t.length<3||t.length>45)return false;              // 소제목 길이대(3~45자)
      if(t.startsWith("[")||/^(Q\d|A\d|POST\d|태그|제목)/.test(t))return false; // 메타/FAQ/태그 제외
      if(l.startsWith("##"))return true;                    // 마크다운 소제목
      if(/[?？]$/.test(t))return true;                       // 물음표로 끝 = 질문 소제목
      // 순수텍스트 소제목: 서술형 종결어미로 끝나지 않는 짧은 줄(제목성)
      return !/[.]$/.test(t)&&!/(요|다|죠|네|까요|습니다|았어|였어|더라고요|거든요|잖아요)$/.test(t);
    });
    const qHeadings=headings.filter(h=>/[?？]/.test(h)||qWords.test(h));
    const headingOk=headings.length>=3&&qHeadings.length>=Math.ceil(headings.length*0.5);
    items.push({label:"질문형 소제목",pass:headingOk,detail:`${headings.length}개 중 ${qHeadings.length}개 질문형`,weight:25});

    // 3. 키워드 밀도
    const keyword=kw.trim();
    const kwCount=keyword?(content.match(new RegExp(keyword.replace(/[.*+?^${}()|[\]\\]/g,"\\$&"),"gi"))||[]).length:0;
    const kwOk=keyword?kwCount>=2&&kwCount<=6:true;
    items.push({label:"키워드 밀도",pass:kwOk,detail:keyword?`"${keyword}" ${kwCount}회 (권장 2~6회)`:"키워드 없음",weight:20});

    // 4. AI 패턴 감지
    const aiPatterns=["해보겠습니다","알아보겠습니다","살펴보겠습니다","소개해드리겠습니다","정리해보겠습니다","결론적으로","중요합니다","다양한","효과적인","필수적으로"];
    const aiHits=aiPatterns.filter(p=>content.includes(p));
    const aiOk=aiHits.length===0;
    items.push({label:"AI 패턴 차단",pass:aiOk,detail:aiOk?"AI 냄새 없음 ✓":`감지됨: ${aiHits.slice(0,2).join(", ")}`,weight:20});

    // 5. 단락 균형
    const paragraphs=content.split(/\n\n+/).filter(p=>p.trim().length>20&&!p.startsWith("##")&&!p.startsWith("["));
    const avgLen=paragraphs.length>0?paragraphs.reduce((a,p)=>a+p.length,0)/paragraphs.length:0;
    const paraOk=paragraphs.length>=4&&avgLen>=80&&avgLen<=400;
    items.push({label:"단락 균형",pass:paraOk,detail:`단락 ${paragraphs.length}개, 평균 ${Math.round(avgLen)}자`,weight:15});

    const score=Math.round(items.reduce((acc,it)=>acc+(it.pass?it.weight:0),0));
    return{score,items};
  }

  // 품질 미달 원고는 한 번만 최소 보정하고, 점수가 실제로 오른 경우에만 교체한다.
  async function repairGeneratedQuality(content:string,kw:string,title:string,signal?:AbortSignal,minScore=80):Promise<string>{
    const before=calcQualityScore(content,kw);
    if(!before||before.score>=minScore)return content;
    const failed=before.items.filter(it=>!it.pass).map(it=>`${it.label}: ${it.detail}`).join("\n");
    try{
      const prompt=`당신은 네이버 블로그 원고 품질 교정자입니다. 실패한 항목만 고치고 순수 본문만 반환하세요.
제목: "${title}"\n핵심 키워드: "${kw}"\n현재 점수: ${before.score}점\n실패 항목:\n${failed}

[안전 규칙]
- 원문의 사실·가격·날짜·장소·경험을 유지하고 새로운 수치나 체험을 지어내지 마세요.
- 핵심 키워드는 띄어쓰기와 글자를 그대로 유지해 전체 2~6회만 사용하세요.
- 첫 문단은 질문에 바로 답하는 핵심 요약 2~3문장으로 쓰세요.
- 4~6개 구간으로 나누고, 절반 이상의 소제목은 왜/어떻게/무엇/언제/가격/비교/주의 같은 질문형으로 쓰세요.
- 단락마다 2~4문장, 단락 사이는 빈 줄로 나누세요.
- 해보겠습니다/알아보겠습니다/결론적으로/다양한/효과적인 같은 AI 상투어를 제거하세요.
- 마크다운 기호, 태그 줄, 교정 설명은 출력하지 마세요.

[원문]\n${content}`;
      let repaired=stripMarkdown(await callAI(prompt,signal));
      repaired=ensureQuestionHeadings(repaired,kw);
      repaired=ensureAeoIntroSummary(await ensureKeywordCount(repaired,kw,2),title);
      const after=calcQualityScore(repaired,kw);
      return after&&after.score>before.score?repaired:content;
    }catch{return content;}
  }

  async function generateCalendar(){
    const kws = calKeywords.split(/[,\n]+/).map(s=>s.trim()).filter(Boolean);
    if(kws.length===0){showToast("키워드를 입력해주세요","error");return;}
    setCalLoading(true);setCalDone(false);setCalSchedule([]);
    try{
      const today=new Date();
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
- 25~32자 권장 (너무 짧거나 길지 않게)
- 구체성: 숫자(예: 5가지·2026·3만원), 대상(초보·직장인), 상황(방법·후기·비교·주의점) 중 1~2개 포함
- 검색 의도어 자연스럽게: ~하는 법 / ~추천 / ~정리 / ~후기 / 총정리
- ⛔ 과장·낚시 감탄사 금지: 대박·충격·미쳤다·1등·놀라운·완벽·진짜 → 네이버 저품질/클릭후 이탈 유발
- ⛔ 물음표·느낌표 남발 금지(제목당 최대 1개)
- 담백하고 정보가 명확한 제목이 클릭 후 체류·지수에 유리하다
Output format (JSON array only, no other text):
[{"date":"YYYY-MM-DD","keyword":"키워드","title":"SEO제목","style":"글스타일","adType":"adpost or adsense"}]`;

      const raw=await callAI(prompt,undefined,true);
      if(!raw){throw new Error("AI 응답이 비어있어요. API 키를 확인해주세요.");}
      const clean=raw.replace(/```json|```/g,"").trim();
      const parsed=JSON.parse(clean);
      const sched=parsed.slice(0,calDays);
      // ★우리 서비스 주제 1개를 스케줄에 자연스럽게 랜덤 삽입 → 그 글 쓰면 본문에 링크가 녹아듦(promo)
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
      localStorage.setItem("publy_cal_schedule",JSON.stringify(sched));  // 앱 재접속해도 유지
      setCalCompleted({}); localStorage.setItem("publy_cal_done","{}");  // 새 스케줄이면 완료기록 초기화
      setCalDone(true);
      showToast(`📅 ${sched.length}일치 스케줄 생성 완료!`);
    }catch(e:any){showToast("❌ "+e.message,"error");}
    finally{setCalLoading(false);}
  }
  // ★개별 항목 재추천: 그 줄의 제목·키워드만 새로 뽑기(나머지 스케줄·완료기록은 유지)
  const [calRegenIdx,setCalRegenIdx]=useState<number>(-1);
  async function regenCalItem(idx:number){
    const cur=calSchedule[idx]; if(!cur) return;
    setCalRegenIdx(idx);
    try{
      const existTitles=calSchedule.filter((_,i)=>i!==idx).map(s=>s.title);
      const prompt=`You are a JSON generator. Return ONLY a valid JSON object, no explanation, no markdown, no code blocks.
주제 키워드: "${cur.keyword}" (이 주제는 유지하되, 아래 기존 제목들과 겹치지 않는 새 각도로 블로그 글감 1개)
기존 제목들(중복 금지): ${existTitles.slice(0,20).join(" / ")}
★제목 규칙(클릭률·검색노출 최적화): 검색어를 앞 8글자 안에 배치, 25~32자, 숫자·대상·상황 중 1~2개 포함, 과장·낚시 감탄사(대박·충격·완벽·진짜) 금지, 물음표·느낌표 최대 1개.
Output (JSON object only): {"keyword":"핵심키워드","title":"새 SEO 제목","style":"감성일기 또는 정보글 또는 맛집후기 또는 여행기","adType":"adpost 또는 adsense"}`;
      // ★JSON 모드로 강제 + 45초 타임아웃(thinking 지연 대비). 빈 응답/파싱실패 원인을 메시지에 노출.
      const raw=await callAI(prompt,AbortSignal.timeout(45000),true);
      const clean=(raw||"").replace(/```json|```/g,"").trim();
      if(!clean)throw new Error("AI가 빈 응답을 보냈어요. 잠시 후 다시 시도해주세요");
      const s=clean.indexOf("{"),e=clean.lastIndexOf("}");
      if(s<0||e<=s)throw new Error("AI 응답 형식 오류(잠시 후 다시)");
      let obj:any; try{ obj=JSON.parse(clean.slice(s,e+1)); }catch{ throw new Error("AI 응답을 읽지 못했어요(형식 오류). 다시 시도해주세요"); }
      setCalSchedule(prev=>{
        const next=[...prev];
        // 홍보(promo) 항목은 서비스 링크 유지 위해 promo 보존, 일반 항목은 새로 교체
        next[idx]={...next[idx],keyword:String(obj.keyword||cur.keyword),title:String(obj.title||cur.title),style:String(obj.style||cur.style),adType:String(obj.adType||cur.adType)};
        localStorage.setItem("publy_cal_schedule",JSON.stringify(next));
        return next;
      });
      showToast("🔄 새 제목으로 다시 추천했어요!");
    }catch(e:any){ const msg=e?.name==="AbortError"?"시간이 초과됐어요. 다시 눌러주세요(네트워크가 느릴 수 있어요)":(e?.message||"알 수 없는 오류"); showToast("❌ 재추천 실패: "+msg,"error"); }
    finally{setCalRegenIdx(-1);}
  }
  // 스케줄 항목 완료 토글(날짜 기준) + localStorage 저장
  function toggleCalDone(date:string){
    setCalCompleted(prev=>{
      const next={...prev};
      if(next[date]) delete next[date]; else next[date]=new Date().toISOString();
      localStorage.setItem("publy_cal_done",JSON.stringify(next));
      return next;
    });
  }
  // 스케줄 항목 → 글쓰기 탭으로(키워드·제목 자동 채움)
  function writeFromSchedule(s:{keyword:string;title:string;promo?:{name:string;url:string;blurb:string}}){
    setKeyword(s.keyword);
    setSelectedTitle(s.title);
    setPendingPromo(s.promo||null);   // 우리 서비스 주제면 글 본문에 자연 삽입
    setTab("write");
    showToast(`✍️ "${s.title}" 글쓰기로 이동했어요!`);
  }

  async function fetchKeywordData(){
    if(!keyword.trim()){showToast("키워드를 먼저 입력해주세요","error");return;}
    setLoadingKw(true);
    try{
      const keys=await getNaverApiKeys(user.id);
      if(!keys.naver_access_license||!keys.naver_secret_key||!keys.naver_customer_id){
        showToast("설정탭에서 네이버 검색광고 API 키를 입력해주세요","error");
        setLoadingKw(false);return;
      }
      // 개인키 여부: naverKeys state에 값이 있으면 개인키
      const isPersonal=!!(naverKeys.naver_access_license&&naverKeys.naver_secret_key&&naverKeys.naver_customer_id);
      const qc=await checkNaverQuota(user.id,user.plan,isPersonal);
      setNaverQuotaInfo({used:qc.used,limit:qc.limit});
      if(!qc.ok){
        showToast(`❌ 일일 한도 초과 (${qc.used}/${qc.limit}회) — 개인 API 키 입력 시 무제한!`,"error");
        setLoadingKw(false);return;
      }
      const isWeb = !window.electron;
      const apiUrl = isWeb ? `/api/naver-keywords` : `${BOT}/api/naver-keywords`;
      const r = isWeb
        ? await fetch(apiUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ accessLicense: keys.naver_access_license, secretKey: keys.naver_secret_key, customerId: keys.naver_customer_id, keywords: [keyword.trim()] }),
          })
        : await botFetch(apiUrl, {
            method: "POST",
            body: JSON.stringify({ accessLicense: keys.naver_access_license, secretKey: keys.naver_secret_key, customerId: keys.naver_customer_id, keywords: [keyword.trim()] }),
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
      if(!isPersonal) await incrementNaverQuota(user.id);
      const newUsed=qc.used+1;
      setNaverQuotaInfo({used:newUsed,limit:qc.limit});
      showToast(`📊 키워드 ${list.length}개 수집 완료! (${newUsed}/${qc.limit}회 사용)`);
    }catch(e:any){showToast("❌ "+e.message,"error");}
    finally{setLoadingKw(false);}
  }
  const [genContent, setGenContent] = useState("");
  const [genTitle, setGenTitle] = useState("");
  const [onPartnerLink, setOnPartnerLink] = useState("");
  const [onPartnerLoading, setOnPartnerLoading] = useState(false);
  const [onPartnerError, setOnPartnerError] = useState("");
  const [onPartnerPlacement, setOnPartnerPlacement] = useState<OnPartnerPlacement>(()=>(localStorage.getItem("publy_onpartner_placement") as OnPartnerPlacement)||"auto");
  // 온파트너 상품 최대 3개 (banner=서버 /api/banner 가로 배너 URL)
  type OnPartnerItem = { product:OnPartnerProduct; banner:string };
  const [onPartnerItems, setOnPartnerItems] = useState<OnPartnerItem[]>([]);
  const [onPartnerPreview, setOnPartnerPreview] = useState<OnPartnerItem|null>(null); // 조회한 상품(아직 추가 전)
  const MAX_ONPARTNER = 3;
  // ── 내 링크(일반 사이트): URL만 넣으면 네이버가 OG 썸네일 카드로 렌더. 온파트너와 별도 관리(안 엉키게) ──
  const [myLinkInput, setMyLinkInput] = useState("");
  const [myLinks, setMyLinks] = useState<string[]>([]);
  const [myLinkError, setMyLinkError] = useState("");
  const MAX_MYLINK = 3;
  const [genTags, setGenTags] = useState("");
  const [generating, setGenerating] = useState(false);
  const abortRef = useRef<AbortController|null>(null);
  const [imgSource, setImgSource] = useState<"ai"|"upload"|"none">("ai");
  const [imgCount, setImgCount] = useState(3);
  const [imgCountAuto, setImgCountAuto] = useState(true);
  // 이미지 개수는 엔진(AI/Flow)에 관계없이 이 상태 하나만 사용한다.
  // ref는 적용 직후 같은 이벤트 흐름에서 생성해도 최신 값을 읽게 한다.
  const imgCountRef = useRef(imgCount);
  const imgCountAutoRef = useRef(imgCountAuto);
  useEffect(()=>{ imgCountRef.current=imgCount; },[imgCount]);
  useEffect(()=>{ imgCountAutoRef.current=imgCountAuto; },[imgCountAuto]);
  const [generatedImages, setGeneratedImages] = useState<string[]>([]);
  const [uploadedImages, setUploadedImages] = useState<string[]>([]);
  const [genImgLoading, setGenImgLoading] = useState(false);
  const [genImgProgress, setGenImgProgress] = useState(0);
  const [captions, setCaptions] = useState<string[]>([]);
  const [videoOn, setVideoOn] = useState(false);
  const [videoUrl, setVideoUrl] = useState("");
  const [videoPosition, setVideoPosition] = useState<"top"|"middle"|"bottom">("middle");
  const [imgPattern, setImgPattern] = useState<"A"|"B"|"C"|"random">("random");
  type ImageConcept = "photo"|"comic";
  const [imageConcept,setImageConcept]=useState<ImageConcept>(()=>(localStorage.getItem("publy_image_concept") as ImageConcept)||"photo");
  const [currentImgPrompt, setCurrentImgPrompt] = useState("");
  const [genImgCurrent, setGenImgCurrent] = useState(0);
  const imgAbortRef = useRef<AbortController|null>(null);
  const [pubConcept, setPubConcept] = useState<PublishConcept>("full");
  const [pubAccId, setPubAccId] = useState("");
  const [pubTitle, setPubTitle] = useState("");
  const [pubTags, setPubTags] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [neighborBusy, setNeighborBusy] = useState(false);  // 서이추·공감댓글 자동작업 중(NeighborPage에서 통보) → 절전방지에 반영
  // ★자동화 탭(서이추·공감댓글·답방·품앗이·지수)은 한 번 열면 계속 살려둔다(언마운트 X).
  //   다른 탭 갔다 와도 작업(SSE)·로그·데이터가 유지되도록 keep-alive. 방문한 탭만 마운트하고 CSS로 숨김.
  const [visitedAutoTabs, setVisitedAutoTabs] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (["neighbor", "engage", "reply", "pumasi", "blogscore", "place", "inflow", "crawl"].includes(tab)) {
      setVisitedAutoTabs(prev => prev.has(tab) ? prev : new Set(prev).add(tab));
    }
  }, [tab]);
  const [liveLog, setLiveLog] = useState("");
  const [liveLogCollapsed, setLiveLogCollapsed] = useState(false);
  const [fullLog, setFullLog] = useState<string|null>(null);
  const [fullLogLoading, setFullLogLoading] = useState(false);
  const liveLogSnapshotRef = useRef("");
  const liveLogEndRef = useRef<HTMLDivElement|null>(null);
  const [pubMsg, setPubMsg] = useState("");
  const [pubScope, setPubScope] = useState<"body"|"faq"|"full">("full");
  const [imgGenFailed, setImgGenFailed] = useState(false);
  const [draftAvailable, setDraftAvailable] = useState(false);
  const [draftData, setDraftData] = useState<{title:string;content:string;savedAt:string}|null>(null);
  const [photoFiles, setPhotoFiles] = useState<{id:string;src:string;name:string}[]>([]);
  const [photoKeypoints, setPhotoKeypoints] = useState("");
  const [photoGenerating, setPhotoGenerating] = useState(false);
  const [photoGenDone, setPhotoGenDone] = useState(false);
  // ★사진 글쓰기 강화: 제목 후보 여러 개 / 생성 단계 로딩 / 꽃가루 축하
  const [photoTitleOptions, setPhotoTitleOptions] = useState<string[]>([]);
  const [photoGenStep, setPhotoGenStep] = useState(0);   // 0=대기,1~3 단계 로딩
  const [photoConfetti, setPhotoConfetti] = useState(false);
  const [photoDragOver, setPhotoDragOver] = useState(false);
  const [photoSuggesting, setPhotoSuggesting] = useState(false);   // 키포인트 AI 자동 제안 중
  const [newPlat, setNewPlat] = useState<"naver"|"tistory">("naver");
  const [newUser, setNewUser] = useState("");
  const [newPw, setNewPw] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [newBlog, setNewBlog] = useState("");
  const [addingAcc, setAddingAcc] = useState(false);
  const [connId, setConnId] = useState<string|null>(null);
  // 계정별 카테고리 (accId → 카테고리 배열)
  const [accCats, setAccCats] = useState<Record<string,string[]>>(()=>{try{return JSON.parse(localStorage.getItem("publy_acc_cats")||"{}");}catch{return {};}});
  const [editingCatAccId, setEditingCatAccId] = useState<string|null>(null);
  const [catInput, setCatInput] = useState("");
  const [writeAI, setWriteAI] = useState(()=>localStorage.getItem("publy_write_ai")||"gemini");
  const [imageAI, setImageAI] = useState(()=>localStorage.getItem("publy_image_ai")||"openai_img");
  const [writeStyle, setWriteStyle] = useState<WriteStyle>(()=>(localStorage.getItem("publy_write_style") as WriteStyle)||"감성일기");
  const [persona, setPersona] = useState<PersonaStyle>(()=>(localStorage.getItem("publy_persona") as PersonaStyle)||"none");
  const [blogTemplate, setBlogTemplate] = useState<BlogTemplate>("none");
  const [fontMode, setFontMode] = useState<"normal"|"large">(()=>(localStorage.getItem("publy_font_mode")||"normal") as "normal"|"large");
  const [noticePopup, setNoticePopup] = useState<{title:string;body:string;key:string}|null>(null);
  const [myReferrals, setMyReferrals] = useState<{id:string;name:string;email:string;plan:string;created_at:string}[]>([]);
  const [referralLoaded, setReferralLoaded] = useState(false);
  const [showUserDrop, setShowUserDrop] = useState(false);
  const [showReferralModal, setShowReferralModal] = useState(false);
  const [qualityScore, setQualityScore] = useState<{score:number;items:{label:string;pass:boolean;detail:string;weight:number}[]}|null>(null);
  const [calKeywords, setCalKeywords] = useState("");
  const [calPlatform, setCalPlatform] = useState<"naver"|"tistory">("naver");
  const [calDays, setCalDays] = useState(30);
  // ★캘린더 스케줄·완료기록은 localStorage에 저장 → 앱 재접속해도 유지(꾸준히 쓰게)
  const [calSchedule, setCalSchedule] = useState<{date:string;keyword:string;title:string;style:string;adType:string;promo?:{name:string;url:string;blurb:string}}[]>(()=>{try{return JSON.parse(localStorage.getItem("publy_cal_schedule")||"[]");}catch{return[];}});
  const [calCompleted, setCalCompleted] = useState<Record<string,string>>(()=>{try{return JSON.parse(localStorage.getItem("publy_cal_done")||"{}");}catch{return{};}});
  const [calLoading, setCalLoading] = useState(false);
  const [calDone, setCalDone] = useState(false);
  // 🔥 핫이슈 추천(무료·누구나): 카테고리별 실시간 인기 주제
  const HOT_CATS = ["실시간","정책자금","음식레시피","여행","재테크","건강운동","뷰티","패션","인테리어","반려동물","육아","경제","증권","산업","정치","사회","전국","세계","문화","연예","스포츠","건강"];
  const [hotCat, setHotCat] = useState("실시간");
  const [hotItems, setHotItems] = useState<string[]>([]);
  const [hotLoading, setHotLoading] = useState(false);
  const [hotPage, setHotPage] = useState(0); // 핫이슈 페이지네이션(주제 많아 아래로 길어짐 방지)
  const HOT_PAGE_SIZE = 20;
  const [quickKw, setQuickKw] = useState(""); // 핫이슈로 '바로 글쓰기'용(캘린더 스케줄과 별개 파이프라인)
  // ⚡ 원터치 발행(BEST): 키워드 여러 개 → 제목→본문→이미지→카테고리 자동→발행, 텀 간격 반복
  const [otKeywords,setOtKeywords]=useState("");
  const [otAiKw,setOtAiKw]=useState(()=>localStorage.getItem("publy_ot_aikw")==="1");   // AI 자동추천 키워드 토글
  const [otAiKwCount,setOtAiKwCount]=useState(()=>{const n=parseInt(localStorage.getItem("publy_ot_aikw_count")||"5");return isNaN(n)?5:Math.max(1,Math.min(30,n));});
  const [otAiCats,setOtAiCats]=useState<string[]>(()=>{try{return JSON.parse(localStorage.getItem("publy_ot_aicats")||"[]");}catch{return [];}});   // AI 키워드 주제 제한(여러 개, 없으면 전체)
  const [otTermMin,setOtTermMin]=useState(60);            // 발행 텀(분): 프리셋 10/30/60/120 + 직접입력
  const [otCustomTerm,setOtCustomTerm]=useState("");
  const [otImgCount,setOtImgCount]=useState(3);
  const [otImgMode,setOtImgMode]=useState<"flow"|"ai">("flow");   // Flow(무료·봇이 발행중 생성) vs AI(DALL-E/Replicate 유료키)
  const [otImageConcept,setOtImageConcept]=useState<"photo"|"comic"|"cycle">(()=>(localStorage.getItem("publy_ot_image_concept") as any)||"cycle");
  const [otCharMode,setOtCharMode]=useState<"auto"|"manual">("auto");
  const [otTargetChars,setOtTargetChars]=useState(1500);
  const [otWriteStyle,setOtWriteStyle]=useState<WriteStyle|"자동">(()=>{ const v=localStorage.getItem("publy_ot_style"); return (v==="자동"||v==="감성일기"||v==="정보글"||v==="맛집후기"||v==="여행기")?v as any:"자동"; });   // 기본=자동(키워드마다 AI가 패턴 선택)
  const [otRunning,setOtRunning]=useState(false);
  const otRunningRef=useRef(false);                       // state 반영 전 동시 재진입까지 차단
  const otStopRef=useRef(false);
  const otAbortRef=useRef<AbortController|null>(null);   // 진행 중 즉시 중단용
  const otFlowExhaustedRef=useRef<Set<number>>(new Set());   // 이번 실행에서 크레딧 소진된 Flow 슬롯(자동 전환용)
  const [otNextAt,setOtNextAt]=useState<number|null>(null);
  const [otPaused,setOtPaused]=useState<{idx:number;kws:string[];reason?:"credit"|"stopped";reviveTarget?:{logNo:string;origTitle:string;origBody:string}}|null>(null);   // 일시정지(크레딧부족) 또는 사용자 중단 → 이어가기 지점
  // ⏰ 예약 발행: 지정 시각에 원터치 자동 시작. 예약 대기 중엔 노트북 절전 방지(무인 운영).
  const [otSchedOn,setOtSchedOn]=useState(false);
  const [otSchedTime,setOtSchedTime]=useState(()=>localStorage.getItem("publy_ot_sched_time")||"09:00");
  const [otSchedDaily,setOtSchedDaily]=useState(()=>localStorage.getItem("publy_ot_sched_daily")!=="0");   // 매일 반복(기본 ON)
  const otRunRef=useRef<(()=>void)|null>(null);       // 예약 트리거가 부를 최신 runOneTouch
  const otReviveRunRef=useRef<((target:{logNo:string;origTitle:string;origBody:string;blogId:string;accountId?:string;careAccountId?:string})=>Promise<void>)|null>(null);
  // ✨ 글 살리기: 블로그지수에서 부실 글을 원터치 엔진으로 통째 새로 써서 그 글에 덮어쓰기
  const [reviveState,setReviveState]=useState<{logNo:string;title:string;step:string;done?:boolean;fail?:string}|null>(null);
  const [otLog,setOtLog]=useState<{id:string;kw:string;title?:string;cat?:string;step:string;status:"wait"|"run"|"done"|"fail"|"limit";postUrl?:string;error?:string;at?:string}[]>(()=>{try{return JSON.parse(localStorage.getItem("publy_ot_log")||"[]");}catch{return [];}});
  useEffect(()=>{try{localStorage.setItem("publy_ot_log",JSON.stringify(otLog.slice(0,50)));}catch{}},[otLog]);   // 로그 저장(작업 안 할 때도 항상 확인)
  // 🔴화면 어디서든 항상 보이는 실시간 로그(고정 패널). 스크롤 안 해도 진행상황이 눈에 보이게.
  const [otLiveLog,setOtLiveLog]=useState<string[]>(()=>{try{return JSON.parse(localStorage.getItem("publy_ot_livelog")||"[]");}catch{return [];}});
  const [otDockOpen,setOtDockOpen]=useState(false);   // 기본 접힘 — 펼치면 화면 절반을 덮어 입력칸(인사말·링크)이 가려 클릭 안 되던 문제
  useEffect(()=>{try{localStorage.setItem("publy_ot_livelog",JSON.stringify(otLiveLog.slice(-200)));}catch{}},[otLiveLog]);
  // 봇 오프라인/웹 미리보기 대비 폴백(카테고리별 무난한 인기 주제) — 빈 화면 방지
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
    // 🆕 대중 생활 카테고리 폴백(실시간 API 실패 시만 사용)
    음식레시피:["제육볶음 레시피","된장찌개 끓이는 법","에어프라이어 요리","자취 요리","다이어트 도시락","김치볶음밥","밑반찬 만들기","닭가슴살 요리","간단 아침 메뉴","비 오는 날 부침개","캠핑 요리","계란 요리","국물 요리","저칼로리 간식","전자레인지 요리","백종원 레시피","브런치 메뉴","야식 추천","제철 나물","홈베이킹"],
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
    } catch {
      // 봇 오프라인/웹 미리보기 → 폴백 주제라도 보여줌
      setHotItems(HOT_FALLBACK[cat] || HOT_FALLBACK["실시간"]);
    }
    setHotLoading(false);
    // 🔄 새로고침 버튼으로 부른 경우: 내용이 바뀌든 아니든 "갱신됐다" 피드백
    if (opts?.refreshed) showToast(`✨ ${cat} 핫이슈를 최신으로 갱신했어요!`, "success");
  };
  // 캘린더 탭 첫 진입 시 실시간 핫이슈 자동 로드
  useEffect(() => { if (tab === "calendar" && hotItems.length === 0 && !hotLoading) loadHotIssues("실시간"); /* eslint-disable-next-line */ }, [tab]);
  // ── 카테고리 / 공개 설정 / 예약 발행 ──
  const [category, setCategory] = useState("");
  const [categories, setCategories] = useState<{id:string;name:string}[]>([]);
  const [loadingCats, setLoadingCats] = useState(false);
  const [visibility, setVisibility] = useState<"public"|"neighbor"|"private">("public");
  const [scheduleOn, setScheduleOn] = useState(false);
  const [scheduleTime, setScheduleTime] = useState("");
  const [kstNow, setKstNow] = useState(()=>formatKstDateTime(new Date(), true));
  useEffect(()=>{
    const timer=setInterval(()=>setKstNow(formatKstDateTime(new Date(), true)),1000);
    return ()=>clearInterval(timer);
  },[]);

  useEffect(()=>{
    let alive = true;
    window.electron?.getAppVersion?.().then(version=>{ if(alive) setAppVersion(version); }).catch(()=>{});
    return ()=>{ alive = false; };
  },[]);

  // ★절전 방지(테리 요청): 자동 작업(발행·이미지생성·서이추·공감댓글) 중엔 화면/맥이 안 꺼지게(맥·윈도우 공통).
  //   어느 기능이든 하나라도 돌면 keepAwake, 전부 끝나면 자동 해제 → 평소엔 정상 절전. (영화 틀면 안 꺼지는 것과 같은 원리)
  useEffect(()=>{
    const busy = publishing || genImgLoading || neighborBusy || otRunning || otSchedOn;   // ★원터치·예약 대기 중 화면·시스템 안 꺼지게(예약=지정 시각까지 노트북 살아있게)
    window.electron?.keepAwake?.(busy).catch(()=>{});
    return ()=>{ if(busy) window.electron?.keepAwake?.(false).catch(()=>{}); };
  },[publishing, genImgLoading, neighborBusy, otRunning, otSchedOn]);
  // ⏰ 예약 감시: 30초마다 현재 시각을 확인해 예약 시각이면 원터치 자동 시작(중복 방지). 매일 반복이면 계속.
  useEffect(()=>{
    otRunRef.current=()=>runOneTouch(undefined,undefined,"schedule");
    otReviveRunRef.current=(target)=>runOneTouch(undefined,target,"revive",target.accountId);
  });
  // ⏰ 예약 감시 — '다음 목표 시각(timestamp)'을 계산해 그 시각이 실제로 지나야만 실행. 켜자마자 절대 안 돎.
  const otSchedTargetRef=useRef<number>(0);   // 다음 예약 발동 목표 시각(ms). 0=미설정
  useEffect(()=>{
    if(!otSchedOn){ otSchedTargetRef.current=0; return; }
    // 켠 순간 기준으로 '다음' 예약 시각을 계산(오늘 그 시각이 이미 지났으면 내일). 항상 미래 시각만 목표로.
    const computeTarget=()=>{
      const [th,tm]=otSchedTime.split(":").map(n=>parseInt(n,10));
      if(!Number.isFinite(th)||!Number.isFinite(tm)) return 0;
      const now=new Date();
      const t=new Date(now.getFullYear(),now.getMonth(),now.getDate(),th,tm,0,0);
      if(t.getTime()<=now.getTime()) t.setDate(t.getDate()+1);   // 이미 지난 시각이면 다음 날
      return t.getTime();
    };
    otSchedTargetRef.current=computeTarget();   // 켤 때 무조건 '미래' 시각 → 켜자마자 실행 불가
    const check=()=>{
      if(otRunningRef.current) return;
      const tgt=otSchedTargetRef.current;
      if(!tgt || Date.now()<tgt) return;         // ★목표 시각 도래 전이면 절대 실행 안 함
      // 도래: 실행하고, 매일 반복이면 다음 목표(내일)로 재설정, 1회면 예약 종료
      if(otSchedDaily){ const n=new Date(tgt); n.setDate(n.getDate()+1); otSchedTargetRef.current=n.getTime(); }
      else { otSchedTargetRef.current=0; setOtSchedOn(false); }
      otRunRef.current?.();
    };
    const iv=setInterval(check,20000);   // 20초마다 목표 시각 도래 확인(켤 때 즉시 호출 안 함)
    return ()=>clearInterval(iv);
    // eslint-disable-next-line
  },[otSchedOn,otSchedTime,otSchedDaily]);

  const liveLogActive = (tab==="publish"&&publishing)||(tab==="image"&&genImgLoading);
  useEffect(()=>{
    if(!liveLogActive||!window.electron?.readBotLog)return;
    let alive = true;
    let polling = false;
    setLiveLog("");
    liveLogSnapshotRef.current = "";
    const poll = async()=>{
      if(polling)return;
      polling = true;
      try{
        const next = (await window.electron?.readBotLog?.())||"";
        if(!alive||next===liveLogSnapshotRef.current)return;
        const previous = liveLogSnapshotRef.current;
        let added = next;
        if(previous&&next.startsWith(previous)) added = next.slice(previous.length);
        else if(previous){
          let overlap = Math.min(previous.length,next.length);
          while(overlap>0&&!previous.endsWith(next.slice(0,overlap))) overlap--;
          added = next.slice(overlap);
        }
        liveLogSnapshotRef.current = next;
        if(added) setLiveLog(current=>current+added);
      }catch{}
      finally{ polling = false; }
    };
    void poll();
    const interval = window.setInterval(poll,1250);
    return ()=>{ alive=false; window.clearInterval(interval); };
  },[liveLogActive]);

  // 📡 라이브 로그를 서버로 올려 관리자가 회원 검색으로 실시간 확인(회원이 신고 안 해도). throttle은 pushLiveLog 내부.
  useEffect(()=>{
    if(!user?.id) return;
    if(!liveLog && !liveLogActive) return;   // 올릴 것도, 진행 중도 아니면 스킵
    const context = tab==="publish"?"발행하기":tab==="image"?"이미지 생성":tab;
    pushLiveLog(user.id, { name:user.name, email:user.email, context, text:liveLog, running:liveLogActive });
  },[liveLog,liveLogActive,user?.id]);

  // 로그 자동스크롤 제거(테리 요청): 새 로그가 와도 화면을 강제로 옮기지 않고 사용자가 스크롤한 위치에 멈춰 있게 둔다.

  async function openFullLog(){
    setFullLogLoading(true);
    try{ setFullLog((await window.electron?.readBotLog?.())||"로그가 없습니다."); }
    catch{ setFullLog("로그를 불러오지 못했습니다."); }
    finally{ setFullLogLoading(false); }
  }

  // ── 블록 에디터 (tarry 방식) ──
  type TextBlock = {type:"text";id:string;content:string};
  type SingleImageBlock = {type:"image";id:string;src:string;alt:string;position:"left"|"center"|"right";source:"auto"|"manual"};
  type ImagePairBlock = {type:"image-pair";id:string;images:{src:string;alt:string}[]};
  type ContentBlock = TextBlock | SingleImageBlock | ImagePairBlock;
  function uid(){return Math.random().toString(36).slice(2);}
  const [blocks, setBlocks] = useState<ContentBlock[]>([{type:"text",id:uid(),content:""}]);
  const [thumbnail, setThumbnail] = useState("");
  const [greeting, setGreeting] = useState(()=>localStorage.getItem("publy_greeting")||"");
  const [savedGreeting, setSavedGreeting] = useState(()=>localStorage.getItem("publy_greeting")||"");   // 저장된(계속 쓰는) 인사말
  const saveGreeting = ()=>{ const g=greeting.trim(); localStorage.setItem("publy_greeting",g); setSavedGreeting(g); showToast(g?"글쓴이 인사말을 저장했어요. 앞으로 모든 글에 자동으로 들어가요":"저장된 인사말을 비웠어요","success"); };
  const [hashtags, setHashtags] = useState<string[]>([]);
  const [newTag, setNewTag] = useState("");
  const [imageMode, setImageMode] = useState<"auto"|"manual">("auto");
  const [imgGenType, setImgGenType] = useState<"ai"|"flow">(()=>(localStorage.getItem("publy_img_gen_type") as "ai"|"flow")||"flow");
  // ★Flow 이미지 생성 진행 표시를 봇 로그와 동기화(테리: "로그가 계속 1/6, 진행이 안 보인다").
  //   Flow는 한 번의 요청이라 앱이 개수를 못 받는다 → 봇 로그의 "N장 완성" 문구를 읽어 진행률을 움직인다.
  useEffect(()=>{
    if(!(tab==="image"&&genImgLoading&&imgGenType==="flow"))return;
    const m=[...liveLog.matchAll(/(\d+)장\s*다\s*만들었어요/g)];
    const done = m.length>0 ? Number(m[m.length-1][1]) : 0;
    const total = Math.max(1, flowImgCountRef.current);
    setGenImgCurrent(done);
    setGenImgProgress(/불러오는 중/.test(liveLog)?100:Math.min(99,Math.round((done/total)*100)));
  },[liveLog,genImgLoading,imgGenType,tab]);
  const [showFlowGuide, setShowFlowGuide] = useState(false);
  const [flowReady, setFlowReady] = useState(false);
  const [flowLaunching, setFlowLaunching] = useState(false);
  // ⚡ Flow 계정 슬롯(여러 구글 계정 — 각자 프로필/포트). name만 저장, 로그인은 각 프로필 크롬에 유지.
  const [flowSlots,setFlowSlots]=useState<{id:number;name:string}[]>(()=>{try{const s=JSON.parse(localStorage.getItem("publy_flow_slots")||"[]");return Array.isArray(s)&&s.length?s:[{id:0,name:"기본 계정"}];}catch{return [{id:0,name:"기본 계정"}];}});
  const [flowSlot,setFlowSlot]=useState<number>(()=>{const n=parseInt(localStorage.getItem("publy_flow_slot")||"0");return isNaN(n)?0:n;});   // 현재 활성 슬롯
  const [flowSlotReady,setFlowSlotReady]=useState<Record<number,boolean>>({});
  useEffect(()=>{try{localStorage.setItem("publy_flow_slots",JSON.stringify(flowSlots));}catch{}},[flowSlots]);
  useEffect(()=>{try{localStorage.setItem("publy_flow_slot",String(flowSlot));}catch{}},[flowSlot]);
  // 기존 Flow 표시/발행 참조도 공통 이미지 개수로 연결한다(별도 상태를 만들지 않음).
  const flowImgCount = imgCount;
  const flowImgCountAuto = imgCountAuto;
  const flowImgCountRef = imgCountRef;
  const [autoInserted, setAutoInserted] = useState(false);
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [showNaverMenu, setShowNaverMenu] = useState(false);
  const [showPublishPanel, setShowPublishPanel] = useState(false);
  const [showMeta, setShowMeta] = useState(false);
  const [toasts, setToasts] = useState<{id:number;msg:string;type:"success"|"error"|"info"}[]>([]);
  const [imageCountPopup, setImageCountPopup] = useState<{kind:"set"|"append";count:number}|null>(null);
  function showToast(msg:string, type:"success"|"error"|"info"="success"){
    const id=Date.now();
    setToasts(p=>[...p,{id,msg,type}]);
    setTimeout(()=>setToasts(p=>p.filter(t=>t.id!==id)),3200);
  } // 썸네일+인사말 접기 (이미지 있으면 자동펼침)
  function setManualImageCount(next:number){
    const count=Math.max(1,Math.min(30,next||1));
    imgCountAutoRef.current=false;
    setImgCountAuto(false);
    imgCountRef.current=count;
    setImgCount(count);
  }

  async function loadHistory(showSuccess = false): Promise<void> {
    try {
      const rows = await getHistory(user.id);
      setHistory(rows);
      setHistoryError("");
      if (showSuccess) showToast(`🔄 ${rows.length}건 · 계정 ${(user.id||"").slice(0,8)}`, "success");
    } catch (error: any) {
      const message = error?.message || String(error);
      setHistoryError(message);
      console.error("[publy_history] load failed", { userId: user.id, error });
      showToast(`❌ ${message}`, "error");
    }
  }
  function applyImageCount(){
    const count=Math.max(1,Math.min(30,imgCount));
    setManualImageCount(count);
    setImageCountPopup({kind:"set",count});
  }
  const [currentPw, setCurrentPw] = useState("");
  const [newPw1, setNewPw1] = useState("");
  const [newPw2, setNewPw2] = useState("");
  const [showCurrentPw, setShowCurrentPw] = useState(false);
  const [showNewPw1, setShowNewPw1] = useState(false);
  const [showNewPw2, setShowNewPw2] = useState(false);
  const [showDmIgPw, setShowDmIgPw] = useState(false);
  const [showPwPrompt, setShowPwPrompt] = useState(false);
  const [pwMsg, setPwMsg] = useState("");
  const [pwChanging, setPwChanging] = useState(false);
  // 버그 신고
  const [bugMemo, setBugMemo] = useState("");
  const [bugSending, setBugSending] = useState(false);
  const [bugMsg, setBugMsg] = useState("");
  // 내 신고가 처리완료되면 화면 어디서든 뜨는 팝업
  const [bugAlert, setBugAlert] = useState<PublyBugReport|null>(null);
  const [naverKeys, setNaverKeys] = useState<NaverApiKeys>({});
  const [naverKeysSaving, setNaverKeysSaving] = useState(false);
  const [naverKeysMsg, setNaverKeysMsg] = useState("");
  const [naverQuotaInfo, setNaverQuotaInfo] = useState<{used:number;limit:number}|null>(null);
  const [showKwInfo, setShowKwInfo] = useState(false);
  const [showRankInfo, setShowRankInfo] = useState(false);
  const thumbnailRef = useRef<HTMLInputElement>(null);
  const manualFileRef = useRef<HTMLInputElement>(null);

  // 카테고리 로드
  // saveToAccId: 불러온 카테고리를 저장할 계정(계정관리에서 특정 계정 버튼 클릭 시). 없으면 발행 탭 계정.
  async function loadCategories(plat: string, saveToAccId?: string) {
    const targetAcc = saveToAccId || pubAccId;
    if (!botOnline) {
      // 봇 오프라인 → accCats에서 로드
      const saved=accCats[targetAcc]||[];
      setCategories(saved.map((c,i)=>({id:String(i),name:c})));
      return;
    }
    setLoadingCats(true); setCategories([]); if(!saveToAccId)setCategory("");
    try {
      const r = await botFetch(`${BOT}/api/${plat}/categories/${user.id}`, {method:"GET", signal: AbortSignal.timeout(30000)} as any);
      const d = await r.json();
      if (d.categories && d.categories.length>0) {
        setCategories(d.categories);
        // 봇에서 불러온 카테고리를 accCats에도 저장(대상 계정)
        const names=d.categories.map((c:{id:string;name:string})=>c.name);
        saveAccCat(targetAcc, names);
        showToast(`✅ 카테고리 ${d.categories.length}개를 불러왔어요.`,"success");
      } else {
        // 봇 응답이 비었으면 저장된 accCats 사용
        const saved=accCats[targetAcc]||[];
        setCategories(saved.map((c,i)=>({id:String(i),name:c})));
        showToast("불러온 카테고리가 없어요. 네이버 로그인/글쓰기 권한을 확인해주세요.","error");
      }
    } catch {
      const saved=accCats[targetAcc]||[];
      setCategories(saved.map((c,i)=>({id:String(i),name:c})));
      showToast("카테고리 불러오기 실패 — 봇/네이버 로그인 상태를 확인해주세요.","error");
    }
    finally { setLoadingCats(false); }
  }

  // ── 블록 조작 ──
  function updateBlock(id:string, updates:Partial<ContentBlock>){
    setBlocks(prev=>prev.map(b=>b.id===id?({...b,...updates} as ContentBlock):b));
  }
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

  // 텍스트 블록들 사이사이에 이미지 블록을 균등하게 끼워넣기 (발행 직전 보정용)
  function interleave(textBlocks:ContentBlock[], imgBlocks:ContentBlock[]):ContentBlock[]{
    if(imgBlocks.length===0)return textBlocks;
    const out:ContentBlock[]=[];
    const step=Math.max(1,Math.floor(textBlocks.length/(imgBlocks.length+1)));
    let imgIdx=0;
    for(let i=0;i<textBlocks.length;i++){
      out.push(textBlocks[i]);
      if(imgIdx<imgBlocks.length && (i+1)%step===0){ out.push(imgBlocks[imgIdx]); imgIdx++; }
    }
    while(imgIdx<imgBlocks.length){ out.push(imgBlocks[imgIdx]); imgIdx++; }
    return out;
  }

  // ── triggerAutoInsert ──
  function triggerAutoInsert(images:{id:number;src:string;alt?:string}[]){
    const textOnly=blocks.filter(b=>b.type==="text"||(b.type==="image"&&(b as SingleImageBlock).source==="manual"));
    const textBlocks=textOnly.filter(b=>b.type==="text");
    if(textBlocks.length===0)return;
    function hasSectionMarker(b:ContentBlock):boolean{
      if(b.type!=="text")return false;
      const c=(b as TextBlock).content;
      // 마커([FAQ시작] 등)뿐 아니라 마커 없는 "질문답변/Q&A/해시태그/자주묻는" 텍스트도 경계로 → 이미지가 절대 그 아래로 안 감
      return /\[FAQ시작\]|\[참고자료시작\]|\[관련글시작\]|질문\s*답변|Q\s*&\s*A|큐앤에이|해시태그|자주\s*묻는/i.test(c);
    }
    const markerIdx=textOnly.findIndex(hasSectionMarker);
    const safeBlocks=markerIdx===-1?textOnly:textOnly.slice(0,markerIdx);
    const sectionBlocks=markerIdx===-1?[]:textOnly.slice(markerIdx);
    const safeTextCount=safeBlocks.filter(b=>b.type==="text").length;
    const imgs=images.filter(img=>img?.src&&img.src.trim()!=="");
    if(imgs.length===0)return;

    // 실제 패턴 결정 (랜덤이면 A/C 중 하나 — B(2장 나란히)는 캡션 문제로 제거)
    const patterns:("A"|"C")[] = ["A","C"];
    const activePattern:("A"|"B"|"C") = imgPattern==="random"
      ? patterns[Math.floor(Math.random()*patterns.length)]
      : (imgPattern==="B"?"C":imgPattern); // 혹시 B가 저장돼 있어도 C로

    // ★ 모든 패턴 공통: 이미지가 글 문단 사이에 "균등 분산"되도록 배치 계산
    //   (예전 패턴 A가 나머지를 한 곳에 몰아넣어 이미지가 다 붙던 버그를 근본 차단)
    //   B는 2장 나란히(pair) 섞고, A/C는 단독 배치 — 다양성은 유지하되 항상 균등.
    const mkImg=(img:{src:string;alt?:string},n:number):ContentBlock=>
      ({type:"image",id:uid(),src:img.src,alt:img.alt||`이미지 ${n}`,position:"center",source:"auto"} as ContentBlock);

    const result:ContentBlock[]=[];
    // 1) 첫 이미지 = 썸네일 (맨 위 단독)
    result.push(mkImg(imgs[0],1));
    const rest=imgs.slice(1);

    // 2) 나머지 이미지 = 전부 "한 줄 1장(단독)"으로 배치.
    //    ★네이버는 2장 한 줄(콜라주)에 개별 캡션을 자동으로 못 넣음 → 캡션 보장 위해 항상 단독.
    type Unit = {kind:"single";img:{src:string;alt?:string}} | {kind:"pair";imgs:{src:string;alt?:string}[]};
    const units:Unit[]=[];
    rest.forEach(img=>units.push({kind:"single",img}));

    // 3) 텍스트 블록 사이 "간격(gap)"에 units를 균등 분배
    //    gap 개수 = safeTextCount (각 텍스트 문단 뒤). units를 gap에 라운드로빈으로 고르게.
    const gaps=Math.max(1,safeTextCount);
    const perGap:Unit[][]=Array.from({length:gaps},()=>[]);
    units.forEach((u,i)=>{
      // 앞쪽 문단부터 고르게: i번째 unit은 (i * gaps / units.length) 위치 gap에
      const g=units.length<=gaps ? Math.min(gaps-1, Math.round((i+1)*gaps/(units.length+1))) : (i%gaps);
      perGap[Math.max(0,Math.min(gaps-1,g))].push(u);
    });

    // 4) 텍스트 블록 순회하며 각 문단 뒤에 배정된 units 삽입
    let textCount=0, imgN=1;
    for(const b of safeBlocks){
      result.push(b);
      if(b.type==="text"){
        const bucket=perGap[textCount]||[];
        for(const u of bucket){
          if(u.kind==="pair"){
            result.push({type:"image-pair",id:uid(),images:[{src:u.imgs[0].src,alt:u.imgs[0].alt||"이미지"},{src:u.imgs[1].src,alt:u.imgs[1].alt||"이미지"}]} as ContentBlock);
            imgN+=2;
          }else{
            result.push(mkImg(u.img,++imgN));
          }
        }
        textCount++;
      }
    }

    for(const b of sectionBlocks)result.push(b);
    setBlocks(result);setAutoInserted(true);
  }

  function handleAutoInsert(){
    const imgs=getActiveImages();
    if(imgs.length===0){alert("이미지를 먼저 생성해주세요");return;}
    triggerAutoInsert(imgs.map((src,i)=>({id:i,src,alt:`${keyword||genTitle} ${i===0?"대표":"현장"} 사진`})));
  }
  function handleRemoveAutoImages(){
    setBlocks(prev=>prev.filter(b=>b.type==="text"||(b.type==="image"&&(b as SingleImageBlock).source==="manual")));
    setAutoInserted(false);
  }

  // ── 네이버 복사 함수들 (tarry 방식) ──
  function addNaverImageMarkers(text:string):string{
    const hasRealImages=blocks.some(b=>(b.type==="image"&&(b as SingleImageBlock).src&&(b as SingleImageBlock).src.trim()!==""));
    if(hasRealImages)return text;
    const lines=text.split("\n").map(l=>l.trim()).filter(l=>l.length>0);
    if(lines.length<=1)return text;
    const CHUNK=300;const chunks:string[]=[];let buf="";
    for(const line of lines.slice(1)){
      if(buf.length>0&&buf.length+line.length+1>CHUNK){chunks.push(buf.trim());buf=line;}
      else{buf=buf?buf+"\n"+line:line;}
    }
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
        if(mode==="body"){
          c=c.replace(/\[FAQ시작\][\s\S]*?\[FAQ끝\]/g,"").replace(/\[참고자료시작\][\s\S]*?\[참고자료끝\]/g,"").replace(/\[관련글시작\][\s\S]*?\[관련글끝\]/g,"").trim();
        }else if(mode==="faq"){
          c=c.replace(/\[참고자료시작\][\s\S]*?\[참고자료끝\]/g,"").replace(/\[관련글시작\][\s\S]*?\[관련글끝\]/g,"").trim();
        }
        c=c.replace(/^#{1,3}\s+/gm,"").replace(/\*\*(.*?)\*\*/g,"$1").replace(/\*(.*?)\*/g,"$1");
        if(c)lines.push(c);
      }else if(b.type==="image"&&(b as SingleImageBlock).src){lines.push("[이미지]");}
    });
    if(hashtags.length>0)lines.push("\n"+hashtags.join(" "));
    return addNaverImageMarkers(lines.filter(Boolean).join("\n"));
  }

  function copyForNaver(){navigator.clipboard.writeText(buildNaverText("full"));showToast("📋 전체 복사 완료!");}
  function copyForNaverWithFaq(){navigator.clipboard.writeText(buildNaverText("faq"));showToast("📋 본문+FAQ 복사 완료!");}
  function copyForNaverBodyOnly(){navigator.clipboard.writeText(buildNaverText("body"));showToast("📋 본문만 복사 완료!");}

  // ── HTML 빌더 (tarry 방식) ──
  function buildHtmlContent():string{
    function escHtml(t:string){return t.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");}
    function inlineFmt(t:string){return escHtml(t).replace(/\*\*(.+?)\*\*/g,"<strong>$1</strong>").replace(/\*(.+?)\*/g,"<em>$1</em>");}
    const parts:string[]=[];
    const sectionMarkerIdx=blocks.findIndex(b=>b.type==="text"&&/\[FAQ시작\]|\[참고자료시작\]|\[관련글시작\]|질문\s*답변|Q\s*&\s*A|큐앤에이|해시태그|자주\s*묻는/i.test((b as TextBlock).content));
    blocks.forEach((b,blockIdx)=>{
      const afterSection=sectionMarkerIdx!==-1&&blockIdx>=sectionMarkerIdx;
      if(b.type==="text"){
        const cleaned=(b as TextBlock).content
          .replace(/\[FAQ시작\][\s\S]*?\[FAQ끝\]/g,"").replace(/\[참고자료시작\][\s\S]*?\[참고자료끝\]/g,"").replace(/\[관련글시작\][\s\S]*?\[관련글끝\]/g,"").trim();
        if(cleaned){
          // 모바일 가독성: 긴 문단은 2문장씩 끊어 별도 <p>로 나누고, 문단 간격을 넉넉히 준다
          const splitForReadability=(t:string):string[]=>{
            if(t.length<=130)return[t];
            const sents=t.match(/[^.!?。！？]+[.!?。！？]+["'”’)\]]*\s*|[^.!?。！？]+$/g)||[t];
            const groups:string[]=[];
            for(let i=0;i<sents.length;i+=2)groups.push(sents.slice(i,i+2).join("").trim());
            return groups.filter(Boolean);
          };
          const htmlLines:string[]=[];
          cleaned.split("\n").forEach(line=>{
            const t=line.trim();if(!t)return;
            if(/^##\s+/.test(t)){htmlLines.push(`<h2 style="font-size:20px;font-weight:800;margin:36px 0 14px;color:#111;border-bottom:2px solid #eee;padding-bottom:8px">${inlineFmt(t.replace(/^##\s+/,""))}</h2>`);return;}
            if(/^###\s+/.test(t)){htmlLines.push(`<h3 style="font-size:17px;font-weight:700;margin:24px 0 10px;color:#1a1a1a;border-left:4px solid #2563eb;padding-left:10px">${inlineFmt(t.replace(/^###\s+/,""))}</h3>`);return;}
            if(/^---+$/.test(t)){htmlLines.push(`<hr style="border:none;border-top:2px solid #eee;margin:24px 0">`);return;}
            splitForReadability(t).forEach(p=>htmlLines.push(`<p style="line-height:1.95;margin:0 0 24px;color:#333;font-size:16px">${inlineFmt(p)}</p>`));
          });
          const html=htmlLines.join("\n");
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
    const sectionTags=["[FAQ시작]","[관련글시작]","[참고자료시작]"];
    const sectionStart=sectionTags.reduce((min,tag)=>{const i=text.indexOf(tag);return(i>-1&&i<min)?i:min;},Infinity);
    const body=sectionStart<Infinity?text.slice(0,sectionStart).trim():text;
    const section=sectionStart<Infinity?text.slice(sectionStart).trim():"";
    const renderLines=(t:string,offset:number)=>t.split("\n").map((line,i)=>{
      if(line.startsWith("## "))return<h2 key={offset+i} style={{fontSize:18,fontWeight:800,margin:"20px 0 8px",color:"#111"}}>{line.slice(3)}</h2>;
      if(line.startsWith("### "))return<h3 key={offset+i} style={{fontSize:16,fontWeight:700,margin:"16px 0 6px",color:"#222"}}>{line.slice(4)}</h3>;
      if(line==="---")return<hr key={offset+i} style={{border:"none",borderTop:"1px solid #ddd",margin:"16px 0"}}/>;
      if(line==="")return<br key={offset+i}/>;
      if(sectionTags.some(t=>line.includes(t)))return<div key={offset+i} style={{display:"none"}}/>;
      return<p key={offset+i} style={{marginBottom:8,fontSize:14,lineHeight:1.8,color:"#333"}}>{line}</p>;
    });
    return[...renderLines(body,0),section?<hr key="sep" style={{border:"none",borderTop:"1px solid #eee",margin:"20px 0"}}/>:<span key="no-sep"/>, ...renderLines(section,10000)];
  }

    async function handleChangePw() {
    if (!currentPw || !newPw1 || !newPw2) { setPwMsg("모든 항목을 입력하세요"); return; }
    if (newPw1 !== newPw2) { setPwMsg("새 비밀번호가 일치하지 않습니다"); return; }
    if (newPw1.length < 6) { setPwMsg("비밀번호는 6자 이상이어야 합니다"); return; }
    setPwChanging(true); setPwMsg("");
    try {
      await changeUserPassword(user.id, currentPw, newPw1);
      setCurrentPw(""); setNewPw1(""); setNewPw2("");
      setPwMsg("✅ 비밀번호가 변경됐어요!");
      setTimeout(() => setPwMsg(""), 4000);
    } catch (e: any) {
      setPwMsg("❌ " + e.message);
    } finally { setPwChanging(false); }
  }

  // ── 버그 신고: 로컬 봇 로그 + 메모 + 아이디를 관리자 페이지로 전송 ──
  async function submitBugReport() {
    setBugSending(true); setBugMsg("");
    try {
      let log = "";
      try { log = (await (window as any).electron?.readBotLog?.()) || ""; } catch {}
      const version = (await (window as any).electron?.checkAppUpdate?.().then((r:any)=>r?.currentVersion).catch(()=>"")) || "";
      const res = await submitBugReportRow({
        user_id: user.id, user_name: user.name, user_email: user.email,
        app_version: version, memo: bugMemo.trim(), log_text: log,
      });
      if (!res.ok) throw new Error(res.error || "전송 실패");
      setBugMemo("");
      setBugMsg("✅ 신고 완료! 로그가 관리자에게 전송됐어요. 빠르게 확인할게요.");
      setTimeout(()=>setBugMsg(""), 6000);
    } catch (e:any) {
      setBugMsg("❌ 전송 실패: " + (e.message||"") + " — '로그 폴더 열기'로 파일을 보내주셔도 돼요.");
    } finally { setBugSending(false); }
  }

  // ── 내 신고가 관리자에 의해 처리완료되면, 화면 어디에 있든 팝업으로 알림 ──
  // "한 번 닫으면 절대 다시 안 뜬다"를 보장: ①로컬(localStorage)에 확인한 id 영구 저장(이 기기)
  //  ②서버에 user_notified=true 기록(다른 기기·재설치까지). 둘 중 하나만 살아있어도 재등장 안 함.
  const BUG_SEEN_KEY = `publy_bug_seen_${user.id}`;
  const bugSeenRef = useRef<Set<string>>(new Set(
    (()=>{ try{ return JSON.parse(localStorage.getItem(`publy_bug_seen_${user.id}`)||"[]"); }catch{ return []; } })()
  ));
  const persistBugSeen = ()=>{ try{ localStorage.setItem(BUG_SEEN_KEY, JSON.stringify([...bugSeenRef.current])); }catch{} };
  useEffect(()=>{
    let alive=true;
    const check=async()=>{
      if(bugAlert) return; // 이미 하나 떠 있으면 대기
      try{
        const rows=await getMyResolvedBugAlerts(user.id);
        const next=rows.find(r=>!bugSeenRef.current.has(r.id)); // 아직 안 본 것만(로컬 기록 포함)
        if(alive && next){ bugSeenRef.current.add(next.id); persistBugSeen(); setBugAlert(next); }
      }catch{}
    };
    const t=setTimeout(check, 3000);          // 진입 직후 한 번
    const iv=setInterval(check, 60000);        // 이후 1분마다
    return ()=>{ alive=false; clearTimeout(t); clearInterval(iv); };
  },[user.id,bugAlert]);

  async function dismissBugAlert(){
    if(!bugAlert) return;
    const id=bugAlert.id;
    bugSeenRef.current.add(id); // 즉시 재등장 차단(DB 반영 전이라도)
    persistBugSeen();           // 이 기기에 영구 저장 → 재설치 전까지 절대 안 뜸(DB 실패해도)
    setBugAlert(null);          // 팝업 닫기
    try{ await markBugNotified(id); }catch{} // 서버에도 기록(다른 기기·재설치 대응)
  }

  // ── Ctrl+V 클립보드 이미지 붙여넣기 ──
  useEffect(()=>{
    const handlePaste=(e:ClipboardEvent)=>{
      if(tab!=="publish")return;
      const items=Array.from(e.clipboardData?.items||[]);
      const imgItem=items.find(i=>i.type.startsWith("image/"));
      if(!imgItem)return;
      const file=imgItem.getAsFile();
      if(!file)return;
      const reader=new FileReader();
      reader.onload=ev=>{
        const src=ev.target?.result as string;
        const newBlock:SingleImageBlock={id:Date.now().toString(),type:"image",src,alt:keyword||"붙여넣기 이미지",position:"center",source:"manual"};
        setBlocks(p=>[...p,newBlock]);
        showToast("📋 이미지가 본문에 추가됐어요!");
      };
      reader.readAsDataURL(file);
    };
    window.addEventListener("paste",handlePaste);
    return ()=>window.removeEventListener("paste",handlePaste);
  },[tab,keyword]);

  // 공지 팝업 로드
  useEffect(()=>{
    (async()=>{
      try{
        const {data}=await supabase.from("publy_settings").select("value").eq("key","global_notice").maybeSingle();
        if(data?.value){
          const n=JSON.parse(data.value);
          if(n.active){
            const dismissed=localStorage.getItem("publy_dismissed_"+n.created_at);
            if(!dismissed) setNoticePopup({title:n.title,body:n.body,key:n.created_at});
          }
        }
      }catch{}
    })();
  },[]);

  const checkBot = useCallback(async()=>{
    try{const r=await botFetch(`${BOT}/health`,{signal:AbortSignal.timeout(3000)});setBotOnline(r.ok);}
    catch{setBotOnline(false);}
  },[]);

  // 🔄 상단바 새로고침 — 클릭하면 눈에 보이게 반응(회전+토스트)하고 봇 상태를 갱신한 뒤 실제 새로고침
  const [refreshing,setRefreshing]=useState(false);
  const handleHeaderRefresh=useCallback(()=>{
    if(refreshing)return;
    setRefreshing(true);
    showToast("🔄 최신 상태로 새로고침해요","success");
    checkBot();
    setTimeout(()=>window.location.reload(),480);
  },[refreshing,checkBot,showToast]);

  // ── 프록시 노란불: 관리자가 이 회원에게 프록시를 배정하면 대시보드에 "프록시 ON" 깜빡이 ──
  const NEIGHBOR_BOT = "http://127.0.0.1:3364";   // 서이추·공감·품앗이 봇(프록시 배정 조회)
  const [proxyActive, setProxyActive] = useState(false);
  const checkMyProxy = useCallback(async()=>{
    try{
      // 이 회원의 연결 계정(서이추·공감·답방·품앗이) accountId도 함께 넘겨, 계정에 배정된 경우도 노란불이 뜨게.
      const accts=new Set<string>();
      ["neighbor","engage","reply","pumasi"].forEach(k=>{try{(JSON.parse(localStorage.getItem(`publy_accounts_${k}`)||"[]")||[]).forEach((a:any)=>{if(a?.accountId)accts.add(a.accountId);});}catch{}});
      const q=accts.size?`?accts=${encodeURIComponent([...accts].join(","))}`:"";
      const r=await botFetch(`${NEIGHBOR_BOT}/api/my-proxy/${user.id}${q}`,{signal:AbortSignal.timeout(3000)}); const j=await r.json(); setProxyActive(!!j.active);
    }
    catch{ setProxyActive(false); }
  },[user.id]);
  useEffect(()=>{ checkMyProxy(); const t=setInterval(checkMyProxy,60000); return ()=>clearInterval(t); },[checkMyProxy]);

  function loadReferrals() {
    if (referralLoaded) return;
    supabase.from("publy_users").select("id,name,email,plan,created_at").eq("referred_by", user.id)
      .then(({data}) => { setMyReferrals(data||[]); setReferralLoaded(true); });
  }

  // 설정탭 열 때 네이버 키 로드
  useEffect(()=>{
    if(tab==="settings"){
      loadReferrals();
      getUserNaverApiKeys(user.id).then(setNaverKeys).catch(()=>{});
    }
    if(tab==="insta_dm" && dmTargets.length===0){
      setDmLoading(true);
      Promise.all([getInstaDmTargets(user.id),getInstaDmQuota(user.id)]).then(([t,q])=>{
        setDmTargets(t); setDmQuota(q); setDmLoading(false);
      });
    }
    if(tab==="insta_dm" && !localStorage.getItem("insta_dm_warn_hide")){
      setShowInstaWarn(true);
    }
    if(tab==="engage") getEngageDailyUsage(user.id).then(setEngageUsed);
  },[tab,user.id]);

  // ★사용량/발행건수 실시간 갱신(테리 요청): 관리자가 '건수 초기화'나 쿼터를 바꾸면 회원 앱이
  //   로그아웃 없이도 20초 안에 반영한다. (등급 실시간은 App.tsx refreshUserById가 담당)
  useEffect(()=>{
    let alive=true;
    const sync=()=>{
      getQuota(user.id).then((q:PublyQuota|null)=>{
        if (!alive || !q) return;
        setQuota(q);
        setLocked((daysUntil(q.reset_date) ?? 0) <= 0);
      });
      getDailyPublishUsage(user.id).then(u=>{ if(alive) setDailyPublishUsed(u); });
      // 서이추·공감·답방 게이지도 함께 갱신 → 관리자가 '건수 초기화'하면 회원 화면도 20초 내 0으로 반영
      getNeighborDailyUsage(user.id).then(u=>{ if(alive) setNeighborUsed(u); });
      getEngageDailyUsage(user.id).then(u=>{ if(alive) setEngageUsed(u); });
      getReplyDailyUsage(user.id).then(u=>{ if(alive) setReplyUsed(u); });
    };
    sync(); // 진입 즉시 1회
    const iv=window.setInterval(sync,5000); // 실시간성 강화: 20초→5초 (관리자 초기화가 회원 화면에 빠르게 반영)
    return ()=>{ alive=false; window.clearInterval(iv); };
  },[user.id]);

  useEffect(()=>{
    checkBot();
    getAccounts(user.id).then(setAccounts);
    void loadHistory();
    getNeighborDailyUsage(user.id).then(setNeighborUsed);
    getEngageDailyUsage(user.id).then(setEngageUsed);
    getReplyDailyUsage(user.id).then(setReplyUsed);
    getInstaDmQuota(user.id).then(q=>{ const today=new Date().toISOString().slice(0,10); setInstaUsed(q && q.reset_date===today ? (q.used_today||0) : 0); });
    getQuota(user.id).then(async (q:PublyQuota|null)=>{
      if(!q) { setPageReady(true); return; }
      setQuota(q);

      // ── 알림 체크 ──
      const now = new Date();
      const daysLeft = daysUntil(q.reset_date) ?? 0;

      // 🔒 모든 회원등급은 관리자가 설정한 이용기간을 동일하게 적용한다.
      setLocked(daysLeft <= 0);

      // 만료 알림 (3일 이하 또는 만료됨)
      if (daysLeft <= 3) {
        setAlertPopup({ type: "expire", daysLeft: Math.max(0, daysLeft) });
        setPageReady(true);   // ⬅️ 페이지는 정상 표시 (예전엔 여기서 return해 무한로딩 유발)
        return;
      }

      // 발행 잔여 알림
      const config = PLAN_CONFIG[user.plan] ?? PLAN_CONFIG.free;
      const used = await getDailyPublishUsage(user.id);
      setDailyPublishUsed(used);
      const remaining = config.dailyPublish - used;
      const pct = remaining / config.dailyPublish;
      if (pct <= 0.1) {
        setAlertPopup({ type: "publish", used, limit: config.dailyPublish });
      } else if (pct <= 0.2 && !localStorage.getItem(`publy_alert_20_${now.toISOString().slice(0,10)}`)) {
        localStorage.setItem(`publy_alert_20_${now.toISOString().slice(0,10)}`, "1");
        setAlertPopup({ type: "publish", used, limit: config.dailyPublish });
      }
      setPageReady(true);
    }).catch(()=>setPageReady(true));
    // 임시저장 확인
    try{
      const d=localStorage.getItem("publy_draft");
      if(d){const p=JSON.parse(d);if(p.content&&p.title){setDraftAvailable(true);setDraftData(p);}}
    }catch{}
    const iv=setInterval(checkBot,30000);
    // 앱 시작 직후 봇 서버가 뜨는 데 몇 초 걸림 → 초반엔 자주 재확인해 "오프라인"이 오래 남지 않게.
    const warm=[2000,4000,7000,11000,16000,22000].map(t=>setTimeout(checkBot,t));
    if(!localStorage.getItem("publy_guide_seen")){setTimeout(()=>setShowGuide(true),900);}
    return()=>{clearInterval(iv);warm.forEach(clearTimeout);};
  },[checkBot,user.id]);

  // ★발행관리 탭 진입 시 발행기록 항상 다시 불러온다(초기 로드 누락/화면 0건 방지).
  //   발행기록은 서버(publy_history)에 user_id별 영구저장 → 탭 열 때마다 최신 반영.
  useEffect(()=>{ if(tab==="manage"&&user?.id) void loadHistory(); },[tab,user?.id]);
  // 📈 컨트롤타워 진입 or 기간 변경 시 활동 그래프 로드(주간/월간/1년)
  useEffect(()=>{ if(tab==="control"&&user?.id) getActivityByRange(user.id,actRange).then(setWeekly).catch(()=>{}); },[tab,user?.id,actRange]);

  function recommendImgCount(content:string):number{
    // 글 길이에 맞춰 이미지 수 추천 — 약 700자당 1장, 최소 2장 최대 8장.
    // (1500자→2장, 2800자→4장, 4200자→6장, 5600자+→8장) 배치는 균등분산이라 많아도 안 붙음.
    return Math.max(2, Math.min(8, Math.round(content.length / 700)));
  }

  /* ── 글 구간별 캡션 생성 ── */
  function buildCaptions(kw:string, count:number, content?:string):string[]{
    const k = kw || "사진";
    // ★"사진 1/사진 2" 같은 숫자 캡션 금지 + 캡션이 서로 다르게(중복 없이). SEO 키워드는 유지.
    //   본문(content) 소제목을 우선 캡션으로 쓰고, 부족하면 아래 자연스러운 후보로 채운다(모두 서로 다르게).
    const pool = [
      `${k}`, `${k} 현장`, `${k} 실물`, `${k} 자세히 보기`, `${k} 추천`, `${k} 정보`,
      `${k} 살펴보기`, `${k} 후기`, `${k} 한눈에`, `${k} 미리보기`, `${k} 포인트`, `${k} 상세`,
    ];
    // 본문에서 소제목(짧은 줄)을 캡션 후보로 추출 → 글 내용과 맞는 캡션(중복·URL·마커 제외)
    const fromBody:string[] = [];
    if(content){
      for(const line of content.split(/\n+/).map(s=>s.trim())){
        if(line.length>=4 && line.length<=24 && !/https?:\/\/|\[|Q\d|A\d|태그|해시/.test(line)) fromBody.push(line);
      }
    }
    const seen=new Set<string>();
    const out:string[]=[];
    const pick=(s:string)=>{ const t=s.trim(); if(t&&!seen.has(t)){seen.add(t);out.push(t);} };
    // 1순위 본문 소제목, 2순위 후보 pool — 서로 다른 것만 담아 count개 채움
    for(const s of fromBody){ if(out.length>=count)break; pick(s); }
    for(const s of pool){ if(out.length>=count)break; pick(s); }
    // 그래도 부족하면(후보 소진) 키워드 변형으로 채우되 숫자 대신 서로 다른 접미
    const extra=["소개","살펴봐요","눈여겨볼 점","참고하세요","체크포인트","활용 팁"];
    let ei=0;
    while(out.length<count){ pick(`${k} ${extra[ei%extra.length]}`); ei++; if(ei>extra.length+count)break; }
    return out.slice(0,count);
  }

  // ─── 300+ 키워드 이미지 프롬프트 시스템 ────────────────────
  const NP_TAG = "zero people, absolutely no humans, no person, no face, no hands, no body parts, no text, no watermark, object only, safe for work, wholesome family-friendly, no violence, no weapons, no explicit or adult content, no real brand logos, no celebrities";
  const PROMPT_DB: {keywords:string[];prompt:string}[] = [
    // 음식/맛집
    {keywords:["한식","한정식","백반","집밥","가정식"],prompt:"Korean home-style meal spread, banchan side dishes, stone pot bibimbap, wooden table, steam rising, cozy restaurant interior, warm natural lighting"},
    {keywords:["맛집","식당","레스토랑","음식점","맛"],prompt:"cozy Korean restaurant interior, beautifully plated dishes on wooden table, ambient warm lighting, inviting atmosphere, bokeh background"},
    {keywords:["삼겹살","고기","구이","바베큐","BBQ","갈비"],prompt:"Korean BBQ pork belly sizzling on grill, smoke rising, lettuce wraps, sesame oil, glowing charcoal, dark dramatic lighting"},
    {keywords:["회","횟집","사시미","해산물","해물","횟감"],prompt:"fresh Korean sashimi platter, colorful fish slices on ice, glistening presentation, premium seafood restaurant, cinematic lighting"},
    {keywords:["초밥","스시","오마카세","일식"],prompt:"premium omakase sushi assortment, chef-crafted nigiri on wooden platter, minimalist Japanese restaurant, soft dramatic lighting"},
    {keywords:["스테이크","소고기","등심","ribeye","안심"],prompt:"perfectly seared ribeye steak, medium-rare interior, herb butter melting, fine dining plating, dramatic dark background"},
    {keywords:["파스타","이탈리안","피자","양식","스파게티"],prompt:"rustic Italian pasta dish, spaghetti with rich tomato sauce, fresh basil, parmesan, warm restaurant ambiance"},
    {keywords:["라면","라멘","국수","우동","소바"],prompt:"steaming bowl of Korean ramen, rich broth, soft egg, noodles, steam wisps, dark moody background, cinematic"},
    {keywords:["치킨","통닭","후라이드","양념치킨"],prompt:"crispy golden Korean fried chicken on wooden board, sauce cups, casual dining atmosphere, warm lighting"},
    {keywords:["피자","도우","화덕피자"],prompt:"artisan wood-fired pizza bubbling cheese, fresh toppings, rustic wooden table, Italian atmosphere"},
    {keywords:["버거","햄버거","샌드위치"],prompt:"gourmet burger juicy patty, fresh vegetables, sauce dripping, brioche bun, craft paper, casual dining"},
    {keywords:["카페","커피","아메리카노","라떼","에스프레소","카페인"],prompt:"cozy Korean cafe interior, latte art in ceramic cup, morning light through window, wooden table, minimalist aesthetic"},
    {keywords:["빵","베이커리","크루아상","소금빵"],prompt:"artisan bakery display, golden croissants, fresh-baked bread, pastries, warm bakery interior, flour dusted surface"},
    {keywords:["케이크","디저트","마카롱","초콜릿","아이스크림","단것"],prompt:"elegant dessert plating, layered chocolate cake, fresh berry garnish, marble surface, soft studio lighting"},
    {keywords:["빙수","팥빙수","설빙","여름간식"],prompt:"Korean shaved ice bingsu, fluffy snow texture, red bean paste, condensed milk drizzle, pastel tones"},
    {keywords:["떡볶이","분식","순대","어묵","포장마차"],prompt:"Korean street food tteokbokki in red sauce, fish cakes, steam, pojangmacha night market atmosphere"},
    {keywords:["편의점","컵라면","야식","간식"],prompt:"Korean convenience store interior, colorful snack displays, late night warm glow, modern retail"},
    {keywords:["도시락","간편식","밀키트"],prompt:"beautifully arranged Korean lunch box bento, colorful vegetables, rice, clean minimal presentation"},
    {keywords:["채식","비건","샐러드","건강식"],prompt:"vibrant vegan grain bowl, colorful vegetables, quinoa, avocado, hummus, white ceramic bowl, editorial"},
    {keywords:["브런치","아보카도","팬케이크","와플"],prompt:"weekend brunch spread, avocado toast, stacked pancakes with maple syrup, fresh fruit, white marble, morning light"},
    {keywords:["맥주","와인","술","주류","칵테일"],prompt:"artisan craft beer glass, golden bubbles, bar setting, warm amber lighting, premium beverage"},
    {keywords:["국","찌개","탕","설렁탕","감자탕"],prompt:"steaming Korean soup pot, rich broth, ingredients visible, ceramic bowl, restaurant wooden table, comfort food"},
    {keywords:["김밥","주먹밥","쌈밥"],prompt:"colorful Korean gimbap rolls sliced, sesame seeds, bamboo mat, traditional presentation, warm lighting"},
    // 여행
    {keywords:["제주도","제주","한라산","성산일출봉","우도"],prompt:"Jeju island volcanic coastline, dramatic black lava rocks, turquoise ocean waves, Hallasan mountain backdrop, golden hour"},
    {keywords:["부산","해운대","광안리","남포동","감천"],prompt:"Busan Gwangalli beach at sunset, Gwangan Bridge illuminated, warm golden reflection on water, cinematic"},
    {keywords:["서울","경복궁","남산","한강","명동"],prompt:"Seoul cityscape at dusk, Namsan tower glowing, Han River reflection, modern skyscrapers meets traditional palace"},
    {keywords:["경주","불국사","첨성대","신라"],prompt:"ancient Gyeongju Bulguksa temple, cherry blossoms, stone lanterns, misty morning atmosphere, UNESCO heritage"},
    {keywords:["전주","한옥마을","비빔밥"],prompt:"Jeonju Hanok village, traditional Korean architecture, tile roofs, stone paths, warm golden afternoon light"},
    {keywords:["강원","강릉","속초","설악산","동해"],prompt:"Seoraksan mountain peaks with autumn foliage, dramatic rocky cliffs, crisp mountain air, editorial"},
    {keywords:["일본","도쿄","오사카","교토","후쿠오카"],prompt:"Kyoto traditional street at twilight, lantern-lit cobblestone alley, cherry blossom petals, cinematic"},
    {keywords:["유럽","파리","로마","스페인","런던","프랑스"],prompt:"Paris street at golden hour, Eiffel Tower in distance, café tables, warm European ambiance, cobblestone"},
    {keywords:["동남아","베트남","태국","발리","싱가포르"],prompt:"Bali tropical infinity pool overlooking lush jungle, lotus flowers, temple offerings, golden sunset"},
    {keywords:["미국","뉴욕","LA","하와이","라스베가스"],prompt:"Manhattan skyline at blue hour, skyscrapers reflected in Hudson River, city lights, dramatic urban"},
    {keywords:["캠핑","글램핑","텐트","야외","아웃도어"],prompt:"luxury glamping tent in forest clearing, warm lantern glow, campfire embers, starry night sky, misty morning"},
    {keywords:["호텔","리조트","숙소","펜션","풀빌라"],prompt:"luxury hotel suite interior, king bed with crisp white linens, floor-to-ceiling window with city view, elegant"},
    {keywords:["여행준비","패킹","캐리어","배낭여행"],prompt:"open suitcase with neatly packed clothes, travel accessories, passport, camera, clean flat lay on white bed"},
    {keywords:["국내여행","드라이브","도로여행","차박"],prompt:"scenic Korean coastal highway, road trip, mountain pass, autumn foliage, blue sky, freedom"},
    {keywords:["인천","강화도","을왕리","수원"],prompt:"Korean coastal scenery, calm bay water, traditional fishing village, golden morning light"},
    {keywords:["남해","통영","거제","한려수도"],prompt:"Southern Korean sea landscape, islands scattered in blue water, fishing boats, pristine coastal scenery"},
    // 건강/운동/의료
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
    {keywords:["치아","치과","구강","칫솔","치실"],prompt:"dental care flat lay, toothbrush, floss, mouthwash, white background, clean clinical aesthetic"},
    {keywords:["병원","진료","의료","건강검진"],prompt:"modern hospital corridor, clean professional healthcare, trust and expertise, bright clinical lighting"},
    {keywords:["한의원","한방","침","뜸","한약"],prompt:"traditional Korean medicine clinic, herbal medicine, acupuncture needles, wooden aesthetic, healing atmosphere"},
    // 재테크/금융
    {keywords:["주식","주식투자","증권","코스피","코스닥"],prompt:"stock market candlestick chart on monitor, trading platform, financial data visualization, dark professional"},
    {keywords:["코인","비트코인","가상화폐","NFT","블록체인"],prompt:"golden bitcoin coins, blockchain network visualization, digital currency concept, blue neon tech aesthetic"},
    {keywords:["부동산","아파트","투자","분양","청약"],prompt:"modern Korean apartment complex aerial view, urban cityscape, real estate development, sunset reflection"},
    {keywords:["재테크","돈","저축","절약","금융"],prompt:"Korean won bills and coins arranged neatly, piggy bank, growth chart, financial planning, clean white background"},
    {keywords:["ETF","펀드","적금","예금","금리","이자"],prompt:"financial investment growth concept, ascending bar chart, coins stacking, plant growing from money, prosperity"},
    {keywords:["경제","금리","환율","인플레이션","뉴스경제"],prompt:"financial newspaper with market data, coffee cup, modern desk, economic analysis aesthetic"},
    {keywords:["사업","창업","스타트업","사업자","CEO"],prompt:"modern startup office, whiteboard with business plan, team collaboration energy, contemporary workspace"},
    {keywords:["프리랜서","부업","N잡러","재택근무","사이드잡"],prompt:"home office setup, laptop on clean desk, plants, natural window light, productive remote work"},
    {keywords:["보험","연금","노후","은퇴"],prompt:"secure family financial planning, warm home setting, documents, trust and stability concept"},
    {keywords:["쇼핑몰","온라인쇼핑몰","판매","셀러","위탁판매"],prompt:"e-commerce product photography setup, clean white background, professional product display, modern"},
    // IT/테크/AI
    {keywords:["AI","인공지능","ChatGPT","GPT","클로드"],prompt:"artificial intelligence neural network visualization, futuristic blue light, data streams, tech concept"},
    {keywords:["스마트폰","아이폰","갤럭시","핸드폰"],prompt:"premium smartphone on minimal surface, app interface glow, clean tech product photography"},
    {keywords:["노트북","맥북","컴퓨터","PC","맥북"],prompt:"MacBook Pro on clean minimal desk, code on screen, soft ambient lighting, developer workspace"},
    {keywords:["앱","어플","앱개발","소프트웨어"],prompt:"smartphone screen with app icons, UI design mockup, colorful interface, mobile development concept"},
    {keywords:["코딩","프로그래밍","개발","개발자","웹개발"],prompt:"dark mode code editor screen, colorful syntax highlighting, developer keyboard, multiple monitors"},
    {keywords:["유튜브","유튜버","영상","콘텐츠","크리에이터"],prompt:"YouTube creator studio setup, ring light, camera, microphone, content creation workspace, professional"},
    {keywords:["인스타","SNS","소셜미디어","틱톡","릴스"],prompt:"social media content creation, smartphone photography setup, aesthetic flat lay, influencer lifestyle"},
    {keywords:["게임","게이밍","PC방","플스","닌텐도","스팀"],prompt:"gaming setup with RGB lighting, multiple monitors, mechanical keyboard, competitive esports atmosphere"},
    {keywords:["드론","항공사진","촬영"],prompt:"aerial drone photography, bird's eye view of Korean landscape, golden hour, dramatic perspective"},
    {keywords:["태블릿","iPad","갤탭","아이패드"],prompt:"tablet device on clean desk with stylus, digital creation, minimal aesthetic, creative workspace"},
    {keywords:["VR","AR","메타버스","가상현실"],prompt:"virtual reality headset, immersive digital world visualization, futuristic tech concept, glowing"},
    {keywords:["보안","해킹","사이버","정보보안"],prompt:"cybersecurity concept, digital lock, data protection visualization, blue code matrix, secure"},
    // 육아/임신/교육
    {keywords:["임신","출산","태교","임산부","만삭"],prompt:"soft nursery room preparation, baby items, gentle morning light, pastel colors, tender atmosphere"},
    {keywords:["육아","아기","신생아","돌잔치"],prompt:"adorable baby toys on soft pastel blanket, tiny shoes, teddy bear, warm nursery, gentle light"},
    {keywords:["유아","어린이","아이","어린이교육","유치원"],prompt:"colorful children learning environment, educational toys, ABC blocks, watercolor paintings, bright playful space"},
    {keywords:["초등","중등","고등","학교","공부","수능","입시"],prompt:"student study desk with books, stationery, planner, focused learning, warm desk lamp"},
    {keywords:["영어","영어공부","어학","토익","토플","회화"],prompt:"language learning setup, English textbooks, headphones, notebook with vocabulary, coffee, productive study"},
    {keywords:["학원","과외","교육","강사","선생님","교사"],prompt:"modern tutoring session, whiteboard with concepts, bright classroom, engaging education atmosphere"},
    // 라이프스타일/인테리어
    {keywords:["인테리어","인테리어디자인","집꾸미기","홈데코"],prompt:"beautifully designed Korean apartment interior, minimalist Scandinavian style, plants, warm natural tones"},
    {keywords:["청소","정리","수납","정돈","미니멀","정리수납"],prompt:"perfectly organized closet with coordinated items, minimalist Korean home, clean aesthetic"},
    {keywords:["이사","새집","아파트","원룸","집구하기"],prompt:"bright modern Korean apartment living room, floor-to-ceiling windows, city view, contemporary furniture"},
    {keywords:["강아지","댕댕이","멍멍이","dog","puppy"],prompt:"fluffy golden retriever puppy in Korean home garden, playful expression, soft natural light, adorable"},
    {keywords:["고양이","냥이","cat","kitty","고냥이"],prompt:"elegant cat lounging on window sill, soft afternoon sunbeam, bokeh background, peaceful domestic"},
    {keywords:["반려동물","펫","애완","동물병원"],prompt:"loving pet care scene, cozy home with happy pet, warm domestic life, lifestyle photography"},
    {keywords:["독서","책","서재","도서관","북카페","독서법"],prompt:"cozy reading nook with books, warm lamp light, coffee cup, wooden shelves, peaceful literary atmosphere"},
    {keywords:["취미","DIY","만들기","핸드메이드","공예"],prompt:"creative craft workspace, artistic materials, handmade projects, organized tools, creative energy"},
    {keywords:["가드닝","정원","식물","화분","홈가드닝"],prompt:"lush indoor plant collection, botanical home aesthetic, morning light through leaves, terra cotta pots"},
    {keywords:["요리","쿠킹","홈쿠킹","레시피","만드는법"],prompt:"home cooking preparation, fresh ingredients on wooden cutting board, kitchen lifestyle, warm cooking"},
    // 패션/뷰티/쇼핑
    {keywords:["퍼스널컬러","봄웜","여름쿨","가을웜","겨울쿨","웜톤","쿨톤","계절진단","색조진단","퍼컬"],prompt:"color analysis swatches, seasonal color palette spread on white surface, fabric swatches in warm cool tones, beauty color wheel editorial flat lay, soft diffused natural light, no text"},
    {keywords:["패션","옷","코디","스타일링","OOTD","옷잘입는"],prompt:"Korean fashion street style flat lay, seasonal outfit coordination, accessories, clean white background"},
    {keywords:["명품","가방","지갑","액세서리","주얼리","럭셔리"],prompt:"luxury handbag editorial, leather texture, branded accessories, marble surface, premium lifestyle"},
    {keywords:["화장","메이크업","립스틱","파운데이션","뷰티"],prompt:"K-beauty makeup flat lay, cosmetic products arranged artfully, rose gold accents, mirror, beauty editorial"},
    {keywords:["향수","perfume","프래그런스","향"],prompt:"luxury perfume bottle on marble surface, light refraction, soft bokeh, elegant fragrance photography"},
    {keywords:["네일","네일아트","네일샵"],prompt:"artistic nail art close-up, intricate designs, gel polish, hands on marble, beauty editorial"},
    {keywords:["헤어","헤어스타일","미용실","염색","펌","헤어케어"],prompt:"Korean hair salon interior, glossy healthy hair, professional care, bright modern salon"},
    {keywords:["다이어트","바디","몸매","체형"],prompt:"healthy fit lifestyle concept, athletic body care, nutritious food, wellness motivation, inspiring"},
    // 자동차
    {keywords:["자동차","신차","차","자동차구매","차량"],prompt:"sleek modern sedan on mountain road, dramatic landscape, automotive photography, golden hour"},
    {keywords:["전기차","EV","테슬라","아이오닉","전기자동차"],prompt:"electric vehicle charging station, clean energy concept, modern EV design, sustainable future"},
    {keywords:["SUV","4WD","오프로드","크로스오버"],prompt:"powerful SUV on mountain trail, rugged terrain, adventure lifestyle, dramatic sky"},
    {keywords:["중고차","중고자동차","차량거래","중고"],prompt:"used car lot at dusk, selective focus on hood, polished exterior, automotive detail"},
    {keywords:["오토바이","바이크","모터사이클"],prompt:"motorcycle on scenic coastal road, freedom concept, dramatic landscape, lifestyle editorial"},
    // 스포츠/레저
    {keywords:["골프","골프장","골프채","필드","골프연습"],prompt:"golf course at sunrise, morning mist over fairway, lush green grass, dramatic landscape, premium sport"},
    {keywords:["등산","트레킹","산행","백패킹","산악"],prompt:"hiker on Korean mountain summit, vast panoramic view, autumn foliage, achievement, dramatic sky"},
    {keywords:["수영","수영장","수영복","수영강습"],prompt:"outdoor swimming pool with turquoise water, summer sun reflection, tropical resort atmosphere"},
    {keywords:["테니스","배드민턴","스쿼시"],prompt:"tennis court at golden hour, sport photography, athletic energy, dramatic sunlight"},
    {keywords:["자전거","사이클","MTB","자전거여행"],prompt:"cyclist on scenic riverside path at sunrise, motion and speed, Korean landscape, freedom"},
    {keywords:["서핑","수상스포츠","웨이크보드"],prompt:"surfer riding large wave at golden hour, dramatic ocean spray, athletic adventure"},
    {keywords:["축구","농구","야구","배구","스포츠"],prompt:"sports field at golden hour, athletic energy, dramatic stadium lighting, competitive spirit"},
    {keywords:["헬스","PT","퍼스널트레이닝","근육"],prompt:"modern gym barbell training, strong physique concept, motivating gym atmosphere, fitness lifestyle"},
    // 직업/커리어
    {keywords:["취업","구직","이력서","자소서","면접"],prompt:"professional Korean job interview setting, confident candidate, modern office, career opportunity"},
    {keywords:["직장","회사","사무실","직장인","오피스"],prompt:"modern Korean office interior, collaborative workspace, professionals working, clean contemporary"},
    {keywords:["이직","커리어","커리어개발","경력관리"],prompt:"career growth concept, ascending staircase, professional development, business success, ambition"},
    {keywords:["간호사","의사","의료진"],prompt:"professional healthcare setting, doctor in white coat, modern hospital, trust and care"},
    {keywords:["공무원","공직","공시"],prompt:"government office building, professional Korean administrative aesthetic, stability and trust"},
    {keywords:["디자이너","그래픽","UX","UI","디자인"],prompt:"creative designer workspace, color palette, sketches, tablet, Macbook, design studio aesthetic"},
    {keywords:["마케터","마케팅","광고","브랜딩"],prompt:"marketing creative workspace, campaign materials, laptop with analytics, colorful brand elements"},
    // 계절/자연
    {keywords:["봄","벚꽃","봄꽃","개나리","튤립"],prompt:"Korean spring cherry blossom path, soft pink petals falling, warm sunlight through branches, dreamy"},
    {keywords:["여름","바다","해수욕장","여름휴가"],prompt:"Korean summer beach, crystal clear water, white sand, golden hour sunlight, vacation mood"},
    {keywords:["가을","단풍","추석","가을여행","단풍여행"],prompt:"Korean autumn forest, vibrant red and orange foliage, misty mountain morning, fallen leaves path"},
    {keywords:["겨울","눈","스키장","크리스마스","연말","설경"],prompt:"winter wonderland snowscape, frost on pine trees, soft blue twilight, peaceful Korean winter"},
    // 자기계발/심리
    {keywords:["자기계발","성장","동기부여","목표","습관"],prompt:"morning routine motivation, sunrise through window, journal and coffee, goal setting, fresh productive start"},
    {keywords:["명상","마음챙김","힐링","치유","회복"],prompt:"peaceful meditation space, serene pose, soft morning light, minimalist zen atmosphere, calm"},
    {keywords:["심리","상담","멘탈헬스","우울","불안"],prompt:"warm therapy room, comfortable couch, soft lighting, safe healing space, professional care"},
    // 문화/엔터
    {keywords:["영화","OTT","넷플릭스","드라마","영화추천"],prompt:"cozy home cinema setup, dark room with large screen glow, popcorn, blanket, movie night"},
    {keywords:["음악","콘서트","공연","아이돌","K-pop"],prompt:"concert stage with dramatic lighting, spotlights, smoke effects, electric atmosphere, performance energy"},
    {keywords:["독립영화","단편영화","영화제"],prompt:"film festival aesthetic, vintage cinema, reel strips, artistic movie poster concept, dramatic"},
    // 환경/사회
    {keywords:["환경","친환경","제로웨이스트","지속가능","ESG"],prompt:"eco-friendly lifestyle flat lay, reusable items, green plants, sustainable products, earth-tone"},
    {keywords:["반려식물","식물키우기","다육이","관엽식물"],prompt:"lush indoor plant collection, botanical shelf arrangement, morning sunlight through leaves, cozy green aesthetic"},
  ];

  function withImageConcept(prompt:string,concept:ImageConcept):string{
    return concept==="comic"
      ? `${prompt}, Korean webtoon-style editorial illustration, clean expressive line art, polished digital coloring, clear visual storytelling, consistent characters, not photorealistic, no text, no letters, no speech bubbles, no watermark`
      : `${prompt}, authentic photorealistic editorial photography, realistic materials and anatomy, natural imperfections, no illustration, no cartoon, no text, no watermark`;
  }

  function buildImgPrompt(kw: string, title: string = "", idx: number = 0, segmentContent?: string): string {
    // 구간 내용이 있으면 그걸로 키워드 보강
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
        if (idx === 1) p = p.replace(/warm natural lighting|morning light|warm lighting/g, "golden hour afternoon light");
        if (idx === 2) p = p.replace(/warm natural lighting|morning light|warm lighting/g, "dramatic blue hour lighting");
        if (idx === 3) p = p.replace(/warm natural lighting|morning light|warm lighting/g, "soft overcast diffused light");
        return `${p}, ${NP_TAG}, ${st}`;
      }
    }
    const CATS: [RegExp, string][] = [
      [/먹|맛|식당|음식|요리|카페|커피|레스토랑|맛집|디저트|베이커리|밥|국|찌개|반찬|술|맥주|와인|칵테일|소주|막걸리/, `stunning Korean food photography, beautifully plated gourmet dish, vibrant fresh ingredients, professional food styling, warm restaurant ambiance, ${NP_TAG}`],
      [/여행|관광|투어|trip|호텔|숙소|제주|부산|경주|해외|유럽|일본|미국|동남아|캠핑|글램핑|아웃도어|백패킹|트레킹/, `breathtaking travel destination, majestic scenic landscape, dramatic sky, iconic local architecture, golden hour atmosphere, ${NP_TAG}`],
      [/주식|펀드|선물|옵션|채권|ETF|코인|암호화폐|트레이딩|차트|증권|배당|퀀트/, `professional financial trading concept, stock market charts on screen, data visualization, clean workspace, ${NP_TAG}`],
      [/보험|연금|퇴직|적금|예금|저축|재테크|투자|경제|수익|부자|부업|프리랜서|애드센스|블로그수익|수익화/, `sophisticated financial planning concept, premium calculator and documents, aspirational wealth aesthetic, modern office, ${NP_TAG}`],
      [/건강|운동|fitness|헬스|요가|필라테스|러닝|마라톤|수영|자전거|등산|스트레칭|근육|체중|다이어트|diet/, `motivating healthy lifestyle, wellness equipment on clean background, energizing fresh ingredients, bright minimal aesthetic, ${NP_TAG}`],
      [/의료|병원|의사|약|의약품|치료|수술|간호|한의원|한약|임상|제약|바이오|헬스케어/, `clean medical healthcare concept, professional stethoscope and equipment, sterile clinical aesthetic, pharmaceutical products, ${NP_TAG}`],
      [/피부|뷰티|스킨케어|화장|메이크업|헤어|네일|미용|세럼|크림|에센스|선크림|향수|화장품/, `luxurious beauty skincare flat lay, premium cosmetic products on marble, dewy glowing texture, feminine elegance, ${NP_TAG}`],
      [/패션|옷|스타일|코디|ootd|아우터|자켓|청바지|원피스|니트|가방|신발|명품|쇼핑|브랜드|하울/, `stylish fashion editorial flat lay, trendy clothing and accessories artfully arranged, urban aesthetic, ${NP_TAG}`],
      [/집|방|인테리어|아파트|가구|리모델링|청소|정리|수납|원룸|빌라|오피스텔|셀프인테리어|홈데코|홈스타일링/, `stunning modern Korean home interior, thoughtfully curated furniture, warm cozy atmosphere, architectural detail, ${NP_TAG}`],
      [/건축|건설|토목|설계|시공|부동산|땅|분양|임대|전세|월세|재건축|재개발|도시개발/, `professional architecture and real estate concept, modern building blueprint or model, urban development, ${NP_TAG}`],
      [/농업|농장|농촌|농산물|채소|과일|쌀|밀|콩|감자|고구마|텃밭|스마트팜|유기농|친환경/, `beautiful farm and agriculture photography, fresh organic produce arranged artfully, countryside pastoral aesthetic, ${NP_TAG}`],
      [/수산업|어업|어촌|수산물|생선|해산물|굴|새우|랍스터|참치|연어|수족관|양식/, `fresh seafood and fisheries concept, glistening ocean products on ice, coastal market aesthetic, ${NP_TAG}`],
      [/육류|육가공|정육|소고기|돼지고기|닭고기|양고기|햄|소시지|베이컨|정육점/, `premium meat and butchery concept, quality cuts on wooden board, professional food styling, rustic aesthetic, ${NP_TAG}`],
      [/유통|물류|배송|창고|공급망|SCM|택배|운송|화물|트럭|항만|수출|수입|무역/, `modern logistics and supply chain concept, warehouse shelves, delivery and shipping aesthetic, efficient operations, ${NP_TAG}`],
      [/제조|공장|생산|가공|조립|금속|철강|기계|설비|장비|산업|공업|자동화/, `industrial manufacturing concept, precision machinery and equipment, clean factory aesthetic, engineering precision, ${NP_TAG}`],
      [/화학|석유|에너지|전력|태양광|풍력|수소|배터리|반도체|소재|원자력|신재생/, `energy and materials science concept, clean technology visualization, solar panels or molecular structure aesthetic, ${NP_TAG}`],
      [/과학|연구|실험|물리|화학|생물|quantum|퀀텀|파동|나노|우주|천문/, `professional scientific research concept, laboratory equipment or quantum visualization, precise academic aesthetic, ${NP_TAG}`],
      [/법률|법무|변호사|판사|소송|계약|규정|법원|세무|회계|감사|컴플라이언스/, `professional legal and compliance concept, clean document arrangement, scales of justice aesthetic, authoritative, ${NP_TAG}`],
      [/교육|학원|공부|강의|수업|강사|학습|입시|자격증|직업훈련|온라인교육|e러닝/, `inspiring education concept, organized study materials and books, clean learning environment, knowledge aesthetic, ${NP_TAG}`],
      [/마케팅|광고|홍보|브랜딩|sns|소셜미디어|콘텐츠|유튜브|인스타그램|블로그|미디어|방송/, `creative marketing and media concept, brand elements on clean workspace, digital content creation aesthetic, ${NP_TAG}`],
      [/스타트업|창업|사업|경영|비즈니스|기업|CEO|리더십|팀워크|혁신|벤처/, `dynamic startup and business concept, innovative workspace, entrepreneurial vision, modern corporate aesthetic, ${NP_TAG}`],
      [/자동차|차량|드라이브|전기차|수입차|SUV|세단|오토바이|바이크|튜닝|연비/, `dramatic automotive photography, sleek vehicle design detail, dynamic angles, premium metallic surfaces, ${NP_TAG}`],
      [/스포츠|축구|야구|농구|골프|테니스|스키|스노보드|서핑|클라이밍|배드민턴|볼링/, `energetic sports equipment flat lay, athletic gear artfully arranged, performance aesthetic, dynamic composition, ${NP_TAG}`],
      [/기술|tech|AI|인공지능|컴퓨터|스마트폰|앱|IT|아이폰|갤럭시|아이패드|노트북|게임|드론|로봇/, `cutting-edge technology concept, sleek modern device on minimal surface, digital innovation, futuristic clean design, ${NP_TAG}`],
      [/봄|여름|가을|겨울|자연|꽃|풍경|숲|바다|산|나무|식물|원예|정원|화초/, `breathtaking Korean seasonal nature, pristine landscape, vivid natural colors, peaceful serene atmosphere, ${NP_TAG}`],
      [/환경|친환경|제로웨이스트|탄소중립|지속가능|ESG|재활용|업사이클|생태계/, `eco-friendly sustainability concept, green products and plants, earth-tone natural aesthetic, ${NP_TAG}`],
      [/음악|악기|노래|가수|밴드|피아노|기타|드럼|클래식|재즈|힙합|K팝/, `artistic music concept, beautiful instrument or vinyl records flat lay, creative studio aesthetic, ${NP_TAG}`],
      [/미술|그림|디자인|사진|영화|드라마|공연|전시|갤러리|예술|창작/, `creative arts concept, artist tools and canvas elegantly arranged, gallery aesthetic, inspirational creative, ${NP_TAG}`],
      [/종교|불교|기독교|성당|사찰|명상|영성|철학|심리|마음|힐링|치유/, `peaceful meditation and spiritual concept, serene nature or candles, calm mindful aesthetic, ${NP_TAG}`],
      [/아이|육아|아기|어린이|임신|출산|신생아|유아|초등|교육|학습|공부|입시/, `warm family educational concept, child-friendly environment, soft pastel tones, learning materials, ${NP_TAG}`],
      [/강아지|고양이|반려동물|pet|puppy|kitten|햄스터|앵무새|어항|수족관/, `adorable pet care flat lay, pet accessories and products, soft heartwarming background, ${NP_TAG}`],
      [/결혼|웨딩|신혼|허니문|프로포즈|스드메|부케|예식장|청첩장|혼수/, `romantic wedding concept, elegant floral arrangement, soft dreamy lighting, bridal aesthetic, ${NP_TAG}`],
    ];
    for (const [re, prompt] of CATS) {
      if (re.test(k)) return `${prompt}, ${st}`;
    }
    return `beautiful Korean lifestyle blog editorial photography, professional composition, warm aesthetic, ${NP_TAG}, ${st}`;
  }

  /* ── Flow 전용 디테일 프롬프트 ── */
  function buildFlowPrompt(kw: string, title: string = "", content: string = "", idx: number = 0): string {
    const k = (kw + " " + title).toLowerCase();
    const c = content.slice(0, 500).toLowerCase();

    // 카테고리 감지 (확장)
    const isFoodCafe = /먹|맛|식|음식|요리|카페|커피|레스토랑|맛집|디저트|베이커리|밥|국|찌개|반찬|술|맥주|와인|칵테일/.test(k+c);
    const isTravel = /여행|관광|투어|trip|tour|호텔|숙소|제주|부산|서울|경주|해외|해외여행|유럽|일본|미국|동남아|캠핑|글램핑|아웃도어/.test(k+c);
    const isHealth = /건강|운동|fitness|diet|헬스|요가|필라테스|수영|러닝|마라톤|자전거|등산|스트레칭|근육|체중/.test(k+c);
    // 조명 변주
    const lightings = [
      "soft golden hour natural lighting, warm sunlight filtering through",
      "bright airy daylight, clean studio-style lighting, crisp shadows",
      "dramatic cinematic side lighting, deep contrast, moody atmosphere",
      "soft diffused overcast light, even tones, pastel color palette",
    ];
    const lighting = lightings[idx % lightings.length];
    // ★ 구도(shot) 변주 — 같은 주제라도 이미지마다 다른 앵글/거리로 (탁자 굴비만 반복되는 문제 방지)
    const shots = [
      "extreme close-up macro shot, shallow depth of field, focus on texture and detail",
      "wide establishing shot showing the full scene and surroundings, environmental context",
      "45-degree angle overhead flat-lay composition, top-down perspective",
      "eye-level medium shot with soft bokeh background, natural framing",
      "dramatic low-angle shot, dynamic perspective, cinematic depth",
      "side-profile shot with negative space, minimalist editorial framing",
      "over-the-shoulder lifestyle shot, candid moment, human context (no visible faces)",
      "detail vignette shot highlighting a single key element, artistic focus",
    ];
    const shot = shots[idx % shots.length];
    const storyBeats = [
      "an immersive establishing moment that introduces the place and overall atmosphere",
      "a tactile close detail of the subject's most distinctive material, ingredient, or feature",
      "the preparation or work process in progress, with tools and ingredients in context",
      "a lively environmental moment showing how the subject belongs in the real location",
      "a candid human hand interaction that communicates scale and experience, no visible face",
      "the polished finished result presented as the visual conclusion of the story",
      "a behind-the-scenes detail from an unexpected side angle",
      "a colorful final atmosphere shot connecting the subject with its surroundings",
    ];
    const storyBeat = storyBeats[idx % storyBeats.length];
    // 품질 + 텍스트 오염 방지(글자/워터마크/로고 없이 순수 이미지만) — 모든 주제 공통
    const quality = `${storyBeat}, ${shot}, rich varied colors, visually beautiful editorial storytelling, ultra-high resolution 8K, hyperrealistic, award-winning photography, razor-sharp focus, absolutely no text, no letters, no words, no captions, no watermark, no logo, no typography`;

    const FLOW_CATS: [RegExp, string][] = [
      [/먹|맛|식당|음식|요리|카페|커피|레스토랑|맛집|디저트|베이커리|밥|술|맥주|와인|소주|막걸리/, `A stunning food photography scene featuring "${title}", beautifully plated gourmet Korean cuisine, vibrant fresh ingredients, professional food styling, bokeh restaurant interior, appetizing shallow depth of field`],
      [/여행|관광|투어|trip|호텔|숙소|제주|부산|해외|유럽|일본|동남아|캠핑|아웃도어|트레킹/, `A breathtaking travel photography of "${title}", majestic scenic landscape with dramatic sky, iconic local culture and architecture, wanderlust inspiring wide angle cinematic view`],
      [/주식|펀드|선물|옵션|채권|ETF|코인|암호화폐|트레이딩|차트|증권|배당|퀀트/, `A sophisticated stock market and investment concept for "${title}", dynamic financial data visualization, trading screens with charts, modern professional workspace, aspirational wealth`],
      [/보험|연금|저축|적금|재테크|투자|경제|수익|부자|부업|프리랜서|애드센스|블로그수익/, `A sophisticated financial success concept for "${title}", modern professional workspace with charts, premium business aesthetic, aspirational and trustworthy mood`],
      [/건강|운동|fitness|헬스|요가|필라테스|러닝|수영|자전거|다이어트|diet/, `A motivating healthy lifestyle photography representing "${title}", wellness activity, fresh organic ingredients, clean minimal bright atmosphere, inspiring positive mood`],
      [/의료|병원|의약품|치료|제약|바이오|헬스케어|한의원/, `A clean medical healthcare concept for "${title}", professional equipment, sterile clinical precision, trustworthy medical aesthetic`],
      [/피부|뷰티|스킨케어|화장|메이크업|헤어|네일|화장품|세럼|크림/, `A luxurious beauty editorial for "${title}", premium cosmetic products on marble surface, dewy glowing skin texture, feminine elegance, aspirational beauty`],
      [/패션|옷|스타일|코디|ootd|아우터|가방|명품|쇼핑|브랜드/, `A stylish fashion editorial representing "${title}", trendy outfit with accessories, urban street style, Vogue-worthy confident composition`],
      [/인테리어|아파트|가구|리모델링|셀프인테리어|수납정리|홈데코|원룸|집꾸미기|방꾸미기|홈스타일링|가구배치/, `A stunning interior design photography of "${title}", beautifully decorated Korean modern home, warm inviting atmosphere, cozy aspirational living space`],
      [/건축|건설|부동산|분양|임대|전세|재건축|도시개발/, `A professional architecture and real estate concept for "${title}", modern building with clean lines, urban development premium aesthetic`],
      [/농업|농장|농촌|농산물|채소|과일|쌀|유기농|스마트팜/, `A beautiful farm and agriculture photography for "${title}", fresh organic produce artfully arranged, countryside pastoral golden hour aesthetic`],
      [/수산업|어업|수산물|생선|해산물|굴|새우|참치|연어|양식/, `A fresh seafood photography for "${title}", glistening ocean products on ice, vibrant coastal market aesthetic`],
      [/육류|육가공|정육|소고기|돼지고기|닭고기|햄|소시지/, `A premium meat and butchery concept for "${title}", quality cuts on rustic wooden board, professional food styling`],
      [/유통|물류|배송|창고|SCM|택배|운송|화물|무역|수출|수입/, `A modern logistics and supply chain concept for "${title}", organized warehouse, efficient delivery and operations aesthetic`],
      [/제조|공장|생산|가공|철강|기계|설비|산업|자동화/, `An industrial manufacturing concept for "${title}", precision machinery, clean factory aesthetic, engineering excellence`],
      [/화학|에너지|태양광|풍력|수소|배터리|반도체|신재생/, `A clean energy and technology concept for "${title}", innovative visualization, sustainable futuristic aesthetic`],
      [/과학|연구|실험|물리|생물|quantum|퀀텀|파동|나노|우주|천문/, `A professional scientific research concept for "${title}", laboratory precision, quantum visualization, academic excellence aesthetic`],
      [/법률|법무|변호사|소송|계약|세무|회계|컴플라이언스/, `A professional legal and compliance concept for "${title}", clean document arrangement, authoritative and trustworthy aesthetic`],
      [/교육|학원|강의|학습|입시|자격증|온라인교육|공부|시험|토익|토플|영어|수능|자격|어학|독서|스터디/, `An inspiring education concept for "${title}", organized study materials and books, clean learning environment, knowledge aesthetic`],
      [/마케팅|광고|홍보|브랜딩|소셜미디어|콘텐츠|유튜브|미디어|방송/, `A creative marketing and media concept for "${title}", brand elements on workspace, digital content creation aesthetic`],
      [/스타트업|창업|사업|경영|비즈니스|기업|리더십|벤처|혁신/, `A dynamic startup and business concept for "${title}", innovative workspace, entrepreneurial vision, modern corporate aesthetic`],
      [/자동차|차량|드라이브|전기차|수입차|SUV|오토바이/, `A dramatic automotive photography featuring "${title}", sleek vehicle design, dynamic angles, premium metallic surfaces, car magazine quality`],
      [/스포츠|축구|야구|농구|골프|테니스|스키|서핑|클라이밍/, `An energetic sports photography representing "${title}", peak athletic performance, dynamic action, ESPN magazine quality`],
      [/기술|tech|AI|인공지능|컴퓨터|스마트폰|앱|IT|아이폰|아이패드|노트북|게임|드론/, `A cutting-edge technology concept for "${title}", sleek devices and interfaces, digital innovation, futuristic clean design`],
      [/봄|여름|가을|겨울|자연|꽃|풍경|숲|바다|산|식물|원예/, `A breathtaking nature photography capturing "${title}", pristine Korean landscape, vivid seasonal colors, immersive serene composition`],
      [/환경|친환경|제로웨이스트|탄소중립|ESG|재활용/, `An eco-friendly sustainability concept for "${title}", green products and plants, earth-tone natural aesthetic`],
      [/음악|악기|노래|피아노|기타|드럼|K팝|클래식/, `An artistic music concept for "${title}", beautiful instrument or vinyl records, creative studio aesthetic`],
      [/미술|그림|디자인|영화|드라마|공연|전시|예술|창작/, `A creative arts concept for "${title}", artist tools elegantly arranged, gallery inspirational aesthetic`],
      [/명상|영성|철학|심리|힐링|치유|종교/, `A peaceful meditation concept for "${title}", serene candles and nature elements, calm mindful aesthetic`],
      [/육아|아기|어린이|임신|출산|유아|신생아|이유식|기저귀|어린이집|아이키우기/, `A heartwarming family concept for "${title}", soft pastel tones, child-friendly environment, tender joyful atmosphere`],
      [/강아지|고양이|반려동물|pet|puppy|햄스터/, `A charming pet photography for "${title}", expressive animal companion, playful moments, soft bokeh, heartwarming mood`],
      [/결혼|웨딩|신혼|프로포즈|부케|예식|혼수/, `A romantic wedding photography for "${title}", beautifully decorated venue, elegant bridal details, dreamy timeless style`],
    ];
    // ★제목/키워드에 반려동물이 명시되면 본문의 우연한 단어(예: "카페 활용", "분양")보다 최우선.
    //   "강아지 무료분양"이 카페→음식, 분양→부동산으로 오인돼 비빔밥 사진이 생성된 실측 버그 방지.
    if (/강아지|고양이|반려동물|pet|puppy|kitten|햄스터/.test(k)) {
      return `A charming pet photography for "${title}", adorable real dog or cat as the unmistakable main subject, responsible pet adoption and animal shelter context, playful heartwarming moment, soft bokeh, ${lighting}, ${quality}`;
    }
    // "인테리어/꾸미기"가 명시되면 음식(카페)보다 인테리어 우선 (홈카페 인테리어 등 오매칭 방지)
    if (/인테리어|꾸미기|홈스타일링|공간연출/.test(k+c)) {
      return `A stunning interior design photography of "${title}", beautifully decorated Korean modern space, warm inviting atmosphere, cozy aspirational aesthetic, ${lighting}, ${quality}`;
    }
    for (const [re, prompt] of FLOW_CATS) {
      if (re.test(k+c)) return `${prompt}, ${lighting}, ${quality}`;
    }
    return `A high-quality professional blog photography representing "${title}" about ${kw}, visually compelling, Korean lifestyle aesthetic, ${lighting}, ${quality}, editorial magazine style`;
  }

  const BRAND_KEEP_RE = /\b(iPhone|iPad|MacBook|iMac|AirPods|Apple|Android|Galaxy|Samsung|LG|SK|KT|Naver|Kakao|YouTube|Netflix|Instagram|TikTok|Facebook|ChatGPT|Gemini|OpenAI|Google|DALL-E|Replicate|Flux|Grok|Groq|AI|SEO|URL|API|PDF|PC|TV|USB|WiFi|Wi-Fi|MBTI|OOTD|DIY|OTT|IT|CT|MRI|VPN|GPS|NFT|ETF|CPR|RGB|LED|LCD|OLED|SNS|DNA|BMW|Benz|Tesla|Dyson|Nike|Adidas|Zara|IKEA|Costco|GS25|Starbucks|MCM|HP|Dell|Asus|Sony|Panasonic|Canon|Nikon|Fuji|DJI|GPT|Claude|MSI|AMD|Intel|NVIDIA)\b/g;

  function stripMarkdown(text:string):string{
    const brands: string[] = [];
    // ⚠️ 플레이스홀더 구분자는 언더스코어(_) 금지 — 아래 마크다운 정리의 _{2,} 제거가 __BR0__를 먹어
    //    "BR0"만 남기고 복원(맨아래)이 실패한다(BR11 등이 본문에 노출된 버그). 마크다운이 안 건드리는 §로 감쌈.
    const preserved = text.replace(BRAND_KEEP_RE, (m) => {
      brands.push(m); return `§BR${brands.length - 1}§`;
    });
    const cleaned = preserved
      // AI 메타 주석 제거 (Self-correction, Character count 등)
      .replace(/<!--[\s\S]*?-->/g,"")
      .replace(/\(Self-correction:[\s\S]*?\)/gi,"")
      .replace(/\(self correction:[\s\S]*?\)/gi,"")
      .replace(/\(.*?character count.*?\)/gi,"")
      .replace(/\(.*?I\'ve used.*?\)/gi,"")
      .replace(/^#{1,6}\s+/gm,"")
      .replace(/\*{2,3}(.*?)\*{2,3}/g,"$1")
      .replace(/\*(.*?)\*/g,"$1")
      .replace(/_{2,}(.*?)_{2,}/g,"$1")
      .replace(/_(.*?)_/g,"$1")
      .replace(/^[-*+]\s+/gm,"")
      .replace(/^>\s*/gm,"")
      .replace(/`{3}[\s\S]*?`{3}/g,"")
      .replace(/`([^`]+)`/g,"$1")
      .replace(/\[([^\]]+)\]\([^)]+\)/g,"$1")
      .replace(/^---+$/gm,"")
      .replace(/^\s*\|.*\|.*$/gm,"")
      .replace(/[\u4E00-\u9FFF\u3400-\u4DBF]/g,"")
      .replace(/[\u3040-\u30FF]/g,"")
      // 플레이스홀더가 아닌 순수 영어 단어 제거 (4자 이상)
      .replace(/(^|[\s,.])(?!§BR\d+§)[A-Za-z]{4,}(?=[\s,.]|$)/g,"$1")
      // 줄 전체가 영어인 경우 제거 (플레이스홀더 없는 줄만)
      .replace(/^(?!.*§BR\d+§)[A-Za-z\s\d.,!?\'""-]{10,}$/gm,"")
      // ── AI 티 나는 상투어 → 자연스러운 구어체로 자동 치환 (SEO 'AI 패턴 차단' 점수 확보) ──
      .replace(/소개해\s*드리겠습니다/g,"소개할게요").replace(/소개하겠습니다/g,"소개할게요")
      .replace(/알아보겠습니다/g,"알아볼게요").replace(/살펴보겠습니다/g,"살펴볼게요")
      .replace(/정리해\s*보겠습니다/g,"정리해볼게요").replace(/정리하겠습니다/g,"정리해볼게요")
      .replace(/해\s*보겠습니다/g,"해볼게요").replace(/해보도록\s*하겠습니다/g,"해볼게요")
      .replace(/말씀드리겠습니다/g,"말할게요").replace(/설명드리겠습니다/g,"설명할게요")
      .replace(/결론적으로/g,"그래서").replace(/무엇보다도/g,"무엇보다").replace(/뿐만\s*아니라/g,"게다가")
      .replace(/중요합니다/g,"중요해요").replace(/필수적으로/g,"꼭").replace(/필수적인/g,"꼭 필요한")
      .replace(/효과적인/g,"괜찮은").replace(/효과적으로/g,"제대로").replace(/다양한/g,"여러")
      .replace(/것을\s*추천드립니다/g,"걸 추천해요").replace(/추천드립니다/g,"추천해요")
      .replace(/하는 것이 좋습니다/g,"하면 좋아요").replace(/하시기 바랍니다/g,"하세요")
      .replace(/ {2,}/g," ")
      .replace(/\n{3,}/g,"\n\n")
      .trim();
    return cleaned.replace(/§BR(\d+)§/g, (_:string,i:string) => brands[parseInt(i)] ?? "");
  }

  // ★키워드 형태 통일(제목·본문 공통): 입력 키워드를 '입력한 형태 그대로' 일정하게 맞춘다.
  //   "원주맛집"이면 본문의 "원주 맛집"→"원주맛집", "강남 맛집"이면 "강남맛집"→"강남 맛집".
  //   블로그 상위노출·플레이스 노출은 키워드가 띄어쓰기까지 똑같이 반복돼야 유리하다.
  function enforceExactKeyword(text:string, kw:string):string {
    const exact=(kw||"").trim();
    const bare=exact.replace(/\s/g,"");
    if(!exact||bare.length<2) return text;
    const esc=(c:string)=>c.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
    const pattern=bare.split("").map(esc).join("\\s*"); // 공백 제거한 글자들 사이 공백 유연 매칭
    try{ return text.replace(new RegExp(pattern,"g"), exact); }catch{ return text; }
  }
  // ★키워드 횟수 보장: 제목·본문에 키워드가 최소 min회 나오게 완성(상위노출 목적).
  //   1)형태통일 2)부족하면 AI 재요청1회 3)그래도 부족하면 자연스러운 문장으로 보충 → 무조건 채움.
  const kwCountOf=(s:string, kw:string):number=>{
    const bare=(kw||"").replace(/\s/g,""); if(bare.length<2) return 0;
    const esc=(c:string)=>c.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
    try{ return (s.match(new RegExp(bare.split("").map(esc).join("\\s*"),"g"))||[]).length; }catch{ return 0; }
  };
  async function ensureKeywordCount(text:string, kw:string, min=5):Promise<string>{
    const exact=(kw||"").trim(); if(!exact||exact.replace(/\s/g,"").length<2) return text;
    let out=enforceExactKeyword(text,exact);
    if(kwCountOf(out,exact)>=min) return out;
    // 2) AI 재요청 1회 — 글은 유지하고 키워드만 자연스럽게 min회 이상
    try{
      const ask=`아래 블로그 글을 내용·길이·문단 구성 거의 그대로 유지하되, 핵심 키워드 "${exact}"가 글 전체에서 정확히 ${min}~${min+1}번 나오도록 자연스럽게 문장 몇 곳만 다듬어줘. 키워드는 반드시 "${exact}" 형태 그대로(띄어쓰기까지 동일). 마크다운·설명 없이 완성된 본문만 출력.\n\n[글]\n${out}`;
      const re=enforceExactKeyword(stripMarkdown(await callAI(ask)).trim(), exact);
      if(re.length>=Math.min(200,out.length*0.7) && kwCountOf(re,exact)>kwCountOf(out,exact)) out=re;
      if(kwCountOf(out,exact)>=min) return out;
    }catch{}
    // 3) 최후 보충 — 마무리에 키워드 포함 문장(다양하게)으로 부족분 채움
    const fillers=[`${exact} 찾으시는 분들께 도움이 됐길 바라요.`,`${exact} 관련해 궁금한 점은 댓글로 남겨주세요.`,`${exact} 준비하실 때 이 글이 참고가 되면 좋겠어요.`,`${exact} 더 알아보고 싶다면 저장해두고 다시 보셔도 좋아요.`];
    let i=0;
    while(kwCountOf(out,exact)<min && i<6){ out=out.trimEnd()+`\n\n${fillers[i%fillers.length]}`; i++; }
    return out;
  }
  function ensureQuestionHeadings(text:string, topic:string):string {
    const markerIndex=text.search(/\n?\[FAQ시작\]/);
    const main=markerIndex>=0?text.slice(0,markerIndex).trim():text.trim();
    const tail=markerIndex>=0?text.slice(markerIndex).trim():"";
    const questionLines=main.split("\n").filter(line=>/[?？]\s*$/.test(line.trim()));
    if(questionLines.length>=3)return text;
    const paragraphs=main.split(/\n{2,}/).map(part=>part.trim()).filter(Boolean);
    if(paragraphs.length<3)return text;
    const safeTopic=(topic.trim()||"이 주제").slice(0,18);
    const candidates=[`${safeTopic}, 왜 주목받을까요?`,`어떻게 고르면 후회가 적을까요?`,`직접 경험하면 무엇이 다를까요?`];
    const missing=candidates.slice(0,3-questionLines.length);
    const positions=[1,Math.max(2,Math.floor(paragraphs.length/2)),Math.max(2,paragraphs.length-1)];
    missing.forEach((heading,index)=>{
      const position=Math.min(paragraphs.length,positions[index]+index);
      paragraphs.splice(position,0,heading);
    });
    return `${paragraphs.join("\n\n")}${tail?`\n\n${tail}`:""}`;
  }

  function getCatGuide(kw:string,title:string):string{
    const k=(kw+" "+title).toLowerCase();
    if(/맛집|음식|카페|식당|요리|커피/.test(k))return"[맛집/음식] 직접 방문한 것처럼: 분위기, 맛, 가격. 단점도 솔직하게.";
    if(/여행|관광|호텔|숙소|제주|부산/.test(k))return"[여행] 교통편, 비용, 소요시간, 명소, 현지 맛집, 예산.";
    if(/건강|다이어트|운동|피부/.test(k))return"[건강] 전문 용어 쉽게, 집 vs 병원 구분.";
    if(/재테크|투자|주식|금융/.test(k))return"[재테크] 초보자용 설명, 실제 숫자 예시.";
    if(/it|앱|ai|테크|스마트폰/.test(k))return"[IT/테크] 쉬운 설명, 실제 사용 시나리오, 장단점.";
    return"[정보/일상] 독자가 몰랐던 새 정보, 실용 팁.";
  }

  // CORS 차단되는 외부 AI(OpenAI/Groq 등)는 봇 프록시 경유. 봇 오프라인이면 직접 시도(폴백).
  async function aiProxyFetch(url:string, init:RequestInit, signal?:AbortSignal):Promise<Response>{
    if(botOnline){
      return botFetch(`${BOT}/api/ai-proxy`,{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({url,method:init.method||"POST",headers:init.headers,body:init.body}),
        signal:signal||(init as any).signal,
      });
    }
    return fetch(url, init);
  }

  async function callAI(prompt:string,signal?:AbortSignal,jsonMode?:boolean):Promise<string>{
    const ai=localStorage.getItem("publy_write_ai")||"gemini";
    if(ai==="gemini"){
      const key=localStorage.getItem("publy_gemini_key")||"";
      if(!key)throw new Error("Gemini API 키 없음 — 설정 탭에서 입력해주세요");
      let lastErr="";
      for(const model of GEMINI_MODELS){
        try{
          // ★2.5계열은 thinking에 토큰 다 써서 빈 답 → thinkingBudget:0. 실패 원인(429한도 등)을 lastErr에 담아 표면화.
          const gc:any={maxOutputTokens:8000};
          if(model.startsWith("gemini-2.5"))gc.thinkingConfig={thinkingBudget:0};
          if(jsonMode)gc.responseMimeType="application/json";   // JSON만 반환 강제(설명·마크다운 섞임 방지)
          const r=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({contents:[{parts:[{text:prompt}]}],generationConfig:gc}),signal:signal||AbortSignal.timeout(90000)});
          if(!r.ok){ const j=await r.json().catch(()=>null); lastErr=`${r.status} ${j?.error?.message||""}`.slice(0,120); continue; }
          const d=await r.json();const t=d.candidates?.[0]?.content?.parts?.[0]?.text||"";if(t)return t;
          lastErr="빈 응답";
        }catch(e:any){if(e.name==="AbortError")throw e;lastErr=e.message||"네트워크 오류";continue;}
      }
      throw new Error(lastErr.includes("429")||lastErr.toLowerCase().includes("quota")||lastErr.toLowerCase().includes("exhaust")
        ? "Gemini 하루 무료 한도를 다 썼어요. 잠시 후(또는 자정 리셋 후) 다시 시도해주세요."
        : `AI 호출 실패 (${lastErr||"알 수 없음"})`);
    }
    if(ai==="groq"){
      const key=localStorage.getItem("publy_groq_key")||"";if(!key)throw new Error("Groq API 키 없음");
      const r=await aiProxyFetch("https://api.groq.com/openai/v1/chat/completions",{method:"POST",headers:{"Content-Type":"application/json","Authorization":`Bearer ${key}`},body:JSON.stringify({model:"llama-3.3-70b-versatile",max_tokens:8000,messages:[{role:"user",content:prompt}]})},signal||AbortSignal.timeout(90000));
      if(!r.ok){const e=await r.json();throw new Error(e.error?.message||"Groq 오류");}
      const d=await r.json();return d.choices?.[0]?.message?.content||"";
    }
    if(ai==="openai"){
      const key=localStorage.getItem("publy_openai_key")||"";if(!key)throw new Error("OpenAI API 키 없음");
      const r=await aiProxyFetch("https://api.openai.com/v1/chat/completions",{method:"POST",headers:{"Content-Type":"application/json","Authorization":`Bearer ${key}`},body:JSON.stringify({model:"gpt-4o",max_tokens:8000,messages:[{role:"user",content:prompt}]})},signal||AbortSignal.timeout(90000));
      if(!r.ok){const e=await r.json();throw new Error(e.error?.message||"OpenAI 오류");}
      const d=await r.json();return d.choices?.[0]?.message?.content||"";
    }
    throw new Error("AI 미선택");
  }

  async function urlToBase64(url:string, signal:AbortSignal):Promise<string>{
    try{
      const r=await fetch(url,{signal});
      if(!r.ok)return url;
      const blob=await r.blob();
      return new Promise((resolve)=>{
        const reader=new FileReader();
        reader.onloadend=()=>resolve(reader.result as string);
        reader.onerror=()=>resolve(url);
        reader.readAsDataURL(blob);
      });
    }catch{return url;}
  }

  async function generateOneImage(kw:string,signal:AbortSignal,idx:number=0,segmentContent?:string,concept:ImageConcept=imageConcept,titleOverride?:string):Promise<string>{
    const prompt=withImageConcept(buildImgPrompt(kw, titleOverride||genTitle||selectedTitle||"", idx, segmentContent),concept);
    const ai=localStorage.getItem("publy_image_ai")||"openai_img";
    if(ai==="openai_img"){
      const key=localStorage.getItem("publy_openai_key")||"";if(!key)throw new Error("OpenAI 키 없음");
      const r=await aiProxyFetch("https://api.openai.com/v1/images/generations",{method:"POST",headers:{"Content-Type":"application/json","Authorization":`Bearer ${key}`},body:JSON.stringify({model:"dall-e-3",prompt,n:1,size:"1024x1024"})},signal);
      if(!r.ok){const e=await r.json();throw new Error("DALL-E: "+(e.error?.message||r.status));}
      const d=await r.json();
      const imgUrl=d.data?.[0]?.url||"";
      // DALL-E URL은 1시간 후 만료 → 즉시 base64로 변환
      if(imgUrl)return urlToBase64(imgUrl,signal);
      return imgUrl;
    }
    if(ai==="replicate"){
      const key=localStorage.getItem("publy_replicate_key")||"";if(!key)throw new Error("Replicate 키 없음");
      // 브라우저 직접 호출은 CORS로 막힘 → 봇 서버 프록시 경유 (생성+폴링+base64 변환까지 서버가 처리)
      const r=await botFetch(`${BOT}/api/replicate-image`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({key,prompt,aspectRatio:"16:9"}),signal});
      if(!r.ok){const e=await r.json().catch(()=>({}));throw new Error(e.error||("Replicate "+r.status));}
      const d=await r.json();
      return d.image||d.sourceUrl||"";
    }
    throw new Error("이미지 AI 미선택");
  }

  function parseArr(text:string):string[]{
    const clean=text.replace(/```json|```/gi,"").trim();
    try{const m=clean.match(/\[[\s\S]*\]/);if(m){const p=JSON.parse(m[0]);if(Array.isArray(p))return p.map(String).filter(t=>t.length>3);}}catch{}
    try{const p=JSON.parse(clean);if(Array.isArray(p))return p.map(String).filter(t=>t.length>3);}catch{}
    return clean.split("\n").map(l=>l.replace(/^[\d]+[).\s]+|^[-*•\s]+/,"").replace(/^[\s"']+|[\s"']+$/g,"").trim()).filter(l=>l.length>4&&l.length<100);
  }

  // ★제목 점수 = 실제 네이버 상위노출 기준(프롬프트와 일치). 낚시가 아니라 '검색에 잘 잡히는 깨끗한 제목'에 점수.
  function calcTitleScore(title:string, keywordOverride?:string):number{
    let score=0;
    const t=(title||"").trim();
    const len=t.length;
    // 1) 핵심 키워드가 제목 앞쪽(검색 매칭의 1순위)
    const kw=(keywordOverride||keyword||"").trim();
    if(kw){ const idx=t.replace(/\s/g,"").indexOf(kw.replace(/\s/g,"")); if(idx>=0&&idx<=8)score+=32; else if(idx>=0)score+=16; }
    else score+=16;
    // 2) 적정 길이(25~40자 롱테일)
    if(len>=25&&len<=40)score+=24; else if(len>=20&&len<=46)score+=12;
    // 3) 실제 검색 의도어(낚시 아님 — 사람들이 실제로 붙여 검색)
    if(/추천|방법|후기|비교|가격|고르는\s?법|순위|정리|총정리|가이드|위치|예약|메뉴|코스|장단점|주의|가성비|근처/.test(t))score+=20;
    // 4) 구체 정보(수치+단위 / 지역·장소) — 롱테일 노출에 유리
    if(/\d+\s?(원|만원|분|시간|일|개월|년|kg|명|곳|가지|위)/.test(t))score+=14;
    if(/[가-힣]{2,}(시|구|동|읍|면|역|점|맛집|해수욕장)/.test(t))score+=10;
    // 5) 낚시·과장(저품질 필터에 걸림) — 감점
    if(/대박|충격|미쳤|소름|경악|1등|최고|완벽|이것만|나만\s?알던|절대|무조건|역대급|레전드/.test(t))score-=25;
    // 6) 물음표·느낌표 남발 감점(1개까진 허용)
    const marks=(t.match(/[?!]/g)||[]).length; if(marks>=2)score-=15;
    return Math.max(0,Math.min(100,score));
  }

  async function handleGenerateTitles(reset=false){
    if(!keyword.trim()){alert("키워드를 입력해주세요");return;}
    // 키워드 풀에 누적 (중복제거, 90개 제한)
    if(!keywords.includes(keyword.trim())){
      const newKws=[...keywords,keyword.trim()].slice(-MAX_KW);
      setKeywords(newKws);
      localStorage.setItem("publy_kws",JSON.stringify(newKws));
    }
    if(reset)setTitles([]);
    setLoadingTitles(true);abortRef.current=new AbortController();
    const prompt=adType==="adpost"
      ?`당신은 대한민국 최고의 네이버 블로그 SEO·AI 브리핑 제목 전문가입니다.\n키워드: "${keyword.trim()}"\n\n검색 의도에 정확히 답하는 제목 30개를 JSON 배열로만 반환하세요.\n\n[반드시 지킬 것]\n- 키워드 "${keyword.trim()}"를 제목 앞부분에 정확히 1번만 자연스럽게 포함\n- 20~35자, 사람들이 실제로 묻는 추천/가격/후기/방법/비교/주의 형태\n- 본문에서 실제로 답할 수 있는 약속만 담고 확인되지 않은 가격·연도·순위·숫자는 만들지 않기\n- 지역·상황·대상·선택 기준 중 관련 있는 구체 조건을 담아 롱테일 검색 의도를 분명히 하기\n- 추천/비교/후기/방법/가격/주의 등 서로 다른 각도로 구성하고 유사 변형 반복 금지\n\n[절대 금지 — 네이버 저품질/스팸 필터에 걸림]\n⛔ 과장·낚시성 감탄사: "진짜?", "대박!", "충격", "이것만", "1등 비결", "미쳤다"\n⛔ 클릭베이트 상투구: "나만 알던", "솔직히", "해봤더니", "알고보니"\n⛔ 관련 없는 핫이슈·유행어 억지 결합, 숫자+감탄사 낚시, 물음표·느낌표 남발\n\n${AEO_TITLE_RULE}\n\nJSON 배열만 반환.`
      :`당신은 구글 애드센스 SEO 전문가입니다.\n키워드: "${keyword.trim()}"\n\n검색 노출이 잘 되는 정보성 제목 30개를 JSON 배열로만 반환하세요.\n- 키워드 "${keyword.trim()}"를 앞부분에 자연스럽게 포함\n- 25~40자, 차분한 정보성 톤\n- 실제 검색 형태("완벽 가이드","총정리","비교","이유","방법")\n- 과장·낚시성 감탄사(대박/진짜/충격) 금지, 물음표·느낌표 남발 금지\n\nJSON 배열만 반환.`;
    try{
      const text=await callAI(prompt,abortRef.current.signal);
      // 생성된 제목의 키워드 형태를 입력 형태 그대로 통일(제목·본문 일관)
      const parsed=Array.from(new Set(parseArr(text).map((t:string)=>enforceExactKeyword(t,keyword.trim())).filter(Boolean)))
        .sort((a:string,b:string)=>calcTitleScore(b,keyword.trim())-calcTitleScore(a,keyword.trim()));
      if(!parsed.length)throw new Error("제목 생성 실패. 다시 시도해주세요.");
      setTitles(prev=>{
        const combined=[...parsed,...prev];
        if(combined.length>=MAX_TITLES){localStorage.setItem("publy_titles",JSON.stringify(parsed));return parsed;}
        localStorage.setItem("publy_titles",JSON.stringify(combined));return combined;
      });
    }catch(e:any){if(e.name!=="AbortError")alert("제목 생성 실패: "+e.message);}
    finally{setLoadingTitles(false);}
  }

  async function recommendKeywordsForTitleTab(){
    setAiKeywordLoading(true);
    const controller=new AbortController();
    try{
      const suggested=await otGenKeywords(30,controller.signal);
      if(!suggested.length)throw new Error("추천할 새 키워드를 찾지 못했어요");
      const merged=Array.from(new Set([...suggested,...keywords])).slice(0,MAX_KW);
      setKeywords(merged);localStorage.setItem("publy_kws",JSON.stringify(merged));
      setKeyword(suggested[0]);setTitles([]);setSelectedTitle("");
      showToast(`AI가 핫이슈·검색의도·최근 중복을 검사해 키워드 ${suggested.length}개를 추천했어요`,"success");
    }catch(e:any){if(e.name!=="AbortError")showToast("키워드 추천 실패: "+(e.message||"오류"),"error");}
    finally{setAiKeywordLoading(false);}
  }

  // ① 조회 — 링크로 상품 정보 불러와 미리보기(onPartnerPreview)만 채운다. 목록엔 아직 안 담김.
  async function loadOnPartnerProduct(){
    const link=onPartnerLink.trim();
    if(!link){setOnPartnerError("온파트너 상품 링크를 입력해주세요.");return;}
    if(onPartnerItems.length>=MAX_ONPARTNER){setOnPartnerError(`상품은 최대 ${MAX_ONPARTNER}개까지 넣을 수 있어요.`);return;}
    setOnPartnerLoading(true);setOnPartnerError("");setOnPartnerPreview(null);
    try{
      const response=await fetch(`https://partner.yuanfnb.com/api/product-card?url=${encodeURIComponent(link)}`,{signal:AbortSignal.timeout(10000)});
      const data=await response.json().catch(()=>({}));
      if(!response.ok||!data.ok||!data.product)throw new Error(data.error==="link_not_found"?"사용할 수 없는 링크예요.":"상품 정보를 불러오지 못했어요.");
      const prod=data.product as OnPartnerProduct;
      if(onPartnerItems.some(it=>it.product.partnerUrl===prod.partnerUrl)){setOnPartnerError("이미 추가된 상품이에요.");return;}
      // 서버가 만든 예쁜 가로 배너(온파트너 /api/banner) — 디자인 통일 + CORS 위험 없음.
      const codeM=prod.partnerUrl.match(/\/r\/([a-z0-9-]+)/i);
      const banner=codeM?`https://partner.yuanfnb.com/api/banner?code=${codeM[1]}`:"";
      setOnPartnerPreview({product:prod,banner});
      showToast("✅ 상품을 조회했어요. '추가'를 누르면 담겨요.","success");
    }catch(e:any){
      setOnPartnerError(e.name==="TimeoutError"?"상품 확인 시간이 초과됐어요. 다시 시도해주세요.":e.message||"상품 정보를 불러오지 못했어요.");
    }finally{setOnPartnerLoading(false);}
  }
  // ② 추가 — 조회한 상품을 목록에 담고 입력/미리보기 초기화.
  function addOnPartnerProduct(){
    if(!onPartnerPreview)return;
    if(onPartnerItems.length>=MAX_ONPARTNER){setOnPartnerError(`상품은 최대 ${MAX_ONPARTNER}개까지 넣을 수 있어요.`);return;}
    if(onPartnerItems.some(it=>it.product.partnerUrl===onPartnerPreview.product.partnerUrl)){setOnPartnerError("이미 추가된 상품이에요.");return;}
    setOnPartnerItems(prev=>[...prev,onPartnerPreview]);
    setOnPartnerPreview(null);setOnPartnerLink("");setOnPartnerError("");
    showToast("✅ 상품을 추가했어요.","success");
  }

  // 내 링크 추가: 일반 사이트 URL을 목록에 담는다. 발행 시 네이버가 OG 썸네일 카드로 렌더.
  function addMyLink(){
    let url=myLinkInput.trim();
    if(!url){setMyLinkError("링크를 입력해주세요.");return;}
    if(!/^https?:\/\//i.test(url)) url="https://"+url;   // http 빠졌으면 붙여줌
    try{ new URL(url); }catch{ setMyLinkError("올바른 링크 주소가 아니에요."); return; }
    if(myLinks.length>=MAX_MYLINK){setMyLinkError(`링크는 최대 ${MAX_MYLINK}개까지 넣을 수 있어요.`);return;}
    if(myLinks.includes(url)){setMyLinkError("이미 추가된 링크예요.");return;}
    setMyLinks(prev=>[...prev,url]); setMyLinkInput(""); setMyLinkError("");
    showToast("✅ 내 링크를 추가했어요.","success");
  }

  // 배너는 온파트너 서버(/api/banner)가 생성 — 클라 canvas 불필요.

  // 본문 최상단에 제휴 안내만 넣는다. 배너(링크 연결된 이미지)는 발행 시 블록에 직접 분산 삽입.
  function placeOnPartnerProduct(generatedBody:string, products:OnPartnerProduct[]):string{
    const items=products.filter(p=>p&&p.available);
    if(items.length===0)return generatedBody.trim();
    const disclosure="※ 이 글에는 제휴 링크가 포함되어 있으며, 구매 시 작성자에게 일정 수수료가 발생할 수 있습니다.";
    return [disclosure,generatedBody.trim()].join("\n\n");
  }

  // ★글자수 하드 캡: AI가 지정 글자수를 무시하고 오버슈트(1500 지정→3000)하는 문제. 목표 125% 초과 시 FAQ는 보존하고 본문 문단을 잘라 목표 근처로 맞춤.
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
  async function handleGenerate(){
    if(!selectedTitle&&!keyword){alert("키워드와 제목을 먼저 선택해주세요");return;}
    const title=selectedTitle||keyword;
    setGenerating(true);abortRef.current=new AbortController();setQualityScore(null);

    // 글자수 자동 랜덤화
    const chars=calcTargetChars();
    if(charMode==="auto")setTargetChars(chars);

    // AI 패턴 뱅크 - 매번 랜덤 선택
    const INTRO_BANK=[
      `오늘은 ${keyword} 직접 경험한 거 솔직하게 써볼게요.`,
      `솔직히 처음엔 별 기대 안 했어요. 근데 ${keyword} 해보고 나서 생각이 완전히 바뀌었어요.`,
      `${keyword} 궁금한 분들 많죠? 저도 한참 찾아봤거든요.`,
      `주변에서 ${keyword} 어디 좋냐고 물어봐서 이참에 정리해봤어요.`,
      `사실 이거 쓸까 말까 고민했는데... ${keyword} 후기 한번 솔직하게 써볼게요.`,
      `${keyword} 직접 겪은 거라 자신있게 말할 수 있어요.`,
      `블로그에 ${keyword} 글 많은데 제 경험이랑 달라서 새로 써봐요.`,
      `${keyword} 처음 접하시는 분들을 위해 제 경험 기반으로 정리했어요.`,
      `저도 처음엔 막막했는데 ${keyword} 이렇게 하면 됩니다.`,
      `${keyword} 고민하다가 직접 해봤는데 결과를 공유해드릴게요.`,
    ];
    const SUBHEAD_BANK=[
      `왜 {주제}가 이렇게 인기 있는 걸까요?`,
      `직접 해보니까 이런 점이 달랐어요`,
      `기대했던 것 vs 실제로 느낀 것`,
      `꼭 알아야 할 핵심 포인트`,
      `이런 분들께 특히 추천해요`,
    ];
    const OUTRO_BANK=[
      `다음에 또 기회가 되면 다시 경험해보고 싶어요.`,
      `이 글이 도움이 됐으면 좋겠습니다.`,
      `궁금한 거 있으면 댓글로 물어봐요!`,
      `저처럼 고민하시는 분들한테 도움이 됐으면 해요.`,
      `더 좋은 정보 있으면 공유해주세요 :)`,
      `오늘도 긴 글 읽어주셔서 감사해요.`,
      `여러분도 꼭 한번 경험해보시길 추천드려요.`,
      `다음에 또 좋은 정보로 돌아올게요.`,
    ];
    const intro=INTRO_BANK[Math.floor(Math.random()*INTRO_BANK.length)];
    const subStyle=SUBHEAD_BANK[Math.floor(Math.random()*SUBHEAD_BANK.length)];
    const outro=OUTRO_BANK[Math.floor(Math.random()*OUTRO_BANK.length)];

    const catGuide=getCatGuide(keyword,title);
    const adGuide=adType==="adpost"?"[수익] 애드포스트: 체류시간 늘리는 감성 스토리.":"[수익] 애드센스: 클릭 유도, 키워드 밀도 높게.";
    const platGuide=platform==="naver"
      ?"[플랫폼] 네이버: ## 기호 절대 금지. 순수 텍스트로 작성. (글의 방향은 아래 스타일 지침을 최우선으로 따를 것)"
      :"[플랫폼] 티스토리: 내부링크 2개 자연스럽게 포함. (글의 방향은 아래 스타일 지침을 최우선으로 따를 것)";
    const styleGuide=WRITE_STYLE_GUIDE[writeStyle]||"";
    const endTone=WRITE_STYLE_ENDTONE[writeStyle]||"문장 끝: ~해요, ~거든요, ~더라고요, ~잖아요 다양하게.";
    const personaGuide=PERSONA_STYLES.find(p=>p.id===persona)?.prompt||"";
    const templateGuide=BLOG_TEMPLATES.find(t=>t.id===blogTemplate)?.guide||"";
    // ★온종일팜/온파트너/온종일체험단 자동 소개(테리 요청 2026-08-21): 아직 유명하지 않은 서비스라
    //   제목/키워드에 이름이 나오면 AI가 모르고 대충 쓰거나 엉뚱하게 쓴다. → 우리가 가진 소개 데이터
    //   (PUBLY_SERVICE_INFO)를 프롬프트에 넣어, 그 서비스가 뭔지 핵심을 "멋있게 풀어서" 쓰게 한다.
    const serviceHay=`${title} ${keyword}`;
    const serviceMatches=(Object.keys(PUBLY_SERVICE_INFO) as ServiceInfoKey[])
      .filter(k=>{const s=PUBLY_SERVICE_INFO[k];return serviceHay.includes(s.name)||(s.aliases||[]).some(a=>serviceHay.includes(a));});
    const serviceGuide=serviceMatches.length>0
      ? "\n\n=== 🏷️ 우리 서비스 소개 (제목/키워드에 등장 — 아직 널리 알려지지 않았으니, 아래 정보를 바탕으로 그 서비스가 무엇인지 자연스럽고 매력적으로 풀어서 설명할 것. 지어내지 말고 이 내용만 사용) ===\n"
        + serviceMatches.map(k=>{const s=PUBLY_SERVICE_INFO[k];
            return `● ${s.name}: ${s.hook}\n  - 한줄요약: ${s.summary}\n  - 핵심 장점: ${s.benefits.map(b=>`${b[0]}(${b[1]})`).join(" / ")}\n  - 이용 흐름: ${s.flow}`;
          }).join("\n")
        + `\n\n★★ 서비스 글 작성 필수 규칙(짧게 쓰지 말 것 — 이게 이 글의 주제다):
- 이 서비스가 제목/주제이므로, 위 정보를 뼈대로 삼아 **글 전체를 충분히 길게** 써서 목표 글자수(${chars}자)를 반드시 채운다. 자료가 적다고 짧게 끝내지 말 것.
- 각 "핵심 장점"을 하나씩 소제목 구간으로 만들어, 각 장점마다 **구체적인 상황·예시·이렇게 쓰면 뭐가 좋은지**를 3~4문장 이상으로 풀어 쓴다.
- "이용 흐름"은 1단계→2단계→3단계처럼 각 단계가 실제로 어떤 모습인지 초보자도 알게 자세히 설명한다.
- "어떤 사람에게 좋은지", "직접 써보니(써본다면) 어떤 점이 편한지", "시작하는 법" 같은 실용 문단도 추가해 살을 붙인다.
- 광고처럼 딱딱하지 말고, 실제 경험담·추천 말투로 자연스럽게. 과장·거짓 정보는 금지(위 내용 범위에서만).
- ⛔ 본문에 URL·웹사이트 주소(http… 같은 링크)를 직접 쓰지 말 것. 링크는 퍼블리가 따로 카드로 넣으니, 글에는 "홈페이지에서", "사이트에서" 처럼 말로만 안내한다.`
      : "";
    // ★퍼블리 기능 자연 녹이기(테리 2026-08-26): 누가 무엇을 쓰든 모든 글에 퍼블리 '기능'을 간접적으로,
    //   자연스럽게 1곳만 슬쩍. 대놓고 서비스 소개가 아니라 "이런 걸 자동으로 해주는 도구도 있다"는 도움말 톤.
    const publyGuide=`\n\n=== 🌿 블로그 자동화 팁 한 스푼 (모든 글 공통 · 짧게라도 꼭) ===
주제가 무엇이든, 글 중반이나 마무리쯤에서 "블로그·글쓰기를 편하게 하는 요즘 방법"으로 이야기를 살짝 이어, 아래 기능 중 이 글 주제와 가장 잘 어울리는 1가지를 골라 1~2문장으로 자연스럽게 녹여라.
- 키워드만 넣으면 AI가 블로그 글을 SEO에 맞게 자동으로 써주고
- 어울리는 사진·이미지도 자동 생성
- 네이버·티스토리에 원하는 시간으로 예약 자동 발행(컴퓨터를 꺼도 올라감)
- 서로이웃·공감·댓글 같은 이웃 관리까지 자동
- 내 블로그 지수(검색 노출·저품질) 진단
규칙: ①딱 1곳, 1~2문장만(장황 금지) ②대놓고 광고·서비스 소개 말고 "요즘은 이런 걸 자동으로 해주는 도구도 있더라고요" 식 정보/경험 말투로 부드럽게 ③'퍼블리'라는 이름은 안 써도 되고, 써도 딱 한 번 가볍게만 ④과장·거짓·링크 금지 ⑤위에 다른 서비스 소개 문단이 이미 있으면 중복되지 않게 다른 자리에서 짧게.`;
    // ★캘린더에서 넘어온 우리 서비스 홍보: 글 마지막에 자연스러운 소개 문단 + 실제 링크를 본문에 삽입
    const promoGuide=pendingPromo
      ? `\n\n=== 🔗 마무리 소개(필수) ===\n이 글의 주제와 관련해, 글 맨 마지막 문단에서 "${pendingPromo.name}"(${pendingPromo.blurb})를 딱 1~2문장으로 자연스럽게 소개하고, 바로 그 다음 줄에 아래 링크를 그대로 한 줄로 넣어라(광고 티 나지 않게, 도움 주는 말투로):\n${pendingPromo.url}\n※ 링크는 이 마무리 1곳에만. 위 다른 규칙의 "링크 쓰지 말 것"은 이 서비스 링크에는 예외.`
      : "";
    const prompt=`당신은 대한민국 최고의 블로그 작가입니다.

키워드: "${keyword}"  제목: "${title}"
목표 글자수: ${chars}자 내외 (±100자, 반드시 이 범위 안에서 작성)

${catGuide}

=== 절대 규칙 ===
⛔ ## 기호 완전 금지 (소제목은 그냥 텍스트로)
⛔ ** * - + 마크다운 기호 전부 금지
⛔ 한자,중국어,일본어 금지
⛔ 영어 단어 절대 금지 — 브랜드명·제품명 제외 100% 순수 한국어로만 작성
⛔ AI 티 나는 상투어 절대 금지: "~해보겠습니다/알아보겠습니다/살펴보겠습니다/소개해드리겠습니다/정리해보겠습니다", "결론적으로", "중요합니다", "다양한", "효과적인", "필수적으로", "무엇보다도", "뿐만 아니라", "~하는 것이 좋습니다", "추천드립니다" → 전부 실제 사람 말투(~해볼게요, 여러, 꼭, 그래서, 추천해요)로
✅ 구체적 수치, 가격, 기간 포함
✅ ${endTone}
✅ ★핵심 키워드 "${keyword||title}"를 본문에 **띄어쓰기·글자 그대로 똑같이 정확히 5~6번** 반복 (예: "원주맛집"이면 "원주 맛집"으로 띄우지 말고 "원주맛집" 그대로. 검색 노출의 핵심)
✅ 반드시 ${chars-100}~${chars+100}자 사이로 작성

=== 🔍 검색 최적화(SEO) 규칙 — 반드시 지킬 것 ===
✅ 본문을 4~6개 구간으로 나누고, 각 구간 맨 앞에 "소제목"을 한 줄 단독으로 넣기 (## 없이 순수 텍스트)
✅ 소제목 일부에 검색어 요소(왜/어떻게/추천/고르는법/가격/후기/비교/주의점)를 자연스럽게 담기 — 단, 물음표는 소제목당 최대 1개, 전체에서 남발 금지
✅ 소제목은 짧게(10~30자), 실제 검색어 형태로 (낚시성 감탄사 금지)
✅ 핵심 키워드 "${keyword||title}"를 **띄어쓰기까지 똑같은 형태 그대로 정확히 5~6회** 반복 (형태 변형·띄어쓰기 금지 — 체험단/플레이스 리뷰 상위노출의 핵심)

${AEO_RULES}

=== ⭐ 저품질 방지 — 네이버가 좋아하는 '진짜 정보 글' (가장 중요) ===
✅ 독자가 실제로 궁금해할 구체 정보를 담기: 가격/비용, 위치·지역, 소요 시간, 준비물, 장단점, 실패담·주의점, 단계별 방법 — 추상적인 미사여구 말고 '알맹이'
✅ 경험담처럼 구체적으로: 실제 상황·수치·예시를 들어 신뢰감 있게 (허위·과장 금지, 없는 사실 지어내지 말 것)
✅ 남들이 다 쓰는 뻔한 내용 말고, 이 주제에서 실제로 도움되는 디테일 한두 개는 꼭 넣기
⛔ 과장·낚시("대박","충격","1등","미쳤다") 절대 금지 — 담백하고 정직하게
⛔ 같은 말 반복·분량 채우기용 물타기 금지 — 짧아도 알맹이 있게

=== 📱 단락 분리 규칙 — 모바일 가독성 최우선(반드시 지킬 것) ===
✅ 모든 단락과 단락 사이는 반드시 "빈 줄 하나"(엔터 두 번)로 분리 — 문단이 절대 딱 붙지 않게
✅ 한 단락은 2~4문장까지만. 길어지면 끊어서 새 단락(빈 줄)으로 나누기
✅ 소제목은 그 자체로 한 줄 단독 + 앞뒤로 빈 줄 (위 단락과, 아래 내용과 딱 붙이지 말 것)
✅ "첫째/둘째/셋째", "1. 2. 3.", "① ② ③" 처럼 순서·항목을 나열할 때는 각 항목을 반드시 별도 단락(빈 줄)으로 분리 — 한 덩어리로 붙여 쓰지 말 것
✅ 이유: 블로그는 얼마나 읽기 쉽고 편하냐가 전부다. 모바일에서 빽빽하면 안 읽힌다.
★ 아래 [글의 방향] 지침이 이 글의 성격을 결정한다 — 구조·어조·시작·초점을 그대로 따를 것 (다른 규칙과 충돌하면 [글의 방향] 우선)

=== 글 패턴 가이드 (매번 다르게) ===
인트로: "${intro}"
소제목 스타일: "${subStyle}"
마무리: "${outro}"

${adGuide}
${platGuide}
${styleGuide}${personaGuide?"\n\n[말투/페르소나]\n"+personaGuide:""}${templateGuide?"\n\n"+templateGuide:""}${serviceGuide}${publyGuide}${promoGuide}

=== 출력 형식 ===
태그: 태그1, 태그2, 태그3, 태그4, 태그5

(본문 ${chars}자 내외 - 순수 텍스트. ★맨 첫 문단은 위 AEO 규칙대로 '핵심 요약' 2~3문장으로 시작)

${AEO_FAQ_FORMAT}

[관련글시작]
POST1: (제목)|(이유)
POST2: (제목)|(이유)
POST3: (제목)|(이유)
[관련글끝]`;
    try{
      const text=await callAI(prompt,abortRef.current.signal);
      const cleaned=stripMarkdown(text);
      const tgm=cleaned.match(/태그[:\s]*([^\n]+)/);
      const bm=cleaned.match(/태그[^\n]*\n([\s\S]+)/);
      setGenTitle(title);if(tgm)setGenTags(tgm[1].trim());
      const generatedBody=ensureQuestionHeadings(bm?bm[1].trim():cleaned,keyword||title);
      const body0=onPartnerItems.length>0?placeOnPartnerProduct(generatedBody,onPartnerItems.map(it=>it.product)):generatedBody.trim();
      // ★키워드 완성: 입력 형태 그대로 최소 5회 보장(형태통일→부족시 AI재요청→최후 문장보충). 상위노출의 핵심.
      const bodyRaw=await ensureKeywordCount(body0,keyword||title,5);
      const capped=charMode==="manual"?enforceMaxChars(bodyRaw,targetChars):bodyRaw;   // 직접 지정 글자수면 오버슈트 방지
      const body=await repairGeneratedQuality(capped,keyword||title,title,abortRef.current.signal,80);
      setGenContent(body);setQualityScore(calcQualityScore(body,keyword));
      setPendingPromo(null);   // 홍보 삽입 1회용 → 사용 후 해제(다음 글에 안 남게)
      // 비동기 글 생성 도중 직접입력으로 바뀌었으면 추천값으로 절대 덮지 않는다.
      if(imgCountAutoRef.current){
        const recommended=recommendImgCount(body);
        imgCountRef.current=recommended;
        setImgCount(recommended);
      }
      // ── tarry 방식: 블록 자동 분리 + 제목/태그 자동 연동 ──
      // ★모바일 가독성(테리 강조 2026-08-21): "단락이 끝나거나 첫째/둘째/셋째로 나뉠 때 꼭 분리".
      //   AI가 여러 문장을 한 줄에 몰아 쓰거나 열거를 붙여 쓰면 발행 시 빽빽해져 모바일에서 안 읽힘.
      //   → 블록으로 쪼갤 때 (a)열거항목(첫째/1./①/- 등)은 앞에서 끊고 (b)긴 문단은 2문장씩 끊는다.
      //   FAQ/관련글 마커 블록은 구조가 있으니 그대로 둔다(건드리지 않음).
      const isStructured=(t:string)=>/\[FAQ시작\]|\[FAQ끝\]|\[관련글시작\]|\[관련글끝\]|\[참고자료시작\]|\[참고자료끝\]/.test(t);
      const splitSentences2=(t:string):string[]=>{ // 긴 줄을 2문장씩(약 130자 초과 시)
        if(t.length<=130)return[t];
        const sents=t.match(/[^.!?。！？]+[.!?。！？]+["'”’)\]]*\s*|[^.!?。！？]+$/g)||[t];
        const groups:string[]=[]; for(let i=0;i<sents.length;i+=2)groups.push(sents.slice(i,i+2).join("").trim());
        return groups.filter(Boolean);
      };
      const enumRe=/^(\s*(?:첫째|둘째|셋째|넷째|다섯째|여섯째|[0-9]+[.)]|[①②③④⑤⑥⑦⑧⑨⑩]|[-•·]))\s/;
      const normalizeToBlocks=(raw:string):string[]=>{
        const out:string[]=[];
        raw.split(/\n\n+/).forEach(chunk=>{
          const c=chunk.trim(); if(!c)return;
          if(isStructured(c)){ out.push(c); return; }            // 구조 블록은 그대로
          c.split(/\n/).forEach(lineRaw=>{                        // 줄바꿈도 문단 경계로
            const line=lineRaw.trim(); if(!line)return;
            if(enumRe.test(line)){ out.push(line); return; }      // 열거 항목은 독립 문단
            splitSentences2(line).forEach(p=>{const s=p.trim(); if(s)out.push(s);});
          });
        });
        return out;
      };
      const rawBlocks = normalizeToBlocks(body).map(p=>({type:"text" as const,id:uid(),content:p}));
      setBlocks(rawBlocks.length>0?rawBlocks:[{type:"text",id:uid(),content:body}]);
      setPubTitle(title);
      if(tgm)setHashtags(tgm[1].trim().split(",").map((t:string)=>{const clean=t.trim().replace(/\s+/g,"");return clean.startsWith("#")?clean:"#"+clean;}).filter((t:string)=>t.replace(/^#+/,"").length>=2).slice(0,Math.floor(Math.random()*4)+5));
      setAutoInserted(false);setThumbnail("");
      // 임시저장
      try {
        localStorage.setItem("publy_draft", JSON.stringify({
          title, content:body, savedAt:new Date().toLocaleString("ko-KR")
        }));
      } catch {}
    }catch(e:any){if(e.name!=="AbortError"){showToast("❌ 글 생성 실패: "+e.message+" (오류가 관리자에게 자동 전달됩니다)","error");logError({user_id:user.id,user_name:(user as any).name||"",user_email:user.email||"",feature:"글 생성",error_message:e.message}).catch(()=>{});}}
    finally{setGenerating(false);}
  }

  // ══════════ ⚡ 원터치 발행 엔진 (BEST) ══════════
  // 키워드 목록을 순서대로: 제목(최고점)→본문(키워드 5~6회)→이미지→카테고리 자동매칭→발행, 텀 간격 반복.
  // 기존 부품 재사용: callAI · generateOneImage · /api/publish-full(검증된 발행). 발행 상태(state) 안 건드림.
  async function otGenTitleBest(kw:string,signal:AbortSignal):Promise<string>{
    const prompt=`당신은 대한민국 최고의 네이버 블로그 SEO 제목 전문가입니다.\n키워드: "${kw}"\n\n검색 의도에 정확히 답하는 제목 20개를 JSON 배열로만 반환하세요.\n- 키워드 "${kw}"는 제목 앞부분에 정확히 1번만 자연스럽게 포함\n- 20~35자, 실제 검색어 형태(추천/후기/방법/가격/비교/고르는법/주의)\n- 본문에서 실제로 답할 수 있는 약속만 담고 확인되지 않은 가격·연도·순위·숫자는 만들지 않기\n- 추천/비교/방법/비용/대상/주의 등 서로 다른 검색 의도로 구성\n- 관련 없는 핫이슈를 억지로 섞거나 같은 키워드 변형만 반복하지 않기\n- 과장·낚시 감탄사(대박/충격/1등/미쳤다) 금지, 물음표·느낌표 남발 금지\n${AEO_TITLE_RULE}\nJSON 배열만.`;
    const text=await callAI(prompt,signal);
    const arr=parseArr(text).map((t:string)=>enforceExactKeyword(t,kw)).filter(Boolean);
    if(!arr.length)throw new Error("제목 생성 실패");
    return arr.slice().sort((a:string,b:string)=>calcTitleScore(b,kw)-calcTitleScore(a,kw))[0]; // 해당 키워드 기준 최고 제목 선택
  }
  // 모바일 가독성: FAQ/구조 마커는 그대로 두고, 긴 문단(3문장↑ 또는 120자↑)을 2문장마다 쪼개 빈 줄로 분리.
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
  // 🎨 글 패턴 자동: 키워드에 가장 어울리는 패턴 하나를 AI가 고름(맛집→맛집후기, 여행→여행기 등). 실패 시 정보글.
  async function otPickStyle(kw:string,title:string,signal:AbortSignal):Promise<WriteStyle>{
    try{
      const t=await callAI(`아래 블로그 글감에 가장 어울리는 글 패턴 하나만 골라 그 단어만 답해. 다른 말 절대 금지.\n선택지: 감성일기 / 정보글 / 맛집후기 / 여행기\n기준: 음식·카페·식당·맛집이면 맛집후기, 여행·여행지·숙소·관광이면 여행기, 개인 경험·감정·일상이면 감성일기, 그 외 정보·방법·가격·비교·추천은 정보글.\n\n키워드: "${kw}"\n제목: "${title}"`,signal);
      const s=(t||"").replace(/[^가-힣]/g,"");
      const hit=(["맛집후기","여행기","감성일기","정보글"] as WriteStyle[]).find(x=>s.includes(x));
      return hit||"정보글";
    }catch{ return "정보글"; }
  }
  async function otGenPost(kw:string,title:string,signal:AbortSignal,styleOverride?:WriteStyle):Promise<{content:string;tags:string}>{
    const chars=otCharMode==="manual"?otTargetChars:calcTargetChars();   // 글자수 직접 지정 or 자동
    const catGuide=getCatGuide(kw,title);
    const effStyle:WriteStyle=styleOverride||(otWriteStyle==="자동"?"정보글":otWriteStyle);   // 자동인데 override 없으면 정보글 폴백
    const styleGuide=WRITE_STYLE_GUIDE[effStyle]||"";                  // 글 패턴(감성일기/정보글/맛집후기/여행기)
    const prompt=`당신은 대한민국 최고의 블로그 작가입니다.\n키워드: "${kw}"  제목: "${title}"\n목표 글자수: ${chars}자 내외(±100자, 반드시 이 범위)\n\n${catGuide}\n\n${styleGuide?"★ 아래 [글의 방향]을 최우선으로 따를 것:\n"+styleGuide+"\n":""}\n=== 절대 규칙 ===\n⛔ ## 및 ** * - + 마크다운 기호 전부 금지(소제목도 순수 텍스트)\n⛔ 한자·중국어·일본어·영어단어 금지(브랜드명 제외)\n⛔ AI 상투어 금지(~해보겠습니다/살펴보겠습니다/결론적으로/다양한/효과적인) → 실제 사람 말투(~해요, ~거든요, ~더라고요)\n✅ ★핵심 키워드 "${kw}"를 본문에 띄어쓰기·글자 그대로 정확히 5~6번 반복(검색 노출 핵심)\n✅ 구체적 수치·가격·기간·경험담 포함, 과장·거짓 금지\n✅ 본문을 4~6개 구간으로 나누고 각 구간 앞에 짧은 소제목(10~30자, ## 없이)\n✅ 소제목 일부에 검색요소(왜/어떻게/추천/가격/후기/비교/주의점)\n✅ 모든 단락 사이 빈 줄 하나(엔터 두 번), 한 단락 2~4문장(모바일 가독성)\n\n${AEO_RULES}\n\n=== 출력 형식 ===\n태그: 태그1, 태그2, 태그3, 태그4, 태그5\n\n(본문 ${chars}자 내외 순수 텍스트. ★맨 첫 문단은 AEO 규칙대로 '핵심 요약' 2~3문장으로 시작)\n\n${AEO_FAQ_FORMAT}`;
    const text=await callAI(prompt,signal);
    const cleaned=stripMarkdown(text);
    const tgm=cleaned.match(/태그[:\s]*([^\n]+)/);
    const bm=cleaned.match(/태그[^\n]*\n([\s\S]+)/);
    const body0=ensureQuestionHeadings(bm?bm[1].trim():cleaned,kw);
    const bodyRaw=ensureAeoIntroSummary(await ensureKeywordCount(body0,kw,5),title);   // 키워드 최소 5회 + 도입 핵심요약 보장
    const bodyCap=enforceMaxChars(bodyRaw,chars);   // 자동·직접 모두 목표 글자수 근처로 캡(오버슈트 방지)
    const spaced=otSpaceParagraphs(bodyCap);   // 모바일 가독성: 긴 문단을 2~3문장마다 쪼개 빈 줄로 분리
    const repaired=await repairGeneratedQuality(spaced,kw,title,signal,80);
    const body=otSpaceParagraphs(enforceMaxChars(repaired,chars));
    return {content:body,tags:tgm?tgm[1].trim():""};
  }
  // 회원 실제 네이버 카테고리 목록 ↔ 글 주제 AI 매칭 → 가장 맞는 카테고리 자동 선택
  async function otPickCategory(title:string,content:string,cats:{id:string;name:string}[],signal:AbortSignal):Promise<{id?:string;name?:string}>{
    if(!cats.length)return {};
    if(cats.length===1)return cats[0];
    const names=cats.map((c,i)=>`${i+1}. ${c.name}`).join("\n");
    try{
      // ★글 전체를 읽고 주제를 판단해 매칭(200자만 보던 것 개선). AI가 다 쓴 글이니 주제를 모를 리 없음.
      const t=await callAI(`아래 블로그 글 전체를 읽고, 이 글의 핵심 주제에 가장 잘 맞는 카테고리 하나를 고르세요.\n제목: ${title}\n\n본문:\n${content.slice(0,2500)}\n\n카테고리 목록:\n${names}\n\n글의 주제를 먼저 파악한 뒤, 위 목록에서 가장 잘 맞는 카테고리의 번호만 숫자로 답하세요(설명·다른 말 금지). 애매하면 1번.`,signal);
      const m=t.match(/\d+/); const idx=m?parseInt(m[0],10)-1:-1;
      if(idx>=0&&idx<cats.length)return cats[idx];
    }catch{}
    return cats[0];
  }
  // flowN>0 → 무료 Flow: 이미지를 미리 안 만들고 봇이 발행 중 생성·삽입(일반 발행의 useFlow와 동일). images는 빈 배열.
  /* ★공용 삽입: 온파트너 상품카드 → 내 링크(OG) → 글쓴이 인사글을, 발행하기와 100% 동일한 규칙으로 blocks에 넣는다.
     원칙: 링크는 '이미지 블록 바로 뒤 + URL만 단독 문단' → 이미지와 링크 사이에 글자가 절대 안 낀다.
     발행하기(handlePublish)와 원터치(otPublishItem)가 같이 쓴다(중복 제거 + 완전 동일 보장). */
  function insertLinksAndGreeting(inputBlocks:any[], effTitle:string, keyword:string):any[]{
    let effectiveBlocks:any[]=inputBlocks.map(b=>({id:b.id||uid(),...b}));
    // 1) 온파트너 상품카드 (가격 나온 상품카드로 렌더 — partnerUrl만 단독 문단)
    const partnerForPublish:OnPartnerItem[] = onPartnerItems.length>0 ? onPartnerItems : (onPartnerPreview?[onPartnerPreview]:[]);
    if(partnerForPublish.length>0){
      const items=partnerForPublish.filter(it=>it.product.available&&it.product.partnerUrl);
      const DISCLOSURE="※ 이 글에는 제휴 링크가 포함되어 있으며, 구매 시 작성자에게 일정 수수료가 발생할 수 있습니다.";
      if(items.length>0 && !effectiveBlocks.some(b=>b.type==="text"&&(b.content||"").includes("제휴 링크가 포함")))
        effectiveBlocks=[{type:"text",id:uid(),content:DISCLOSURE},...effectiveBlocks];
      const isBoundary=(b:any)=>b.type==="text"&&/\[FAQ시작\]|\[관련글시작\]|질문\s*답변|Q\s*&\s*A|큐앤에이|해시태그|자주\s*묻는/i.test(b.content||"");
      let boundaryIdx=effectiveBlocks.findIndex(isBoundary); if(boundaryIdx<0)boundaryIdx=effectiveBlocks.length;
      const imgIdxs:number[]=[]; for(let i=1;i<boundaryIdx;i++){const t=effectiveBlocks[i].type;if(t==="image"||t==="image-pair")imgIdxs.push(i);}
      const textIdxs:number[]=[]; for(let i=0;i<boundaryIdx;i++){const b=effectiveBlocks[i];if(b.type==="text"&&(b.content||"").trim().length>=40)textIdxs.push(i);}
      if(textIdxs.length===0)for(let i=0;i<boundaryIdx;i++)if(effectiveBlocks[i].type==="text")textIdxs.push(i);
      const anchorIdxs = imgIdxs.length>0 ? imgIdxs : textIdxs;
      if(items.length>0 && anchorIdxs.length>0){
        const ratios = items.length===1?[0.6]:items.length===2?[0.45,0.72]:[0.35,0.58,0.8];
        const used=new Set<number>();
        const insertAfter=items.map((_,i)=>{ let ai=Math.round(anchorIdxs.length*ratios[i])-1; ai=Math.max(0,Math.min(anchorIdxs.length-1,ai)); while(used.has(anchorIdxs[ai])&&ai<anchorIdxs.length-1)ai++; used.add(anchorIdxs[ai]); return anchorIdxs[ai]; });
        const withLink:any[]=[];
        effectiveBlocks.forEach((b,i)=>{ withLink.push(b); items.forEach((it,k)=>{ if(insertAfter[k]===i) withLink.push({type:"text",id:uid(),content:`👇 '${it.product.name}' 지금 바로 확인하기\n${it.product.partnerUrl}`}); }); });
        effectiveBlocks=withLink;
      }
    }
    // 2) 내 링크 (OG 썸네일 카드 — URL만 단독 문단, 온파트너 붙은 이미지는 앵커 제외)
    if(myLinks.length>0){
      const isBoundary2=(b:any)=>b.type==="text"&&/\[FAQ시작\]|\[관련글시작\]|질문\s*답변|Q\s*&\s*A|큐앤에이|해시태그|자주\s*묻는/i.test(b.content||"");
      let bIdx=effectiveBlocks.findIndex(isBoundary2); if(bIdx<0)bIdx=effectiveBlocks.length;
      const isLinkBlock=(b?:any)=>!!b&&b.type==="text"&&/https?:\/\//.test(b.content||"");
      const anchors:number[]=[];
      for(let i=1;i<bIdx;i++){const t=effectiveBlocks[i].type;if((t==="image"||t==="image-pair")&&!isLinkBlock(effectiveBlocks[i+1]))anchors.push(i);}
      if(anchors.length===0)for(let i=0;i<bIdx;i++){const b=effectiveBlocks[i];if(b.type==="text"&&(b.content||"").trim().length>=40&&!/https?:\/\//.test(b.content||""))anchors.push(i);}
      if(anchors.length>0){
        const ratios = myLinks.length===1?[0.7]:myLinks.length===2?[0.5,0.8]:[0.4,0.62,0.85];
        const used=new Set<number>();
        const insAfter=myLinks.map((_,i)=>{ let ai=Math.round(anchors.length*ratios[i])-1; ai=Math.max(0,Math.min(anchors.length-1,ai)); while(used.has(anchors[ai])&&ai<anchors.length-1)ai++; used.add(anchors[ai]); return anchors[ai]; });
        const withMy:any[]=[];
        effectiveBlocks.forEach((b,i)=>{ withMy.push(b); myLinks.forEach((url,k)=>{ if(insAfter[k]===i) withMy.push({type:"text",id:uid(),content:url}); }); });
        effectiveBlocks=withMy;
      }
    }
    // 3) 글쓴이 인사말 (썸네일/제휴문구 바로 다음 1회)
    if(greeting.trim()){
      const g=greeting.trim();
      if(!effectiveBlocks.some(b=>b.type==="text"&&(b.content||"").trim()===g)){
        const discIdx=effectiveBlocks.findIndex(b=>b.type==="text"&&(b.content||"").includes("제휴 링크가 포함"));
        const firstImgIdx=effectiveBlocks.findIndex(b=>b.type==="image"||b.type==="image-pair");
        const at = discIdx>=0 ? discIdx+1 : (firstImgIdx>=0 ? firstImgIdx+1 : 0);
        effectiveBlocks=[...effectiveBlocks.slice(0,at),{type:"text",id:uid(),content:g},...effectiveBlocks.slice(at)];
      }
    }
    return effectiveBlocks;
  }
  async function otPublishItem(kw:string,title:string,content:string,tags:string[],images:string[],categoryId:string|undefined,accId:string,flowN:number=0,editLogNo?:string,editBlogId?:string):Promise<string>{
    const acc=connAccs.find(a=>a.id===accId);
    const blocks:any[]=[];
    if(!flowN&&images[0])blocks.push({type:"image",src:images[0],alt:""});   // 썸네일 alt는 항상 비움(본문 유실 방지)
    const paras=content.split(/\n\n+/).map(s=>s.trim()).filter(Boolean);
    const rest=flowN?[]:images.slice(1);
    // ★캡션: "사진 1/사진 2" 숫자 대신 본문 소제목 기반 서로 다른 캡션(중복 없음). 썸네일 제외 rest 장수만큼.
    const caps=buildCaptions(kw,rest.length,content);
    const every=rest.length?Math.max(1,Math.floor(paras.length/(rest.length+1))):0;
    let ri=0;
    paras.forEach((p,i)=>{
      blocks.push({type:"text",content:p});
      if(every&&ri<rest.length&&(i+1)%every===0){blocks.push({type:"image",src:rest[ri],alt:caps[ri]||kw});ri++;}
    });
    while(ri<rest.length){blocks.push({type:"image",src:rest[ri],alt:caps[ri]||kw});ri++;}
    // ★온파트너·내 링크·인사글을 발행하기와 동일 규칙으로 삽입(링크↔이미지 사이 글 안 낌)
    const finalBlocks=insertLinksAndGreeting(blocks,title,kw);
    const payload:any={userId:user.id,platform:"naver",title,content,
      naverId:acc?.username||undefined,pubScope,tags,
      imageUrl:(!flowN&&images[0])||undefined,categoryId:categoryId||undefined,visibility,blocks:finalBlocks,
      ...(editLogNo?{editLogNo,editBlogId}:{})};   // ★글 살리기: 그 글의 소유 블로그까지 검증 후 덮어쓰기
    if(flowN){   // 무료 Flow: 봇이 발행 중 flowN장 생성. 본문 구간별 프롬프트 + 캡션 전달(일반 발행과 동일).
      const lines=content.split("\n").filter((l:string)=>l.trim().length>5);
      const step=Math.max(1,Math.floor(lines.length/flowN));
      payload.useFlow=true; payload.flowImgCount=flowN;
      payload.flowPrompts=Array.from({length:flowN},(_,i)=>{const seg=lines.slice(i*step,(i+1)*step).join(" ").slice(0,150);return withImageConcept(buildFlowPrompt(kw,title,seg,i),"photo");});
      payload.flowCaptions=buildCaptions(kw,flowN,content);
    }
    const r=await botFetch(`${BOT}/api/publish-full`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload),signal:otAbortRef.current?.signal});
    const d=await r.json().catch(()=>({}));
    if(r.status===401)throw new Error("세션 만료 — 계정 관리에서 재연결해주세요");
    if(!r.ok)throw new Error(d.error||"발행 실패");
    return d.postUrl||"";
  }
  function stopOneTouch(){otStopRef.current=true;try{otAbortRef.current?.abort();}catch{};setOtRunning(false);setOtNextAt(null);showToast("원터치를 멈췄어요 — 진행 중이던 작업도 중단","info");}

  function showOneTouchPreflight(errors:string[],title="글 살리기를 시작할 수 없어요"){
    window.alert(`${title}\n\n${errors.map(v=>`• ${v}`).join("\n")}`);
  }

  // 블로그지수(NeighborPage)에서 '글 살리기' 클릭 → 이벤트로 여기서 실행(원터치 탭으로 이동해 진행상황 표시)
  useEffect(()=>{
    const h=async(e:any)=>{ const {logNo,title,blogId,naverId,careAccountId,requestId}=e.detail||{}; if(!logNo)return;
      const finish=(accepted:boolean)=>window.dispatchEvent(new CustomEvent("publy-revive-request-finished",{detail:{requestId,logNo:String(logNo),accepted}}));
      const target={logNo:String(logNo),origTitle:String(title||""),origBody:"",blogId:String(blogId||""),careAccountId:String(careAccountId||"")};
      setTab("onetouch");
      // ★글 살리기는 반드시 원문 소유 블로그의 로그인 세션을 골라야 한다.
      //   네이버 로그인ID(bb9653)와 블로그ID(system-b)는 다를 수 있으므로 username이 아니라
      //   연결 때 저장한 blog_name(실제 blogId)을 우선 비교한다. 현재 원터치 선택계정을 쓰면
      //   다른 계정(s9653)의 정상 세션을 활성화해 그 블로그에서 편집기를 찾는 사고가 난다.
      const naverAccs=accounts.filter(a=>a.platform==="naver"&&(botOnline?a.is_connected:true));
      const errors:string[]=[];
      if(!naverAccs.length)errors.push("네이버 계정이 연결 안 됐어요 → 계정관리에서 계정을 연결하세요");
      const norm=(v?:string)=>String(v||"").trim().toLowerCase().replace(/@naver\.com$/i,"");
      const targetBlogId=norm(target.blogId);
      // 1순위는 블로그지수/제목수정에서 이미 검증해 사용한 로그인ID. blog_name 비교는 구버전 이벤트용 폴백.
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
  },[accounts,platform,botOnline,otImgMode,flowSlot,flowSlotReady]);
  // ── 14일 중복방지: 사용한 키워드 기록/조회 ──
  function otRecentUsedKw():string[]{ try{ const cut=Date.now()-14*86400000; return (JSON.parse(localStorage.getItem("publy_ot_used_kw")||"[]") as any[]).filter(r=>r.at>cut).map(r=>r.kw); }catch{return [];} }
  function otRecordUsedKw(kws:string[]){ try{ const cut=Date.now()-14*86400000; const kept=(JSON.parse(localStorage.getItem("publy_ot_used_kw")||"[]") as any[]).filter(r=>r.at>cut); const now=Date.now(); for(const k of kws) kept.push({kw:k,at:now}); localStorage.setItem("publy_ot_used_kw",JSON.stringify(kept.slice(-800))); }catch{} }
  // ── AI 자동추천 키워드: 핫이슈 참고 + SEO 최적화, 서로 다른 분야 다양하게, 14일 내 사용분 제외 ──
  async function otGenKeywords(count:number,signal?:AbortSignal):Promise<string[]>{
    const used=otRecentUsedKw();
    let hot:string[]=[];
    try{ const r=await botFetch(`${BOT}/api/hot-issues?category=${encodeURIComponent("실시간")}`,{signal:AbortSignal.timeout(15000)} as any); const d=await r.json().catch(()=>({})); if(Array.isArray(d.items))hot=d.items.slice(0,30); }catch{}
    const excl=used.slice(0,120).join(", ");
    const hotHint=hot.length?`\n\n[현재 핫이슈 후보 — 선택 카테고리와 실제 관련 있을 때만 활용]\n${hot.slice(0,25).join(", ")}`:"";
    const catRule=otAiCats.length
      ? `- ★반드시 다음 주제 카테고리 안에서만 생성하세요(이 밖의 주제 금지): ${otAiCats.join(", ")}. 고른 카테고리들에 골고루 분배.`
      : `- 분야를 최대한 골고루 섞기: 맛집·여행·재테크·건강·육아·뷰티·인테리어·IT/가전·정책자금·반려동물·패션·자기계발 등`;
    const prompt=`당신은 네이버 블로그 SEO·검색의도·트렌드 전문가입니다.\n실제로 글로 답할 수 있고 검색자가 행동할 이유가 분명한 키워드 ${count}개를 JSON 배열로만 생성하세요.\n[규칙]\n- 상시형 70%, 계절·시기·핫이슈형 30%로 구성\n- 방법/가격/비교/후기/신청/주의/추천처럼 구체적인 정보 의도를 자연스럽게 포함\n- 너무 넓은 한 단어, 인물명·사건명만 있는 뉴스 키워드, 의미가 거의 같은 변형 반복 금지\n- 핫이슈는 선택 카테고리와 직접 관련되고 독자에게 해결 정보를 줄 수 있을 때만 사용\n- 확인되지 않은 연도·가격·혜택·순위를 지어내지 않기\n- 자연스러운 2~5어절 롱테일 키워드\n${catRule}\n${excl?`- ⛔ 아래 최근 14일간 이미 쓴 키워드는 절대 포함 금지: ${excl}`:""}${hotHint}\nJSON 배열만 반환.`;
    const text=await callAI(prompt,signal);
    const usedSet=new Set(used.map(u=>u.replace(/\s+/g,"")));
    const seen=new Set<string>();
    const arr=parseArr(text).map(s=>s.trim()).filter(Boolean).filter(k=>{const key=k.replace(/\s+/g,""); if(!key||usedSet.has(key)||seen.has(key))return false; seen.add(key); return true;});
    // ★14일 중복 절대금지: 필터 후 부족하면 한 번 더 생성해 채운다(최대 2회 추가). 그래도 부족하면 있는 만큼만.
    let tries=0;
    while(arr.length<count && tries<2){
      tries++;
      const need=count-arr.length;
      const exclAll=[...used,...arr].slice(0,150).join(", ");
      try{
        const more=await callAI(`위와 같은 조건으로 검색 의도가 분명한 네이버 롱테일 키워드 ${need}개를 JSON 배열로만 더 생성하세요.\n${catRule}\n- ⛔ 아래 키워드는 절대 포함 금지(14일 내 사용 + 방금 뽑은 것): ${exclAll}\n- 2~5어절, 관련 없는 핫이슈·과장·낚시·유사 변형 금지\nJSON 배열만.`,signal);
        for(const k of parseArr(more).map(s=>s.trim()).filter(Boolean)){ const key=k.replace(/\s+/g,""); if(key&&!usedSet.has(key)&&!seen.has(key)){seen.add(key);arr.push(k);} if(arr.length>=count)break; }
      }catch{break;}
    }
    return arr.slice(0,count);
  }
  async function runOneTouch(resume?:{idx:number;kws:string[];reviveTarget?:{logNo:string;origTitle:string;origBody:string;blogId?:string;careAccountId?:string}},reviveTarget?:{logNo:string;origTitle:string;origBody:string;blogId?:string;careAccountId?:string},source:"manual"|"schedule"|"revive"="manual",accountId?:string){
    const activeRevive=reviveTarget||resume?.reviveTarget;
    if(otRunningRef.current){if(activeRevive)setReviveState({logNo:activeRevive.logNo,title:activeRevive.origTitle,step:"실패",fail:"다른 원터치 작업이 진행 중이에요."});return;}
    if(otSchedOn&&source!=="schedule"&&!activeRevive){const fail=`예약 대기 중이에요. ${otSchedTime} 예약을 끈 뒤 다시 시도해주세요.`;showToast(fail,"info");return;}
    if(activeRevive){
      const rq=await checkReviveQuota(user.id,user.plan);
      if(!rq.ok){const fail=`오늘 이 글 살리기 한도(${rq.limit}회)를 모두 사용했어요. 자정에 다시 사용할 수 있어요.`;setReviveState({logNo:activeRevive.logNo,title:activeRevive.origTitle,step:"실패",fail});showToast(fail,"info");return;}
    }
    const runAccId=accountId||pubAccId;
    const preflightErrors:string[]=[];
    // 관문 = '연결된 네이버 계정이 있나'(발행은 user.id 세션으로 하므로 계정 매칭 불필요). revive는 platform 상태와 무관하게 통과해야 하니 accounts 전체에서 확인.
    const hasNaverAcc=accounts.some(a=>a.platform==="naver"&&(botOnline?a.is_connected:true));
    const runAccOk=!!runAccId&&(connAccs.some(a=>a.id===runAccId)||accounts.some(a=>a.id===runAccId));
    if(activeRevive?!hasNaverAcc:(!runAccOk))preflightErrors.push("네이버 계정이 연결 안 됐어요 → 계정관리에서 계정을 연결하세요");
    if(otImgMode==="flow"&&!flowSlotReady[flowSlot])preflightErrors.push("Flow가 연결 안 됐어요 → 원터치 발행에서 Flow를 연결 후 다시 시작하세요");
    if(preflightErrors.length){showOneTouchPreflight(preflightErrors,activeRevive?undefined:"원터치 발행을 시작할 수 없어요");return;}
    const termMin=otCustomTerm.trim()?Math.max(1,parseInt(otCustomTerm,10)||otTermMin):otTermMin;
    otRunningRef.current=true;otStopRef.current=false;setOtRunning(true);setOtNextAt(null);setOtPaused(null);otFlowExhaustedRef.current.clear();
    const ctrl=new AbortController();otAbortRef.current=ctrl;const signal=ctrl.signal;
    try{
    // 📡 모든 단계를 라이브 로그로 → 회원 본인도, 관리자도 실시간 확인. (관리자 '라이브 로그' 탭에서 회원별로 보임)
    const liveLines:string[]=[];
    const bySched=source==="schedule";
    setOtLiveLog(prev=>[...prev,activeRevive
      ? `━━ 글 살리기 시작 ━━`
      : `━━━━━ ${new Date().toLocaleString("ko-KR")} 원터치 ${resume?`이어가기(${resume.idx+1}번째부터)`:bySched?"예약 자동 시작":"시작"} ━━━━━`].slice(-300));
    const otLive=(t:string,running=true)=>{const line=`[${new Date().toLocaleTimeString("ko-KR")}] ${t}`; liveLines.push(line); setOtLiveLog(prev=>[...prev,line].slice(-300)); try{pushLiveLog(user.id,{name:user.name,email:user.email,context:"⚡ 원터치 발행",text:liveLines.slice(-80).join("\n"),running});}catch{}};
    // 👤 어떤 네이버 계정으로 도는지 시작 로그 맨 앞에 항상 표시(일반 원터치·예약·이어가기·글살리기 전부). 회원=관리자 동일.
    { const runAcc=connAccs.find(a=>a.id===runAccId)||accounts.find(a=>a.id===runAccId);
      otLive(`👤 글 작성 계정: ${runAcc?.username||"확인 불가"}${runAcc?.blog_name?` → 블로그 ${runAcc.blog_name}`:""}`); }
    if(activeRevive?.blogId&&activeRevive.logNo){
      otLive(`🔗 살릴 글 주소: https://blog.naver.com/${encodeURIComponent(activeRevive.blogId)}/${encodeURIComponent(activeRevive.logNo)}`);
    }
    // ── 발행 계획 요약(테리 요청: 예약이면 몇 시 예약·매일반복 여부 / 몇 개 / 몇 분 간격 전부 디테일하게) ──
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
    // ── 키워드 결정: 이어가기면 기존 목록, AI면 생성, 아니면 입력칸 ──
    let kws:string[]; let startIdx=0; let reviveImageCount=otImgCount||3; let reviveSucceeded=false;
    if(activeRevive){
      otLive(`✨ 대상 글: "${activeRevive.origTitle}"`);
      setReviveState({logNo:activeRevive.logNo,title:activeRevive.origTitle,step:"원본 글을 읽고 주제 파악 중..."});
      let origBody=activeRevive.origBody;
      // ★원본 글 읽기 = 실제 blogId(예: system-b)로. 예전엔 계정 username(bb9653)을 blogId 자리에 넣어 다른 블로그를 읽으려다 실패했음.
      { const readBlogId=activeRevive.blogId||""; try{const br=await botFetch(`${BOT}/api/post-body?blogId=${encodeURIComponent(readBlogId)}&logNo=${encodeURIComponent(activeRevive.logNo)}`,{signal:AbortSignal.timeout(25000)} as any);const bd=await br.json().catch(()=>({}));if(bd.ok){if(!origBody)origBody=String(bd.body||"");const fetchedCount=Number(bd.imageCount);if(Number.isFinite(fetchedCount)&&fetchedCount>=0)reviveImageCount=Math.floor(fetchedCount);}}catch{} }
      let kw=activeRevive.origTitle.replace(/[\[\]#]/g,"").trim().slice(0,20);
      try{const t=await callAI(`아래 블로그 글의 핵심 검색 키워드(2~4어절)만 답해. 다른 말 절대 금지.\n제목: ${activeRevive.origTitle}\n본문: ${origBody.slice(0,600)}`,new AbortController().signal);const k=(t||"").split("\n")[0].replace(/["'`]/g,"").trim();if(k&&k.length<=25)kw=k;}catch{}
      kws=[kw]; otLive(`📝 주제: ${kw}`);
    } else if(resume){ kws=resume.kws; startIdx=resume.idx; otLive(`▶ ${resume.idx+1}번째 키워드부터 이어서 발행해요`); }
    else if(otAiKw){
      otLive(`✨ AI 자동추천 키워드 ${otAiKwCount}개 생성 중(핫이슈+SEO·14일 중복 제외)`);
      try{ kws=await otGenKeywords(otAiKwCount); }catch(e:any){ otLive(`❌ 키워드 생성 실패: ${e.message||"오류"}`,false); showToast("AI 키워드 생성 실패","error"); otRunningRef.current=false;setOtRunning(false); return; }
      if(!kws.length){ otLive(`❌ 생성된 키워드가 없어요(최근 사용분 제외 후 0개). 잠시 후 다시 시도하세요.`,false); showToast("생성된 키워드가 없어요","error"); otRunningRef.current=false;setOtRunning(false); return; }
      otLive(`✅ 생성된 키워드 ${kws.length}개: ${kws.join(", ")}`);
    } else {
      kws=otKeywords.split(/[\n,]+/).map(s=>s.trim()).filter(Boolean);
      if(!kws.length){ showToast("키워드를 한 줄에 하나씩 넣거나, AI 자동추천을 켜세요","error"); otRunningRef.current=false;setOtRunning(false); return; }
    }
    if(!resume&&!activeRevive) otRecordUsedKw(kws);   // 사용한 키워드 14일 기록(이어가기는 이미 기록됨)
    const accId=runAccId;
    // 회원 실제 카테고리 목록 확보(state 경쟁 방지 위해 직접 fetch)
    let cats:{id:string;name:string}[]=[];
    try{ const cr=await botFetch(`${BOT}/api/naver/categories/${user.id}`,{method:"GET",signal:AbortSignal.timeout(30000)} as any); const cd=await cr.json().catch(()=>({})); if(cd.categories&&cd.categories.length)cats=cd.categories; }catch{}
    if(!cats.length)cats=(accCats[accId]||[]).map((c,i)=>({id:String(i),name:c}));
    if(!resume) setOtLog(kws.map(kw=>({id:uid(),kw,step:"대기",status:"wait" as const})));
    // ★이어가기 지점 = '발행 성공한 다음 글'. 발행 전(제목·본문·이미지 생성 중)에 중단되면 그 글부터 다시(건너뛰지 않음).
    //   otLog(state)는 비동기라 실시간이 아님 → 발행 성공을 로컬 변수로 직접 추적(테리: 중단된 글은 다시 생성돼야).
    let nextResumeIdx=startIdx;
    for(let i=startIdx;i<kws.length;i++){
      if(otStopRef.current)break;
      const kw=kws[i]; const upd=(patch:any)=>setOtLog(prev=>prev.map((r,j)=>j===i?{...r,...patch}:r));
      const q=await checkDailyPublishQuota(user.id,user.plan);
      if(!q.ok){
        upd({step:`발행 한도(${q.limit}건) 부족 — 등급을 올리면 더 발행돼요`,status:"limit"});
        setOtLog(prev=>prev.map((r,j)=>j>i?{...r,step:"발행 한도 부족 — 다음날 이어지거나 등급 업",status:"limit" as const}:r));
        otLive(`⛔ 발행 한도(${q.limit}건) 소진 — 남은 ${kws.length-i}개는 등급 업 시 발행`,false);
        showToast(`오늘 발행 한도(${q.limit}건)를 다 썼어요. 남은 키워드는 등급을 올리면 발행돼요`,"info");
        break;
      }
      const n=activeRevive?reviveImageCount:Math.min(6,Math.max(1,otImgCount));
      try{
        upd({step:"제목 생성 중",status:"run"}); otLive(activeRevive?`✏️ 새 제목 생성 중...`:`▶ [${i+1}/${kws.length}] "${kw}" 제목 생성 중`); const title=await otGenTitleBest(kw,signal); upd({title}); otLive(activeRevive?`✏️ 제목 수정: "${activeRevive.origTitle}" → "${title}"`:`  ✅ 제목 선택: ${title}`);
        if(activeRevive&&title.trim().length<8)throw new Error("제목 생성 품질 미달 — 덮어쓰기 중단(원본 안전)");
        let effStyle:WriteStyle=otWriteStyle==="자동"?"정보글":otWriteStyle;
        if(otWriteStyle==="자동"){ effStyle=await otPickStyle(kw,title,signal); otLive(`  🎨 글 패턴 자동 선택: ${effStyle}`); }
        upd({step:"본문 생성 중"}); otLive(`  ✍️ 본문 생성 중(${otCharMode==="manual"?otTargetChars+"자·":""}${effStyle}·키워드 5~6회)`); const {content,tags}=await otGenPost(kw,title,signal,effStyle); const contentQuality=calcQualityScore(content,kw); otLive(`  ✅ 본문 완성 (${content.length}자 · SEO 품질 ${contentQuality?.score??"-"}점${contentQuality&&contentQuality.score<80?" · 자동 보정 후 재검사":""})`);
        if(activeRevive&&content.replace(/\s/g,"").length<400)throw new Error("본문 생성 품질 미달 — 덮어쓰기 중단(원본 안전)");
        if(activeRevive)otLive(`🖼️ 이미지 ${n}장 · 📄 글자수 ${content.length}자로 덮어쓰기 시작합니다`);
        const imgs:string[]=[];
        // 글 살리기는 기존 실사 유지. 일반 원터치는 고정 또는 글 단위 실사 2 : 만화 1 순환.
        const runImageConcept:ImageConcept=activeRevive?"photo":otImageConcept==="cycle"?(i%3===2?"comic":"photo"):otImageConcept;
        if(!activeRevive)otLive(`  🎭 이미지 콘셉트: ${runImageConcept==="comic"?"만화형":"실사형"}${otImageConcept==="cycle"?" (2:1 순환)":""}`);
        if(n===0){otLive(`  🖼️ 원본 글에 이미지가 없어 이미지 생성은 건너뜁니다`);
        } else if(otImgMode==="ai"){ upd({step:"이미지 생성 중"}); otLive(`  🖼️ 이미지 ${n}장 생성 중(AI)`);
          for(let k=0;k<n;k++){ if(otStopRef.current)break; try{imgs.push(await generateOneImage(kw,signal,k,undefined,runImageConcept,title));}catch(ie:any){otLive(`  ⚠️ 이미지 ${k+1} 실패: ${ie.message||"오류"}`);} }
          otLive(`  ✅ 이미지 ${imgs.length}/${n}장`);
        } else {   // 무료 Flow: 위 'Flow 준비'로 연 크롬(포트 9222)을 그대로 사용 → 재로그인/새창 없음
          upd({step:"Flow 이미지 생성 중"}); otLive(`  🖼️ Flow 이미지 ${n}장 생성 중(연결된 크롬 사용)`);
          const flines=content.split("\n").filter((l:string)=>l.trim().length>5); const fstep=Math.max(1,Math.floor(flines.length/n));
          const fprompts=Array.from({length:n},(_,k)=>{const seg=flines.slice(k*fstep,(k+1)*fstep).join(" ").slice(0,150);return withImageConcept(buildFlowPrompt(kw,title,seg,k),runImageConcept);});
          const fcaptions=buildCaptions(kw,n,content);
          // ★크레딧이 떨어지면 미리 로그인해둔 다음 슬롯으로 자동 전환하며 이어감(자리 비워도 OK). 소진 슬롯은 otFlowExhaustedRef에 기록.
          // 시도 순서: 현재 슬롯 먼저, 그다음 소진 안 된 나머지 슬롯들.
          const trySlots=[flowSlot,...flowSlots.map(s=>s.id).filter(id=>id!==flowSlot)].filter(id=>!otFlowExhaustedRef.current.has(id));
          let flowHandled=false;   // 성공 또는 '이미지 없이 진행'으로 매듭지어졌나
          for(const slotId of trySlots){
            if(otStopRef.current)break;
            if(slotId!==flowSlot){   // 다른 계정으로 자동 전환
              const nm=flowSlots.find(s=>s.id===slotId)?.name||`슬롯${slotId+1}`;
              otLive(`  🔄 '${nm}' 계정으로 자동 전환해서 계속해요(미리 로그인돼 있어요)`); setFlowSlot(slotId);
              if(!flowSlotReady[slotId]){ try{ await handleFlowLaunchChrome(slotId); }catch{} }
            }
            try{ const fr=await botFetch(`${BOT}/api/flow-generate`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({prompts:fprompts,captions:fcaptions,cdpPort:9222+(slotId||0)}),signal});
              const fd=await fr.json().catch(()=>({}));
              if(fr.status===402||fd.code==="FLOW_NO_CREDIT"){   // 이 계정 크레딧 소진 → 기록하고 다음 계정
                otFlowExhaustedRef.current.add(slotId);
                otLive(`  ⏸ 이 계정 크레딧이 떨어졌어요 — 다음 계정 확인 중...`);
                continue;
              }
              else if(fr.ok&&Array.isArray(fd.images)&&fd.images.length){ imgs.push(...fd.images.map((im:any)=>im.src).filter(Boolean)); otLive(`  ✅ Flow 이미지 ${imgs.length}/${n}장${imgs.length<n?` (${n-imgs.length}장은 생성 실패해 빠졌어요)`:""}`); flowHandled=true; break; }
              else { otLive(`  ❌ Flow 이미지 실패: ${fd.error||("HTTP "+fr.status)} — 이미지 없이 발행하지 않고 멈춥니다`); flowHandled=true; break; }
            }catch(e:any){ if(e?.name==="AbortError")throw e; otLive(`  ❌ Flow 이미지 오류: ${e.message} — 이미지 없이 발행하지 않고 멈춥니다`); flowHandled=true; break; }
          }
          if(!flowHandled&&!otStopRef.current){   // 등록된 모든 Flow 계정 크레딧 소진 → 그때만 사람 호출
            upd({step:"⏸ 모든 Flow 계정 크레딧 소진 — 계정 추가 후 이어가기",status:"limit"});
            otLive(`  ⏸ 등록된 Flow 계정이 모두 크레딧이 떨어졌어요. 새 계정을 연결한 뒤 '이어가기'를 누르면 이 키워드부터 계속돼요.`,false);
            showToast("모든 Flow 계정 크레딧 소진 — 계정 추가 후 '이어가기'","info");
            if(activeRevive){setReviveState({logNo:activeRevive.logNo,title:activeRevive.origTitle,step:"실패",fail:"모든 Flow 계정의 크레딧이 소진됐어요."});otLive("❌ 글 살리기 실패 — 모든 Flow 계정의 크레딧이 소진됐어요",false);}
            else setOtPaused({idx:i,kws,reason:"credit"});
            otRunningRef.current=false; setOtRunning(false); setOtNextAt(null); return;
          }
          if(!otStopRef.current&&imgs.length===0)throw new Error("Flow 이미지를 한 장도 만들지 못해 발행을 중단했어요. Flow 연결 상태를 확인한 후 다시 시작하세요.");
        }
        if(otStopRef.current){ upd({step:"⏹ 중단됨 — 이 글은 발행하지 않았어요",status:"limit"}); otLive(`  ⏹ 중단 — 발행 전이라 이 글은 올리지 않았어요`,false); break; }   // ★전체 중단: 발행 전이면 글도 안 올림
        upd({step:"카테고리 매칭 중"}); const cat=await otPickCategory(title,content,cats,signal); upd({cat:cat.name||"기본"}); otLive(`  📂 카테고리 자동 선택: ${cat.name||"기본"}`);
        if(otStopRef.current){ upd({step:"⏹ 중단됨 — 이 글은 발행하지 않았어요",status:"limit"}); otLive(`  ⏹ 중단 — 발행 전이라 이 글은 올리지 않았어요`,false); break; }
        const ok=await useQuota(user.id); if(!ok){upd({step:"발행 건수 초과",status:"limit"});otLive(`  ⛔ 발행 건수 초과`,false);break;}
        upd({step:"발행 중"}); otLive(`  🚀 네이버 발행 중...`);
        let postUrl="";
        try{ postUrl=await otPublishItem(kw,title,content,tags.split(",").map(t=>t.replace("#","").trim()).filter(Boolean),imgs,cat.id,accId,0,activeRevive?.logNo,activeRevive?.blogId); }
        catch(e:any){ await refundQuota(user.id); throw e; }
        const at=new Date().toLocaleTimeString("ko-KR",{hour:"2-digit",minute:"2-digit"});
        if(postUrl){   // ★주소를 받았을 때만 '완료' — 주소 없으면 실제로 안 올라갔을 수 있어 '확인 필요'로 정직하게
          await incrementDailyPublish(user.id); setDailyPublishUsed(p=>p+1);
          await addHistory({user_id:user.id,platform:"naver",title,post_url:postUrl,status:"success"}).catch(()=>{});
          upd({step:"발행 완료",status:"done",postUrl,at});
          nextResumeIdx=i+1;   // ★이 글 발행 성공 → 이어가기는 다음 글부터
          otLive(`  ✅ 발행 완료! ${postUrl}`);
          if(activeRevive){
            reviveSucceeded=true;
            window.dispatchEvent(new CustomEvent("publy-revive-succeeded",{detail:{logNo:activeRevive.logNo}}));
            await incrementReviveQuota(user.id);
            if(activeRevive.careAccountId){
              const tracked=await markTitleChanged(user.id,activeRevive.careAccountId,activeRevive.logNo,title);
              if(tracked){
                otLive(`  🩺 수정추적 등록 완료: ${activeRevive.logNo}`);
                window.dispatchEvent(new CustomEvent("publy-revive-tracked",{detail:{logNo:activeRevive.logNo,careAccountId:activeRevive.careAccountId}}));
              }else otLive(`  ⚠️ 발행은 완료됐지만 수정추적 저장에 실패했어요`,false);
            }
            setReviveState({logNo:activeRevive.logNo,title:activeRevive.origTitle,step:"완료",done:true});showToast("✨ 글을 새로 써서 덮어썼어요!","success");
          }
        } else {
          await refundQuota(user.id);   // 실제 발행 불확실 → 건수 환불
          if(activeRevive)setReviveState({logNo:activeRevive.logNo,title:activeRevive.origTitle,step:"실패",fail:"덮어쓰기 주소를 못 받았어요 — 블로그를 확인하세요"});
          upd({step:"⚠️ 발행 주소를 못 받음 — 블로그에 올라갔는지 확인하세요",status:"fail",at});
          otLive(`  ⚠️ 발행 주소를 못 받았어요(글이 실제로 안 올라갔을 수 있음). 블로그를 확인하세요.`);
          if(activeRevive)otLive(`❌ 글 살리기 실패 — 덮어쓰기 주소를 못 받았어요`,false);
          await addHistory({user_id:user.id,platform:"naver",title,status:"fail",error_message:"발행 주소 미수신(글 미게시 의심)"}).catch(()=>{});
        }
      }catch(e:any){
        if(activeRevive){const fail=String(e?.message||e).split("\n")[0];setReviveState({logNo:activeRevive.logNo,title:activeRevive.origTitle,step:"실패",fail});showToast("글 살리기 실패: "+fail,"error");}
        upd({step:"실패: "+(e.message||"오류"),status:"fail",error:e.message});
        otLive(activeRevive?`❌ 글 살리기 실패 — ${e.message||"오류"}`:`  ❌ 실패: ${e.message||"오류"}`);
        await addHistory({user_id:user.id,platform:"naver",title:kw,status:"fail",error_message:e.message}).catch(()=>{});
      }
      if(otStopRef.current) break;
      const hasNext=i<kws.length-1;
      if(hasNext){
        // ★계정 안전: 텀을 ±15% 랜덤으로 흔든다(칼같이 N분마다 = 봇 티 → 저품질 위험). 사람처럼 들쭉날쭉하게.
        const jitter=0.85+Math.random()*0.3; const actualMin=Math.max(1,Math.round(termMin*jitter));
        const until=Date.now()+actualMin*60000; setOtNextAt(until);
        const hhmm=(d:number)=>new Date(d).toLocaleTimeString("ko-KR",{hour:"2-digit",minute:"2-digit"});
        otLive(`  ⏱️ 약 ${actualMin}분 대기 (설정 ${termMin}분 ±안전 랜덤 · ${hhmm(Date.now())} → ${hhmm(until)}에 다음 글)`);
        while(Date.now()<until){ if(otStopRef.current)break; await new Promise(r=>setTimeout(r,1000)); }
        setOtNextAt(null);
        if(otStopRef.current) break;
        otLive(`  ▶ ${hhmm(Date.now())} 대기 끝 — 다음 글 시작`);
      }
    }
    // ★중단됐고 남은 키워드가 있으면 '이어가기' 지점을 저장 → 텀을 바꾼 뒤 '이어가기'를 누르면 그 키워드부터 이어감(AI/수동 무관)
    //   nextResumeIdx = 발행 성공한 다음 글. 발행 전 중단된 글은 그 글부터 다시(테리 확정: 중단된 글은 다시 생성).
    if(otStopRef.current){
      if(activeRevive){setReviveState({logNo:activeRevive.logNo,title:activeRevive.origTitle,step:"실패",fail:"사용자가 작업을 중단했어요. 원본 글은 덮어쓰지 않았습니다."});otLive("❌ 글 살리기 실패 — 사용자가 작업을 중단했어요",false);}
      const remain=kws.slice(nextResumeIdx);
      if(remain.length&&!activeRevive){
        setOtPaused({idx:nextResumeIdx,kws,reason:"stopped"});   // 일반 원터치만 이어가기 배너 표시
        if(!otAiKw){ setOtKeywords(remain.join("\n")); }      // 수동 모드는 입력칸에도 되돌려 둠(기존 동작 유지)
        otLive(`⏹ 중단 — 남은 ${remain.length}개는 아래 '이어가기'로 계속할 수 있어요. 발행 텀을 바꾸고 싶으면 위에서 바꾼 뒤 이어가기를 누르세요.`,false);
      } else if(!activeRevive) {
        otLive(`⏹ 전체 중단 — 남은 글이 없어요`,false);
      }
    } else if(activeRevive) {
      if(reviveSucceeded)otLive("✅ 글 살리기 완료 — 새 글로 덮어썼어요",false);
    } else {
      otLive("🎉 원터치 발행 전체 완료",false);
    }
    void loadHistory();
    }catch(e:any){
      const fail=String(e?.message||e||"알 수 없는 오류").split("\n")[0];
      if(activeRevive){setReviveState({logNo:activeRevive.logNo,title:activeRevive.origTitle,step:"실패",fail});showToast("글 살리기 실패: "+fail,"error");}
      else showToast("원터치 실행 실패: "+fail,"error");
    }finally{
      otRunningRef.current=false;otAbortRef.current=null;setOtRunning(false);setOtNextAt(null);
    }
  }

  // ── Flow 준비: 디버깅 크롬 자동 실행 (Electron) ── slot=열 계정 슬롯. 열면 그 슬롯을 활성으로.
  async function handleFlowLaunchChrome(slot:number=flowSlot){
    if(!(window as any).electron?.flowLaunchChrome){
      showToast("PC 앱에서만 Flow 준비가 가능해요. Publy 앱을 실행해주세요.","error");
      return;
    }
    setFlowLaunching(true);
    try{
      const r=await (window as any).electron.flowLaunchChrome(slot);
      if(r.ok){
        setFlowSlot(slot); setFlowReady(true); setFlowSlotReady(p=>({...p,[slot]:true}));
        const nm=flowSlots.find(s=>s.id===slot)?.name||`계정 ${slot+1}`;
        showToast(r.already?`✅ '${nm}' Flow 크롬이 준비돼 있어요!`:`✅ '${nm}' Flow 크롬을 열었어요! 크롬 창에서 Google 로그인만 해주세요 (최초 1회)`,"success");
      }else{
        showToast("❌ "+(r.error||"Flow 준비 실패"),"error");
      }
    }catch(e:any){ showToast("❌ Flow 준비 실패: "+e.message,"error"); }
    finally{ setFlowLaunching(false); }
  }
  // 전체 연결: 등록된 모든 슬롯을 순서대로 열어(각 창에서 로그인) — 최초 세팅 편의
  async function handleFlowConnectAll(){
    if(!(window as any).electron?.flowLaunchChrome){ showToast("PC 앱에서만 가능해요.","error"); return; }
    setFlowLaunching(true);
    try{
      for(const s of flowSlots){
        try{ const r=await (window as any).electron.flowLaunchChrome(s.id); if(r.ok)setFlowSlotReady(p=>({...p,[s.id]:true})); }catch{}
        await new Promise(r=>setTimeout(r,1500));
      }
      showToast(`✅ ${flowSlots.length}개 계정 창을 순서대로 열었어요. 이미 로그인된 계정은 그대로 두고, 풀린 계정만 다시 로그인해 주세요.`,"success");
    } finally { setFlowLaunching(false); }
  }
  // Flow 선택 시 준비 상태 폴링 (이미지 탭 + 원터치 탭 공용). 원터치는 활성 슬롯 기준.
  useEffect(()=>{
    const flowActive = imgGenType==="flow" || (tab==="onetouch" && otImgMode==="flow");
    if(!flowActive || !(window as any).electron?.flowStatus)return;
    const slot = tab==="onetouch" ? flowSlot : 0;
    let alive=true;
    const check=async()=>{ try{ const s=await (window as any).electron.flowStatus(slot); if(alive){setFlowReady(!!s.ready); setFlowSlotReady(p=>({...p,[slot]:!!s.ready}));} }catch{} };
    check(); const iv=setInterval(check,5000);
    return ()=>{ alive=false; clearInterval(iv); };
  },[imgGenType,tab,otImgMode,flowSlot]);

  // ── 글을 읽고 "장면이 서로 다른" 이미지 프롬프트 N개 생성 (Gemini) ──
  //   6하원칙(언제/어디서/무엇을/어떻게/왜)에 맞춰 이미지만 봐도 스토리가 읽히게.
  async function buildStoryPrompts(title:string, content:string, n:number):Promise<{prompts:string[];captions:string[]}>{
    // ★글을 실제 순서대로 N개 구간으로 나눠, "각 구간 본문이 말하는 바로 그 장면"의 이미지를 만든다.
    //   (예전엔 정해진 스토리 아크로 만들어 글과 이미지가 어긋났음 — 생선구이 얘기에 간장게장 이미지 등)
    const clean=(content||"").replace(/\[(FAQ|참고자료|관련글)시작\][\s\S]*?\[\1끝\]/g,"").trim();
    const paras=clean.split(/\n{2,}/).map(p=>p.replace(/^#+\s*/,"").trim()).filter(p=>p.length>15);
    // N개 구간으로 균등 분할(각 구간=연속된 문단 묶음). 문단이 부족할 때만 실제 문장 경계로 세분화한다.
    let units=paras.length?paras:[clean||title];
    if(units.length<n){
      const sentences=units.flatMap(p=>p.match(/[^.!?。！？]+[.!?。！？]?/g)?.map(s=>s.trim()).filter(Boolean)||[]);
      if(sentences.length>units.length) units=sentences;
    }
    const count=Math.min(n,units.length);
    const segments=Array.from({length:count},(_,i)=>{
      const start=Math.floor(units.length*i/count);
      const end=Math.floor(units.length*(i+1)/count);
      return units.slice(start,end).join(" ").slice(0,320);
    }).filter(Boolean);
    const segList=segments.map((s,i)=>`[${i+1}번 구간] ${s}`).join("\n");
    const ask=`너는 블로그 사진 디렉터야. 아래는 한 글을 순서대로 ${segments.length}구간으로 나눈 거야.
각 구간의 "그 문단이 실제로 말하는 장면"을 사진 1장으로 기획해줘. 반드시 해당 구간 내용과 딱 맞아야 해(다른 구간 내용/엉뚱한 소재 금지).
예: 구간이 '생선구이'면 생선구이 사진, '조개구이'면 조개구이 사진. 구간에 특정 음식/장소가 나오면 그걸 그려.

구간별로 아래 형식 정확히 ${segments.length}줄(순서대로, 다른 말 금지):
장면설명(한국어 10~20자) | 영문 이미지 프롬프트(사진 스타일, 그 구간의 구체적 장면·소재, 조명, 사실적, 글자/워터마크 없이)

글 제목: ${title}
${segList}`;
    const text=await callAI(ask);
    const prompts:string[]=[]; const captions:string[]=[];
    for(const line of text.split("\n")){
      const t=line.trim(); if(!t||!t.includes("|"))continue;
      const [cap,...rest]=t.replace(/^\d+[).\s]*/,"").split("|");
      const eng=rest.join("|").trim();
      if(eng.length<10)continue;
      let capClean=cap.trim().replace(/[*#\-]/g,"").replace(/^\[|\]$/g,"").replace(/^\d+번?\s*구간\]?\s*/,"").trim();
      // ★형식 안내문이 캡션에 새는 것 차단: "영문 이미지 프롬프트/장면설명/사진 스타일" 등 메타 문구,
      //   한글이 하나도 없는(=영문 프롬프트가 통째로 들어온) 경우는 캡션으로 안 씀 → 아래서 깨끗한 폴백 사용.
      if(/프롬프트|영문|prompt|워터마크|사진\s*스타일|장면\s*설명|한국어|구간/i.test(capClean)) capClean="";
      if(!/[가-힣]/.test(capClean)||capClean.length<2) capClean="";
      captions.push(capClean.slice(0,30));
      prompts.push(`${eng}, rich vibrant color palette, ultra realistic 8K photography, absolutely no text, no letters, no watermark, no logo`);
    }
    return { prompts, captions };
  }

  // ── Google Flow 이미지 생성 (봇 CDP 경유, 미리보기까지) ──
  //   append=true 면 기존 이미지에 "이어붙임"(1장 지운 자리 채우기 등), false 면 전체 새로 생성(교체)
  async function handleGenerateFlowImages(append:boolean=false, addCount?:number){
    // 1) Flow 준비 상태 확인 (디버깅 크롬 열려있나) — Electron 우선, 없으면 봇 API
    const checkReady=async():Promise<boolean>=>{
      try{
        if((window as any).electron?.flowStatus){ const s=await (window as any).electron.flowStatus(); return !!s.ready; }
        const r=await botFetch(`${BOT}/api/flow/status`,{signal:AbortSignal.timeout(3000)}); const j=await r.json(); return !!j.ready;
      }catch{ return false; }
    };
    let ready=await checkReady();
    // ★ 크롬이 안 떠 있으면 여기서 "자동으로" 띄운다(예전엔 안내만 하고 아무 창도 안 떠 혼란).
    if(!ready && (window as any).electron?.flowLaunchChrome){
      showToast("🚀 Flow 크롬을 여는 중... (처음이면 로그인 창이 떠요)","info");
      try{
        const lr=await (window as any).electron.flowLaunchChrome();
        if(lr?.ok){ setFlowReady(true); ready=true; }
        else showToast("❌ 크롬 열기 실패: "+(lr?.error||"Chrome이 설치돼 있는지 확인해주세요"),"error");
      }catch(e:any){ showToast("❌ 크롬 열기 오류: "+(e?.message||""),"error"); }
    }
    if(!ready){
      showToast("🎨 Flow 준비가 안 됐어요. 위의 '🚀 Flow 준비' 버튼을 먼저 눌러주세요.","error");
      return;
    }
    setGenImgLoading(true);setGenImgProgress(0);setGenImgCurrent(0);setImgGenFailed(false);
    // 2) 글 내용 기반 프롬프트 + 캡션 구성
    // ★버튼 숫자 = 만들 장수(n). 기존 이미지가 몇 장이든 상관없이 그 개수만큼만 만든다(더하기 계산 없음).
    //   이어붙이기면 addCount(1/2/3장), 처음 생성이면 설정 개수(ref=최신).
    const n=append&&addCount ? Math.max(1,Math.min(3,addCount)) : Math.max(1,flowImgCountRef.current);
    const content=genContent||"";
    let prompts:string[]=[];
    let caps:string[]=[];
    console.log(`[publy] Flow ${append?"이어서":"새로"} ${n}장 생성 (버튼 숫자=만들 장수, 기존 개수 무관)`);
    // 글 전체를 n등분해 서로 다른 구간의 프롬프트 n개 생성(장면이 안 섞여 괴물 방지). 실패 시 고정 템플릿 폴백.
    try{
      const sceneResult=await buildStoryPrompts(pubTitle||genTitle, content, n);
      if(sceneResult.prompts.length>=n){ prompts=sceneResult.prompts.slice(0,n).map(p=>withImageConcept(p,imageConcept)); caps=sceneResult.captions.slice(0,n); }
    }catch{}
    if(prompts.length<n){
      // 폴백: 구간별 고정 템플릿 — 글을 n등분
      const lines=content.split("\n").filter(l=>l.trim().length>5);
      const step=Math.max(1,Math.floor(lines.length/n));
      prompts=Array.from({length:n},(_,k)=>{
        const seg=lines.slice(k*step,(k+1)*step).join(" ").slice(0,150);
        return withImageConcept(buildFlowPrompt(keyword||genTitle,pubTitle||genTitle,seg,k),imageConcept);
      });
      caps=buildCaptions(keyword||genTitle,n,content).slice(0,n);
    }
    try{
      showToast(append?`🎨 이미지 ${n}장 이어서 생성 중... (글 뒷부분 이어받음)`:`🎨 새로 이미지 ${n}장 생성 중...`,"info");
      const postOnce=()=>botFetch(`${BOT}/api/flow-generate`,{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({prompts,captions:caps}),
        // Flow의 후보 렌더·다운로드·재시도 시간을 장수에 비례해 보장한다(8장 약 34분).
        signal:AbortSignal.timeout(n*240000+120000),
      });
      let r=await postOnce();
      let d=await r.json();
      // ★자동치유: 크롬이 좀비라 못 붙은 경우(CDP_CONNECT_FAIL) 크롬을 자동으로 다시 준비(좀비 정리+재실행)하고 1회 재시도
      if(!r.ok && d.code==="CDP_CONNECT_FAIL" && (window as any).electron?.flowLaunchChrome){
        showToast("🔧 Flow 크롬을 다시 준비하는 중...","info");
        try{ const lr=await (window as any).electron.flowLaunchChrome(); if(lr?.ok)setFlowReady(true); }catch{}
        r=await postOnce(); d=await r.json();
      }
      if(!r.ok){
        if(d.code==="FLOW_NOT_LOGGED_IN") showToast("크롬 창에서 Google Flow 로그인을 먼저 해주세요.","error");
        else if(d.code==="CDP_CONNECT_FAIL") showToast("Flow 크롬 준비에 실패했어요. 'Flow 준비'를 다시 눌러주세요.","error");
        else showToast("❌ Flow 생성 실패: "+(d.error||r.status),"error");
        setImgGenFailed(true);setGenImgLoading(false);return;
      }
      const imgs:string[]=(d.images||[]).map((x:any)=>x.src).filter(Boolean);
      if(imgs.length===0){ showToast("❌ 이미지가 생성되지 않았어요","error");setImgGenFailed(true);setGenImgLoading(false);return; }
      const newCaps=(d.images||[]).map((x:any,i:number)=>x.alt||caps[i]||`${keyword||genTitle} 사진 ${i+1}`);
      // ★ append면 기존 이미지 뒤에 이어붙이기(1장 지운 자리 채우기), 아니면 교체(전체 새로)
      const finalImgs = append ? [...generatedImages, ...imgs] : imgs;
      const finalCaps = append ? [...captions, ...newCaps] : newCaps;
      setGeneratedImages(finalImgs);
      setCaptions(finalCaps);
      if(!thumbnail)setThumbnail(finalImgs[0]);
      triggerAutoInsert(finalImgs.map((src,i)=>({id:i,src,alt:finalCaps[i]||`${keyword||genTitle} 사진`})));
      setShowMeta(true);
      showToast(append?`✅ 이미지 ${imgs.length}장 이어서 생성 완료!`:`✅ Flow 이미지 ${imgs.length}장 생성 완료! (바탕화면에도 백업됨)`,"success");
      if(append)setImageCountPopup({kind:"append",count:imgs.length});
    }catch(e:any){
      if(e.name!=="AbortError"){ showToast("❌ Flow 생성 실패: "+e.message,"error");setImgGenFailed(true); }
    }finally{ setGenImgLoading(false); }
  }

  async function handleGenerateImages(){
    if(!keyword&&!genTitle){alert("먼저 글을 생성해주세요");return;}
    // ── Flow 이미지 생성 (Google Flow, CDP 방식) ──
    if(imgGenType==="flow"){ await handleGenerateFlowImages(); return; }
    // 이미지 AI 키 사전 체크 — 없으면 조용히 실패하지 않고 명확히 안내
    const imageAi=localStorage.getItem("publy_image_ai")||"openai_img";
    if(imageAi==="replicate"&&!localStorage.getItem("publy_replicate_key")){
      showToast("⚠️ Replicate 키가 없어요. 설정 탭에서 Replicate API 키를 입력하거나, 'Flow 이미지(무료)' 또는 '내 이미지 업로드'를 선택하세요.","error");
      return;
    }
    if(imageAi==="openai_img"&&!localStorage.getItem("publy_openai_key")){
      showToast("⚠️ OpenAI 키가 없어요. 설정 탭에서 키를 입력하거나, 'Flow 이미지(무료)' 또는 '내 이미지 업로드'를 선택하세요.","error");
      return;
    }
    setGenImgLoading(true);setGenImgProgress(0);setGenImgCurrent(0);
    imgAbortRef.current=new AbortController();const imgs:string[]=[];

    // 글 내용을 이미지 수만큼 등분
    const content = genContent || "";
    const segments: string[] = [];
    if (content.length > 0 && imgCount > 1) {
      const lines = content.split("\n").filter(l => l.trim().length > 5);
      const step = Math.max(1, Math.floor(lines.length / imgCount));
      for (let i = 0; i < imgCount; i++) {
        const start = i * step;
        const seg = lines.slice(start, start + step).join(" ").slice(0, 150);
        segments.push(seg);
      }
    }

    const firstPrompt=buildImgPrompt(keyword||genTitle,genTitle,0,segments[0]);
    setCurrentImgPrompt(firstPrompt);
    try{
      for(let i=0;i<imgCount;i++){
        if(imgAbortRef.current.signal.aborted)break;
        setGenImgCurrent(i+1);
          const url=await generateOneImage(keyword||genTitle,imgAbortRef.current.signal,i,segments[i],imageConcept);
        imgs.push(url);setGeneratedImages([...imgs]);setGenImgProgress(Math.round(((i+1)/imgCount)*100));
      }
      // 이미지 생성 완료 시 캡션 자동생성 + 블록 자동배치 + 썸네일 자동지정
      setCaptions(buildCaptions(keyword||genTitle, imgs.length, genContent));
      if(imgs.length>0){
        const captionList = buildCaptions(keyword||genTitle, imgs.length, genContent);
        if(!thumbnail)setThumbnail(imgs[0]);
        triggerAutoInsert(imgs.map((src,i)=>({id:i,src,alt:captionList[i]||`${keyword||genTitle} ${i===0?"대표":"현장"} 사진`})));
        setShowMeta(true);
      }
    }catch(e:any){if(e.name!=="AbortError"){showToast("❌ 이미지 생성 실패: "+e.message,"error");setImgGenFailed(true);}}
    finally{setGenImgLoading(false);imgAbortRef.current=null;}
  }

  function stopImageGen(){imgAbortRef.current?.abort();setGenImgLoading(false);}

  function handleImageUpload(e:React.ChangeEvent<HTMLInputElement>){
    const files=e.target.files;if(!files)return;
    Array.from(files).forEach(async file=>{
      if(!file.type.startsWith("image/"))return;
      const src=await resizeImage(file); // 업로드 이미지도 리사이즈(발행 속도)
      setUploadedImages(prev=>[...prev,src]);
    });
  }

  function getActiveImages():string[]{return imgSource==="upload"?uploadedImages:generatedImages;}

  // 발행 가능 여부 — state가 비어도 draft에 글/제목 있으면 발행 가능(탭 이동 대응)
  function hasPublishableContent():boolean{
    if(pubTitle && (genContent || blocks.some(b=>b.type==="text"&&(b as TextBlock).content.trim()))) return true;
    try{ const d=JSON.parse(localStorage.getItem("publy_draft")||"{}"); return !!(d.title && d.content); }catch{ return false; }
  }
  function buildPublishContent():string{ return buildPublishContentWith(genContent); }
  function buildPublishContentWith(gc:string):string{
    if(!gc)return "";
    // pubScope 필터 먼저 적용 (블록보다 우선)
    if(pubScope==="body"){
      let t=gc;
      t=t.replace(/\[FAQ시작\][\s\S]*?\[FAQ끝\]/g,"").replace(/\[참고자료시작\][\s\S]*?\[참고자료끝\]/g,"").replace(/\[관련글시작\][\s\S]*?\[관련글끝\]/g,"").trim();
      return t;
    }
    if(pubScope==="faq"){
      let t=gc;
      t=t.replace(/\[참고자료시작\][\s\S]*?\[참고자료끝\]/g,"").replace(/\[관련글시작\][\s\S]*?\[관련글끝\]/g,"").trim();
      return t;
    }
    // full: 블록에 텍스트 있으면 블록 HTML, 없으면 gc 그대로
    if(blocks.some(b=>b.type==="text"&&(b as TextBlock).content.trim()))return buildHtmlContent();
    return gc;
  }

  async function handlePublish(){
    // ★ 탭 이동/계정 변경으로 state가 비어도 발행되게 — draft(localStorage)에서 자동 복원.
    //   준비만 됐으면(제목·본문 어딘가에 존재) 몇 번을 오가든 무조건 발행 가능하게.
    let effTitle = pubTitle || genTitle;
    let effGenContent = genContent;
    if(!effTitle || !effGenContent){
      try{
        const d = JSON.parse(localStorage.getItem("publy_draft")||"{}");
        if(!effTitle && d.title) effTitle = d.title;
        if(!effGenContent && d.content) effGenContent = d.content;
      }catch{}
    }
    // 복원된 값을 state에도 반영(다음 렌더/블록 계산 일관성)
    if(effTitle && effTitle!==pubTitle) setPubTitle(effTitle);
    if(effGenContent && effGenContent!==genContent) setGenContent(effGenContent);

    if(!pubAccId){alert("발행할 계정을 선택해주세요 (계정 관리에서 연결)");return;}
    if(!effTitle){alert("제목이 없어요. 글 생성 또는 키워드/제목에서 제목을 만들어주세요");return;}
    // content 계산 (state 대신 복원값 기준)
    const content = buildPublishContentWith(effGenContent);
    if(!content){alert("발행할 본문이 없어요. 글 생성 탭에서 글을 만들어주세요");return;}
    if(scheduleOn&&!scheduleTime){alert("예약 날짜와 시간을 선택해주세요");return;}
    const normalizedScheduleTime=scheduleOn?kstScheduleIso(scheduleTime):undefined;
    if(scheduleOn&&(!normalizedScheduleTime||Date.parse(normalizedScheduleTime)<=Date.now())){alert("예약 시간은 현재 한국시간보다 이후로 선택해주세요");return;}
    setPublishing(true);showToast(scheduleOn?"예약 설정 중...":"발행 중...","info");
    const tags=hashtags.map(t=>t.replace("#","")).filter(Boolean);
    // ── blocks 이미지 보정: 선택된 이미지(업로드/AI)가 blocks에 안 들어가 있으면 자동 배치 ──
    //    (직접 업로드는 triggerAutoInsert를 안 거쳐 blocks에 이미지가 없던 문제 방지)
    const activeImgs=getActiveImages();
    const blocksHaveImg=blocks.some(b=>b.type==="image"||b.type==="image-pair");
    let effectiveBlocks=blocks;
    if(imgSource!=="none" && activeImgs.length>0 && !blocksHaveImg){
      triggerAutoInsert(activeImgs.map((src,i)=>({id:i,src,alt:captions[i]||`${keyword||genTitle||pubTitle} ${i===0?"대표":"사진"} ${i+1}`})));
      // triggerAutoInsert는 setBlocks(비동기)라 이번 발행엔 로컬로 즉시 구성
      const imgBlocks=activeImgs.map((src,i)=>({type:"image" as const,id:uid(),src,alt:captions[i]||`${keyword||genTitle||pubTitle} 사진 ${i+1}`,position:"center" as const,source:(imgSource==="upload"?"manual":"auto") as any}));
      const textBlocks=blocks.filter(b=>b.type==="text");
      effectiveBlocks=textBlocks.length>0?[imgBlocks[0],...interleave(textBlocks,imgBlocks.slice(1))]:[...imgBlocks];
      if(!thumbnail && activeImgs[0]) setThumbnail(activeImgs[0]);
    }
    // ★썸네일(첫 이미지)은 "어떤 상황에도" 캡션을 넣지 않는다(테리 2026-08-21). 썸네일 캡션칸이 열려 있으면
    //   그 칸으로 글쓴이 인사말·제휴 광고고지 같은 본문 텍스트가 빨려 들어가 본문에서 유실된다(온파트너 안 넣었을 때 재현).
    //   온파트너 유무와 무관하게 항상 첫 이미지 alt를 비운다(naver.ts는 alt="" 이미지는 클릭/캡션을 생략함).
    {
      const thumbIdx=effectiveBlocks.findIndex(b=>b.type==="image");
      if(thumbIdx>=0) effectiveBlocks[thumbIdx]={...(effectiveBlocks[thumbIdx] as SingleImageBlock),alt:""} as ContentBlock;
    }
    // ── 온파트너 링크: URL만 본문에 분산 삽입 → 네이버가 정사각 링크 카드로 렌더(상품당 1개, Q&A·해시태그 위) ──
    // ★안전장치: 조회만 하고 저장(💾) 안 한 상품(onPartnerPreview)도 발행에 포함.
    const partnerForPublish:OnPartnerItem[] = onPartnerItems.length>0 ? onPartnerItems : (onPartnerPreview?[onPartnerPreview]:[]);
    console.log("[publy] 온파트너 링크 대상:", partnerForPublish.length, "개", partnerForPublish.map(it=>it.product.name));
    if(partnerForPublish.length>0){
      const items=partnerForPublish.filter(it=>it.product.available&&it.product.partnerUrl);
      // (썸네일 첫 이미지 캡션 비우기는 위에서 온파트너 유무와 무관하게 항상 처리함)
      // ★고지 문단을 "썸네일 바로 다음"(본문 맨 앞)에 무조건 1회. 이미 있으면 중복 안 넣음.
      const DISCLOSURE="※ 이 글에는 제휴 링크가 포함되어 있으며, 구매 시 작성자에게 일정 수수료가 발생할 수 있습니다.";
      const hasDisclosure=effectiveBlocks.some(b=>b.type==="text"&&(b as TextBlock).content.includes("제휴 링크가 포함"));
      if(!hasDisclosure){
        effectiveBlocks=[{type:"text",id:uid(),content:DISCLOSURE} as ContentBlock,...effectiveBlocks];
      }
      // 광고 금지 경계: FAQ/Q&A/관련글/해시태그 섹션 시작 텍스트 블록 — 광고는 이 위에만.
      const isBoundary=(b:ContentBlock)=>b.type==="text"&&/\[FAQ시작\]|\[관련글시작\]|질문\s*답변|Q\s*&\s*A|큐앤에이|해시태그|자주\s*묻는/i.test((b as TextBlock).content);
      let boundaryIdx=effectiveBlocks.findIndex(isBoundary);
      if(boundaryIdx<0)boundaryIdx=effectiveBlocks.length;
      // ★링크는 "이미지 블록 바로 뒤"에 붙인다(테리 요청 2026-08-21): 이미지 → 링크 카드가 딱 붙어,
      //   이미지와 링크 사이에 본문 글이 끼지 않게. 썸네일(첫 이미지, index 0)은 제외(제휴문구 자리라 충돌 방지).
      //   이미지가 없으면 기존처럼 본문 텍스트 블록 뒤로 폴백.
      const imgIdxs:number[]=[];
      for(let i=1;i<boundaryIdx;i++){const t=effectiveBlocks[i].type;if(t==="image"||t==="image-pair")imgIdxs.push(i);}
      const textIdxs:number[]=[];
      for(let i=0;i<boundaryIdx;i++){const b=effectiveBlocks[i];if(b.type==="text"&&(b as TextBlock).content.trim().length>=40)textIdxs.push(i);}
      if(textIdxs.length===0)for(let i=0;i<boundaryIdx;i++)if(effectiveBlocks[i].type==="text")textIdxs.push(i);
      const anchorIdxs = imgIdxs.length>0 ? imgIdxs : textIdxs;   // 우선 이미지 뒤, 없으면 텍스트 뒤
      if(anchorIdxs.length>0){
        const ratios = items.length===1?[0.6]:items.length===2?[0.45,0.72]:[0.35,0.58,0.8];
        const used=new Set<number>();
        const insertAfter=items.map((_,i)=>{
          let ai=Math.round(anchorIdxs.length*ratios[i])-1;
          ai=Math.max(0, Math.min(anchorIdxs.length-1, ai));
          while(used.has(anchorIdxs[ai])&&ai<anchorIdxs.length-1)ai++;   // 여러 링크가 같은 이미지에 몰리지 않게
          used.add(anchorIdxs[ai]);
          return anchorIdxs[ai];
        });
        const withLink:ContentBlock[]=[];
        effectiveBlocks.forEach((b,i)=>{
          withLink.push(b);
          items.forEach((it,k)=>{
            if(insertAfter[k]===i){
              // URL만 자체 문단으로 → 네이버가 정사각 링크 카드 자동 생성. 앞에 짧은 안내 한 줄.
              withLink.push({type:"text",id:uid(),content:`👇 '${it.product.name}' 지금 바로 확인하기\n${it.product.partnerUrl}`} as ContentBlock);
            }
          });
        });
        effectiveBlocks=withLink;
      }
    }
    // ── 내 링크(일반 사이트): 온파트너와 별도로, "이미지 바로 뒤(사이 글 없이)"에 URL만 삽입 → 네이버 OG 카드 ──
    //    ★온파트너와 안 엉키게: 이미 링크가 바로 뒤에 붙은 이미지는 앵커에서 제외한다.
    if(myLinks.length>0){
      const isBoundary2=(b:ContentBlock)=>b.type==="text"&&/\[FAQ시작\]|\[관련글시작\]|질문\s*답변|Q\s*&\s*A|큐앤에이|해시태그|자주\s*묻는/i.test((b as TextBlock).content);
      let bIdx=effectiveBlocks.findIndex(isBoundary2); if(bIdx<0)bIdx=effectiveBlocks.length;
      const isLinkBlock=(b?:ContentBlock)=>!!b&&b.type==="text"&&/https?:\/\//.test((b as TextBlock).content);
      // 앵커=경계 전 이미지 블록 중, 바로 뒤가 이미 링크가 아닌 것(온파트너 링크 붙은 이미지 제외). 썸네일(0) 제외.
      const anchors:number[]=[];
      for(let i=1;i<bIdx;i++){const t=effectiveBlocks[i].type;if((t==="image"||t==="image-pair")&&!isLinkBlock(effectiveBlocks[i+1]))anchors.push(i);}
      // 이미지 앵커가 없으면 본문 텍스트 블록 뒤로 폴백
      if(anchors.length===0)for(let i=0;i<bIdx;i++){const b=effectiveBlocks[i];if(b.type==="text"&&(b as TextBlock).content.trim().length>=40&&!/https?:\/\//.test((b as TextBlock).content))anchors.push(i);}
      if(anchors.length>0){
        const ratios = myLinks.length===1?[0.7]:myLinks.length===2?[0.5,0.8]:[0.4,0.62,0.85];
        const used=new Set<number>();
        const insAfter=myLinks.map((_,i)=>{
          let ai=Math.round(anchors.length*ratios[i])-1; ai=Math.max(0,Math.min(anchors.length-1,ai));
          while(used.has(anchors[ai])&&ai<anchors.length-1)ai++;
          used.add(anchors[ai]); return anchors[ai];
        });
        const withMy:ContentBlock[]=[];
        effectiveBlocks.forEach((b,i)=>{
          withMy.push(b);
          myLinks.forEach((url,k)=>{ if(insAfter[k]===i) withMy.push({type:"text",id:uid(),content:url} as ContentBlock); });  // URL만 → OG 카드
        });
        effectiveBlocks=withMy;
      }
    }
    // ── 온종일팜 자동 링크(테리 2026-08-21): 제목/키워드에 "온종일팜"이 나오면 소개 랜딩(app.yuanfnb.com/landing)을 ──
    //    OG 링크 카드로 자동 삽입한다. 내 링크와 동일 방식(이미지 바로 뒤에 URL만 → 네이버 OG 썸네일 카드).
    //    온파트너·내 링크가 이미 붙은 이미지는 앵커에서 제외해 서로 안 엉키게. 이미 같은 URL이 있으면 중복 안 넣음.
    {
      const farmUrl=PUBLY_SERVICE_INFO.farm.url;   // https://app.yuanfnb.com/landing
      const farmHay=`${effTitle} ${keyword}`;
      const farmMatched=!!farmUrl && (farmHay.includes(PUBLY_SERVICE_INFO.farm.name)||(PUBLY_SERVICE_INFO.farm.aliases||[]).some(a=>farmHay.includes(a)));
      const farmAlready=!!farmUrl && effectiveBlocks.some(b=>b.type==="text"&&(b as TextBlock).content.includes(farmUrl));
      if(farmMatched && farmUrl && !farmAlready){
        const isBoundaryF=(b:ContentBlock)=>b.type==="text"&&/\[FAQ시작\]|\[관련글시작\]|질문\s*답변|Q\s*&\s*A|큐앤에이|해시태그|자주\s*묻는/i.test((b as TextBlock).content);
        let fIdx=effectiveBlocks.findIndex(isBoundaryF); if(fIdx<0)fIdx=effectiveBlocks.length;
        const isLinkBlockF=(b?:ContentBlock)=>!!b&&b.type==="text"&&/https?:\/\//.test((b as TextBlock).content);
        const ancF:number[]=[];
        for(let i=1;i<fIdx;i++){const t=effectiveBlocks[i].type;if((t==="image"||t==="image-pair")&&!isLinkBlockF(effectiveBlocks[i+1]))ancF.push(i);}
        if(ancF.length===0)for(let i=0;i<fIdx;i++){const b=effectiveBlocks[i];if(b.type==="text"&&(b as TextBlock).content.trim().length>=40&&!/https?:\/\//.test((b as TextBlock).content))ancF.push(i);}
        if(ancF.length>0){
          const at=ancF[Math.min(ancF.length-1, Math.round(ancF.length*0.66))];   // 본문 후반부 이미지/문단 뒤
          const withFarm:ContentBlock[]=[];
          effectiveBlocks.forEach((b,i)=>{ withFarm.push(b); if(i===at) withFarm.push({type:"text",id:uid(),content:farmUrl} as ContentBlock); });
          effectiveBlocks=withFarm;
        }
      }
    }
    // ── 글쓴이 인사말: "제휴문구 바로 다음 / 제휴문구 없으면 썸네일(첫 이미지) 다음"에 1회 삽입 (테리 요청 2026-08-21) ──
    //    순서 = 썸네일 → (있으면)제휴문구 → 인사말 → 본문. 인사말이 비어있으면 안 넣는다.
    //    blocks 기반 발행이라 여기서 명시적으로 넣어야 유실 안 됨(기존엔 buildNaverText에만 있어 발행에서 누락됐음).
    if(greeting.trim()){
      const g=greeting.trim();
      const already=effectiveBlocks.some(b=>b.type==="text"&&(b as TextBlock).content.trim()===g);
      if(!already){
        const gBlock={type:"text",id:uid(),content:g} as ContentBlock;
        const discIdx=effectiveBlocks.findIndex(b=>b.type==="text"&&(b as TextBlock).content.includes("제휴 링크가 포함"));
        const firstImgIdx=effectiveBlocks.findIndex(b=>b.type==="image"||b.type==="image-pair");
        const at = discIdx>=0 ? discIdx+1 : (firstImgIdx>=0 ? firstImgIdx+1 : 0);   // 제휴문구 뒤 > 썸네일 뒤 > 맨 앞
        effectiveBlocks=[...effectiveBlocks.slice(0,at),gBlock,...effectiveBlocks.slice(at)];
      }
    }
    const publishBody={
      userId:user.id,platform,title:effTitle,content,
      naverId:platform==="naver"?(connAccs.find(a=>a.id===pubAccId)?.username||undefined):undefined,
      pubScope,
      tags,
      imageUrl:thumbnail||activeImgs[0]||undefined,
      categoryId:category||undefined,
      visibility,
      scheduleTime:normalizedScheduleTime,
      videoUrl:(videoOn&&videoUrl.trim())?videoUrl.trim():undefined,
      videoPosition,
      blocks:effectiveBlocks.map(b=>{
        if(b.type==="text")return{type:"text",content:(b as TextBlock).content};
        if(b.type==="image")return{type:"image",src:(b as SingleImageBlock).src,alt:(b as SingleImageBlock).alt||"",link:(b as any).link||undefined};
        if(b.type==="image-pair")return{type:"image-pair",images:(b as ImagePairBlock).images};
        return null;
      }).filter(Boolean),
      // Flow 이미지 설정
      useFlow: imgGenType === "flow" && generatedImages.length === 0,
      flowImgCount: imgGenType === "flow" && generatedImages.length === 0 ? flowImgCountRef.current : undefined,
      flowPrompts: imgGenType === "flow" && generatedImages.length === 0 ? (() => {
        const c = genContent || "";
        const lines = c.split("\n").filter((l:string) => l.trim().length > 5);
        const step = Math.max(1, Math.floor(lines.length / flowImgCount));
        return Array.from({length: flowImgCount}, (_, i) => {
          const seg = lines.slice(i * step, (i + 1) * step).join(" ").slice(0, 150);
          return withImageConcept(buildFlowPrompt(keyword||genTitle, pubTitle, seg, i),imageConcept);
        });
      })() : undefined,
      flowCaptions: imgGenType === "flow" && generatedImages.length === 0
        ? buildCaptions(keyword||genTitle, flowImgCount, genContent)
        : undefined,
    };
    try{
      // 하루 발행 한도 체크
      const dailyCheck = await checkDailyPublishQuota(user.id, user.plan);
      if (!dailyCheck.ok) {
        showToast(`❌ 오늘 발행 한도(${dailyCheck.limit}개) 초과! 내일 다시 가능해요`, "error");
        setPublishing(false); return;
      }
      // 봇 오프라인일 때만 큐(publy_jobs)에 저장 → 앱 켜지면 처리. (예약이든 아니든)
      //   ★ 예약발행(scheduleOn)은 봇 온라인이면 아래 else로 가서 "지금 즉시 네이버에 글·이미지 작성 후
      //     네이버 예약발행 UI에 시간을 넣어" 확정한다(PC 꺼도 네이버가 그 시간에 발행). scheduleTime을 payload로 넘김.
      if(!botOnline){
        const jobRow:any={user_id:user.id,platform,title:effTitle,content,
          tags,image_url:publishBody.imageUrl,
          category_id:category||undefined,visibility,
          schedule_time:normalizedScheduleTime,status:"pending",
          payload:publishBody};
        let {error:jobErr}=await supabase.from("publy_jobs").insert(jobRow);
        if(jobErr && /payload|column|schema|does not exist/i.test(jobErr.message)){
          const {payload,...noPayload}=jobRow;
          const retry=await supabase.from("publy_jobs").insert(noPayload); jobErr=retry.error;
        }
        if(jobErr) throw new Error("예약 저장 실패: "+jobErr.message);
        setPubMsg("✅ PC 봇에 예약됐어요! Publy 앱 실행 시 자동 발행돼요.");
        showToast("✅ PC 봇에 예약됐어요! Publy 앱 실행 시 자동 발행돼요.");
        await addHistory({user_id:user.id,platform,title:effTitle,status:"pending" as "success"|"fail"});
      }else{
        // PC 봇이 오프라인인 작업은 봇이 실제 처리할 때 한 번만 차감한다.
        const ok=await useQuota(user.id);if(!ok){showToast("❌ 발행 건수 초과","error");setPublishing(false);return;}
        let r: Response;
        try {
          r=await botFetch(`${BOT}/api/publish-full`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(publishBody)});
        } catch (error) {
          await refundQuota(user.id);
          throw error;
        }
        const d=await r.json();
        if(r.status===401){await refundQuota(user.id);showToast("❌ 세션 만료 — 계정 관리 탭에서 재연결해주세요","error");setPublishing(false);return;}
        if(!r.ok){await refundQuota(user.id);throw new Error(d.error);}
        await addHistory({user_id:user.id,platform,title:effTitle,post_url:d.postUrl,status:"success",
          content:{title:effTitle,content,pubScope,tags,imageUrl:thumbnail||getActiveImages()[0]||undefined,categoryId:category||undefined,visibility,blocks:publishBody.blocks,platform}})
          .catch(async()=>{ await addHistory({user_id:user.id,platform,title:effTitle,post_url:d.postUrl,status:"success"}).catch(()=>{}); });
        await incrementDailyPublish(user.id);
        setDailyPublishUsed(p => p + 1);
        setPubMsg(scheduleOn?"✅ 예약 완료! 설정한 시간에 자동 발행돼요.":"✅ 발행 완료!");
        showToast(scheduleOn?"⏰ 예약 완료!":"✅ 발행 완료! 🎉");
        if(d.warning) setTimeout(()=>showToast("⚠️ "+d.warning,"error"),1500);
      }
      void loadHistory();getQuota(user.id).then((q:PublyQuota|null)=>q&&setQuota(q));
    }catch(e:any){await addHistory({user_id:user.id,platform,title:effTitle,status:"fail",error_message:e.message});setPubMsg("❌ "+e.message+" (오류가 관리자에게 자동 전달됩니다)");showToast("❌ "+e.message,"error");logError({user_id:user.id,user_name:(user as any).name||"",user_email:user.email||"",feature:"블로그 발행 ("+platform+")",error_message:e.message}).catch(()=>{});}
    finally{setPublishing(false);}
  }

  // ── 발행 패널 렌더 함수 ──
  // 발행 탭: 작성한 글 + 생성한 이미지 전부 초기화(설정·계정은 유지)
  function resetDraft(){
    if(!confirm("작성한 글과 생성한 이미지를 모두 지우고 처음부터 시작할까요?"))return;
    setGenContent(""); setGenTitle(""); setPubTitle(""); setGenTags("");
    setBlocks([{type:"text",id:uid(),content:""}]);
    setGeneratedImages([]); setCaptions([]); setThumbnail("");
    try{ localStorage.removeItem("publy_draft"); }catch{}
    setDraftAvailable(false); setDraftData(null);
    showToast("🧹 글과 이미지를 초기화했어요");
  }

  function renderPublishPanel(){
    return(<div style={{display:"flex",flexDirection:"column",gap:12}}>
      {/* 초기화 */}
      <div style={{display:"flex",justifyContent:"flex-end"}}>
        <button onClick={resetDraft} style={{display:"inline-flex",alignItems:"center",gap:6,padding:"8px 14px",borderRadius:9,border:"1px solid var(--border)",background:"var(--bg2)",color:"var(--text2)",cursor:"pointer",fontSize:12.5,fontWeight:700,fontFamily:"inherit",transition:"all .15s"}}>🧹 글·이미지 초기화</button>
      </div>
      {/* 플랫폼 */}
      <div className="card" style={{padding:"14px 16px"}}>
        <div className="card-title" style={{marginBottom:10}}>🌐 플랫폼</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
          {([{p:"naver",ico:"🟢",name:"네이버",c:"var(--naver)"},{p:"tistory",ico:"🟠",name:"티스토리",c:"var(--tistory)"}] as const).map(({p,ico,name,c})=>(
            <button key={p} onClick={()=>{setPlatform(p);if(pubAccId)loadCategories(p);}} style={{padding:"12px 10px",borderRadius:10,border:`2px solid ${platform===p?c:"var(--border)"}`,background:platform===p?`${c}18`:"var(--bg)",cursor:"pointer",fontFamily:"inherit",display:"flex",alignItems:"center",justifyContent:"center",gap:6,transition:"all .15s",whiteSpace:"nowrap",overflow:"hidden"}}>
              <span style={{fontSize:18,flexShrink:0}}>{ico}</span>
              <span style={{fontSize:13,fontWeight:700,color:"var(--text)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{name}</span>
              {platform===p&&<span style={{color:c,fontSize:12,flexShrink:0}}>✓</span>}
            </button>
          ))}
        </div>
      </div>

      {/* 계정 */}
      <div className="card" style={{padding:"14px 16px"}}>
        <div className="card-title" style={{marginBottom:10}}>🔗 발행 계정</div>
        {connAccs.length===0?(
          <div style={{textAlign:"center",padding:"16px"}}>
            <div style={{fontSize:13,color:"var(--text3)",marginBottom:10}}>연결된 계정이 없어요</div>
            <button className="btn btn-primary btn-sm" onClick={()=>setTab("accounts")}>계정 관리 →</button>
          </div>
        ):connAccs.map(a=>(
          <label key={a.id} onClick={()=>{setPubAccId(a.id);loadCategories(platform);}} style={{display:"flex",alignItems:"center",gap:10,padding:"12px 14px",borderRadius:10,cursor:"pointer",marginBottom:6,background:pubAccId===a.id?"var(--accent-bg)":"var(--bg)",border:`2px solid ${pubAccId===a.id?"var(--accent)":"var(--border)"}`,transition:"all .15s"}}>
            <input type="radio" name="pacc" checked={pubAccId===a.id} onChange={()=>{}} style={{accentColor:"var(--accent)",width:16,height:16,flexShrink:0}}/>
            <div style={{flex:1}}><div style={{fontSize:14,fontWeight:700,color:"var(--text)"}}>{a.username}</div>{a.blog_name&&<div style={{fontSize:11,color:"var(--text3)"}}>{a.blog_name}</div>}</div>
            {pubAccId===a.id&&<span style={{fontSize:11,fontWeight:700,padding:"2px 8px",borderRadius:99,background:"var(--accent-bg)",color:"var(--accent-text)",border:"1px solid var(--accent-border)"}}>✅</span>}
          </label>
        ))}
      </div>

      {/* 카테고리 */}
      {pubAccId&&(
        <div className="card" style={{padding:"14px 16px"}}>
          <div className="card-title" style={{marginBottom:10}}>📂 카테고리</div>
          {loadingCats?(
            <div style={{display:"flex",alignItems:"center",gap:8,padding:"8px",color:"var(--text3)",fontSize:13}}><span className="spinner" style={{width:16,height:16}}/>불러오는 중...</div>
          ):(()=>{
            const cats = categories.length>0 ? categories : (accCats[pubAccId]||[]).map((c,i)=>({id:String(i),name:c}));
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

      {/* 공개 설정 */}
      <div className="card" style={{padding:"14px 16px"}}>
        <div className="card-title" style={{marginBottom:10}}>👁️ 공개 설정</div>
        <div style={{display:"flex",flexDirection:"column",gap:8}}>
          {(platform==="naver"?[{v:"public",ico:"🌍",label:"전체 공개"},{v:"neighbor",ico:"👥",label:"이웃 공개"},{v:"private",ico:"🔒",label:"비공개"}]:[{v:"public",ico:"🌍",label:"전체 공개"},{v:"private",ico:"🔒",label:"비공개"}] as {v:string,ico:string,label:string}[]).map(opt=>(
            <button key={opt.v} onClick={()=>setVisibility(opt.v as "public"|"neighbor"|"private")} style={{padding:"11px 14px",borderRadius:10,border:`2px solid ${visibility===opt.v?"var(--accent)":"var(--border)"}`,background:visibility===opt.v?"var(--accent-bg)":"var(--bg)",cursor:"pointer",fontFamily:"inherit",textAlign:"left",transition:"all .15s",display:"flex",alignItems:"center",gap:10}}>
              <span style={{fontSize:20}}>{opt.ico}</span>
              <span style={{fontSize:13,fontWeight:600,color:visibility===opt.v?"var(--accent-text)":"var(--text)"}}>{opt.label}</span>
              {visibility===opt.v&&<span style={{marginLeft:"auto",color:"var(--accent-text)"}}>✓</span>}
            </button>
          ))}
        </div>
      </div>

      {/* 예약 발행 */}
      <div className="card" style={{padding:"14px 16px"}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:scheduleOn?12:0}}>
          <div>
            <div className="card-title" style={{margin:0}}>⏰ 예약 발행</div>
            <div style={{fontSize:11,color:"var(--text3)",marginTop:2}}>설정 시간에 자동 발행</div>
          </div>
          <button onClick={()=>{setScheduleOn(v=>!v);if(!scheduleTime){const d=new Date(Date.now()+60*60*1000);d.setUTCMinutes(0,0,0);setScheduleTime(formatKstDateTime(d));}}} style={{width:48,height:26,borderRadius:99,background:scheduleOn?"var(--accent)":"var(--border)",border:"none",cursor:"pointer",position:"relative",transition:"background .2s",flexShrink:0}}>
            <div style={{position:"absolute",top:3,left:scheduleOn?24:3,width:20,height:20,borderRadius:"50%",background:"#fff",transition:"left .2s",boxShadow:"0 1px 4px rgba(0,0,0,.3)"}}/>
          </button>
        </div>
        {scheduleOn&&(
          <div>
            <div style={{fontSize:12,color:"var(--text2)",marginBottom:8}}>🇰🇷 현재 한국시간 {kstNow.replace("T"," ")}</div>
            <input type="datetime-local" value={scheduleTime} onChange={e=>setScheduleTime(e.target.value)} min={formatKstDateTime()} style={{width:"100%",padding:"10px 12px",borderRadius:10,border:"2px solid var(--border)",background:"var(--bg)",color:"var(--text)",fontSize:14,fontFamily:"inherit",outline:"none",boxSizing:"border-box"}}/>
            {scheduleTime&&<div style={{marginTop:8,padding:"10px 12px",borderRadius:10,background:"var(--accent-bg)",border:"1px solid var(--accent-border)",fontSize:12,color:"var(--accent-text)",fontWeight:600}}>
              ✅ {new Date(scheduleTime).toLocaleDateString("ko-KR",{month:"long",day:"numeric",weekday:"short"})} {new Date(scheduleTime).toLocaleTimeString("ko-KR",{hour:"2-digit",minute:"2-digit"})} 발행
            </div>}
          </div>
        )}
      </div>

      {/* 발행 버튼 */}
      <button onClick={handlePublish} disabled={publishing||!pubAccId||!hasPublishableContent()||(quota!==null&&(quota.remaining_quota||0)<=0)||(scheduleOn&&!scheduleTime)} className="btn btn-primary btn-full btn-xl pub-submit-btn">
        {publishing
          ?<><span className="spinner"/>{scheduleOn?"예약 중...":"발행 중..."}</>
          :scheduleOn?<>⏰ 예약 발행 설정하기</>:<>🚀 블로그 자동 발행</>
        }
      </button>
    </div>);
  }

  function saveAccCat(accId:string, cats:string[]){
    const next={...accCats,[accId]:cats};
    setAccCats(next);
    localStorage.setItem("publy_acc_cats",JSON.stringify(next));
  }
  function addCatToAcc(accId:string){
    const val=catInput.trim();if(!val)return;
    const cur=accCats[accId]||[];
    if(cur.includes(val))return;
    saveAccCat(accId,[...cur,val]);
    setCatInput("");
  }
  function removeCatFromAcc(accId:string, cat:string){
    saveAccCat(accId,(accCats[accId]||[]).filter(c=>c!==cat));
  }

  async function handleAddAccount(){
    if(!newUser||!newPw)return;
    // 계정 수 제한 체크
    const config = PLAN_CONFIG[user.plan] ?? PLAN_CONFIG.free;
    const currentCount = accounts.filter(a => a.platform !== "google").length;
    if (currentCount >= config.maxAccounts) {
      alert(`${config.label} 플랜은 최대 ${config.maxAccounts}개 계정까지 등록 가능합니다`);
      return;
    }
    setAddingAcc(true);
    try{
      if(!botOnline)throw new Error("PC에서 Publy 앱을 먼저 실행해주세요");
      const r=await botFetch(`${BOT}/api/${newPlat}/save-session`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({userId:user.id,id:newUser,pw:newPw,blogName:newBlog||undefined}),signal:AbortSignal.timeout(120000)});
      const d=await r.json();if(!d.success)throw new Error(d.error||"연결 실패");
      // 같은 계정(플랫폼+아이디)이 이미 있으면 새로 만들지 말고 그 행을 갱신 → 중복 생성 방지
      const existingAcc=accounts.find(a=>a.platform===newPlat&&a.username===newUser);
      await upsertAccount({...(existingAcc?{id:existingAcc.id}:{}),user_id:user.id,platform:newPlat,username:newUser,blog_name:newBlog||undefined,is_connected:true,connected_at:new Date().toISOString()});
      await getAccounts(user.id).then(setAccounts);setNewUser("");setNewPw("");setNewBlog("");
    }
    catch(e:any){alert(e.message);}finally{setAddingAcc(false);}
  }
  async function handleConnect(acc:PublyAccount){
    if(!botOnline){alert("PC에서 Publy 앱을 먼저 실행해주세요");return;}setConnId(acc.id);
    try{
      const legacy=(acc as any).password_encrypted||"";
      let pw="";try{pw=legacy?atob(legacy):"";}catch{}
      if(!pw){ const entered=await askPassword(acc); if(entered===null){setConnId(null);return;} pw=entered; }
      if(!pw)throw new Error("비밀번호 입력이 필요합니다");
      const r=await botFetch(`${BOT}/api/${acc.platform}/save-session`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({userId:acc.user_id,id:acc.username,pw,blogName:acc.blog_name}),signal:AbortSignal.timeout(120000)});
      const d=await r.json();if(!d.success)throw new Error(d.error||"연결 실패");
      await upsertAccount({...acc,password_encrypted:"",is_connected:true,connected_at:new Date().toISOString()});
      getAccounts(user.id).then(setAccounts);
      refreshSessionStatus();
    }catch(e:any){alert("연결 실패: "+e.message);}finally{setConnId(null);}
  }
  // 🔖 AEO 강조 배너 — 퍼블리가 네이버 AI 인용(AEO) 형식으로 글을 쓰는 걸 강조. 발행/원터치 상단.
  function renderAeoBanner(){
    return (
      <div style={{margin:"12px 16px 0",padding:"14px 16px",borderRadius:14,background:"rgba(124,58,237,.06)",border:"1.5px solid rgba(124,58,237,.3)"}}>
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
  // ✨ 키포인트 AI 자동 제안: 사진을 분석해 글에 쓸 핵심 포인트 초안을 채워줌(초보자·글감 막힘 해소)
  async function suggestKeypoints() {
    if(photoFiles.length===0){showToast("사진을 먼저 올려주세요","error");return;}
    const geminiKey=localStorage.getItem("publy_gemini_key")||"";
    if(!geminiKey){showToast("설정에서 Gemini API 키를 입력해주세요","error");return;}
    setPhotoSuggesting(true);
    try{
      const imgParts = photoFiles.slice(0,20).map(f=>{
        const b64 = f.src.split(",")[1]||f.src;
        const mime = f.src.startsWith("data:image/png")?"image/png":"image/jpeg";
        return {inlineData:{mimeType:mime,data:b64}};
      });
      const prompt = `이 사진들을 보고 블로그 글에 넣을 핵심 포인트를 뽑아줘.
사진에서 실제로 보이는 것만: 장소·가게 이름 느낌, 음식/제품, 대략 가격대, 분위기, 눈에 띄는 특징 등.
규칙: 5~8개 항목, 각 항목은 한 줄로 짧게, 앞에 "- " 붙여서, 설명·인사말 없이 항목만 출력. 확실하지 않은 건 "(확인 필요)"로 표시.`;
      let text = "";
      try{
        const pr=await botFetch(`${BOT}/api/gemini-vision`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({apiKey:geminiKey,parts:imgParts,prompt}),signal:AbortSignal.timeout(30000)});
        if(pr.ok){const pd=await pr.json();if(pd.text)text=pd.text;}
      }catch{}
      if(!text){
        for(const model of ["gemini-2.5-flash","gemini-2.5-flash-lite","gemini-flash-latest","gemini-flash-lite-latest"]){
          try{
            const cfg:any={maxOutputTokens:2000,temperature:0.7};
            if(model.startsWith("gemini-2.5"))cfg.thinkingConfig={thinkingBudget:0};
            const r=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({contents:[{parts:[...imgParts,{text:prompt}]}],generationConfig:cfg}),signal:AbortSignal.timeout(60000)});
            if(!r.ok)continue;const d=await r.json();const c=d.candidates?.[0];const t=c?.content?.parts?.[0]?.text;
            if(t&&c?.finishReason!=="MAX_TOKENS"){text=t;break;}
          }catch{}
        }
      }
      if(!text) throw new Error("사진 분석에 실패했어요. 잠시 후 다시 시도해주세요.");
      const cleaned=text.replace(/```/g,"").trim();
      setPhotoKeypoints(prev=>prev.trim()?prev.trim()+"\n"+cleaned:cleaned);
      showToast("✨ 키포인트 초안을 채웠어요! 가격·시간 등 아는 정보를 더 다듬으면 글이 훨씬 좋아져요","success");
    }catch(e:any){showToast("❌ "+e.message,"error");}
    finally{setPhotoSuggesting(false);}
  }

  async function generateFromPhotos() {
    if(photoFiles.length===0){showToast("사진을 먼저 업로드해주세요","error");return;}
    const geminiKey=localStorage.getItem("publy_gemini_key")||"";
    if(!geminiKey){showToast("설정에서 Gemini API 키를 입력해주세요","error");return;}
    setPhotoGenerating(true);setPhotoGenDone(false);setPhotoTitleOptions([]);setPhotoConfetti(false);
    // ★단계별 로딩 연출(📸 사진 구경 → ✏️ 글감 찾기 → 🌸 문장 다듬기)
    setPhotoGenStep(1);
    const stepTimer = setInterval(()=>setPhotoGenStep(s=>s>=3?3:s+1), 4500);

    try {
      // 이미지 parts 구성 (최대 20장 Vision 전송 - 체험단 실무 기준. 리사이즈로 용량 적음)
      const imgParts = photoFiles.slice(0,20).map(f=>{
        const b64 = f.src.split(",")[1]||f.src;
        const mime = f.src.startsWith("data:image/png")?"image/png":"image/jpeg";
        return {inlineData:{mimeType:mime,data:b64}};
      });

      const keypointText = photoKeypoints.trim()
        ? `

[작성자 키포인트]
${photoKeypoints.trim()}`
        : "";

      const styleGuide = WRITE_STYLE_GUIDE[writeStyle]||"";
      const endTone = WRITE_STYLE_ENDTONE[writeStyle]||"문장 끝: ~해요, ~거든요, ~더라고요 다양하게.";
      const personaGuide = PERSONA_STYLES.find(p=>p.id===persona)?.prompt||"";

      const photoCount = Math.min(photoFiles.length, 20);
      const prompt = `당신은 대한민국 최고의 블로그 작가입니다. 첨부된 ${photoCount}장의 사진을 순서대로 자세히 분석하여 네이버 블로그 글을 작성해주세요.

사진 속 모든 디테일(색상, 분위기, 장소, 음식, 사람, 배경 등)을 실제로 경험한 것처럼 생생하게 묘사해주세요.${keypointText}

=== 절대 규칙 ===
⛔ ## 기호 완전 금지 (소제목은 그냥 텍스트로)
⛔ ** * 마크다운 기호 전부 금지
⛔ AI 티 나는 상투어 절대 금지 (다양한, 효과적인, 중요합니다, 필수적으로, 결론적으로, ~해보겠습니다, 추천드립니다 등) → 실제 사람 말투로
⛔ 영어 단어 금지 (브랜드명 제외)
✅ 사진에서 직접 보이는 것을 구체적으로 묘사
✅ 구체적 수치, 가격, 시간 포함
✅ ${endTone}
★ 아래 [글의 방향] 지침이 이 글의 성격을 결정한다 — 구조·어조·초점을 그대로 따를 것 (충돌 시 [글의 방향] 우선)

=== ⭐ 사진 배치 규칙 (가장 중요) ===
✅ 각 사진은 그 사진을 설명하는 문단 "바로 앞"에 [사진N] 마커로 넣어주세요 (N은 1부터, 첨부 순서 그대로).
✅ 예: [사진1] 뒤에는 1번 사진에 대한 이야기, [사진2] 뒤에는 2번 사진 이야기.
✅ ${photoCount}개의 마커 [사진1]~[사진${photoCount}]를 본문에 빠짐없이, 순서대로, 각각 한 번씩만 넣으세요.
✅ 마커는 반드시 문단 맨 앞에 단독 줄로. 마커 바로 다음 문단은 그 사진에 실제로 보이는 것을 구체적으로 묘사.
✅ 각 사진 문단은 최소 3~4문장 이상, 사진끼리 내용이 겹치지 않게.

${styleGuide}
${personaGuide?`
[말투]
${personaGuide}`:""}

${AEO_RULES}

=== 출력 형식 (반드시 준수) ===
제목: (SEO 최적화 제목, 15~25자)
제목후보: 후보1 | 후보2 | 후보3 (서로 다른 각도의 SEO 제목 3개, 검색어를 앞에 배치, 과장·낚시 금지)
태그: 태그1, 태그2, 태그3, 태그4, 태그5, 태그6, 태그7 (사진·내용 기반 실제 검색 키워드)

[사진1]
(1번 사진을 보고 쓴 문단)

[사진2]
(2번 사진을 보고 쓴 문단)

... (첨부한 ${photoCount}장 전부, 사진마다 마커+문단)

${AEO_FAQ_FORMAT}

[관련글시작]
POST1: (제목)|(이유)
POST2: (제목)|(이유)
POST3: (제목)|(이유)
[관련글끝]`;

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

      // 봇 없거나 실패 시 직접 호출 (토큰 8000·2.5 thinking 끄기·잘림 재시도)
      if(!text){
        const MODELS = ["gemini-2.5-flash","gemini-2.5-flash-lite","gemini-flash-latest","gemini-flash-lite-latest"];
        for(const model of MODELS){
          try{
            const genCfg:any = {maxOutputTokens:8000,temperature:0.9};
            if(model.startsWith("gemini-2.5")) genCfg.thinkingConfig={thinkingBudget:0};
            const bodyDirect = {contents:[{parts:[...imgParts,{text:prompt}]}],generationConfig:genCfg};
            const r = await fetch(
              `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`,
              {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(bodyDirect),signal:AbortSignal.timeout(120000)}
            );
            if(!r.ok) continue;
            const d = await r.json();
            const cand = d.candidates?.[0];
            const t = cand?.content?.parts?.[0]?.text;
            if(t && cand?.finishReason!=="MAX_TOKENS"){text=t;break;}   // 잘리면 다음 모델
          }catch{}
        }
      }
      if(!text) throw new Error("생성 실패. Gemini 키를 확인하거나 잠시 후 다시 시도해주세요.");

      const titleM = text.match(/제목[:\s]*([^\n]+)/);
      const titleOptM = text.match(/제목후보[:\s]*([^\n]+)/);
      const tagM = text.match(/태그[:\s]*([^\n]+)/);
      const bodyM = text.match(/태그[^\n]*\n([\s\S]+)/);

      const title = titleM?.[1]?.trim()||"사진으로 작성된 글";
      // ★제목 후보 여러 개 (사용자가 골라 쓰게)
      if(titleOptM?.[1]){
        const opts = titleOptM[1].split(/\s*\|\s*/).map(s=>s.replace(/^[0-9.\-\s]+/,"").trim()).filter(s=>s.length>=4);
        setPhotoTitleOptions([title,...opts].filter((v,i,a)=>a.indexOf(v)===i).slice(0,4));
      } else setPhotoTitleOptions([title]);
      if(tagM?.[1]){
        setHashtags(tagM[1].trim().split(",").map((t:string)=>{
          const clean=t.trim().replace(/\s+/g,"");
          return clean.startsWith("#")?clean:"#"+clean;
        }).filter((t:string)=>t.replace(/^#+/,"").length>=2).slice(0,Math.floor(Math.random()*4)+5));
      }

      // 본문에서 혹시 남은 '제목후보:' 줄 제거(본문 오염 방지)
      const body2 = (bodyM?.[1]?.trim()||text).replace(/^제목후보[:\s].*$/gm,"").trim();
      setGenContent(body2.replace(/\[사진\d+\]/g,"").replace(/\n{3,}/g,"\n\n").trim());
      setGenTitle(title);
      setPubTitle(title);

      // ── ⭐ [사진N] 마커 기반 정밀 배치 ──
      //   AI가 각 사진을 설명하는 문단 앞에 [사진N]을 넣음 → 그 위치에 실제 사진 블록을 꽂아
      //   글 흐름과 사진이 정확히 매칭되게 한다. (기존 균등배치는 글-사진 불일치)
      const usedPhoto = new Set<number>();
      const finalBlocks: ContentBlock[] = [];
      // ★캡션을 사진의 '실제 내용 문단'에서 뽑아 글·이미지·캡션을 일치시킨다(키워드/파일명 반복 금지).
      //   AI가 [사진N] 바로 뒤에 그 사진을 보고 쓴 문단을 두므로, 그 문단 첫 문장을 짧은 캡션으로.
      const makeCaptionFrom = (txt:string):string => {
        const first = (txt||"").replace(/\s+/g," ").trim().split(/(?<=[.!?~。])\s|(?<=요)\s|(?<=다)\s/)[0] || (txt||"").trim();
        let c = first.replace(/^["'\s]+|["'\s]+$/g,"").replace(/[.!?~]+$/,"").trim();
        if(c.length>28) c = c.slice(0,26).trim()+"…";
        return c;
      };
      // 마커→그 다음 텍스트를 캡션 소스로 쓰기 위해 전체를 토큰 배열로 평탄화
      const paragraphs = body2.split(/\n\n+/).map(s=>s.trim()).filter(Boolean);
      const tokens: {marker?:number; text?:string}[] = [];
      for(const para of paragraphs){
        for(const part of para.split(/(\[사진\d+\])/g).filter(s=>s.trim())){
          const m = part.match(/^\[사진(\d+)\]$/);
          if(m) tokens.push({marker:parseInt(m[1],10)-1});
          else tokens.push({text:part.trim()});
        }
      }
      for(let ti=0; ti<tokens.length; ti++){
        const tk = tokens[ti];
        if(tk.marker!==undefined){
          const idx = tk.marker;
          if(idx>=0 && idx<photoFiles.length && !usedPhoto.has(idx)){
            usedPhoto.add(idx);
            // 이 사진 다음에 오는 첫 텍스트 토큰 = 이 사진을 설명하는 문단 → 캡션 소스
            const nextText = tokens.slice(ti+1).find(t=>t.text)?.text || "";
            const cap = makeCaptionFrom(nextText) || `사진 ${idx+1}`;
            finalBlocks.push({type:"image",id:uid(),src:photoFiles[idx].src,alt:cap,position:"center",source:"manual"} as ContentBlock);
          }
        } else if(tk.text){
          finalBlocks.push({type:"text",id:uid(),content:tk.text} as ContentBlock);
        }
      }
      // AI가 마커를 빠뜨린 사진은 글 뒤에 순서대로 보충(캡션은 사진 내용을 모르니 번호만 — 잘못된 캡션보다 나음)
      photoFiles.forEach((f,i)=>{
        if(!usedPhoto.has(i)) finalBlocks.push({type:"image",id:uid(),src:f.src,alt:`사진 ${i+1}`,position:"center",source:"manual"} as ContentBlock);
      });

      setBlocks(finalBlocks.length>0?finalBlocks:[{type:"text",id:uid(),content:body2}]);
      if(photoFiles.length>0) setThumbnail(photoFiles[0].src);

      setQualityScore(calcQualityScore(body2, photoKeypoints.split(/[\s,]/)[0]||""));
      setPhotoGenDone(true);
      setAutoInserted(true);
      setPhotoConfetti(true); setTimeout(()=>setPhotoConfetti(false), 2600);   // 🎉 꽃가루 축하
      showToast("✅ 사진 기반 글 생성 완료!", "success");
    } catch(e:any) {
      showToast("❌ 생성 실패: "+e.message+" (오류가 관리자에게 자동 전달됩니다)", "error");logError({user_id:user.id,user_name:(user as any).name||"",user_email:user.email||"",feature:"사진 글쓰기",error_message:e.message}).catch(()=>{});
    } finally {
      clearInterval(stepTimer); setPhotoGenStep(0);
      setPhotoGenerating(false);
    }
  }

  // 업로드 이미지 리사이즈: 긴 변 최대 1600px, JPEG 82% → 발행 속도↑(폰 원본 5MB→~300KB), 화질 충분
  function resizeImage(file: File, maxSide=1600, quality=0.82): Promise<string> {
    return new Promise((resolve)=>{
      const reader=new FileReader();
      reader.onload=ev=>{
        const dataUrl=ev.target?.result as string;
        const img=new Image();
        img.onload=()=>{
          let {width,height}=img;
          if(width<=maxSide && height<=maxSide){ resolve(dataUrl); return; } // 이미 작으면 그대로
          if(width>height){ height=Math.round(height*maxSide/width); width=maxSide; }
          else { width=Math.round(width*maxSide/height); height=maxSide; }
          const canvas=document.createElement("canvas");
          canvas.width=width; canvas.height=height;
          const ctx=canvas.getContext("2d");
          if(!ctx){ resolve(dataUrl); return; }
          ctx.drawImage(img,0,0,width,height);
          try{ resolve(canvas.toDataURL("image/jpeg",quality)); }catch{ resolve(dataUrl); }
        };
        img.onerror=()=>resolve(dataUrl);
        img.src=dataUrl;
      };
      reader.readAsDataURL(file);
    });
  }

  function handlePhotoUpload(files: FileList|null) {
    if(!files)return;
    const arr = Array.from(files).slice(0, 20 - photoFiles.length);
    arr.forEach(async file=>{
      if(!file.type.startsWith("image/"))return;
      const src = await resizeImage(file);
      setPhotoFiles(prev=>{
        if(prev.length>=20)return prev;
        return [...prev,{id:uid(),src,name:file.name}];
      });
    });
  }

    function openPreview(){
    const sectionTags=["[FAQ시작]","[관련글시작]","[참고자료시작]"];
    // blocks가 비어있으면 genContent로 임시 블록 구성
    const previewBlocks = blocks.length > 0 ? blocks :
      genContent ? [{type:"text" as const, id:"tmp", content:genContent}] : [];
    const blocksHtml=previewBlocks.map((b:any)=>{
      if(b.type==="text"){
        const txt=(b as TextBlock).content;
        const secStart=sectionTags.reduce((min,tag)=>{const i=txt.indexOf(tag);return i>-1&&i<min?i:min;},Infinity);
        const body=secStart<Infinity?txt.slice(0,secStart).trim():txt;
        const sec=secStart<Infinity?txt.slice(secStart).trim():"";
        const toHtml=(t:string)=>t.split("\n").filter(l=>l.trim()&&!sectionTags.some(tag=>l.includes(tag))).map(line=>{
          if(line.startsWith("## "))return`<h2>${line.slice(3)}</h2>`;
          if(line.startsWith("### "))return`<h3>${line.slice(4)}</h3>`;
          if(line==="---")return`<hr/>`;
          return`<p>${line}</p>`;
        }).join("");
        return toHtml(body)+(sec?`<div class="section-box">${toHtml(sec)}</div>`:"");
      }
      const ib=b as SingleImageBlock;
      return ib.src?`<figure><img src="${ib.src}" alt="${ib.alt||""}"/>${ib.alt?`<figcaption>${ib.alt}</figcaption>`:""}</figure>`:"";
    }).join("");
    const tagsHtml=hashtags.length>0?`<div class="tags">${hashtags.map(t=>`<span class="tag">${t.startsWith("#")?t:"#"+t}</span>`).join("")}</div>`:"";
    const html=`<!DOCTYPE html><html><head><meta charset="utf-8"><title>미리보기</title><style>*{box-sizing:border-box;margin:0;padding:0}body{background:#f5f5f5;font-family:'Apple SD Gothic Neo','Malgun Gothic',sans-serif;padding:20px}h1{font-size:24px;font-weight:900;color:#111;margin-bottom:16px;line-height:1.35;word-break:keep-all}.card{max-width:680px;margin:0 auto;background:#fff;border-radius:16px;padding:32px 28px;box-shadow:0 2px 12px rgba(0,0,0,.08)}h2{font-size:18px;font-weight:800;margin:24px 0 10px;color:#111;border-bottom:2px solid #eee;padding-bottom:8px}h3{font-size:15px;font-weight:700;margin:18px 0 8px;color:#222;border-left:4px solid #2563eb;padding-left:10px}p{margin:0 0 12px;font-size:15px;line-height:1.9;color:#333;word-break:keep-all}img{width:100%;border-radius:10px;display:block;margin:16px 0}figure{margin:16px 0}figcaption{font-size:11px;color:#999;text-align:center;margin-top:4px}.tags{margin-top:20px;display:flex;flex-wrap:wrap;gap:6px}.tag{font-size:12px;padding:3px 10px;border-radius:99px;background:#f0f4ff;color:#2563eb;font-weight:600}.section-box{margin-top:20px;padding:16px;background:#f8f8f8;border-radius:12px;border-left:4px solid #ddd}hr{border:none;border-top:1px solid #eee;margin:16px 0}</style></head><body><div class="card">${pubTitle?`<h1>${pubTitle}</h1>`:""}${thumbnail?`<img src="${thumbnail}" alt="썸네일"/>`:""}${blocksHtml}${tagsHtml}</div></body></html>`;
    // Electron IPC로 새 창 열기
    if((window as any).electron?.openPreview){
      (window as any).electron.openPreview(html);
    } else {
      const w=window.open("","_blank","width=900,height=960,scrollbars=yes");
      if(w){w.document.write(html);w.document.close();}
    }
  }

  async function handleDeleteAccount(id:string){
    if(!confirm("이 계정을 삭제할까요?"))return;
    const acc=accounts.find(a=>a.id===id);
    if(acc)await botFetch(`${BOT}/api/session/${acc.platform}/${acc.user_id}`,{method:"DELETE"}).catch(()=>{});
    await supabase.from("publy_accounts").delete().eq("id",id);getAccounts(user.id).then(setAccounts);
  }

  const quotaPct=quota?Math.min(100,(quota.used_quota/quota.total_quota)*100):0;
  const connAccs=accounts.filter(a=>a.platform===platform&&(botOnline?a.is_connected:true));
  const todayPub=history.filter(h=>new Date(h.published_at).toDateString()===new Date().toDateString()).length;
  const activeImages=getActiveImages();
  useEffect(()=>{if(genTitle)setPubTitle(genTitle);},[genTitle]);
  useEffect(()=>{if(genTags)setPubTags(genTags);},[genTags]);
  const P="#FF6B9D",Y="#FFD93D",G="#f0417a";
  const guideTabs=["🏠 시작","🔑 API 키","✍️ 글 생성","🖼️ 이미지","🚀 발행","🏪 플레이스","❓ FAQ"];
  const guidePages=[
    /* ── 0: 시작 ── */
    <div key="0">
      <div className="g-step" style={{borderColor:`${G}40`,background:`${G}08`}}>
        <div className="g-step-num" style={{color:"var(--g-green)"}}>🎉 PUBLY에 오신 걸 환영해요!</div>
        <div className="g-step-title" style={{color:"var(--g-fg)"}}>글쓰기부터 매장 성장까지 한곳에서 해요</div>
        <div className="g-step-desc">블로그는 <b>제목 → 글 → 이미지 → 자동 발행</b>, 매장은 <b>순위 확인 → 진단 → 고객 화면 점검 → 리뷰어 찾기</b> 순서로 따라가면 돼요.</div>
      </div>
      <div className="g-step" style={{borderColor:"rgba(240,65,122,.35)",background:"rgba(240,65,122,.08)"}}>
        <div className="g-step-num" style={{color:"#16856b"}}>🏪 매장을 운영하시나요?</div>
        <div className="g-step-title" style={{color:"var(--g-fg)"}}>플레이스 365부터 눌러보세요</div>
        <div className="g-step-desc">왼쪽의 <b>🏪 플레이스 365</b>에서 내 매장을 등록하면 현재 순위, 주변 업체 비교, 고객에게 보이는 정보를 한눈에 확인할 수 있어요.</div>
        <button className="g-btn" style={{background:"linear-gradient(135deg,#16856b,#22a880)",color:"#fff"}} onClick={()=>{setShowGuide(false);setTab("place");}}>🏪 내 매장 진단 시작하기</button>
      </div>
      <div className="g-step" style={{borderColor:`${Y}40`,background:`${Y}08`}}>
        <div className="g-step-num" style={{color:"var(--g-yellow)"}}>📋 5단계 전체 흐름</div>
        <div className="g-step-title" style={{color:"var(--g-fg)"}}>이 순서대로만 하면 끝!</div>
        <div className="g-step-desc">
          {[["✍️","글쓰기 탭","키워드 입력 → 제목 선택 → 글 자동 생성"],["🖼️","이미지 탭","AI 이미지 생성 + 캡션 입력 + 영상 설정"],["🚀","발행 탭","발행 방식 선택 → 계정 선택 → 자동 발행"],["📋","기록 탭","발행된 글 목록 전체 확인"],["⚙️","설정 탭","API 키 관리 + 블로그 계정 연결"]].map(([ico,t,d],idx)=>(
            <div key={idx} style={{display:"flex",gap:10,padding:"9px 0",borderBottom:idx<4?"1px solid var(--g-line)":"none"}}>
              <span style={{fontSize:22,flexShrink:0}}>{ico}</span>
              <div><div style={{fontWeight:800,color:"var(--g-fg)",fontSize:15}}>{t}</div><div style={{fontSize:13,color:"var(--g-fg2)",marginTop:2}}>{d}</div></div>
            </div>
          ))}
        </div>
      </div>
      <div className="g-step" style={{borderColor:`${P}40`,background:`${P}08`}}>
        <div className="g-step-num" style={{color:"var(--g-pink)"}}>💰 수익화 2가지</div>
        <div className="g-step-title" style={{color:"var(--g-fg)"}}>무엇을 선택할까요?</div>
        <div className="g-step-desc">
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginTop:4}}>
            <div style={{padding:14,borderRadius:12,background:"rgba(3,199,90,.1)",border:"1.5px solid rgba(3,199,90,.3)"}}>
              <div style={{fontSize:15,fontWeight:900,color:"#03C75A",marginBottom:5}}>📰 애드포스트</div>
              <div style={{fontSize:13,color:"var(--g-fg2)",lineHeight:1.7}}>네이버 블로그.<br/>친근하고 감성적.<br/>처음 시작에 추천!</div>
            </div>
            <div style={{padding:14,borderRadius:12,background:"rgba(77,166,255,.1)",border:"1.5px solid rgba(77,166,255,.3)"}}>
              <div style={{fontSize:15,fontWeight:900,color:"#4da6ff",marginBottom:5}}>🔍 애드센스</div>
              <div style={{fontSize:13,color:"var(--g-fg2)",lineHeight:1.7}}>티스토리.<br/>구글 검색 노출.<br/>글자 수 더 많아요.</div>
            </div>
          </div>
        </div>
      </div>
    </div>,

    /* ── 1: API 키 ── */
    <div key="1">
      <div className="g-step" style={{borderColor:`${Y}40`,background:`${Y}08`}}>
        <div className="g-step-num" style={{color:"var(--g-yellow)"}}>⚠️ 이것부터 해야 해요!</div>
        <div className="g-step-title" style={{color:"var(--g-fg)"}}>API 키 없으면 글을 쓸 수 없어요</div>
        <div className="g-step-desc">API 키는 AI 서비스 이용권이에요. 아래 중 <b>하나만</b> 있으면 돼요!</div>
        <button className="g-btn" style={{background:`linear-gradient(135deg,${Y},#e0a500)`,color:"#000"}} onClick={()=>{setShowGuide(false);setTab("settings");}}>⚙️ 지금 API 키 설정하기</button>
      </div>
      {[{logo:"G",color:"#4285F4",name:"Gemini Flash",free:true,desc:"구글 AI. 완전 무료! 처음 시작하는 분께 강력 추천.",link:"https://aistudio.google.com/app/apikey"},{logo:"L",color:"#F55036",name:"Groq Llama 3",free:true,desc:"초고속 AI. 역시 무료!",link:"https://console.groq.com/keys"},{logo:"O",color:"#10A37F",name:"GPT-4o",free:false,desc:"가장 강력한 AI. 유료지만 최고 품질.",link:"https://platform.openai.com/api-keys"}].map((ai,i)=>(
        <div key={i} className="g-step" style={{borderColor:`${ai.color}35`,background:`${ai.color}08`}}>
          <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:8}}>
            <div style={{width:34,height:34,borderRadius:9,background:ai.color,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:900,color:"#000",fontSize:14,flexShrink:0}}>{ai.logo}</div>
            <div><div style={{fontSize:15,fontWeight:800,color:"var(--g-fg)"}}>{ai.name}</div><span style={{fontSize:11,fontWeight:800,padding:"2px 8px",borderRadius:99,background:ai.free?"rgba(240,65,122,.15)":"rgba(245,158,11,.15)",color:ai.free?"#f0417a":"#f59e0b"}}>{ai.free?"✅ 무료":"💳 유료"}</span></div>
          </div>
          <div className="g-step-desc">{ai.desc}</div>
          <div className="g-tip" style={{marginTop:8,fontSize:13}}>🔑 <a href={ai.link} target="_blank" rel="noopener noreferrer" style={{color:"var(--g-yellow)",fontWeight:700,textDecoration:"underline"}}>여기서 키 발급</a> → 로그인 → API 키 생성 → 복사 → 설정 탭 붙여넣기</div>
        </div>
      ))}
    </div>,

    /* ── 2: 글 생성 ── */
    <div key="2">
      {[
        {n:"STEP 1",i:"🎯",t:"플랫폼 + 수익화 선택",c:G,d:<>헤더에서 <b>🟢 네이버</b> 또는 <b>🟠 티스토리</b> 선택 후, 글쓰기 탭에서 애드포스트/애드센스 선택!</>},
        {n:"STEP 2",i:"🔍",t:"키워드 입력",c:Y,d:<>예: <b>"강남 맛집"</b> 입력 후 Enter 또는 버튼 클릭! 제목 30개 자동 추천!</>},
        {n:"STEP 3",i:"⭐",t:"제목 클릭해서 선택",c:P,d:<>AI가 추천한 제목 중 마음에 드는 거 클릭! 마음에 안 들면 30개 추가도 가능!</>},
        {n:"STEP 4",i:"📏",t:"글자수 설정",c:"#8B5CF6",d:<><b>🎲 자동 랜덤</b> 추천! 네이버: 1500~2000자, 체험단: 1800~2500자, 티스토리: 2000~3000자. 매번 달라서 AI 감지 방지!</>},
        {n:"STEP 5",i:"✨",t:"글 생성 시작",c:"#F55036",d:<><b>본문 생성 시작</b> 버튼! 인트로·소제목·마무리가 매번 달라져요. 이미지는 다음 탭에서 따로!</>},
      ].map((s,i)=>(
        <div key={i} className="g-step" style={{borderColor:`${s.c}40`,background:`${s.c}08`}}>
          <div className="g-step-num" style={{color:s.c}}>{s.i} {s.n}</div>
          <div className="g-step-title" style={{color:"var(--g-fg)"}}>{s.t}</div>
          <div className="g-step-desc">{s.d}</div>
        </div>
      ))}
    </div>,

    /* ── 3: 이미지 ── */
    <div key="3">
      <div className="g-step" style={{borderColor:`${G}40`,background:`${G}08`}}>
        <div className="g-step-num" style={{color:"var(--g-green)"}}>🖼️ 이미지 탭 사용법</div>
        <div className="g-step-title" style={{color:"var(--g-fg)"}}>이미지마다 캡션을 꼭 입력해요!</div>
        <div className="g-step-desc">캡션(이미지 설명)은 네이버 상위 노출에 도움이 돼요. 자동 생성되지만 직접 수정도 가능해요.</div>
      </div>
      {[
        {t:"✨ AI 자동 생성",d:"수량 자동추천 또는 직접 입력 (체험단 15장+ 가능). 생성 중 언제든 ⏹ 중단 가능!"},
        {t:"📁 내 이미지 업로드",d:"직접 찍은 사진이나 저장한 이미지. 여러 장 동시 업로드 가능!"},
        {t:"🚫 이미지 없이 발행",d:"텍스트만 발행할 때 선택."},
        {t:"📐 이미지 배치 패턴",d:"🎲 랜덤(권장): 매 발행마다 자동 변경 → AI 감지 방지!\nA: 썸네일 + 글 중간 배치 / B: 균등 분산 (모든 이미지 캡션 포함)"},
        {t:"🎬 영상 삽입",d:"네이버TV/유튜브 URL 입력 후 ON. 체험단 영상 필수 업체 대응! 위치(상단/중간/하단) 선택 가능."},
      ].map((item,i)=>(
        <div key={i} style={{padding:"13px 15px",borderRadius:12,background:"var(--g-surface2)",border:"1px solid var(--g-line)",marginBottom:8}}>
          <div style={{fontSize:15,fontWeight:800,color:"var(--g-fg)",marginBottom:4}}>{item.t}</div>
          <div style={{fontSize:13,color:"var(--g-fg2)",lineHeight:1.7,whiteSpace:"pre-line"}}>{item.d}</div>
        </div>
      ))}
    </div>,

    /* ── 4: 발행 ── */
    <div key="4">
      <div className="g-step" style={{borderColor:`${P}40`,background:`${P}08`}}>
        <div className="g-step-num" style={{color:"var(--g-pink)"}}>🚨 발행 전 필수 확인!</div>
        <div className="g-step-title" style={{color:"var(--g-fg)"}}>PC에서 Publy 앱이 실행 중이어야 해요</div>
        <div className="g-step-desc">오른쪽 패널에 <b style={{color:"var(--g-green)"}}>● 온라인</b>이 보여야 즉시 발행! 오프라인이면 자동으로 대기열에 저장돼요 😊</div>
      </div>
      <div className="g-step" style={{borderColor:`${G}40`,background:`${G}08`}}>
        <div className="g-step-num" style={{color:"var(--g-green)"}}>✅ 발행 순서 (이거 하나면 끝!)</div>
        <div className="g-step-title" style={{color:"var(--g-fg)"}}>순서대로만 하면 돼요</div>
        <div className="g-step-desc">
          {[["① 이미지 생성 후 발행탭 이동","이미지가 자동으로 글 사이에 배치돼요. 썸네일도 자동 설정!"],["② 오른쪽 패널에서 계정·플랫폼 선택","네이버 또는 티스토리, 연결된 계정 선택"],["③ 발행 방식 선택","전체/본문+FAQ/본문만 — 오른쪽 패널에서 선택"],["④ 🚀 발행 버튼 클릭","오른쪽 아래 큰 초록 버튼!"]].map(([t,d],i)=>(
            <div key={i} style={{display:"flex",gap:8,padding:"8px 0",borderBottom:i<3?"1px solid var(--g-line)":"none"}}>
              <div><div style={{fontSize:14,fontWeight:800,color:"var(--g-fg)"}}>{t}</div><div style={{fontSize:13,color:"var(--g-fg2)",marginTop:2}}>{d}</div></div>
            </div>
          ))}
        </div>
        <button className="g-btn" style={{background:`linear-gradient(135deg,${G},#ff8a4c)`,color:"#000"}} onClick={()=>{setShowGuide(false);setTab("accounts");}}>🔗 계정 연결하러 가기</button>
      </div>
      <div className="g-step" style={{borderColor:`${Y}40`,background:`${Y}08`}}>
        <div className="g-step-num" style={{color:"var(--g-yellow)"}}>🖼️ 이미지+글 패턴 확인</div>
        <div className="g-step-title" style={{color:"var(--g-fg)"}}>본문 편집기에서 눈으로 확인하세요</div>
        <div className="g-step-desc">이미지와 글이 섞인 순서가 보여요. 위치가 마음에 안 들면 블록 옆 <b>🖼️ 버튼</b>으로 직접 조정!</div>
      </div>
    </div>,

    /* ── 5: 플레이스 365 ── */
    <div key="5">
      <div className="g-step" style={{borderColor:"rgba(240,65,122,.4)",background:"rgba(240,65,122,.08)"}}>
        <div className="g-step-num" style={{color:"#16856b"}}>🏪 플레이스 365이 뭐예요?</div>
        <div className="g-step-title" style={{color:"var(--g-fg)"}}>내 가게를 찾고, 비교하고, 키우는 매장 성장센터예요</div>
        <div className="g-step-desc">단순 순위 조회가 아니에요. 고객에게 내 매장이 어떻게 보이는지 확인하고, 주변 업체보다 부족한 점과 다음 행동을 알려줘요.</div>
      </div>
      {[
        {n:"STEP 1",i:"🏷️",t:"내 매장 등록·전환",c:"#16856b",d:"상호명·지역·업종을 입력해요. 무료 1개·베이직 2개·프로 5개까지 등록하고 위쪽 매장 버튼으로 바꿀 수 있어요."},
        {n:"STEP 2",i:"📍",t:"지금 내 순위 측정",c:"#e34f86",d:"고객이 검색할 지역·업종 키워드로 업체를 찾으면 내 매장 순위가 자동 기록되고, 앱을 다시 열어도 같은 검색어의 상승·하락 이력을 볼 수 있어요."},
        {n:"STEP 3",i:"🩺",t:"주변 업체와 비교 진단",c:"#f59e0b",d:"내 방문자·블로그 리뷰를 주변 평균과 비교해 신규 고객, 노출, 리뷰 문제를 구분해요."},
        {n:"STEP 4",i:"📊",t:"운영자료 원인 진단",c:"#0ea5e9",d:"POS·예약·광고 보고서의 두 기간 숫자를 직접 입력하거나 CSV로 불러와 신규 고객, 재방문율, 광고 효율, 매출 흐름을 섞지 않고 비교해요."},
        {n:"STEP 5",i:"✅",t:"오늘의 성장 미션 실행",c:"#16856b",d:"내 매장 수치에 맞춰 나온 할 일을 위에서부터 실행해요. 운영자료 저장·순위 재측정·내 매장 고객 화면 확인·리뷰어 전달은 실행 순간 자동 완료되고 다른 PC에서도 이어져요."},
        {n:"STEP 6",i:"👀",t:"고객 화면 상세 확인",c:"#3b82f6",d:"업체 카드의 ‘고객 화면 보기’를 눌러 사진·영업시간·전화·메뉴·가격·예약·주차와 완성도 점수를 확인해요."},
        {n:"STEP 7",i:"🧭",t:"리뷰 블로거 역추적",c:"#8b5cf6",d:"경쟁업체를 체크하고 리뷰어 찾기를 누르면 실제 리뷰 블로거를 모아 크롤링 협업 제안으로 보낼 수 있어요."},
      ].map((s,i)=><div key={i} className="g-step" style={{borderColor:`${s.c}40`,background:`${s.c}08`}}><div className="g-step-num" style={{color:s.c}}>{s.i} {s.n}</div><div className="g-step-title" style={{color:"var(--g-fg)"}}>{s.t}</div><div className="g-step-desc">{s.d}</div></div>)}
      <div className="g-step" style={{borderColor:`${Y}55`,background:`${Y}08`}}><div className="g-step-num" style={{color:"var(--g-yellow)"}}>⚠️ 꼭 알아두세요</div><div className="g-step-desc">오늘 미션은 한국시간 자정에 새로 시작하고 리뷰어 전달 누적은 유지돼요. 순위는 위치·시간·기기·개인화에 따라 달라질 수 있으니 같은 조건으로 반복 확인하세요. 같은 네이버 계정은 한 번에 한 작업만 가능하고, 다른 계정은 동시에 사용할 수 있어요.</div><button className="g-btn" style={{background:"linear-gradient(135deg,#16856b,#22a880)",color:"#fff"}} onClick={()=>{setShowGuide(false);setTab("place");}}>플레이스 365 열기 →</button></div>
    </div>,

    /* ── 6: FAQ ── */
    <div key="6">
      {[
        {q:"API 키가 뭐예요?",a:"AI 서비스 비밀번호예요. 처음 한 번만 설정하면 돼요! Gemini는 구글 계정만 있으면 무료 발급!",c:G},
        {q:"글이 얼마나 걸려요?",a:"보통 30초~1분이요. AI가 글을 쓰는 중이라 잠깐 기다려주세요 ☕",c:Y},
        {q:"글자수는 어떻게 정해요?",a:"🎲 자동 랜덤 추천! 네이버: 1500~2000자, 체험단/맛집: 1800~2500자, 티스토리: 2000~3000자. 직접 설정도 가능해요.",c:P},
        {q:"체험단 이미지 15장 이상도 되나요?",a:"네! 이미지 탭에서 '✏️ 직접입력' 선택 후 숫자를 입력하면 돼요. 최대 30장까지 가능해요.",c:"#8B5CF6"},
        {q:"이미지 설명(캡션)이 뭔가요?",a:"이미지 아래 짧은 설명이에요. 네이버 상위 노출에 도움이 돼요. 자동 생성 후 수정 가능해요.",c:"#4ECDC4"},
        {q:"블로그에 ## 기호가 들어가요",a:"이미 수정됐어요! 마크다운 기호 완전 제거 기능이 적용돼 있어요.",c:P},
        {q:"이미지 생성이 안 돼요",a:"OpenAI 또는 Replicate 키가 필요해요. 없으면 '내 이미지 업로드' 또는 '이미지 없이 발행'을 선택하세요.",c:"#F55036"},
        {q:"발행 건수가 부족해요",a:"FREE 10건, BASIC 50건, PRO 무제한. 업그레이드는 관리자에게 문의하세요.",c:Y},
        {q:"설치할 때 'Publy cannot be closed' 문구가 떠요",a:"이전에 실행 중인 Publy가 완전히 종료되지 않은 거예요.\n방법: 키보드 Ctrl+Shift+Esc 누르기 → 프로세스 탭에서 Publy 찾기 → 마우스 우클릭 → 작업 끝내기 → 다시 시도 클릭",c:"#f85149"},
        {q:"봇이 오프라인으로 계속 뜨면요?",a:"PC에서 Publy 앱이 실행 중인지 확인하세요. 앱을 껐다 켜면 봇이 자동으로 켜져요.",c:"#ff8c00"},
        {q:"오류가 났는데 어떻게 해요?",a:"걱정 마세요! 오류가 생기면 관리자에게 자동으로 전달돼요. 잠깐 기다렸다가 다시 시도해 보세요.",c:"#4ECDC4"},
        {q:"플레이스 순위가 네이버에서 본 것과 달라요",a:"검색 위치·시간·기기·로그인 개인화에 따라 결과가 달라질 수 있어요. 퍼블리에서는 같은 조건으로 꾸준히 측정해 상승·하락 흐름을 보는 것이 중요해요.",c:"#16856b"},
        {q:"고객 화면 확인은 왜 횟수를 쓰나요?",a:"사진·영업시간·메뉴처럼 공개 상세정보를 새로 읽는 작업이라 하루 한도가 있어요. 한 번 확인한 매장은 6시간 동안 다시 열어도 차감하지 않아요.",c:"#3b82f6"},
      ].map((item,i)=>(
        <div key={i} className="g-step" style={{borderColor:`${item.c}55`,background:`${item.c}15`,marginBottom:10,padding:"14px 16px"}}>
          <div style={{fontSize:13,fontWeight:900,color:item.c,marginBottom:6}}>Q. {item.q}</div>
          <div style={{fontSize:13,color:"var(--g-fg2)",lineHeight:1.8,whiteSpace:"pre-line"}}>👉 {item.a}</div>
        </div>
      ))}
    </div>,
  ];

  const dmDailyLimit = INSTA_DM_DAILY_LIMIT[user.plan] ?? 5;
  const dmRemaining = Math.max(0, dmDailyLimit - instaUsed);
  const dmPendingCount = dmTargets.filter(target=>target.status==="pending").length;
  const dmSendableCount = Math.min(dmPendingCount, dmRemaining);
  const dmEstimatedMinutes = dmSendableCount ? Math.ceil((dmSendableCount * 65) / 60) : 0;
  const dmCurrentStep = !dmSessionOk ? 1 : dmPendingCount===0 ? 2 : !dmMessage.trim() ? 3 : 4;

  return (
    <>
      <style>{CSS}</style>
      <div className={`app ${theme} ${fontMode==="large"?"large":""}`}>

        {/* ── 🔒 무료체험 만료 잠금(페이월) — 무료 7일 끝나면 전체 기능 잠금. 결제 전까지 이 화면이 덮음 ── */}
        {locked && (
          <div style={{position:"fixed",inset:0,zIndex:2147483000,background:"rgba(15,10,20,.82)",backdropFilter:"blur(6px)",display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
            <div style={{width:"100%",maxWidth:430,background:"var(--card,#fff)",color:"var(--text,#1a1a1a)",borderRadius:24,padding:"32px 26px 26px",boxShadow:"0 30px 90px rgba(0,0,0,.6)",border:"1px solid rgba(255,111,165,.4)",textAlign:"center",animation:"fadeUp .3s ease"}}>
              <div style={{fontSize:52,marginBottom:8}}>🔒</div>
              <div style={{fontSize:21,fontWeight:900,letterSpacing:"-.02em",marginBottom:10,color:"var(--text,#1a1a1a)"}}>무료 체험이 끝났어요</div>
              <div style={{fontSize:14,lineHeight:1.7,color:"var(--text2,#555)",marginBottom:6}}>퍼블리의 <b style={{color:"#ff4d8d"}}>모든 기능</b>은 회원가입 후 <b style={{color:"#ff4d8d"}}>7일간 무료</b>로 드려요.</div>
              <div style={{fontSize:14,lineHeight:1.7,color:"var(--text2,#555)",marginBottom:22}}>체험 기간이 끝나 지금은 사용이 잠겼어요.<br/>계속 이용하시려면 <b>결제</b>가 필요해요.</div>
              <a href="https://open.kakao.com/o/s0lQ66wi" target="_blank" rel="noopener noreferrer"
                style={{display:"flex",alignItems:"center",justifyContent:"center",gap:9,width:"100%",boxSizing:"border-box",padding:"16px",borderRadius:14,background:"#FEE500",color:"#191600",fontSize:16,fontWeight:900,textDecoration:"none",marginBottom:11,boxShadow:"0 8px 22px rgba(254,229,0,.4)"}}>
                💬 카톡으로 결제 문의하기
              </a>
              <div style={{fontSize:12,color:"var(--text3,#999)",marginBottom:16}}>버튼을 누르면 카카오톡 상담으로 연결돼요.</div>
              <button onClick={()=>window.location.reload()} style={{background:"transparent",border:"1px solid var(--border,#ddd)",color:"var(--text2,#666)",borderRadius:10,padding:"9px 16px",fontSize:12.5,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>결제 완료 후 새로고침</button>
            </div>
          </div>
        )}

        {/* ── 웹 접속자용 앱 설치 안내 배너 (Electron 앱에서는 안 뜸) ── */}
        <WebInstallNotice />

        {/* ── 초기 로딩 오버레이 (플리커 방지) ── */}
        {!pageReady && (
          <div style={{position:"fixed",inset:0,background:theme==="dark"?"#050a12":"#f0faf4",zIndex:9999,display:"flex",alignItems:"center",justifyContent:"center"}}>
            <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:16}}>
              <div style={{width:44,height:44,borderRadius:"50%",border:"3px solid rgba(0,255,136,.2)",borderTopColor:"#00ff88",animation:"spin 1s linear infinite"}}/>
              <div style={{fontSize:13,color:"var(--text3)",fontWeight:600}}>불러오는 중...</div>
            </div>
            <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
          </div>
        )}

        {/* ── 만료/발행 알림 팝업 ── */}
        {/* ── 재연결 비밀번호 입력 모달 (window.prompt 대체) ── */}
        {pwPrompt&&(
          <div style={{position:"fixed",inset:0,zIndex:10000,background:"rgba(0,0,0,.75)",display:"flex",alignItems:"center",justifyContent:"center",padding:20}}
            onClick={()=>{ pwPromptResolve.current?.(null); pwPromptResolve.current=null; setPwPrompt(null); }}>
            <div style={{width:"100%",maxWidth:400,borderRadius:20,background:"var(--card)",border:"1px solid var(--accent-border)",overflow:"hidden",animation:"fadeUp .25s ease",boxShadow:"0 24px 60px rgba(0,0,0,.5)"}} onClick={e=>e.stopPropagation()}>
              <div style={{padding:"18px 22px 14px",background:"linear-gradient(135deg,var(--accent),#ff8a4c)",display:"flex",alignItems:"center",gap:10}}>
                <span style={{fontSize:24}}>🔒</span>
                <div><div style={{fontSize:16,fontWeight:900,color:"#000"}}>세션이 만료되었어요</div>
                <div style={{fontSize:12,color:"rgba(0,0,0,.7)",marginTop:2}}>{pwPrompt.acc.platform==="naver"?"네이버":"티스토리"} 비밀번호를 다시 입력해주세요</div></div>
              </div>
              <div style={{padding:"20px 22px"}}>
                <div style={{fontSize:12,color:"var(--text3)",marginBottom:6}}>계정: <b style={{color:"var(--text)"}}>{pwPrompt.acc.username}</b></div>
                <div style={{position:"relative",marginBottom:14}}>
                  <input type={showPwPrompt?"text":"password"} autoFocus className="inp" placeholder="비밀번호" value={pwPrompt.value}
                    onChange={e=>setPwPrompt(p=>p?{...p,value:e.target.value}:p)}
                    onKeyDown={e=>{ if(e.key==="Enter"&&pwPrompt.value){ pwPromptResolve.current?.(pwPrompt.value); pwPromptResolve.current=null; setPwPrompt(null); } }}
                    style={{fontSize:14,padding:"12px 44px 12px 14px"}}/>
                  <button type="button" onClick={()=>setShowPwPrompt(v=>!v)} aria-label="비밀번호 보기" style={{position:"absolute",right:10,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",cursor:"pointer",fontSize:18,color:"var(--text3)"}}>{showPwPrompt?"🙈":"👁️"}</button>
                </div>
                <div style={{display:"flex",gap:8}}>
                  <button onClick={()=>{ pwPromptResolve.current?.(null); pwPromptResolve.current=null; setPwPrompt(null); }}
                    style={{flex:1,padding:"11px",borderRadius:10,border:"1px solid var(--border)",background:"var(--bg2)",color:"var(--text2)",cursor:"pointer",fontSize:13,fontWeight:700,fontFamily:"inherit"}}>취소</button>
                  <button disabled={!pwPrompt.value} onClick={()=>{ pwPromptResolve.current?.(pwPrompt.value); pwPromptResolve.current=null; setPwPrompt(null); }}
                    style={{flex:2,padding:"11px",borderRadius:10,border:"none",background:pwPrompt.value?"var(--accent)":"var(--border)",color:pwPrompt.value?"#000":"var(--text3)",cursor:pwPrompt.value?"pointer":"not-allowed",fontSize:13,fontWeight:800,fontFamily:"inherit"}}>🔗 재연결</button>
                </div>
              </div>
            </div>
          </div>
        )}

        {alertPopup&&(
          <div style={{position:"fixed",inset:0,zIndex:9999,background:"rgba(0,0,0,.75)",display:"flex",alignItems:"center",justifyContent:"center",padding:20}} onClick={()=>setAlertPopup(null)}>
            <div style={{width:"100%",maxWidth:400,borderRadius:20,background:"var(--card)",border:`1px solid ${alertPopup.type==="expire"?"rgba(255,83,99,.4)":"rgba(255,159,63,.4)"}`,overflow:"hidden",animation:"fadeUp .25s ease",boxShadow:"0 24px 60px rgba(0,0,0,.5)"}} onClick={e=>e.stopPropagation()}>
              {/* 헤더 */}
              <div style={{padding:"18px 22px 16px",background:alertPopup.type==="expire"?"linear-gradient(135deg,#ff5363,#ff3366)":"linear-gradient(135deg,#ff9f3f,#ff6600)",display:"flex",alignItems:"center",gap:12}}>
                <div style={{fontSize:28}}>{alertPopup.type==="expire"?"⏰":"📊"}</div>
                <div>
                  <div style={{fontSize:16,fontWeight:900,color:"var(--g-fg)"}}>
                    {alertPopup.type==="expire"
                      ? alertPopup.daysLeft===0 ? "오늘 만료됩니다!" : alertPopup.daysLeft! < 0 ? "서비스가 만료됐습니다!" : `만료 ${alertPopup.daysLeft}일 전`
                      : "오늘 발행 한도가 얼마 안 남았어요"}
                  </div>
                  <div style={{fontSize:12,color:"var(--g-fg2)",marginTop:2}}>
                    {alertPopup.type==="expire" ? "서비스 이용을 위해 갱신해주세요" : "추가 발행이 필요하면 플랜을 업그레이드하세요"}
                  </div>
                </div>
              </div>
              {/* 내용 */}
              <div style={{padding:"18px 22px"}}>
                {alertPopup.type==="expire" ? (
                  <div style={{fontSize:14,color:"var(--text)",lineHeight:1.8}}>
                    {alertPopup.daysLeft! < 0
                      ? "서비스가 만료됐습니다. 갱신 후 이용 가능합니다."
                      : alertPopup.daysLeft===0
                      ? "오늘 자정에 서비스가 만료됩니다."
                      : `${alertPopup.daysLeft}일 후 서비스가 만료됩니다.`}
                    <br/>만료 후에는 <strong>모든 기능이 정지</strong>됩니다.
                  </div>
                ) : (
                  <div style={{fontSize:14,color:"var(--text)",lineHeight:1.8}}>
                    오늘 <strong>{alertPopup.used}개</strong> {alertPopup.type==="insta"?"발송":"발행"} 완료 / 한도 <strong>{alertPopup.limit}개</strong>
                    <br/>남은 {alertPopup.type==="insta"?"발송":"발행"} 수: <strong style={{color:"var(--warn)"}}>{(alertPopup.limit||0)-(alertPopup.used||0)}개</strong>
                    <div style={{marginTop:10,height:6,borderRadius:99,background:"var(--border)",overflow:"hidden"}}>
                      <div style={{height:"100%",borderRadius:99,width:`${Math.min(100,((alertPopup.used||0)/(alertPopup.limit||1))*100)}%`,background:"linear-gradient(90deg,#ff9f3f,#ff6600)",transition:"width .4s"}}/>
                    </div>
                  </div>
                )}
                <div style={{display:"flex",gap:8,marginTop:16}}>
                  <button onClick={()=>setAlertPopup(null)}
                    style={{flex:1,padding:"10px",borderRadius:10,border:"1px solid var(--border)",background:"var(--card2)",color:"var(--text2)",cursor:"pointer",fontSize:13,fontWeight:700,fontFamily:"inherit"}}>
                    닫기
                  </button>
                  <a href="https://open.kakao.com/o/s0lQ66wi" target="_blank" rel="noopener noreferrer"
                    onClick={()=>setAlertPopup(null)}
                    style={{flex:2,padding:"10px",borderRadius:10,border:"none",background:alertPopup.type==="expire"?"linear-gradient(135deg,#ff5363,#ff3366)":"linear-gradient(135deg,#ff9f3f,#ff6600)",color:"var(--g-fg)",cursor:"pointer",fontSize:13,fontWeight:800,fontFamily:"inherit",textDecoration:"none",display:"flex",alignItems:"center",justifyContent:"center",gap:6}}>
                    💬 {alertPopup.type==="expire" ? "카카오로 갱신 문의" : "카카오로 업그레이드 문의"}
                  </a>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 소개 영상 모달 */}
        {showVideo&&(
          <div className="video-overlay" onClick={()=>setShowVideo(false)}>
            <div className="video-frame" onClick={e=>e.stopPropagation()}>
              <button className="video-close" onClick={()=>setShowVideo(false)}>✕</button>
              <video src="intro-assets/publy-intro.mp4" autoPlay controls playsInline style={{width:"100%",height:"100%",objectFit:"contain",background:"#000",display:"block"}} />
            </div>
          </div>
        )}

        {/* 가이드 모달 */}
        {showGuide&&(
          <div className="guide-overlay" onClick={closeGuideAndOpenBook}>
            <div className="guide-modal" onClick={e=>e.stopPropagation()}>
              <div className="guide-header" style={{position:"relative"}}>
                <div className="guide-logo-row"><div className="guide-logo-ico">📖</div><div><div className="guide-title">PUBLY 사용설명서</div><div className="guide-subtitle">처음이세요? 이것만 읽으면 바로 시작!</div></div></div>
                <button className="guide-close" onClick={closeGuideAndOpenBook}>✕</button>
                <div className="guide-tabs">{guideTabs.map((t,i)=><button key={i} className={`guide-tab ${guideTab===i?"active":""}`} onClick={()=>setGuideTab(i)}>{t}</button>)}</div>
              </div>
              <div className="guide-body">{guidePages[guideTab]}</div>
              <div className="guide-footer">
                <button className="guide-nav-btn" style={{borderColor:"var(--g-line)",background:"transparent",color:"var(--g-fg2)"}} onClick={()=>setGuideTab(Math.max(0,guideTab-1))} disabled={guideTab===0}>← 이전</button>
                <span className="guide-page">{guideTab+1} / {guideTabs.length}</span>
                {guideTab<guideTabs.length-1?<button className="guide-nav-btn" style={{borderColor:Y,background:`${Y}15`,color:"var(--g-yellow)"}} onClick={()=>setGuideTab(guideTab+1)}>다음 →</button>:<button className="guide-nav-btn" style={{borderColor:G,background:`${G}15`,color:"var(--g-green)"}} onClick={closeGuideAndOpenBook}>✅ 시작하기!</button>}
              </div>
            </div>
          </div>
        )}



        {/* ── 헤더 ── */}
        <div className="header">
          <button className="logo" type="button" onClick={handleLogoTap} aria-label="퍼블리 로고" style={{background:"transparent",border:0,cursor:"pointer",fontFamily:"inherit"}}>
            <div className="logo-ico" style={{fontSize:17,fontWeight:900,color:"#fff"}}>T</div>
            <span className="logo-text">TRAFFIC</span>
          </button>
          {appVersion&&<span style={{fontSize:10.5,color:"var(--text3)",fontWeight:600,whiteSpace:"nowrap"}}>{appVersion.startsWith("v")?appVersion:`v${appVersion}`}</span>}
          <div className="header-mid">
            <button className={`plat-btn ${platform==="naver"?"plat-btn-naver":"plat-btn-naver-off"}`} onClick={()=>setPlatform("naver")}>🟢 네이버</button>
            <button className={`plat-btn ${platform==="tistory"?"plat-btn-tistory":"plat-btn-tistory-off"}`} onClick={()=>setPlatform("tistory")}>🟠 티스토리</button>
            <div style={{width:1,height:16,background:"var(--border)",flexShrink:0}}/>
            <div className={`server-chip ${botOnline?"server-on":"server-off"}`}><div className={`dot ${botOnline?"dot-on":"dot-off"}`}/>{botOnline?"서버 온라인":"서버 오프라인"}</div>
            {proxyActive && <div className="server-chip proxy-chip" title="관리자가 프록시(전용 IP)를 켜줬어요. 안전하게 자동 접속 중이에요."><div className="dot"/>프록시 ON</div>}
            {(["unlimited","admin"] as string[]).includes(user.plan)
              ? <div className="quota-chip"><div className="quota-bar-bg"><div className="quota-bar-fill" style={{width:"100%"}}/></div>무제한<span className={`plan-badge plan-${user.plan}`}>{PLAN_LABELS[user.plan]}</span></div>
              : <div className="quota-chip"><div className="quota-bar-bg"><div className="quota-bar-fill" style={{width:`${Math.min(100,(dailyPublishUsed/(PLAN_CONFIG[user.plan]?.dailyPublish??2))*100)}%`}}/></div>{Math.max(0,(PLAN_CONFIG[user.plan]?.dailyPublish??2)-dailyPublishUsed)}건<span className={`plan-badge plan-${user.plan}`}>{PLAN_LABELS[user.plan]}</span></div>}
          </div>
          <div className="header-right">
            <button className="video-open-btn" onClick={()=>setShowVideo(true)} title="소개 영상 보기">🎬 <span className="guide-btn-text">영상</span></button>
            <button className="guide-open-btn" onClick={()=>{setShowGuide(true);setGuideTab(0);}}>📖 <span className="guide-btn-text">사용설명서</span></button>
            <button className="guide-open-btn" onClick={()=>setShowDaebaekseo(true)} title="어떤 순서로 어떨 때 쓰면 좋은지 모아둔 퍼블리 대백서" style={{background:"linear-gradient(135deg,#ff7eb6,#ff5a98)",color:"#fff",border:0}}>📚 <span className="guide-btn-text">대백서</span></button>
            <button className="icon-btn" onClick={onThemeToggle} title="화면 밝기 전환" aria-label="테마 전환">{theme==="dark"?"☀️":"🌙"}</button>
            <button className="icon-btn" onClick={handleHeaderRefresh} title="새로고침" aria-label="새로고침" disabled={refreshing}><span style={{display:"inline-block",animation:refreshing?"publySpin .55s linear infinite":"none"}}>🔄</span></button>

            {/* 유저 칩 + 드롭다운 */}
            <div style={{position:"relative"}}>
              <div className="user-chip" onClick={()=>{setShowUserDrop(v=>!v);loadReferrals();}}>
                <div className="user-avatar">{(user.name||user.email)[0].toUpperCase()}</div>
                <span className="user-name">{user.name||user.email.split("@")[0]}</span>
              </div>
              {showUserDrop&&(
                <>
                  {/* 배경 클릭 닫기 */}
                  <div style={{position:"fixed",inset:0,zIndex:199}} onClick={()=>setShowUserDrop(false)}/>
                  <div style={{
                    position:"absolute",top:"calc(100% + 8px)",right:0,zIndex:200,
                    width:220,borderRadius:14,overflow:"hidden",
                    background:"var(--card)",border:"1px solid var(--border)",
                    boxShadow:"0 8px 32px rgba(0,0,0,.18)",
                  }}>
                    {/* 유저 정보 */}
                    <div style={{padding:"14px 16px 12px",borderBottom:"1px solid var(--border)"}}>
                      <div style={{display:"flex",alignItems:"center",gap:10}}>
                        <div style={{width:36,height:36,borderRadius:10,background:"var(--accent-bg)",border:"1px solid var(--accent-border)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:15,fontWeight:900,color:"var(--accent-text)",flexShrink:0}}>
                          {(user.name||user.email)[0].toUpperCase()}
                        </div>
                        <div style={{minWidth:0}}>
                          <div style={{fontSize:13,fontWeight:700,color:"var(--text)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{user.name||user.email.split("@")[0]}</div>
                          <span style={{fontSize:10,fontWeight:800,padding:"1px 7px",borderRadius:99,background:"var(--accent-bg)",color:"var(--accent-text)",border:"1px solid var(--accent-border)"}}>{PLAN_LABELS[user.plan]||user.plan}</span>
                        </div>
                      </div>
                    </div>
                    {/* 초대 코드 */}
                    <div style={{padding:"12px 16px",borderBottom:"1px solid var(--border)"}}>
                      <div style={{fontSize:10,fontWeight:700,color:"var(--text3)",marginBottom:6,letterSpacing:".05em"}}>🎁 내 초대 코드</div>
                      <div style={{display:"flex",alignItems:"center",gap:6}}>
                        <code style={{flex:1,fontSize:12,fontWeight:700,color:"var(--accent-text)",background:"var(--accent-bg)",border:"1px solid var(--accent-border)",borderRadius:7,padding:"5px 9px",letterSpacing:".08em",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                          {user.id.slice(0,8).toUpperCase()}
                        </code>
                        <button onClick={()=>{navigator.clipboard.writeText(user.id.slice(0,8).toUpperCase());showToast("📋 초대 코드 복사됐어요!");setShowUserDrop(false);}}
                          style={{padding:"5px 10px",borderRadius:7,border:"1px solid var(--border)",background:"var(--bg2)",color:"var(--text2)",cursor:"pointer",fontSize:11,fontWeight:700,flexShrink:0,fontFamily:"inherit"}}>
                          복사
                        </button>
                      </div>
                    </div>
                    {/* 초대한 친구 */}
                    <div style={{padding:"12px 16px",borderBottom:"1px solid var(--border)"}}>
                      <button onClick={()=>{setShowUserDrop(false);setShowReferralModal(true);}}
                        style={{width:"100%",display:"flex",alignItems:"center",justifyContent:"space-between",background:"none",border:"none",cursor:"pointer",padding:0,fontFamily:"inherit"}}>
                        <span style={{fontSize:12,fontWeight:600,color:"var(--text2)"}}>👥 초대한 친구</span>
                        <span style={{display:"flex",alignItems:"center",gap:6}}>
                          <span style={{fontSize:12,fontWeight:800,color:"var(--accent-text)",background:"var(--accent-bg)",border:"1px solid var(--accent-border)",borderRadius:99,padding:"2px 9px"}}>{myReferrals.length}명</span>
                          <span style={{fontSize:11,color:"var(--text3)"}}>→</span>
                        </span>
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>

            <button className="logout-btn" onClick={()=>{window.electron?.unregisterUser(user.id);onLogout();}}>로그아웃</button>
          </div>
        </div>

        {/* 래퍼럴 전체화면 모달 */}
        {showReferralModal&&(
          <div style={{position:"fixed",inset:0,zIndex:500,background:"var(--bg)",display:"flex",flexDirection:"column"}}>
            {/* 헤더 */}
            <div style={{padding:"20px 24px",borderBottom:"1px solid var(--border)",display:"flex",alignItems:"center",gap:14,flexShrink:0}}>
              <button onClick={()=>setShowReferralModal(false)}
                style={{width:36,height:36,borderRadius:10,border:"1px solid var(--border)",background:"var(--card)",cursor:"pointer",fontSize:18,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                ←
              </button>
              <div>
                <div style={{fontSize:17,fontWeight:800,color:"var(--text)"}}>👥 내가 초대한 친구</div>
                <div style={{fontSize:12,color:"var(--text3)",marginTop:2}}>총 {myReferrals.length}명</div>
              </div>
            </div>
            {/* 목록 */}
            <div style={{flex:1,overflowY:"auto",padding:"16px 24px"}}>
              {myReferrals.length===0?(
                <div style={{textAlign:"center",padding:"60px 0",color:"var(--text3)"}}>
                  <div style={{fontSize:40,marginBottom:12}}>🎁</div>
                  <div style={{fontSize:15,fontWeight:600,marginBottom:6}}>아직 초대한 친구가 없어요</div>
                  <div style={{fontSize:13}}>초대 코드를 공유해보세요!</div>
                  <div style={{marginTop:20,display:"inline-flex",alignItems:"center",gap:10,background:"var(--card)",border:"1px solid var(--border)",borderRadius:12,padding:"12px 18px"}}>
                    <code style={{fontSize:14,fontWeight:800,color:"var(--accent-text)",letterSpacing:".1em"}}>{user.id.slice(0,8).toUpperCase()}</code>
                    <button onClick={()=>{navigator.clipboard.writeText(user.id.slice(0,8).toUpperCase());showToast("📋 복사됐어요!");}}
                      style={{padding:"5px 12px",borderRadius:7,border:"1px solid var(--accent-border)",background:"var(--accent-bg)",color:"var(--accent-text)",cursor:"pointer",fontSize:12,fontWeight:700,fontFamily:"inherit"}}>
                      복사
                    </button>
                  </div>
                </div>
              ):(
                <div style={{display:"flex",flexDirection:"column",gap:8,maxWidth:560,margin:"0 auto"}}>
                  {myReferrals.map((u,i)=>(
                    <div key={u.id} style={{display:"flex",alignItems:"center",gap:12,padding:"14px 16px",borderRadius:12,background:"var(--card)",border:"1px solid var(--border)"}}>
                      <div style={{width:40,height:40,borderRadius:11,background:"var(--accent-bg)",border:"1px solid var(--accent-border)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:15,fontWeight:900,color:"var(--accent-text)",flexShrink:0}}>
                        {(u.name||u.email||"?")[0].toUpperCase()}
                      </div>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontSize:14,fontWeight:700,color:"var(--text)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{u.name||"이름없음"}</div>
                        <div style={{fontSize:12,color:"var(--text3)",marginTop:2}}>{u.email} · {new Date(u.created_at).toLocaleDateString("ko-KR")} 가입</div>
                      </div>
                      <span style={{fontSize:11,fontWeight:800,padding:"4px 10px",borderRadius:99,flexShrink:0,
                        background:u.plan==="pro"?"rgba(99,102,241,.12)":u.plan==="basic"?"rgba(251,191,36,.1)":"var(--bg2)",
                        color:u.plan==="pro"?"#818cf8":u.plan==="basic"?"#f59e0b":"var(--text3)",
                        border:`1px solid ${u.plan==="pro"?"rgba(99,102,241,.3)":u.plan==="basic"?"rgba(251,191,36,.3)":"var(--border)"}`}}>
                        {u.plan==="pro"?"PRO":u.plan==="basic"?"BASIC":"FREE"}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* 레이아웃 */}
        <div className="layout">
          <div className="sidebar">
            {NAV_GROUPS.map(group=>(
              <div key={group.label} className={(group as any).boxed?"nav-box":""}>
                {group.label&&<div className={(group as any).boxed?"nav-box-lbl":"nav-lbl"}>{group.label}</div>}
                {group.tabs.map(t=> t.k==="inflow" ? (
                  <button key={t.k} className={`nav-item nav-crawl nav-shine ${tab===t.k?"active":""}`} onClick={()=>setTab(t.k)}>
                    <span className="nav-ico">{t.i}</span><span className="nav-crawl-label">{t.l}</span>
                  </button>
                ) : (
                  <button key={t.k} className={`nav-item ${tab===t.k?"active":""}`} onClick={()=>setTab(t.k)}>
                    <span className="nav-ico">{t.i}</span><span>{t.l}</span>
                  </button>
                ))}
              </div>
            ))}
            <div className="sidebar-foot">
              <div className="stat-card">
                {(["unlimited","admin"] as string[]).includes(user.plan)
                  ? <div className="stat-num" style={{color:"var(--text)"}}>{dailyPublishUsed}<span style={{fontSize:12,color:"var(--text3)",fontWeight:500}}> · 무제한</span></div>
                  : <div className="stat-num" style={{color: dailyPublishUsed >= (PLAN_CONFIG[user.plan]?.dailyPublish ?? 2) ? "var(--danger)" : "var(--text)"}}>
                      {dailyPublishUsed}<span style={{fontSize:12,color:"var(--text3)",fontWeight:500}}>/{PLAN_CONFIG[user.plan]?.dailyPublish ?? 2}</span>
                    </div>}
                <div className="stat-lbl">오늘 발행</div>
              </div>
              <div className="stat-card" style={{background:"var(--accent-bg)",borderColor:"var(--accent-border)"}}>
                <div className="stat-num" style={{fontSize:18,color:"var(--accent-text)"}}>{formatDaysLeft(quota?.reset_date)}</div>
                <div className="stat-lbl">만료일 {quota ? new Date(quota.reset_date).toLocaleDateString("ko-KR",{month:"numeric",day:"numeric"}) : "—"}</div>
              </div>
            </div>
          </div>

          <div className="main">

            {/* ── 사용한도 + 만료일 상태바 (항상 표시) ── */}
            {(()=>{
              const plan = user.plan;
              const config = PLAN_CONFIG[plan] ?? PLAN_CONFIG.free;
              const publishLimit = config.dailyPublish;
              const neighborLimit = NEIGHBOR_DAILY_LIMIT[plan] ?? 10;
              const engageLimit = ENGAGE_DAILY_LIMIT[plan] ?? 10;
              const replyLimit = REPLY_DAILY_LIMIT[plan] ?? 10;
              const expiry = quota ? new Date(quota.reset_date) : null;
              const daysLeft = quota ? daysUntil(quota.reset_date) : null;
              const dColor = daysLeft === null ? "var(--text3)" : daysLeft <= 3 ? "var(--danger)" : daysLeft <= 7 ? "#ff9f3f" : "var(--success)";
              // ★무제한이라도 서이추·공감·품앗이는 '네이버 안전 권장치'로 사용량을 보여준다(락 아님, 참고용). 넘으면 경고색.
              const items = [
                { label:"✍️ 글쓰기", used: dailyPublishUsed, limit: publishLimit, color:"var(--accent)", safe:0 },
                { label:"🤝 서이추", used: neighborUsed, limit: neighborLimit, color:"#00c8ff", safe:NAVER_SAFE_NEIGHBOR },
                { label:"❤️ 공감·댓글", used: engageUsed, limit: engageLimit, color:"#ff6b9d", safe:NAVER_SAFE_ENGAGE },
                { label:"💬 답방", used: replyUsed, limit: replyLimit, color:"#8b5cf6", safe:0 },
              ];
              return (
                <div style={{display:"flex",gap:10,marginBottom:16,flexWrap:"wrap",alignItems:"center"}}>
                  {items.map(({label,used,limit,color,safe})=>{
                    const unlimited = limit>=99999 || (["unlimited","admin"] as string[]).includes(plan);
                    const useSafe = unlimited && safe>0;                 // 무제한이라도 안전 권장치로 표시
                    const refLimit = useSafe ? safe : limit;
                    const pct = (unlimited && !useSafe) ? 100 : Math.min(100, (used/refLimit)*100);
                    const overSafe = useSafe && used>=safe;
                    const over = overSafe || (!unlimited && used>=limit);
                    const barColor = overSafe ? "#f59e0b" : over ? "var(--danger)" : color;   // 안전권장 초과=주황 경고, 실한도 초과=빨강
                    return (
                      <div key={label} style={{flex:1,minWidth:120,padding:"10px 14px",borderRadius:14,background:"var(--card)",border:`1px solid ${overSafe?"rgba(245,158,11,.45)":over?"rgba(255,83,99,.4)":"var(--border)"}`,transition:"border .2s"}}>
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
                          <span style={{fontSize:12,fontWeight:700,color:"var(--text2)"}}>{label}</span>
                          <span style={{fontSize:12,fontWeight:800,color:barColor}}>{used}<span style={{fontSize:11,color:"var(--text3)",fontWeight:500}}>{useSafe?` · 권장 ${safe}`:(unlimited?" · 무제한":`/${limit}`)}</span></span>
                        </div>
                        <div style={{height:5,borderRadius:99,background:"var(--border)",overflow:"hidden"}}>
                          <div style={{height:"100%",borderRadius:99,width:`${pct}%`,background:barColor,transition:"width .4s"}}/>
                        </div>
                        {overSafe&&<div style={{fontSize:10.5,color:"#f59e0b",fontWeight:700,marginTop:4}}>⚠️ 네이버 안전 권장({safe})을 넘었어요 — 계정 보호 위해 잠시 쉬어가는 걸 권해요</div>}
                      </div>
                    );
                  })}
                  <div style={{padding:"10px 16px",borderRadius:14,background:"var(--card)",border:`1px solid ${daysLeft!==null&&daysLeft<=3?"rgba(255,83,99,.4)":daysLeft!==null&&daysLeft<=7?"rgba(255,159,63,.3)":"var(--border)"}`,whiteSpace:"nowrap"}}>
                    <div style={{fontSize:11,color:"var(--text3)",fontWeight:600,marginBottom:3}}>📅 만료일</div>
                    <div style={{fontSize:13,fontWeight:800,color:dColor}}>{expiry?expiry.toLocaleDateString("ko-KR",{month:"numeric",day:"numeric"}):"—"}</div>
                    <div style={{fontSize:11,color:dColor,fontWeight:600,marginTop:1}}>{formatDaysLeft(quota?.reset_date)}</div>
                  </div>
                </div>
              );
            })()}
            {/* ═══ 🎛️ 컨트롤타워 탭 ═══ */}
            {tab==="control"&&(()=>{
              const cfg = PLAN_CONFIG[user.plan] ?? PLAN_CONFIG.free;
              const isUnlim = (["unlimited","admin"] as string[]).includes(user.plan);
              const perf = [
                {label:"오늘 발행", icon:"🚀", used:dailyPublishUsed, limit:cfg.dailyPublish??2, color:"var(--accent)", go:"publish" as MainTab, hint:"오늘 블로그에 발행한 글 수예요", safe:0},
                {label:"서이추",    icon:"🤝", used:neighborUsed,   limit:NEIGHBOR_DAILY_LIMIT[user.plan]??10, color:"#00b8d4", go:"neighbor" as MainTab, hint:"오늘 보낸 서로이웃 신청 수예요", safe:NAVER_SAFE_NEIGHBOR},
                {label:"공감·댓글", icon:"❤️", used:engageUsed,     limit:ENGAGE_DAILY_LIMIT[user.plan]??10,   color:"#e5397f", go:"engage" as MainTab,   hint:"오늘 남긴 공감·댓글 수예요", safe:NAVER_SAFE_ENGAGE},
                {label:"답방",      icon:"💬", used:replyUsed,      limit:REPLY_DAILY_LIMIT[user.plan]??10,    color:"#8b5cf6", go:"reply" as MainTab,    hint:"오늘 내 글 댓글에 답한 수예요", safe:0},
              ];
              const now = new Date();
              const greeting = now.getHours()<12?"좋은 아침이에요":now.getHours()<18?"좋은 오후예요":"오늘도 수고 많으셨어요";
              const recent = history.slice(0,5);
              return (
                <div className="ct" style={{animation:"fadeUp .3s ease both"}}>
                  {/* 상단 인사 + 플랜 */}
                  <div className="ct-hero">
                    <div className="ct-hero-left">
                      <div className="ct-hero-eyebrow">🎛️ 컨트롤타워 · {now.toLocaleDateString("ko-KR",{month:"long",day:"numeric",weekday:"long"})}</div>
                      <h1 className="ct-hero-title">{greeting}, <b>{user.name||"회원"}</b>님</h1>
                      <p className="ct-hero-sub">내 블로그 자동화의 <b>모든 현황을 한눈에</b> 관리하는 관제탑이에요. 오늘의 성과를 확인하고, 원하는 작업으로 바로 이동하세요.</p>
                    </div>
                    <div className="ct-hero-plan">
                      <div className="ct-plan-badge">{PLAN_LABELS[user.plan]}</div>
                      <div className="ct-plan-days">{formatDaysLeft(quota?.reset_date)}</div>
                      <div className="ct-plan-lbl">이용권 남음</div>
                    </div>
                  </div>

                  {/* 📈 자동화 현황 그래프 + 시너지 수치 (실데이터 · 주간/월간/1년) */}
                  {(()=>{
                    const fbLen = actRange==="year"?12:actRange==="month"?30:7;
                    const wk = weekly.length ? weekly : Array.from({length:fbLen},(_,i)=>{ const d=new Date(Date.now()-(fbLen-1-i)*86400000); return {date:"",label: actRange==="year"?`${((new Date().getMonth()-(11-i)+12)%12)+1}월`:`${d.getMonth()+1}/${d.getDate()}`,publish:0,neighbor:0,engage:0,reply:0,total:0}; });
                    const weekTotal = wk.reduce((s,d)=>s+d.total,0);
                    const maxTotal = Math.max(1,...wk.map(d=>d.total));
                    const savedMin = weekTotal*3;   // 작업 1건당 약 3분 수작업 절감 가정
                    const savedHours = Math.floor(savedMin/60), savedRemMin = savedMin%60;
                    const cumPublish = history.length;   // 누적 발행(발행 이력 총계)
                    const parts=[{k:"publish",label:"발행",color:"var(--accent)"},{k:"neighbor",label:"서이추",color:"#00b8d4"},{k:"engage",label:"공감·댓글",color:"#e5397f"},{k:"reply",label:"답방",color:"#8b5cf6"}] as const;
                    const rLabel = actRange==="year"?"최근 1년":actRange==="month"?"최근 30일":"이번 주";
                    const rDesc = actRange==="year"?"최근 12개월간 자동화가 처리한 작업이에요. 매달 이어질수록 블로그가 커집니다.":actRange==="month"?"최근 30일간 퍼블리가 자동으로 처리한 작업이에요.":"최근 7일간 퍼블리가 자동으로 처리한 작업이에요. 여러 기능이 합쳐져 블로그를 키웁니다.";
                    // 연속: 일별(week/month)=연속 활동일, 년=활동한 달 수
                    // ★오늘(마지막 칸)이 아직 0이면 '진행 중'으로 보고 건너뜀 → 자정 지났다고 어제까지 쌓은 연속이 0으로 리셋되지 않게(GitHub/듀오링고식).
                    const streak=(()=>{let i=wk.length-1;if(i>=0&&wk[i].total===0)i--;let s=0;for(;i>=0;i--){if(wk[i].total>0)s++;else break;}return s;})();
                    return (
                  <section className="ct-section">
                    <div className="ct-sec-head" style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:12,flexWrap:"wrap"}}>
                      <div>
                        <h2 className="ct-sec-title">📈 자동화 현황</h2>
                        <p className="ct-sec-desc">{rDesc} 기록은 <b>매일 계속 누적</b>돼요.</p>
                      </div>
                      <div style={{display:"flex",gap:4,background:"var(--bg)",border:"1px solid var(--border)",borderRadius:12,padding:4,flexShrink:0}}>
                        {([["week","주간"],["month","월간"],["year","1년"]] as [ActivityRange,string][]).map(([r,l])=>(
                          <button key={r} onClick={()=>setActRange(r)} style={{padding:"7px 14px",borderRadius:9,border:"none",cursor:"pointer",fontSize:12.5,fontWeight:800,fontFamily:"inherit",background: actRange===r?"var(--accent)":"transparent",color: actRange===r?"#fff":"var(--text2)",transition:"all .15s"}}>{l}</button>
                        ))}
                      </div>
                    </div>
                    {/* 시너지 수치 4개 */}
                    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))",gap:12,marginBottom:20}}>
                      {[
                        {ic:"⚡",lbl:`${rLabel} 총 작업`,val:`${weekTotal.toLocaleString()}건`,sub:"발행+서이추+공감+답방",color:"var(--accent-text)"},
                        {ic:"⏱️",lbl:"아낀 시간(약)",val: savedHours>0?`${savedHours}시간 ${savedRemMin}분`:`${savedMin}분`,sub:"수작업 대비 절감",color:"#f59e0b"},
                        {ic:"📝",lbl:"누적 발행 글",val:`${cumPublish.toLocaleString()}개`,sub:"전체 기간 누적",color:"#00b487"},
                        {ic:"🔥",lbl: actRange==="year"?"연속 활동 달":"연속 활동일",val:`${streak}${actRange==="year"?"개월":"일"}`,sub:"이어갈수록 지수 ↑",color:"#e5397f"},
                      ].map(m=>(
                        <div key={m.lbl} style={{background:"var(--bg)",border:"1px solid var(--border)",borderRadius:16,padding:"16px 14px"}}>
                          <div style={{fontSize:11.5,color:"var(--text3)",fontWeight:700,marginBottom:6,display:"flex",alignItems:"center",gap:5}}><span>{m.ic}</span>{m.lbl}</div>
                          <div style={{fontSize:22,fontWeight:900,color:m.color,lineHeight:1.1}}>{m.val}</div>
                          <div style={{fontSize:10.5,color:"var(--text3)",marginTop:4}}>{m.sub}</div>
                        </div>
                      ))}
                    </div>
                    {/* 주간 누적 막대그래프 */}
                    <div style={{background:"var(--bg)",border:"1px solid var(--border)",borderRadius:16,padding:"18px 16px"}}>
                      <div style={{display:"flex",alignItems:"flex-end",justifyContent:"space-between",gap:8,height:140,padding:"0 4px"}}>
                        {wk.map((d,i)=>(
                          <div key={i} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:6,height:"100%",justifyContent:"flex-end"}}>
                            <div style={{fontSize:10,fontWeight:800,color:"var(--text2)",opacity:d.total?1:.35}}>{d.total||""}</div>
                            <div title={`${d.label} · ${d.total}건`} style={{width:"78%",maxWidth:34,display:"flex",flexDirection:"column-reverse",borderRadius:"7px 7px 3px 3px",overflow:"hidden",height:`${Math.max(3,(d.total/maxTotal)*100)}%`,minHeight:d.total?10:3,background:d.total?"transparent":"var(--border)",transition:"height .4s"}}>
                              {d.total>0 && parts.map(p=>{ const v=(d as any)[p.k] as number; if(!v) return null; return <div key={p.k} style={{height:`${(v/d.total)*100}%`,background:p.color}} title={`${p.label} ${v}`}/>; })}
                            </div>
                            <div style={{fontSize:10.5,color:"var(--text3)",fontWeight:600}}>{d.label}</div>
                          </div>
                        ))}
                      </div>
                      {/* 범례 */}
                      <div style={{display:"flex",flexWrap:"wrap",gap:12,justifyContent:"center",marginTop:14,paddingTop:12,borderTop:"1px solid var(--border)"}}>
                        {parts.map(p=>(<div key={p.k} style={{display:"flex",alignItems:"center",gap:5,fontSize:11,color:"var(--text2)",fontWeight:600}}><span style={{width:10,height:10,borderRadius:3,background:p.color}}/>{p.label}</div>))}
                      </div>
                      {weekTotal===0 && <div style={{textAlign:"center",fontSize:12,color:"var(--text3)",marginTop:12,lineHeight:1.6}}>아직 이번 주 활동이 없어요. <b style={{color:"var(--accent-text)"}}>글 발행·서이추·공감·답방</b>을 시작하면 여기 쌓여요 📊</div>}
                    </div>
                  </section>
                    );
                  })()}

                  {/* 💰 수익 루프 — 노트북 한 대로 도는 자동 캐시플로우. 각 단계가 왜 필요한지 + 실제 기능으로 이동 */}
                  <section className="ct-section" style={{background:"linear-gradient(135deg,rgba(255,196,0,.07),transparent 60%),var(--card)",border:"1px solid rgba(255,180,0,.3)"}}>
                    <div className="ct-sec-head">
                      <h2 className="ct-sec-title">💰 수익 루프 <span style={{fontSize:11,fontWeight:800,color:"#000",background:"linear-gradient(135deg,#ffd85e,#ffab2e)",padding:"2px 8px",borderRadius:99}}>노트북 한 대로</span></h2>
                      <p className="ct-sec-desc">발굴 → 홍보 → 수익화 → 상위노출이 <b>하나로 이어져 돌아가는 흐름</b>이에요. 각 단계는 <b>왜 필요한지</b> 이유가 있고, 버튼을 누르면 <b>실제 그 기능</b>으로 바로 갑니다.</p>
                    </div>
                    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(155px,1fr))",gap:10}}>
                      {[
                        {n:1,icon:"🔍",title:"블로거·업체 발굴",why:"홍보해줄 블로거와 잠재 고객(업체)을 직접 찾아야 시작돼요.",act:"크롤링 열기",go:()=>{ if(crawlEnabled) setTab("crawl"); else setShowCrawlLock(true); }},
                        {n:2,icon:"🌱",title:"홍보할 상품 찾기",why:"팔 물건(온종일팜 산지 상품)이 있어야 콘텐츠가 수익으로 이어져요.",act:"온종일팜 열기",href:"https://app.yuanfnb.com/landing"},
                        {n:3,icon:"🔗",title:"온파트너로 수익화",why:"추천 링크가 있어야 내가 소개한 상품이 팔릴 때 수익이 들어와요.",act:"온파트너 신청",href:"https://partner.yuanfnb.com/pages/signup.html"},
                        {n:4,icon:"✍️",title:"퍼블리로 홍보글 발행",why:"블로그·SNS에 글을 올려야 링크가 노출되고 클릭·구매가 생겨요.",act:"글 생성 열기",go:()=>setTab("write")},
                        {n:5,icon:"📈",title:"상위노출로 증폭",why:"검색 상위에 떠야 더 많은 사람이 보고, 이 과정이 반복·확대돼요.",act:"순위 관리 열기",go:()=>setTab("place")},
                      ].map((s,i,arr)=>(
                        <div key={s.n} style={{position:"relative",display:"flex",flexDirection:"column",background:"var(--bg)",border:"1px solid var(--border)",borderRadius:14,padding:"14px 13px"}}>
                          <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:7}}>
                            <span style={{width:22,height:22,flexShrink:0,borderRadius:"50%",background:"linear-gradient(135deg,#ffd85e,#ffab2e)",color:"#3a2500",fontSize:12,fontWeight:900,display:"flex",alignItems:"center",justifyContent:"center"}}>{s.n}</span>
                            <span style={{fontSize:18}}>{s.icon}</span>
                          </div>
                          <div style={{fontSize:13.5,fontWeight:800,color:"var(--text)",marginBottom:5}}>{s.title}</div>
                          <div style={{fontSize:11.5,color:"var(--text2)",lineHeight:1.5,flex:1,marginBottom:10}}><b style={{color:"#c78a00"}}>왜?</b> {s.why}</div>
                          {"href" in s
                            ? <a href={s.href} target="_blank" rel="noreferrer" style={{textAlign:"center",padding:"8px",borderRadius:9,background:"var(--card2)",border:"1px solid var(--border)",color:"var(--accent-text)",fontSize:12,fontWeight:800,textDecoration:"none"}}>{s.act} ↗</a>
                            : <button onClick={s.go} style={{padding:"8px",borderRadius:9,background:"var(--accent)",border:"none",color:"#fff",fontSize:12,fontWeight:800,cursor:"pointer",fontFamily:"inherit"}}>{s.act} →</button>}
                          {i<arr.length-1 && <span style={{position:"absolute",right:-9,top:"50%",transform:"translateY(-50%)",fontSize:15,color:"#ffab2e",zIndex:1}} className="loop-arrow">→</span>}
                        </div>
                      ))}
                    </div>
                    <div style={{marginTop:12,padding:"10px 14px",borderRadius:10,background:"rgba(255,180,0,.09)",border:"1px dashed rgba(255,180,0,.4)",fontSize:12,color:"var(--text2)",lineHeight:1.55,fontWeight:600}}>🔄 <b style={{color:"#c78a00"}}>다시 1번으로.</b> 5번에서 얻은 수익·노출이 다시 발굴·홍보에 재투자돼요. 노트북 한 대로 이 바퀴가 계속 굴러갈수록 캐시플로우가 커집니다.</div>
                  </section>

                  {/* 🎯 내 업종에 맞게 시작 — 대상별 시작 경로(각각 실제 첫 기능으로 이동) */}
                  <section className="ct-section">
                    <div className="ct-sec-head">
                      <h2 className="ct-sec-title">🎯 내 상황에 맞게 시작하기</h2>
                      <p className="ct-sec-desc">뭘 먼저 해야 할지 모르겠다면, <b>내 경우를 골라</b> 바로 시작하세요. 상황별 추천 순서로 안내해요.</p>
                    </div>
                    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(210px,1fr))",gap:10}}>
                      {[
                        {icon:"🏪",who:"매장·플레이스 사장님",desc:"내 가게를 검색 상위에 올리고 리뷰를 관리",steps:"플레이스365 진단 → 리뷰답글 → 블로그 리뷰로 상위노출",act:"플레이스365 시작",go:()=>{ if(place360Enabled) setTab("place"); else showToast("플레이스365는 관리자 승인이 필요해요","info"); }},
                        {icon:"🛒",who:"쇼핑몰·온라인 판매",desc:"상품을 블로거·블로그로 홍보해 매출 상승",steps:"블로거 발굴 → 홍보글 발행 → 블로그 순위 관리",act:"홍보글 만들기",go:()=>setTab("write")},
                        {icon:"🚀",who:"창업·프랜차이즈 모집",desc:"모집 홍보글을 검색 상위에 올려 예비 창업자를 유입",steps:"모집 홍보글 발행 → 블로그 상위노출 → 예비 창업자 검색 유입 → 문의",act:"모집 홍보글 만들기",go:()=>setTab("write")},
                        {icon:"💸",who:"부업·N잡러",desc:"추천 링크로 소개 수익 만들기",steps:"온파트너 가입 → 상품 링크 → SNS·블로그 홍보",act:"온파트너 열기",href:"https://partner.yuanfnb.com/pages/signup.html"},
                      ].map(p=>(
                        <div key={p.who} style={{display:"flex",flexDirection:"column",background:"var(--bg)",border:"1px solid var(--border)",borderRadius:14,padding:"15px 14px"}}>
                          <div style={{fontSize:24,marginBottom:7}}>{p.icon}</div>
                          <div style={{fontSize:14,fontWeight:800,color:"var(--text)",marginBottom:4}}>{p.who}</div>
                          <div style={{fontSize:12,color:"var(--text2)",lineHeight:1.5,marginBottom:8}}>{p.desc}</div>
                          <div style={{fontSize:11,color:"var(--text3)",lineHeight:1.5,marginBottom:12,flex:1,paddingLeft:9,borderLeft:"2px solid var(--accent-30)"}}>{p.steps}</div>
                          {"href" in p
                            ? <a href={p.href} target="_blank" rel="noreferrer" style={{textAlign:"center",padding:"9px",borderRadius:9,background:"var(--accent)",color:"#fff",fontSize:12.5,fontWeight:800,textDecoration:"none"}}>{p.act} ↗</a>
                            : <button onClick={p.go} style={{padding:"9px",borderRadius:9,background:"var(--accent)",border:"none",color:"#fff",fontSize:12.5,fontWeight:800,cursor:"pointer",fontFamily:"inherit"}}>{p.act} →</button>}
                        </div>
                      ))}
                    </div>
                  </section>

                  {/* 오늘의 성과 */}
                  <section className="ct-section">
                    <div className="ct-sec-head">
                      <h2 className="ct-sec-title">📊 오늘의 성과</h2>
                      <p className="ct-sec-desc">오늘 하루 자동화가 처리한 작업량이에요. <b>카드를 누르면</b> 해당 기능 화면으로 바로 이동해요.</p>
                    </div>
                    <div className="ct-perf-grid">
                      {perf.map(p=>{
                        const useSafe = isUnlim && p.safe>0;    // 무제한이라도 서이추·공감은 네이버 안전 권장치로 표시(락 아님)
                        const refLimit = useSafe ? p.safe : p.limit;
                        const pct = (isUnlim && !useSafe)?Math.min(100,p.used):Math.min(100,(p.used/Math.max(1,refLimit))*100);
                        const overSafe = useSafe && p.used>=p.safe;
                        const danger = overSafe || (!isUnlim && p.used>=p.limit);
                        const barColor = overSafe?"#f59e0b":danger?"var(--danger)":p.color;
                        return (
                          <button key={p.label} className="ct-perf-card" onClick={()=>setTab(p.go)} style={{["--pc" as any]:p.color}}>
                            <div className="ct-perf-top"><span className="ct-perf-ico">{p.icon}</span><span className="ct-perf-name">{p.label}</span></div>
                            <div className="ct-perf-num">{p.used}<span className="ct-perf-lim">{useSafe?` · 권장 ${p.safe}`:(isUnlim?" · 무제한":` / ${p.limit}`)}</span></div>
                            <div className="ct-perf-bar"><div className="ct-perf-fill" style={{width:`${pct}%`,background:barColor}}/></div>
                            <div className="ct-perf-hint">{overSafe?`⚠️ 안전 권장 ${p.safe} 초과 — 잠시 쉬어가는 걸 권해요`:p.hint}</div>
                          </button>
                        );
                      })}
                    </div>
                  </section>

                  {/* 계정 안전 · 워밍업 */}
                  <section className="ct-section">
                    <div className="ct-sec-head">
                      <h2 className="ct-sec-title">🛡️ 계정 안전 · 워밍업</h2>
                      <p className="ct-sec-desc">새 계정에 갑자기 많은 서이추·공감을 하면 네이버가 스팸으로 보고 <b>제재</b>할 수 있어요. 워밍업은 계정 나이에 맞춰 <b>안전한 하루 활동량</b>을 단계별로 안내해, 계정을 오래오래 지켜줘요. (연결 30일이면 완료)</p>
                    </div>
                    <div className="ct-warm-grid">
                      {accounts.length===0
                        ? <div className="ct-empty">아직 연결된 계정이 없어요. <button className="ct-link" onClick={()=>setTab("accounts")}>계정 연결하러 가기 →</button></div>
                        : accounts.map(a=>{
                            const w = getWarmup(a.connected_at);
                            return (
                              <div key={a.id} className="ct-warm-card" style={{["--wc" as any]:w.color}}>
                                <div className="ct-warm-head">
                                  <div className="ct-warm-acc">
                                    <span className={`ct-acc-dot ${a.is_connected?"":"off"}`}/>
                                    <span className="ct-warm-name">{a.blog_name||a.username||"계정"}</span>
                                    <span className="ct-warm-plat">{a.platform==="naver"?"네이버":a.platform==="tistory"?"티스토리":a.platform}</span>
                                  </div>
                                  <div className="ct-warm-stage">{w.emoji} {w.label} <b>{w.stage}단계</b></div>
                                </div>
                                <div className="ct-warm-bar" title={`워밍업 진행 ${w.progress}%`}><div className="ct-warm-fill" style={{width:`${w.progress}%`}}/></div>
                                <div className="ct-warm-foot">
                                  <span className="ct-warm-age">{w.done?"✅ 워밍업 완료 · 안전":`연결 ${w.ageDays}일째 · 30일 목표`}</span>
                                  <span className="ct-warm-rec">오늘 권장 서이추 <b>{w.neighbor}</b> · 공감 <b>{w.engage}</b></span>
                                </div>
                              </div>
                            );
                          })}
                    </div>
                    {accounts.length>0&&(
                      <div className="ct-warm-note">
                        <span className="ct-warm-note-ico">💡</span>
                        <div><b>워밍업은 강제가 아니라 '안전 권장'이에요.</b> 원하시면 권장치보다 더 많이 활동하셔도 됩니다 — 다만 계정을 오래오래 지키려면 초반엔 천천히 늘려가시길 추천드려요.</div>
                      </div>
                    )}
                  </section>


                  {/* 최근 활동 */}
                  <section className="ct-section">
                    <div className="ct-sec-head">
                      <h2 className="ct-sec-title">📋 최근 활동</h2>
                      <p className="ct-sec-desc">최근 발행한 글 기록이에요. 문제가 생긴 글은 빨간색으로 표시돼요.</p>
                    </div>
                    {recent.length===0
                      ? <div className="ct-empty">아직 발행한 글이 없어요. <button className="ct-link" onClick={()=>setTab("keyword")}>첫 글 쓰러 가기 →</button></div>
                      : <div className="ct-recent">
                          {recent.map(h=>(
                            <div key={h.id} className="ct-recent-row" onClick={()=>h.post_url&&window.open(h.post_url,"_blank")} style={{cursor:h.post_url?"pointer":"default"}}>
                              <span className={`ct-recent-badge ct-${h.status}`}>{h.status==="success"?"성공":h.status==="fail"?"실패":"대기"}</span>
                              <span className="ct-recent-title">{h.title||"(제목 없음)"}</span>
                              <span className="ct-recent-plat">{h.platform==="naver"?"네이버":h.platform==="tistory"?"티스토리":h.platform}</span>
                              <span className="ct-recent-time">{new Date(h.published_at).toLocaleDateString("ko-KR",{month:"numeric",day:"numeric"})}</span>
                            </div>
                          ))}
                        </div>}
                  </section>
                </div>
              );
            })()}

            {/* ═══ 🔍 키워드/제목 탭 ═══ */}
            {tab==="keyword"&&(
              <div className="tab-keyword" style={{animation:"fadeUp .25s ease both"}}>
                <UsageGuide theme={theme==="dark"?"dark":"light"} accent={theme==="dark"?"#7aa2ff":"#2563eb"} subtitle="펄리예요! 쓸 주제부터 정해봐요. 인기 키워드와 제목을 추천해줄게요." steps={[{ico:"✏️",title:"주제·키워드 입력",desc:"쓰고 싶은 주제나 키워드를 적어요(예: 강남 맛집)."},{ico:"💡",title:"추천 받기",desc:"버튼을 누르면 인기 키워드와 제목 후보를 보여줘요."},{ico:"➡️",title:"제목 고르기",desc:"마음에 드는 제목을 고르면 ‘글 생성’으로 이어가요."}]} />
                <div className="steps">
                  {[{n:"1",t:"키워드 입력"},{n:"2",t:"제목 추천"},{n:"3",t:"제목 선택"}].map((s,i)=>{
                    const done=(i===0&&keywords.length>0)||(i===1&&titles.length>0)||(i===2&&!!selectedTitle);
                    const active=(i===0&&keywords.length===0)||(i===1&&keywords.length>0&&titles.length===0)||(i===2&&titles.length>0&&!selectedTitle);
                    return(<div key={i} className={`step-item ${done?"done":active?"active":""}`}><span className="step-n">STEP {s.n}</span>{done?"✓ ":""}{s.t}</div>);
                  })}
                </div>

                {/* 수익화 목적 + 플랫폼 */}
                <div className="card" style={{borderColor:onPartnerItems.length>0?"rgba(190,255,0,.38)":undefined}}>
                  <div className="card-title" style={{marginBottom:6}}>🌱 온파트너 상품 링크 <span style={{fontSize:11,color:"var(--text3)",fontWeight:600}}>({onPartnerItems.length}/{MAX_ONPARTNER})</span></div>
                  <div style={{fontSize:11,color:"var(--text3)",lineHeight:1.6,marginBottom:10}}>링크 넣고 <b>조회</b> → <b>저장</b>을 <b>최대 {MAX_ONPARTNER}개까지</b> 반복하면, 각 상품 링크가 본문에 자동 삽입돼요(네이버 상품 카드로 표시, Q&A·해시태그 위).</div>
                  {onPartnerItems.length<MAX_ONPARTNER&&(
                    <div style={{display:"flex",gap:7,alignItems:"stretch"}}>
                      <input className="inp" value={onPartnerLink} onChange={e=>{setOnPartnerLink(e.target.value);setOnPartnerError("");setOnPartnerPreview(null);}} onKeyDown={e=>e.key==="Enter"&&loadOnPartnerProduct()} placeholder="https://partner.yuanfnb.com/r/추천코드" style={{flex:1,minWidth:0}}/>
                      <button className="btn btn-secondary" onClick={loadOnPartnerProduct} disabled={onPartnerLoading} style={{flexShrink:0}}>{onPartnerLoading?<><span className="spinner"/>조회 중</>:"🔍 조회"}</button>
                    </div>
                  )}
                  {onPartnerError&&<div style={{fontSize:11,color:"var(--danger)",marginTop:7}}>⚠️ {onPartnerError}</div>}

                  {/* 조회된 상품 미리보기 (아직 추가 전) — 여기서 '추가' 눌러야 목록에 담김 */}
                  {onPartnerPreview&&(
                    <div style={{marginTop:12,padding:10,borderRadius:11,background:"var(--accent-bg)",border:"1.5px solid var(--accent-border)"}}>
                      <div style={{display:"flex",gap:12,alignItems:"center"}}>
                        {onPartnerPreview.product.image?<img src={onPartnerPreview.product.image} alt={onPartnerPreview.product.name} style={{width:56,height:56,borderRadius:9,objectFit:"cover",flexShrink:0}}/>:<div style={{width:56,height:56,borderRadius:9,background:"var(--bg2)",display:"grid",placeItems:"center",fontSize:22,flexShrink:0}}>🌱</div>}
                        <div style={{minWidth:0,flex:1}}>
                          <div style={{fontSize:13,fontWeight:800,color:"var(--text)",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{onPartnerPreview.product.name}</div>
                          <div style={{fontSize:12,fontWeight:800,color:"var(--accent-text)",marginTop:3}}>{onPartnerPreview.product.price?`${onPartnerPreview.product.price.toLocaleString("ko-KR")}원`:"가격은 상품 페이지에서 확인"}</div>
                          <div style={{fontSize:10,color:onPartnerPreview.product.available?"var(--success)":"var(--danger)",marginTop:3}}>{onPartnerPreview.product.available?"● 판매 중":"● 현재 판매 중지"}</div>
                        </div>
                      </div>
                      <div style={{display:"flex",gap:7,marginTop:10}}>
                        <button className="btn btn-primary" onClick={addOnPartnerProduct} style={{flex:1,justifyContent:"center"}}>💾 저장 (목록에 추가)</button>
                        <button className="btn btn-secondary" onClick={()=>{setOnPartnerPreview(null);setOnPartnerLink("");}} style={{flexShrink:0}}>취소</button>
                      </div>
                    </div>
                  )}

                  {/* 추가된 상품 목록 (최대 3) — 컴팩트 한 줄 (배너는 작은 썸네일) */}
                  {onPartnerItems.map((it,idx)=>(
                    <div key={it.product.partnerUrl||idx} style={{marginTop:8,padding:"8px 10px",borderRadius:10,background:"var(--card2)",border:"1px solid var(--border)",display:"flex",gap:10,alignItems:"center"}}>
                      <span style={{fontSize:11,fontWeight:800,color:"var(--accent-text)",flexShrink:0}}>{idx+1}</span>
                      {it.product.image?<img src={it.product.image} alt={it.product.name} style={{width:50,height:50,borderRadius:7,objectFit:"cover",flexShrink:0}}/>:<div style={{width:50,height:50,borderRadius:7,background:"var(--bg2)",display:"grid",placeItems:"center",fontSize:20,flexShrink:0}}>🌱</div>}
                      <div style={{minWidth:0,flex:1}}>
                        <div style={{fontSize:12.5,fontWeight:800,color:"var(--text)",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{it.product.name}</div>
                        <div style={{fontSize:11,fontWeight:800,color:"var(--accent-text)",marginTop:2}}>{it.product.price?`${it.product.price.toLocaleString("ko-KR")}원`:"가격 상품페이지 확인"}<span style={{fontSize:9,color:"var(--text3)",fontWeight:600,marginLeft:6}}>· 링크 자동삽입</span></div>
                      </div>
                      <button type="button" onClick={()=>setOnPartnerItems(prev=>prev.filter((_,i)=>i!==idx))} title="빼기" style={{border:0,background:"transparent",color:"var(--text3)",cursor:"pointer",fontSize:15,flexShrink:0}}>✕</button>
                    </div>
                  ))}

                  {onPartnerItems.length>0&&onPartnerItems.length===1&&(
                    <div style={{marginTop:8,display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,flexWrap:"wrap"}}>
                      <b style={{fontSize:11,color:"var(--text2)"}}>📍 배너 위치</b>
                      <select className="inp" value={onPartnerPlacement} onChange={e=>{const v=e.target.value as OnPartnerPlacement;setOnPartnerPlacement(v);localStorage.setItem("publy_onpartner_placement",v)}} style={{width:"min(200px,100%)",padding:"6px 9px",fontSize:11}}>
                        {Object.entries(ONPARTNER_PLACEMENT_INFO).map(([value,info])=><option key={value} value={value}>{info.label}</option>)}
                      </select>
                    </div>
                  )}
                  {onPartnerItems.length>1&&<div style={{marginTop:8,color:"var(--accent-text)",fontSize:10,fontWeight:800}}>본문에 골고루 분산 배치돼요 (Q&A·해시태그 위).</div>}
                </div>

                {/* ── 내 링크 (일반 사이트) — 온파트너와 별도, OG 썸네일 카드로 자동 배치 ── */}
                <div className="card" style={{borderColor:myLinks.length>0?"rgba(0,150,255,.35)":undefined}}>
                  <div className="card-title" style={{marginBottom:6}}>🔗 내 링크 넣기 <span style={{fontSize:11,color:"var(--text3)",fontWeight:600}}>({myLinks.length}/{MAX_MYLINK})</span></div>
                  <div style={{fontSize:11,color:"var(--text3)",lineHeight:1.6,marginBottom:10}}>내 사이트·블로그 등 <b>아무 링크</b>나 넣고 <b>추가</b>하면, 발행 시 이미지 바로 밑에 <b>썸네일 카드(OG)</b>로 자동 배치돼요. 온파트너와 안 섞여요. (최대 {MAX_MYLINK}개)</div>
                  {myLinks.length<MAX_MYLINK&&(
                    <div style={{display:"flex",gap:7,alignItems:"stretch"}}>
                      <input className="inp" value={myLinkInput} onChange={e=>{setMyLinkInput(e.target.value);setMyLinkError("");}} onKeyDown={e=>e.key==="Enter"&&addMyLink()} placeholder="https://내사이트.com  (또는 pick.온종일.com)" style={{flex:1,minWidth:0}}/>
                      <button className="btn btn-secondary" onClick={addMyLink} style={{flexShrink:0}}>＋ 추가</button>
                    </div>
                  )}
                  {myLinkError&&<div style={{fontSize:11,color:"var(--danger)",marginTop:7}}>⚠️ {myLinkError}</div>}
                  {myLinks.map((url,idx)=>(
                    <div key={url} style={{marginTop:8,padding:"9px 11px",borderRadius:10,background:"var(--card2)",border:"1px solid var(--border)",display:"flex",gap:10,alignItems:"center"}}>
                      <span style={{fontSize:14,flexShrink:0}}>🔗</span>
                      <div style={{minWidth:0,flex:1}}>
                        <div style={{fontSize:12.5,fontWeight:800,color:"var(--text)",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{url.replace(/^https?:\/\//,"")}</div>
                        <div style={{fontSize:10,color:"var(--text3)",fontWeight:600,marginTop:2}}>발행 시 썸네일 카드로 자동 삽입</div>
                      </div>
                      <button type="button" onClick={()=>setMyLinks(prev=>prev.filter((_,i)=>i!==idx))} title="빼기" style={{border:0,background:"transparent",color:"var(--text3)",cursor:"pointer",fontSize:15,flexShrink:0}}>✕</button>
                    </div>
                  ))}
                  {myLinks.length>1&&<div style={{marginTop:8,color:"#0096ff",fontSize:10,fontWeight:800}}>본문 이미지 밑에 골고루 배치돼요 (Q&A·해시태그 위).</div>}
                </div>

                <div className="card">
                  <div className="card-header">
                    <div className="card-title">🎯 수익화 목적 선택</div>
                    <select className="inp" style={{width:110,padding:"7px 10px",fontSize:12}} value={platform} onChange={e=>setPlatform(e.target.value as any)}>
                      <option value="naver">네이버</option><option value="tistory">티스토리</option>
                    </select>
                  </div>
                  <div className="adtype-row">
                    {([{id:"adpost",label:"📰 네이버 애드포스트",sub:"감성적·경험 공유형\n1200~1500자 최적",cls:"sel-adpost"},{id:"adsense",label:"🔍 구글 애드센스",sub:"정보성·SEO 최적화\n1500자+ 최적",cls:"sel-adsense"}] as const).map(t=>(
                      <button key={t.id} className={`adtype-btn ${adType===t.id?t.cls:""}`} onClick={()=>setAdType(t.id)}>
                        <div className="adtype-lbl">{t.label}</div>
                        <div className="adtype-sub" style={{whiteSpace:"pre-line"}}>{t.sub}</div>
                        {adType===t.id&&<div style={{position:"absolute",top:10,right:12,fontSize:14,color:t.id==="adpost"?"var(--naver)":"var(--info)"}}>✓</div>}
                      </button>
                    ))}
                  </div>

                  {/* 누적 키워드 풀 */}
                  {keywords.length>0&&(
                    <div style={{marginBottom:14}}>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                        <label className="inp-label" style={{margin:0}}>🏷️ 누적 키워드 <span style={{color:"var(--text3)",fontWeight:400}}>({keywords.length}/{MAX_KW})</span></label>
                        <button className="btn btn-danger btn-sm" style={{padding:"4px 10px",fontSize:11}} onClick={()=>{setKeywords([]);localStorage.removeItem("publy_kws");}}>전체 삭제</button>
                      </div>
                      <div style={{display:"flex",flexWrap:"wrap",gap:7}}>
                        {keywords.map((kw,i)=>(
                          <button key={i} onClick={()=>setKeyword(kw)} style={{padding:"7px 14px",borderRadius:99,fontSize:13,fontWeight:600,cursor:"pointer",border:`1.5px solid ${keyword===kw?"var(--accent)":"var(--border)"}`,background:keyword===kw?"var(--accent-bg)":"var(--bg)",color:keyword===kw?"var(--accent-text)":"var(--text2)",fontFamily:"inherit",transition:"all .15s"}}>{kw}</button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* 키워드 입력 */}
                  <label className="inp-label">🔍 키워드 입력</label>
                  <div style={{display:"flex",gap:8}}>
                    <input className="inp lg" style={{flex:1}} placeholder="예: 강남 맛집, 다이어트 방법, 제주도 여행..." value={keyword} onChange={e=>setKeyword(e.target.value)} onKeyDown={e=>e.key==="Enter"&&handleGenerateTitles(true)}/>
                  </div>

                  <div style={{display:"flex",gap:8,marginTop:12,flexWrap:"wrap"}}>
                    <button className="btn btn-secondary" onClick={recommendKeywordsForTitleTab} disabled={aiKeywordLoading||loadingTitles} style={{borderColor:"var(--accent)",color:"var(--accent-text)"}}>{aiKeywordLoading?<><span className="spinner"/>키워드 찾는 중...</>:<>✨ AI 키워드 30개 추천</>}</button>
                    <button className="btn btn-primary" onClick={()=>handleGenerateTitles(true)} disabled={loadingTitles||!keyword}>{loadingTitles?<><span className="spinner"/>추천 중...</>:<>⭐ 제목 {BATCH}개 추천받기</>}</button>
                    {titles.length>0&&<button className="btn btn-secondary" onClick={()=>handleGenerateTitles(false)} disabled={loadingTitles}>{titles.length>=MAX_TITLES?"🔄 초기화 후 재생성":"➕ 30개 추가"}</button>}
                    {titles.length>0&&<button className="btn btn-danger btn-sm" onClick={()=>{setTitles([]);setSelectedTitle("");localStorage.removeItem("publy_titles");}}>🗑 제목 초기화</button>}
                    <div style={{display:"flex",alignItems:"center",gap:6}}>
                      <button className="btn btn-secondary" onClick={fetchKeywordData} disabled={loadingKw||!keyword} style={{borderColor:"var(--naver)",color:"var(--naver)"}}>
                        {loadingKw?<><span className="spinner"/>수집 중...</>:"📊 황금 키워드 분석"}
                      </button>
                      <button onClick={()=>setShowKwInfo(true)} style={{padding:"7px 14px",borderRadius:8,border:"none",background:"linear-gradient(135deg,#ff6b9d,#ff4081)",color:"#fff",cursor:"pointer",fontSize:12,fontWeight:800,fontFamily:"inherit",whiteSpace:"nowrap",boxShadow:"0 3px 10px rgba(255,64,129,.35)"}}>
                        💡 이게 뭐야?
                      </button>
                    </div>
                    {naverQuotaInfo&&!naverKeys.naver_access_license&&(
                      <span style={{fontSize:11,color:naverQuotaInfo.used>=naverQuotaInfo.limit?"var(--danger)":"var(--text3)",alignSelf:"center"}}>
                        {naverQuotaInfo.used}/{naverQuotaInfo.limit}회 사용
                      </span>
                    )}
                    {naverKeys.naver_access_license&&(
                      <span style={{fontSize:11,color:"var(--accent-text)",alignSelf:"center"}}>🔑 개인키 (무제한)</span>
                    )}
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

                  {/* 제목 진행바 */}
                  {titles.length>0&&(
                    <div style={{marginTop:10,display:"flex",alignItems:"center",gap:8}}>
                      <div style={{flex:1,height:4,background:"var(--border)",borderRadius:99,overflow:"hidden"}}>
                        <div style={{height:"100%",width:`${(titles.length/MAX_TITLES)*100}%`,background:titles.length>=MAX_TITLES?"var(--danger)":"var(--accent)",borderRadius:99,transition:"width .4s"}}/>
                      </div>
                      <span style={{fontSize:11,color:titles.length>=MAX_TITLES?"var(--danger)":"var(--text2)",fontFamily:"monospace",flexShrink:0}}>{titles.length}/{MAX_TITLES}</span>
                    </div>
                  )}
                </div>

                {/* 제목 목록 */}
                {titles.length>0&&(
                  <div className="card" style={{animation:"fadeUp .2s ease both"}}>
                    <div className="card-header">
                      <div className="card-title">✨ 제목 선택</div>
                      <span style={{fontSize:11,color:"var(--text3)"}}>클릭해서 선택</span>
                    </div>
                    {selectedTitle&&(<div className="sel-banner"><div className="sel-banner-lbl">✅ 선택된 제목</div><div className="sel-banner-txt">{selectedTitle}</div></div>)}
                    <div className="title-grid">
                      {titles.map((t,i)=>{
                        const score=calcTitleScore(t);
                        const sc=score>=80?"#4ade80":score>=55?"#fbbf24":"#94a3b8";
                        return(
                          <button key={`${t}-${i}`} className={`title-card ${selectedTitle===t?"sel":""}`} onClick={()=>setSelectedTitle(t)}>
                            <div className="title-n">#{titles.length-i}</div>
                            <div className="title-t">{t}</div>
                            <div style={{display:"flex",alignItems:"center",gap:6,marginTop:4}}>
                              <div style={{flex:1,height:3,background:"var(--border)",borderRadius:99,overflow:"hidden"}}>
                                <div style={{height:"100%",width:`${score}%`,background:sc,borderRadius:99,transition:"width .4s"}}/>
                              </div>
                              <span style={{fontSize:10,fontWeight:800,color:sc,minWidth:28}}>{score}점</span>
                            </div>
                            {selectedTitle===t&&<div className="title-chk">✓</div>}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* 다음 단계 버튼 */}
                {selectedTitle&&(
                  <div className="flow-nav">
                    <button className="flow-btn flow-btn-g" onClick={()=>setTab("write")}>✍️ 글 생성하러 가기 →</button>
                  </div>
                )}
              </div>
            )}

            {/* ═══ ✍️ 글 생성 탭 ═══ */}
            {tab==="write"&&(
              <div className="tab-write" style={{animation:"fadeUp .25s ease both"}}>
                <UsageGuide theme={theme==="dark"?"dark":"light"} accent={theme==="dark"?"#e7a53d":"#c07d16"} subtitle="고른 제목으로 본문을 자동으로 써줄게요." steps={[{ico:"📝",title:"제목·키워드 확인",desc:"위에서 고른 제목과 키워드가 맞는지 봐요."},{ico:"🎨",title:"스타일 고르기",desc:"말투·글 유형(정보/후기 등)을 골라요."},{ico:"✨",title:"글 생성",desc:"‘글 생성’을 누르면 본문이 자동으로 써져요. 이미지·발행으로 이어가요."}]} />

                {/* 임시저장 불러오기 배너 */}
                {draftAvailable&&draftData&&!genContent&&(
                  <div style={{padding:"12px 16px",borderRadius:12,background:"rgba(0,200,120,.1)",border:"1px solid rgba(0,200,120,.3)",marginBottom:12,display:"flex",alignItems:"center",justifyContent:"space-between",gap:10}}>
                    <div>
                      <div style={{fontSize:13,fontWeight:800,color:"var(--success)"}}>📝 임시저장된 글이 있어요</div>
                      <div style={{fontSize:11,color:"var(--text3)",marginTop:2}}>{draftData.savedAt} · {draftData.title}</div>
                    </div>
                    <div style={{display:"flex",gap:6,flexShrink:0}}>
                      <button onClick={()=>{
                        setGenContent(draftData.content);
                        setPubTitle(draftData.title);
                        setGenTitle(draftData.title);
                        const rawBlocks=draftData.content.split("\n\n").filter(Boolean).map(p=>({type:"text" as const,id:uid(),content:p}));
                        setBlocks(rawBlocks.length>0?rawBlocks:[{type:"text",id:uid(),content:draftData.content}]);
                        setDraftAvailable(false);
                        showToast("✅ 임시저장 불러오기 완료","success");
                      }} style={{padding:"5px 12px",borderRadius:8,background:"var(--success)",color:"#fff",border:"none",cursor:"pointer",fontSize:12,fontWeight:700,fontFamily:"inherit"}}>불러오기</button>
                      <button onClick={()=>{localStorage.removeItem("publy_draft");setDraftAvailable(false);setDraftData(null);}} style={{padding:"5px 10px",borderRadius:8,background:"var(--bg2)",color:"var(--text3)",border:"1px solid var(--border)",cursor:"pointer",fontSize:12,fontFamily:"inherit"}}>삭제</button>
                    </div>
                  </div>
                )}

                {/* 선택된 제목 표시 - 없으면 경고 */}
                {selectedTitle?(
                  <div className="sel-banner" style={{marginBottom:16}}>
                    <div className="sel-banner-lbl">📌 선택된 제목 — <span style={{fontWeight:400,cursor:"pointer",textDecoration:"underline"}} onClick={()=>setTab("keyword")}>키워드/제목 탭에서 변경</span></div>
                    <div className="sel-banner-txt">{selectedTitle}</div>
                  </div>
                ):(
                  <div className="alert-box alert-warn" style={{display:"flex",alignItems:"center",gap:10}}>
                    ⚠️ 먼저 키워드/제목 탭에서 제목을 선택해주세요
                    <button className="btn btn-secondary btn-sm" style={{marginLeft:"auto",flexShrink:0}} onClick={()=>setTab("keyword")}>키워드/제목 탭으로 →</button>
                  </div>
                )}

                <div className="card">
                  <div className="card-title" style={{marginBottom:16}}>⚙️ 글 생성 설정</div>

                  {/* 글 템플릿 */}
                  <div style={{marginBottom:14}}>
                    <label className="inp-label">📋 글 템플릿 <span style={{fontSize:10,color:"var(--text3)",fontWeight:400}}>(선택 시 스타일·말투 자동 세팅)</span></label>
                    <select value={blogTemplate} onChange={e=>{
                      const t=BLOG_TEMPLATES.find(t=>t.id===e.target.value);
                      if(t){
                        setBlogTemplate(t.id);
                        if(t.id!=="none"){
                          setWriteStyle(t.style);localStorage.setItem("publy_write_style",t.style);
                          setPersona(t.persona);localStorage.setItem("publy_persona",t.persona);
                        }
                      }
                    }} style={{width:"100%",padding:"9px 12px",borderRadius:10,border:"1px solid var(--border)",background:"var(--bg)",color:"var(--text)",fontSize:13,fontFamily:"inherit",outline:"none",cursor:"pointer"}}>
                      {BLOG_TEMPLATES.map(t=><option key={t.id} value={t.id}>{t.label}</option>)}
                    </select>
                    {/* 템플릿 기능설명 */}
                    <div style={{marginTop:8,padding:"10px 12px",borderRadius:10,background:"var(--card2)",border:"1px solid var(--border)",fontSize:12,color:"var(--text2)",lineHeight:1.6}}>
                      💡 <b>템플릿이란?</b> 글의 <b>구성 순서(뼈대)</b>를 미리 잡아주는 도우미예요.
                      {blogTemplate!=="none"?(
                        <><br/><span style={{color:"var(--text3)"}}>지금은 <b style={{color:"var(--accent-text)"}}>{BLOG_TEMPLATES.find(t=>t.id===blogTemplate)?.label}</b> 순서로 짜임새 있게 써줘요. (스타일·말투도 자동으로 맞춰졌어요)</span></>
                      ):(
                        <><br/><span style={{color:"var(--text3)"}}><b>필수는 아니에요.</b> 안 골라도(=템플릿 없음) 아래 스타일·말투대로 글은 정상 생성돼요.</span></>
                      )}
                    </div>
                  </div>

                  {/* 글 스타일 프리셋 */}
                  <div style={{marginBottom:16}}>
                    <label className="inp-label">✍️ 글 스타일</label>
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:7}}>
                      {WRITE_STYLES.map(s=>(
                        <button key={s.id} onClick={()=>{setWriteStyle(s.id);localStorage.setItem("publy_write_style",s.id);}}
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
                        <button key={p.id} onClick={()=>{setPersona(p.id);localStorage.setItem("publy_persona",p.id);}}
                          style={{padding:"6px 11px",borderRadius:20,border:`1.5px solid ${persona===p.id?p.color:"var(--border)"}`,background:persona===p.id?p.color+"22":"var(--bg)",cursor:"pointer",fontFamily:"inherit",fontSize:12,fontWeight:persona===p.id?700:500,color:persona===p.id?p.color:"var(--text2)",transition:"all .15s",whiteSpace:"nowrap"}}>
                          {p.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div style={{marginBottom:16}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                      <label className="inp-label" style={{margin:0}}>📏 목표 글자수</label>
                      <span style={{fontSize:18,fontWeight:900,color:"var(--accent-text)",fontFamily:"'Space Grotesk',sans-serif"}}>{targetChars.toLocaleString()}자</span>
                    </div>
                    {/* 자동/수동 모드 */}
                    <div style={{display:"flex",gap:6,marginBottom:10}}>
                      <button onClick={()=>setCharMode("auto")} style={{flex:1,padding:"7px",borderRadius:8,border:`1.5px solid ${charMode==="auto"?"var(--accent)":"var(--border)"}`,background:charMode==="auto"?"var(--accent-bg)":"transparent",cursor:"pointer",fontSize:11,fontWeight:700,color:charMode==="auto"?"var(--accent-text)":"var(--text2)",fontFamily:"inherit"}}>🎲 자동 랜덤</button>
                      <button onClick={()=>setCharMode("manual")} style={{flex:1,padding:"7px",borderRadius:8,border:`1.5px solid ${charMode==="manual"?"var(--accent)":"var(--border)"}`,background:charMode==="manual"?"var(--accent-bg)":"transparent",cursor:"pointer",fontSize:11,fontWeight:700,color:charMode==="manual"?"var(--accent-text)":"var(--text2)",fontFamily:"inherit"}}>✏️ 직접 설정</button>
                    </div>
                    {charMode==="auto"?(
                      <div style={{padding:"10px 12px",borderRadius:9,background:"var(--accent-bg)",border:"1px solid var(--accent-border)",fontSize:12,color:"var(--accent-text)",fontWeight:600,lineHeight:1.6}}>
                        🎲 생성마다 자동 랜덤<br/>
                        <span style={{fontSize:11,opacity:.8}}>
                          {platform==="tistory"?"티스토리: 2000~3000자":adType==="adpost"&&/체험단|맛집|후기|리뷰/.test(keyword)?"체험단/맛집: 1800~2500자":"네이버: 1500~2000자"}
                        </span>
                      </div>
                    ):(
                      <>
                        <input type="range" min={1200} max={4000} step={50} value={targetChars} onChange={e=>setTargetChars(Number(e.target.value))} style={{width:"100%",accentColor:"var(--accent)",height:6,cursor:"pointer"}}/>
                        <div style={{display:"flex",justifyContent:"space-between",fontSize:11,color:"var(--text3)",marginTop:4}}><span>1,200자</span><span>2,500자</span><span>4,000자</span></div>
                      </>
                    )}
                  </div>
                  <button className="btn btn-primary btn-full btn-xl" onClick={handleGenerate} disabled={generating||!selectedTitle}>
                    {generating?<><span className="spinner"/>AI가 글을 쓰고 있어요...</>:<>✍️ 본문 생성 시작</>}
                  </button>
                  {generating&&<div style={{textAlign:"center",marginTop:8}}><button className="btn-stop" onClick={()=>abortRef.current?.abort()}>⏹ 생성 중단</button></div>}
                </div>

                {genContent&&(
                  <div className="card" style={{animation:"fadeUp .2s ease both"}}>
                    <div className="card-header">
                      <div className="card-title">🎉 글 생성 완료!</div>
                      <div style={{display:"flex",gap:7,alignItems:"center"}}>
                        <span style={{padding:"4px 12px",borderRadius:99,fontSize:12,fontWeight:800,background:"var(--accent-bg)",color:"var(--accent-text)",border:"1px solid var(--accent-border)"}}>{genContent.length.toLocaleString()}자</span>
                        <button style={{padding:"7px 14px",borderRadius:9,border:"1px solid var(--accent-border)",background:"var(--accent-bg)",color:"var(--accent-text)",cursor:"pointer",fontSize:12,fontWeight:700,fontFamily:"inherit"}} onClick={()=>openPreview()}>👁️ 미리보기</button>
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
                          {qualityScore.items.map((item,i)=>(
                            <div key={i} style={{display:"flex",alignItems:"center",gap:8,padding:"6px 10px",borderRadius:8,background:item.pass?"rgba(0,255,150,.06)":"rgba(255,80,80,.06)"}}>
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

                    {/* ── Flow 준비 안내 (Flow 선택 시) ── */}
                    {imgGenType==="flow"&&(
                      <div style={{marginBottom:14,padding:"14px 16px",borderRadius:14,background:flowReady?"rgba(0,200,120,.08)":"rgba(168,85,247,.08)",border:`1.5px solid ${flowReady?"rgba(0,200,120,.4)":"rgba(168,85,247,.35)"}`}}>
                        <div style={{display:"flex",alignItems:"center",gap:10}}>
                          <span style={{fontSize:22}}>{flowReady?"✅":"🎨"}</span>
                          <div style={{flex:1}}>
                            <div style={{fontSize:13.5,fontWeight:800,color:flowReady?"var(--success)":"#c084fc"}}>
                              {flowReady?"Flow 준비 완료! 바로 생성하세요":"Flow 이미지는 먼저 '준비'가 필요해요"}
                            </div>
                            <div style={{fontSize:11.5,color:"var(--text3)",marginTop:3,lineHeight:1.5}}>
                              {flowReady?"이제 아래 '이미지 생성 시작'을 누르면 무료로 이미지가 생성돼요":"버튼을 누르면 크롬이 열려요 → Google 로그인 1회만 하면 계속 자동으로 써요"}
                            </div>
                          </div>
                          {!flowReady&&(
                            <button onClick={()=>handleFlowLaunchChrome(0)} disabled={flowLaunching}
                              style={{padding:"10px 18px",borderRadius:10,border:"none",background:"linear-gradient(135deg,#a855f7,#7c3aed)",color:"#fff",cursor:flowLaunching?"wait":"pointer",fontSize:13,fontWeight:800,fontFamily:"inherit",whiteSpace:"nowrap",flexShrink:0,opacity:flowLaunching?.7:1}}>
                              {flowLaunching?"준비 중...":"🚀 Flow 준비"}
                            </button>
                          )}
                        </div>
                      </div>
                    )}

                    <div style={{display:"flex",flexDirection:"column",gap:12,marginBottom:14}}>
                      <div><label className="inp-label">제목</label><input className="inp" value={genTitle} onChange={e=>setGenTitle(e.target.value)}/></div>
                      <div><label className="inp-label">태그 (쉼표 구분)</label><input className="inp" value={genTags} onChange={e=>setGenTags(e.target.value)}/></div>
                      <div>
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}><label className="inp-label" style={{margin:0}}>본문</label><span style={{fontSize:12,color:"var(--text2)"}}>{genContent.length.toLocaleString()}자</span></div>
                        <textarea className="inp" rows={10} style={{fontSize:13,lineHeight:1.8}} value={genContent} onChange={e=>setGenContent(e.target.value)}/>
                      </div>
                    </div>
                    <div className="flow-nav">
                      <button className="flow-btn flow-btn-g" onClick={()=>setTab("image")}>🖼️ 이미지 생성하기 →</button>
                      <button className="flow-btn flow-btn-skip" onClick={()=>setTab("publish")}>🚀 이미지 없이 발행</button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ===== 이미지 생성 ===== */}
            {tab==="image"&&(
              <div className="tab-image" style={{animation:"fadeUp .25s ease both"}}>
                <UsageGuide theme={theme==="dark"?"dark":"light"} accent={theme==="dark"?"#a992ff":"#6b46e8"} subtitle="글과 어울리는 이미지를 만들어줄게요." steps={[{ico:"🖼️",title:"이미지 키워드 입력",desc:"글과 어울리는 이미지 키워드를 적어요."},{ico:"🆓",title:"방식 고르기",desc:"무료(Google Flow) 또는 유료 방식 중 골라요."},{ico:"➡️",title:"생성·확인",desc:"이미지를 만들고 캡션을 확인한 뒤 발행에 넣어요."}]} />
                {!genContent&&(<div className="alert-box alert-warn">⚠️ 먼저 글 생성 탭에서 글을 생성해주세요!<button className="btn btn-sm btn-secondary" style={{marginLeft:"auto",flexShrink:0}} onClick={()=>setTab("write")}>글 생성하러 가기</button></div>)}

                {/* ── 이미지 생성 방식 스위치 ── */}
                <div style={{marginBottom:16,padding:"20px 24px",borderRadius:20,background:"linear-gradient(135deg,rgba(99,102,241,.12),rgba(168,85,247,.12))",border:"1.5px solid rgba(168,85,247,.25)",boxShadow:"0 8px 32px rgba(99,102,241,.15)",animation:"float 3s ease-in-out infinite"}}>
                  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14,flexWrap:"wrap",gap:8}}>
                    <div>
                      <div style={{fontSize:15,fontWeight:900,color:"var(--text)"}}>🖼️ 이미지 생성 방식</div>
                      <div style={{fontSize:12,color:"var(--text3)",marginTop:2}}>원하는 방식을 선택하세요</div>
                    </div>
                    <button onClick={()=>setShowFlowGuide(true)}
                      style={{padding:"6px 14px",borderRadius:99,border:"1px solid rgba(168,85,247,.4)",background:"rgba(168,85,247,.1)",color:"#a855f7",cursor:"pointer",fontSize:12,fontWeight:700,fontFamily:"inherit"}}>
                      ❓ Flow란?
                    </button>
                  </div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                    {/* AI 이미지 */}
                    <button onClick={()=>{setImgGenType("ai");localStorage.setItem("publy_img_gen_type","ai");}}
                      style={{padding:"16px 14px",borderRadius:16,border:`2px solid ${imgGenType==="ai"?"#6366f1":"var(--border)"}`,background:imgGenType==="ai"?"linear-gradient(135deg,rgba(99,102,241,.18),rgba(99,102,241,.06))":"var(--card)",cursor:"pointer",fontFamily:"inherit",textAlign:"left",transition:"all .2s",boxShadow:imgGenType==="ai"?"0 4px 20px rgba(99,102,241,.25)":"none"}}>
                      <div style={{fontSize:28,marginBottom:6}}>✨</div>
                      <div style={{fontSize:14,fontWeight:900,color:imgGenType==="ai"?"#818cf8":"var(--text)",marginBottom:4}}>AI 이미지</div>
                      <div style={{fontSize:11,color:"var(--text3)",lineHeight:1.5}}>DALL-E · Flux<br/>API 키 필요</div>
                      {imgGenType==="ai"&&<div style={{marginTop:8,fontSize:10,fontWeight:800,color:"#818cf8",background:"rgba(99,102,241,.15)",padding:"3px 8px",borderRadius:99,display:"inline-block"}}>✓ 선택됨</div>}
                    </button>
                    {/* Flow 이미지 */}
                    <button onClick={()=>{setImgGenType("flow");localStorage.setItem("publy_img_gen_type","flow");}}
                      style={{padding:"16px 14px",borderRadius:16,border:`2px solid ${imgGenType==="flow"?"#a855f7":"var(--border)"}`,background:imgGenType==="flow"?"linear-gradient(135deg,rgba(168,85,247,.18),rgba(168,85,247,.06))":"var(--card)",cursor:"pointer",fontFamily:"inherit",textAlign:"left",transition:"all .2s",boxShadow:imgGenType==="flow"?"0 4px 20px rgba(168,85,247,.25)":"none",position:"relative",overflow:"hidden"}}>
                      <div style={{position:"absolute",top:8,right:10,fontSize:10,fontWeight:800,color:"#fff",background:"linear-gradient(135deg,#a855f7,#7c3aed)",padding:"2px 8px",borderRadius:99}}>FREE</div>
                      <div style={{fontSize:28,marginBottom:6}}>🎨</div>
                      <div style={{fontSize:14,fontWeight:900,color:imgGenType==="flow"?"#c084fc":"var(--text)",marginBottom:4}}>Flow 이미지</div>
                      <div style={{fontSize:11,color:"var(--text3)",lineHeight:1.5}}>Google Flow<br/>무료 · 고퀄리티</div>
                      {imgGenType==="flow"&&<div style={{marginTop:8,fontSize:10,fontWeight:800,color:"#c084fc",background:"rgba(168,85,247,.15)",padding:"3px 8px",borderRadius:99,display:"inline-block"}}>✓ 선택됨</div>}
                    </button>
                  </div>
                </div>

                {/* 일반 발행 이미지 콘셉트 — AI/Flow 공통 */}
                <div style={{marginBottom:16,padding:"16px 20px",borderRadius:16,background:"var(--card)",border:"1.5px solid var(--border)"}}>
                  <div style={{fontSize:14,fontWeight:900,color:"var(--text)",marginBottom:5}}>🎭 이미지 표현 방식</div>
                  <div style={{fontSize:11.5,color:"var(--text3)",marginBottom:10}}>글 전체 이미지를 한 콘셉트로 통일해요. 이미지 생성 방식과 별개로 적용됩니다.</div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                    {([['photo','📷 실사형','자연스러운 실제 사진 느낌'],['comic','🖍️ 만화형','깔끔한 한국 웹툰 일러스트']] as const).map(([v,label,desc])=>{
                      const on=imageConcept===v;return <button key={v} onClick={()=>{setImageConcept(v);localStorage.setItem("publy_image_concept",v);}} style={{padding:"12px",borderRadius:12,border:`2px solid ${on?"#7c3aed":"var(--border)"}`,background:on?"rgba(124,58,237,.10)":"var(--bg)",color:on?"#8b5cf6":"var(--text2)",fontFamily:"inherit",cursor:"pointer",textAlign:"left"}}><div style={{fontSize:13,fontWeight:900}}>{label}</div><div style={{fontSize:10.5,marginTop:3,opacity:.8}}>{desc}</div></button>;
                    })}
                  </div>
                </div>

                {/* ── Flow 가이드 팝업 ── */}
                {showFlowGuide&&(
                  <div style={{position:"fixed",inset:0,zIndex:9999,background:"rgba(0,0,0,.75)",display:"flex",alignItems:"flex-start",justifyContent:"center",padding:"60px 20px 20px",overflowY:"auto"}} onClick={()=>setShowFlowGuide(false)}>
                    <div style={{width:"100%",maxWidth:520,borderRadius:24,background:"var(--card)",border:"1px solid rgba(168,85,247,.3)",overflow:"hidden",animation:"fadeUp .25s ease",boxShadow:"0 24px 60px rgba(0,0,0,.6)"}} onClick={e=>e.stopPropagation()}>
                      {/* 헤더 */}
                      <div style={{padding:"20px 24px 16px",background:"linear-gradient(135deg,#7c3aed,#a855f7)",display:"flex",alignItems:"center",gap:12}}>
                        <div style={{fontSize:32}}>🎨</div>
                        <div>
                          <div style={{fontSize:17,fontWeight:900,color:"#fff"}}>Google Flow 이미지란?</div>
                          <div style={{fontSize:12,color:"rgba(255,255,255,.8)",marginTop:2}}>무료 고퀄리티 AI 이미지 생성</div>
                        </div>
                        <button onClick={()=>setShowFlowGuide(false)}
                          style={{marginLeft:"auto",width:28,height:28,borderRadius:8,border:"none",background:"rgba(255,255,255,.2)",color:"#fff",cursor:"pointer",fontSize:16,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>×</button>
                      </div>

                      <div style={{padding:"18px 24px"}}>
                        {/* 회원가입 + 설정 버튼 */}
                        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:16}}>
                          <a href="https://accounts.google.com/signup" target="_blank" rel="noreferrer"
                            style={{display:"flex",flexDirection:"column",alignItems:"center",gap:6,padding:"14px 12px",borderRadius:14,border:"1.5px solid rgba(168,85,247,.3)",background:"linear-gradient(135deg,rgba(168,85,247,.12),rgba(99,102,241,.08))",textDecoration:"none",transition:"all .2s",cursor:"pointer"}}>
                            <span style={{fontSize:24}}>👤</span>
                            <span style={{fontSize:13,fontWeight:800,color:"#c084fc"}}>구글 회원가입</span>
                            <span style={{fontSize:10,color:"var(--text3)",textAlign:"center"}}>구글 계정이 없다면<br/>먼저 가입하세요</span>
                          </a>
                          <a href="https://labs.google/fx/ko/tools/image-fx" target="_blank" rel="noreferrer"
                            style={{display:"flex",flexDirection:"column",alignItems:"center",gap:6,padding:"14px 12px",borderRadius:14,border:"1.5px solid rgba(0,214,143,.3)",background:"linear-gradient(135deg,rgba(0,214,143,.12),rgba(0,214,143,.04))",textDecoration:"none",transition:"all .2s",cursor:"pointer"}}>
                            <span style={{fontSize:24}}>🔗</span>
                            <span style={{fontSize:13,fontWeight:800,color:"var(--success)"}}>Flow 설정하기</span>
                            <span style={{fontSize:10,color:"var(--text3)",textAlign:"center"}}>클릭 후 구글 로그인<br/>한 번만 하면 완료!</span>
                          </a>
                        </div>

                      {/* 동작 방식 */}
                        <div style={{marginBottom:12,padding:"12px 14px",borderRadius:12,background:"rgba(99,102,241,.08)",border:"1px solid rgba(99,102,241,.2)"}}>
                          <div style={{fontSize:13,fontWeight:800,color:"#818cf8",marginBottom:8}}>🚀 동작 방식</div>
                          <div style={{fontSize:12,color:"var(--text)",lineHeight:2}}>
                            ① 이미지 탭에서 <strong style={{color:"#c084fc"}}>Flow 이미지</strong> 선택<br/>
                            ② 글 생성 후 이미지 수 자동 추천 (500자당 1장)<br/>
                            ③ 발행하기 탭에서 🚀 발행 버튼 클릭<br/>
                            ④ 크롬이 자동으로 열려 Google Flow 접속<br/>
                            ⑤ 글 제목 기반 영문 프롬프트 자동 입력<br/>
                            ⑥ 이미지 생성 완료 → 자동 다운로드<br/>
                            ⑦ 글 패턴에 맞게 자동 삽입 후 발행
                          </div>
                        </div>

                        {/* 이미지 수 안내 */}
                        <div style={{marginBottom:12,padding:"12px 14px",borderRadius:12,background:"rgba(168,85,247,.08)",border:"1px solid rgba(168,85,247,.2)"}}>
                          <div style={{fontSize:13,fontWeight:800,color:"#c084fc",marginBottom:8}}>📸 이미지 수 설정</div>
                          <div style={{fontSize:12,color:"var(--text)",lineHeight:2}}>
                            <strong style={{color:"#c084fc"}}>✨ 자동추천</strong> — 글자 수 기준 500자당 1장<br/>
                            예) 1,500자 → 3장 / 2,000자 → 4장<br/>
                            <strong style={{color:"#c084fc"}}>✏️ 직접입력</strong> — 원하는 수량 직접 설정 가능
                          </div>
                        </div>

                        {/* 주의사항 */}
                        <div style={{marginBottom:16,padding:"12px 14px",borderRadius:12,background:"rgba(255,159,63,.08)",border:"1px solid rgba(255,159,63,.2)"}}>
                          <div style={{fontSize:13,fontWeight:800,color:"var(--warn)",marginBottom:8}}>⚠️ 주의사항</div>
                          <div style={{fontSize:12,color:"var(--text)",lineHeight:2}}>
                            장시간 미사용 시 구글 재로그인 필요<br/>
                            발행 시 크롬 창이 자동으로 열립니다<br/>
                            크롬 창을 닫거나 조작하지 마세요
                          </div>
                        </div>

                        <button onClick={()=>setShowFlowGuide(false)}
                          style={{width:"100%",padding:"13px",borderRadius:12,border:"none",background:"linear-gradient(135deg,#7c3aed,#a855f7)",color:"#fff",cursor:"pointer",fontSize:14,fontWeight:800,fontFamily:"inherit"}}>
                          확인했어요!
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* ── Flow 선택 시 UI ── */}
                {imgGenType==="flow"&&(
                  <div style={{marginBottom:14,animation:"fadeUp .2s ease both"}}>
                    <div className="card" style={{padding:"20px 22px",border:"1.5px solid rgba(168,85,247,.25)",background:"linear-gradient(135deg,rgba(168,85,247,.06),rgba(99,102,241,.04))"}}>
                      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:16}}>
                        <div style={{width:40,height:40,borderRadius:12,background:"linear-gradient(135deg,#7c3aed,#a855f7)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,flexShrink:0}}>🎨</div>
                        <div>
                          <div style={{fontSize:15,fontWeight:900,color:"var(--text)"}}>Google Flow 자동 생성</div>
                          <div style={{fontSize:12,color:"var(--text3)"}}>발행 시 크롬이 자동으로 열려 이미지를 생성합니다</div>
                        </div>
                      </div>

                      {/* 생성할 이미지 수 */}
                      <div style={{marginBottom:16}}>
                        <div style={{fontSize:12,fontWeight:700,color:"var(--text3)",marginBottom:8}}>📸 생성할 이미지 수</div>
                        <div style={{display:"flex",gap:6,marginBottom:8}}>
                          <button onClick={()=>{imgCountAutoRef.current=true;setImgCountAuto(true);if(genContent){const n=recommendImgCount(genContent);imgCountRef.current=n;setImgCount(n);}}}
                            style={{flex:1,padding:"8px",borderRadius:9,border:`1.5px solid ${flowImgCountAuto?"#a855f7":"var(--border)"}`,background:flowImgCountAuto?"rgba(168,85,247,.15)":"transparent",cursor:"pointer",fontSize:12,fontWeight:700,color:flowImgCountAuto?"#c084fc":"var(--text2)",fontFamily:"inherit"}}>
                            ✨ 자동추천
                          </button>
                          <button onClick={()=>{imgCountAutoRef.current=false;setImgCountAuto(false);}}
                            style={{flex:1,padding:"8px",borderRadius:9,border:`1.5px solid ${!flowImgCountAuto?"#a855f7":"var(--border)"}`,background:!flowImgCountAuto?"rgba(168,85,247,.15)":"transparent",cursor:"pointer",fontSize:12,fontWeight:700,color:!flowImgCountAuto?"#c084fc":"var(--text2)",fontFamily:"inherit"}}>
                            ✏️ 직접입력
                          </button>
                        </div>

                        {flowImgCountAuto ? (
                          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 14px",borderRadius:10,background:"rgba(168,85,247,.1)",border:"1px solid rgba(168,85,247,.25)"}}>
                            <span style={{fontSize:12,color:"#c084fc",fontWeight:600}}>💡 글자 수 기반 자동 추천 (500자당 1장)</span>
                            <span style={{fontSize:24,fontWeight:900,color:"#c084fc",fontFamily:"'Space Grotesk',sans-serif"}}>{flowImgCount}장</span>
                          </div>
                        ) : (
                          <div>
                          <div style={{display:"flex",alignItems:"center",gap:8}}>
                            <button onClick={()=>setManualImageCount(imgCount-1)}
                              style={{width:40,height:40,borderRadius:9,border:"2px solid #a855f7",background:"rgba(168,85,247,.18)",cursor:"pointer",fontSize:22,fontWeight:900,lineHeight:1,display:"flex",alignItems:"center",justifyContent:"center",color:"#c084fc",transition:"transform .08s"}} onMouseDown={e=>e.currentTarget.style.transform="scale(.9)"} onMouseUp={e=>e.currentTarget.style.transform="scale(1)"} onMouseLeave={e=>e.currentTarget.style.transform="scale(1)"}>−</button>
                            <input type="number" min={1} max={30} value={flowImgCount}
                              onChange={e=>setManualImageCount(Number(e.target.value))}
                              style={{flex:1,textAlign:"center",padding:"8px",borderRadius:9,border:"1.5px solid rgba(168,85,247,.4)",background:"var(--bg2)",color:"#c084fc",fontSize:20,fontWeight:900,fontFamily:"'Space Grotesk',sans-serif"}}/>
                            <button onClick={()=>setManualImageCount(imgCount+1)}
                              style={{width:40,height:40,borderRadius:9,border:"2px solid #a855f7",background:"rgba(168,85,247,.18)",cursor:"pointer",fontSize:22,fontWeight:900,lineHeight:1,display:"flex",alignItems:"center",justifyContent:"center",color:"#c084fc",transition:"transform .08s"}} onMouseDown={e=>e.currentTarget.style.transform="scale(.9)"} onMouseUp={e=>e.currentTarget.style.transform="scale(1)"} onMouseLeave={e=>e.currentTarget.style.transform="scale(1)"}>+</button>
                          </div>
                          <button onClick={applyImageCount} style={{width:"100%",marginTop:10,padding:"13px",borderRadius:11,border:"2px solid #a855f7",background:"linear-gradient(135deg,#a855f7,#7c3aed)",color:"#fff",cursor:"pointer",fontSize:15,fontWeight:900,fontFamily:"inherit",boxShadow:"0 5px 18px rgba(168,85,247,.35)"}}>✓ 이미지 {imgCount}장 적용</button>
                          </div>
                        )}
                      </div>

                      {/* 프롬프트 미리보기 */}
                      {genTitle&&(
                        <div style={{marginBottom:16,padding:"14px",borderRadius:12,background:"var(--bg)",border:"1px solid var(--border)"}}>
                          <div style={{fontSize:11,fontWeight:700,color:"var(--text3)",marginBottom:6}}>🔤 자동 생성될 영문 프롬프트</div>
                          <div style={{fontSize:11,color:"#c084fc",lineHeight:1.8,fontStyle:"italic",wordBreak:"break-word"}}>
                            {buildFlowPrompt(keyword||genTitle, genTitle, genContent, 0)}
                          </div>
                        </div>
                      )}

                      {/* 상태 안내 */}
                      <div style={{display:"flex",alignItems:"center",gap:8,padding:"12px 14px",borderRadius:12,background:"rgba(168,85,247,.08)",border:"1px solid rgba(168,85,247,.2)"}}>
                        <div style={{width:8,height:8,borderRadius:"50%",background:"#a855f7",boxShadow:"0 0 8px #a855f7",animation:"float 1.5s ease-in-out infinite",flexShrink:0}}/>
                        <div style={{fontSize:12,color:"#c084fc",fontWeight:600}}>발행하기 탭에서 🚀 발행 버튼을 누르면 자동으로 시작됩니다</div>
                      </div>
                    </div>
                  </div>
                )}

                <div className="img-split" style={{display:"grid",gap:14,alignItems:"start"}}>

                  {/* ── 왼쪽: 설정 패널 ── */}
                  <div style={{display:"flex",flexDirection:"column",gap:10}}>

                    {/* 현재 키워드 + 영문 프롬프트 */}
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
                            {currentImgPrompt||buildImgPrompt(keyword||genTitle,genTitle,0)}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* 이미지 소스 */}
                    <div className="card" style={{padding:"14px 16px"}}>
                      <div className="card-title" style={{marginBottom:12}}>⚙️ 이미지 설정</div>
                      <label className="inp-label">이미지 소스</label>
                      <div style={{display:"flex",flexDirection:"column",gap:6,marginBottom:16}}>
                        {([{id:"ai",ico:"✨",label:"AI 자동 생성"},{id:"upload",ico:"📁",label:"내 이미지 업로드"},{id:"none",ico:"🚫",label:"이미지 없이 발행"}] as const).map(s=>(
                          <button key={s.id} onClick={()=>setImgSource(s.id)} style={{padding:"10px 14px",borderRadius:10,border:`1.5px solid ${imgSource===s.id?"var(--accent)":"var(--border)"}`,background:imgSource===s.id?"var(--accent-bg)":"var(--bg)",cursor:"pointer",fontFamily:"inherit",transition:"all .15s",display:"flex",alignItems:"center",gap:9,textAlign:"left"}}>
                            <span style={{fontSize:18}}>{s.ico}</span>
                            <span style={{fontSize:13,fontWeight:600,color:imgSource===s.id?"var(--accent-text)":"var(--text2)"}}>{s.label}</span>
                            {imgSource===s.id&&<span style={{marginLeft:"auto",color:"var(--accent-text)"}}>✓</span>}
                          </button>
                        ))}
                      </div>

                      {/* AI 수량 설정 */}
                      {imgSource==="ai"&&(
                        <>
                          <label className="inp-label">생성 수량</label>
                          {/* 자동/수동 모드 전환 */}
                          <div style={{display:"flex",gap:6,marginBottom:10}}>
                            <button onClick={()=>{imgCountAutoRef.current=true;setImgCountAuto(true);if(genContent){const n=recommendImgCount(genContent);imgCountRef.current=n;setImgCount(n);}}} style={{flex:1,padding:"7px",borderRadius:8,border:`1.5px solid ${imgCountAuto?"var(--accent)":"var(--border)"}`,background:imgCountAuto?"var(--accent-bg)":"transparent",cursor:"pointer",fontSize:12,fontWeight:700,color:imgCountAuto?"var(--accent-text)":"var(--text2)",fontFamily:"inherit"}}>✨ 자동추천</button>
                            <button onClick={()=>{imgCountAutoRef.current=false;setImgCountAuto(false);}} style={{flex:1,padding:"7px",borderRadius:8,border:`1.5px solid ${!imgCountAuto?"var(--accent)":"var(--border)"}`,background:!imgCountAuto?"var(--accent-bg)":"transparent",cursor:"pointer",fontSize:12,fontWeight:700,color:!imgCountAuto?"var(--accent-text)":"var(--text2)",fontFamily:"inherit"}}>✏️ 직접입력</button>
                          </div>

                          {imgCountAuto?(
                            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 14px",borderRadius:10,background:"var(--accent-bg)",border:"1px solid var(--accent-border)",marginBottom:10}}>
                              <span style={{fontSize:12,color:"var(--accent-text)",fontWeight:600}}>💡 글자 수 기반 추천</span>
                              <span style={{fontSize:24,fontWeight:900,color:"var(--accent-text)",fontFamily:"'Space Grotesk',sans-serif"}}>{imgCount}장</span>
                            </div>
                          ):(
                            <div style={{marginBottom:10}}>
                              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
                                <button onClick={()=>setManualImageCount(imgCount-1)} style={{width:40,height:40,borderRadius:9,border:"2px solid #a855f7",background:"rgba(168,85,247,.18)",color:"#c084fc",cursor:"pointer",fontSize:22,fontWeight:900,display:"flex",alignItems:"center",justifyContent:"center"}}>−</button>
                                <input type="number" min={1} max={30} value={imgCount} onChange={e=>setManualImageCount(Number(e.target.value))} style={{flex:1,textAlign:"center",padding:"8px",borderRadius:9,border:"1.5px solid rgba(168,85,247,.4)",background:"var(--bg2)",color:"#c084fc",fontSize:20,fontWeight:900,fontFamily:"'Space Grotesk',sans-serif"}}/>
                                <button onClick={()=>setManualImageCount(imgCount+1)} style={{width:40,height:40,borderRadius:9,border:"2px solid #a855f7",background:"rgba(168,85,247,.18)",color:"#c084fc",cursor:"pointer",fontSize:22,fontWeight:900,display:"flex",alignItems:"center",justifyContent:"center"}}>+</button>
                              </div>
                              <button onClick={applyImageCount} style={{width:"100%",padding:"13px",borderRadius:11,border:"2px solid #a855f7",background:"linear-gradient(135deg,#a855f7,#7c3aed)",color:"#fff",cursor:"pointer",fontSize:15,fontWeight:900,fontFamily:"inherit",boxShadow:"0 5px 18px rgba(168,85,247,.35)"}}>✓ 이미지 {imgCount}장 적용</button>
                              <div style={{fontSize:11,color:"var(--text3)",textAlign:"center"}}>체험단 15장 이상도 가능 (최대 30장)</div>
                            </div>
                          )}

                          {/* 진행률 */}
                          {genImgLoading&&(
                            <div style={{marginBottom:12,padding:"12px 14px",borderRadius:10,background:"var(--bg)",border:"1px solid var(--border)"}}>
                              <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
                                <span style={{fontSize:12,fontWeight:700,color:"var(--accent-text)",animation:"pulse 1.2s infinite"}}>⏳ {genImgCurrent} / {imgGenType==="flow"?flowImgCount:imgCount}장 완성</span>
                                <span style={{fontSize:14,fontWeight:900,color:"var(--accent-text)",fontFamily:"'Space Grotesk',sans-serif"}}>{genImgProgress}%</span>
                              </div>
                              <div style={{height:8,background:"var(--border)",borderRadius:99,overflow:"hidden"}}>
                                <div style={{height:"100%",width:`${genImgProgress}%`,background:"linear-gradient(90deg,var(--accent),#ff8a4c)",borderRadius:99,transition:"width .4s"}}/>
                              </div>
                            </div>
                          )}

                          {/* ── Flow 준비 안내/버튼 (Flow 방식 선택 시, 생성 버튼 바로 위) ── */}
                          {imgGenType==="flow"&&(
                            <div style={{marginBottom:12,padding:"14px 16px",borderRadius:14,background:flowReady?"rgba(0,200,120,.08)":"rgba(168,85,247,.1)",border:`2px solid ${flowReady?"rgba(0,200,120,.45)":"rgba(168,85,247,.45)"}`}}>
                              <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:flowReady?0:12}}>
                                <span style={{fontSize:22}}>{flowReady?"✅":"🎨"}</span>
                                <div style={{flex:1,minWidth:0}}>
                                  <div style={{fontSize:13.5,fontWeight:800,color:flowReady?"var(--success)":"#c084fc"}}>
                                    {flowReady?"Flow 준비 완료! 이제 아래 '이미지 생성 시작'을 누르세요":"이미지를 만들려면 먼저 'Flow 준비'가 필요해요"}
                                  </div>
                                  {!flowReady&&(
                                    <div style={{fontSize:11.5,color:"var(--text2)",marginTop:4,lineHeight:1.6}}>
                                      아래 파란 버튼을 누르면 <b>크롬 창이 열려요</b> → 그 창에서 <b>구글 로그인 1회만</b> 하면 → 다시 여기서 '이미지 생성 시작'을 누르면 됩니다. (로그인은 처음 한 번만)
                                    </div>
                                  )}
                                </div>
                              </div>
                              {!flowReady&&(
                                <button onClick={()=>handleFlowLaunchChrome(0)} disabled={flowLaunching}
                                  style={{width:"100%",padding:"14px",borderRadius:12,border:"2px solid #7c3aed",background:flowLaunching?"#a855f7":"linear-gradient(135deg,#a855f7,#7c3aed)",color:"#fff",cursor:flowLaunching?"wait":"pointer",fontSize:15,fontWeight:900,fontFamily:"inherit",boxShadow:"0 4px 16px rgba(124,58,237,.4)",opacity:flowLaunching?.8:1,display:"flex",alignItems:"center",justifyContent:"center",gap:8}}>
                                  {flowLaunching?<><span className="spinner"/>크롬 여는 중...</>:<>👉 여기 눌러 Flow 준비하기 (크롬 열림)</>}
                                </button>
                              )}
                            </div>
                          )}

                          <div style={{display:"flex",flexDirection:"column",gap:8}}>
                            <button className="btn btn-primary btn-full" onClick={handleGenerateImages} disabled={genImgLoading||!genContent}>
                              {genImgLoading?<><span className="spinner"/>생성 중...</>:<>🎨 이미지 생성 시작</>}
                            </button>
                            {genImgLoading&&<button className="btn-stop" style={{width:"100%",justifyContent:"center"}} onClick={stopImageGen}>⏹ 생성 중단</button>}
                            {imgGenFailed&&!genImgLoading&&(
                              <div style={{marginTop:6,padding:"13px 15px",borderRadius:12,background:"rgba(255,159,63,.08)",border:"1px solid rgba(255,159,63,.35)",display:"flex",flexDirection:"column",gap:8}}>
                                <div style={{fontSize:12.5,fontWeight:800,color:"var(--warn,#e0952f)"}}>⚠️ 이미지 생성이 중간에 멈췄어요</div>
                                <div style={{fontSize:11.5,color:"var(--text3)",lineHeight:1.6}}>화면 로그는 사라져도 <b style={{color:"var(--text2)"}}>기록은 저장돼 있어요</b>. 아래 <b style={{color:"var(--text2)"}}>로그 보기</b>로 어디서 멈췄는지 확인하거나, <b style={{color:"var(--text2)"}}>신고</b>를 누르면 로그가 관리자에게 자동 전송돼요.</div>
                                <button className="btn btn-sm" onClick={()=>{setImgGenFailed(false);handleGenerateImages();}} style={{background:"var(--warn)",color:"#fff",border:"none",cursor:"pointer",width:"100%",justifyContent:"center"}}>🔄 다시 시도</button>
                                <div style={{display:"flex",gap:6}}>
                                  <button className="btn btn-sm" onClick={openFullLog} disabled={fullLogLoading||!window.electron?.readBotLog} style={{flex:1,justifyContent:"center",border:"1px solid var(--border)",background:"var(--bg)",color:"var(--text2)",cursor:"pointer"}}>{fullLogLoading?"불러오는 중...":"📋 로그 보기"}</button>
                                  <button className="btn btn-sm" onClick={()=>(window as any).electron?.openLogFolder?.()} style={{flex:1,justifyContent:"center",border:"1px solid var(--border)",background:"var(--bg)",color:"var(--text2)",cursor:"pointer"}}>📂 폴더</button>
                                  <button className="btn btn-sm" onClick={submitBugReport} disabled={bugSending} style={{flex:1,justifyContent:"center",border:"none",background:"var(--accent)",color:"#000",cursor:bugSending?"default":"pointer",fontWeight:800}}>{bugSending?"전송 중":"🐞 신고"}</button>
                                </div>
                              </div>
                            )}
                            {imgGenType==="flow"&&generatedImages.length>0&&!genImgLoading&&(
                              <div style={{padding:"12px 14px",borderRadius:12,background:"rgba(16,185,129,.08)",border:"1px solid rgba(16,185,129,.3)",display:"flex",flexDirection:"column",gap:8}}>
                                <div style={{fontSize:12,color:"#10b981",fontWeight:700,lineHeight:1.6}}>
                                  ➕ 이미지 더 만들기
                                  <div style={{fontSize:11,color:"var(--text2)",fontWeight:500,marginTop:2,lineHeight:1.7}}>버튼 숫자만큼 이미지를 만들어요 — <b>1장</b>이면 1장, <b>2장</b>이면 2장, <b>3장</b>이면 3장. (더하기 아님)<br/>· 맘에 안 드는 이미지를 🗑로 지운 뒤 <b>그 자리 채우기</b><br/>· 기존 이미지는 그대로 두고 <b>더 추가하기</b><br/>새로 만든 이미지는 <b>글 흐름을 이어받아</b> 뒤에 붙어요(섞여서 이상한 이미지 안 나와요).</div>
                                </div>
                                <div style={{display:"flex",gap:6}}>
                                  {[1,2,3].map(c=>(
                                    <button key={c} className="btn btn-sm" onClick={()=>handleGenerateFlowImages(true,c)} disabled={genImgLoading||!genContent}
                                      style={{flex:1,background:"rgba(16,185,129,.15)",color:"#10b981",border:"1.5px solid #10b981",cursor:"pointer",justifyContent:"center",fontWeight:800,fontFamily:"inherit"}}>
                                      {c}장
                                    </button>
                                  ))}
                                </div>
                              </div>
                            )}
                            {generatedImages.length>0&&!genImgLoading&&<button className="btn btn-danger btn-full btn-sm" onClick={()=>{setGeneratedImages([]);setCaptions([]);}}>🗑 이미지 초기화</button>}
                          </div>
                        </>
                      )}

                      {imgSource==="upload"&&(
                        <div>
                          <label style={{display:"flex",alignItems:"center",gap:10,padding:"16px 14px",borderRadius:10,border:"2px dashed var(--accent-border)",background:"var(--accent-bg)",cursor:"pointer"}}>
                            <span style={{fontSize:24}}>📁</span>
                            <div><div style={{fontSize:13,fontWeight:700,color:"var(--accent-text)"}}>파일 선택</div><div style={{fontSize:11,color:"var(--text2)",marginTop:2}}>여러 장 동시 가능 (체험단 15장+)</div></div>
                            <input type="file" accept="image/*" multiple onChange={e=>{handleImageUpload(e);setTimeout(()=>setCaptions(buildCaptions(keyword||genTitle,uploadedImages.length+1)),100);}} style={{display:"none"}}/>
                          </label>
                          {uploadedImages.length>0&&<button className="btn btn-danger btn-full btn-sm" style={{marginTop:10}} onClick={()=>{setUploadedImages([]);setCaptions([]);}}>🗑 업로드 초기화</button>}
                        </div>
                      )}

                      {imgSource==="none"&&(
                        <div style={{padding:"14px",borderRadius:10,background:"rgba(255,83,99,.06)",border:"1px solid rgba(255,83,99,.2)",fontSize:13,color:"var(--text2)",lineHeight:1.7}}>
                          이미지 없이 텍스트만 발행해요.
                        </div>
                      )}
                    </div>

                    {/* 영상 삽입 설정 */}
                    <div className="card" style={{padding:"14px 16px"}}>
                      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
                        <div>
                          <div className="card-title" style={{margin:0}}>🎬 영상 삽입</div>
                          <div style={{fontSize:11,color:"var(--text3)",marginTop:3}}>체험단 영상 필수 업체 대응</div>
                        </div>
                        <div style={{display:"flex",alignItems:"center",gap:8}}>
                          <span style={{fontSize:11,fontWeight:700,color:videoOn?"var(--accent-text)":"var(--text3)"}}>{videoOn?"ON":"OFF"}</span>
                          <button onClick={()=>setVideoOn(v=>!v)} style={{width:48,height:26,borderRadius:99,background:videoOn?"var(--accent)":"var(--border)",border:"none",cursor:"pointer",position:"relative",transition:"background .2s",flexShrink:0}}>
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
                            {([{v:"top",l:"🔝 글 상단",desc:"글 맨 위"},{v:"middle",l:"🔲 글 중간",desc:"본문 중간"},{v:"bottom",l:"🔽 글 하단",desc:"글 맨 아래"}] as const).map(p=>(
                              <button key={p.v} onClick={()=>setVideoPosition(p.v)} style={{flex:1,padding:"8px 4px",borderRadius:8,border:`1.5px solid ${videoPosition===p.v?"var(--accent)":"var(--border)"}`,background:videoPosition===p.v?"var(--accent-bg)":"transparent",cursor:"pointer",fontSize:11,fontWeight:700,color:videoPosition===p.v?"var(--accent-text)":"var(--text2)",fontFamily:"inherit",textAlign:"center"}}>
                                <div>{p.l}</div>
                                <div style={{fontSize:10,fontWeight:400,marginTop:2,color:"var(--text3)"}}>{p.desc}</div>
                              </button>
                            ))}
                          </div>
                        </>
                      )}
                    </div>

                    {/* 이미지 배치 패턴 */}
                    <div className="card" style={{padding:"14px 16px"}}>
                      <div className="card-title" style={{marginBottom:4}}>📐 이미지 배치 패턴</div>
                      <div style={{fontSize:11,color:"var(--text3)",marginBottom:12}}>글 안에 이미지를 어떻게 배치할지 선택해요</div>
                      <div style={{display:"flex",flexDirection:"column",gap:8}}>
                        {([
                          {v:"random",l:"🎲 랜덤",badge:"권장",sub:"매 발행마다 자동으로 패턴 변경",desc:"AI 감지 방지에 가장 효과적이에요",diagram:"🖼️ → 📝 → 🖼️ → 📝"},
                          {v:"A",l:"패턴 A",badge:"",sub:"썸네일 + 중간 이미지 1장",desc:"글 중간에 이미지 1장 배치",diagram:"🖼️썸네일 → 📝글 → 🖼️중간 → 📝글"},
                          {v:"C",l:"패턴 B",badge:"",sub:"썸네일 + 이미지 균등 분산",desc:"이미지를 글 전체에 고르게 배치",diagram:"🖼️썸네일 → 📝 → 🖼️ → 📝 → 🖼️"},
                        ] as const).map(p=>(
                          <button key={p.v} onClick={()=>setImgPattern(p.v)} style={{padding:"11px 13px",borderRadius:10,border:`1.5px solid ${imgPattern===p.v?"var(--accent)":"var(--border)"}`,background:imgPattern===p.v?"var(--accent-bg)":"var(--bg)",cursor:"pointer",fontFamily:"inherit",textAlign:"left",transition:"all .15s"}}>
                            <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:4}}>
                              <span style={{fontSize:13,fontWeight:800,color:imgPattern===p.v?"var(--accent-text)":"var(--text)"}}>{p.l}</span>
                              {p.badge&&<span style={{fontSize:10,fontWeight:800,padding:"2px 7px",borderRadius:99,background:"var(--accent)",color:"#000"}}>{p.badge}</span>}
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
                      <div className="card-header" style={{marginBottom:14}}>
                        <div className="card-title">
                          🖼️ 생성된 이미지
                          {getActiveImages().length>0&&<span style={{fontWeight:500,color:"var(--text3)",textTransform:"none",letterSpacing:0}}> — {getActiveImages().length}장 · 첫 번째가 썸네일</span>}
                        </div>
                        {getActiveImages().length>0&&captions.length===0&&(
                          <button className="btn btn-sm btn-secondary" onClick={()=>setCaptions(buildCaptions(keyword||genTitle,getActiveImages().length,genContent))}>💬 캡션 자동생성</button>
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
                                <img src={img} alt="" style={{width:"100%",height:"100%",objectFit:"cover",borderRadius:12,border:i===0?"2px solid var(--accent)":"2px solid var(--border)",display:"block",animation:"imgIn .3s ease both",cursor:"pointer"}}
                                  onClick={()=>window.open(img,"_blank")}
                                  onError={e=>{(e.target as HTMLImageElement).style.display="none";}}/>
                                {i===0&&<span style={{position:"absolute",top:-7,left:-4,fontSize:9,fontWeight:800,padding:"2px 7px",borderRadius:99,background:"var(--accent)",color:"#000",whiteSpace:"nowrap"}}>썸네일</span>}
                                <button style={{position:"absolute",top:-8,right:-8,width:28,height:28,borderRadius:"50%",background:"var(--danger)",border:"2px solid var(--bg)",color:"#fff",cursor:"pointer",fontSize:12,display:"flex",alignItems:"center",justifyContent:"center",boxShadow:"0 2px 6px rgba(0,0,0,.3)"}}
                                  onClick={()=>{
                                    const delSrc=getActiveImages()[i];
                                    const newImgs=getActiveImages().filter((_,j)=>j!==i);
                                    const newCaps=captions.filter((_,j)=>j!==i);
                                    if(imgSource==="ai")setGeneratedImages(p=>p.filter((_,j)=>j!==i));
                                    else setUploadedImages(p=>p.filter((_,j)=>j!==i));
                                    setCaptions(newCaps);
                                    // ★ 발행에 쓰이는 blocks도 다시 배치 — 지운 이미지가 발행에 남지 않게
                                    if(newImgs.length>0){
                                      triggerAutoInsert(newImgs.map((src,k)=>({id:k,src,alt:newCaps[k]||`${keyword||genTitle||pubTitle} 사진`})));
                                    }else{
                                      setBlocks(prev=>prev.filter(b=>b.type==="text"));
                                    }
                                    // 지운 게 썸네일이었으면 썸네일도 갱신
                                    if(thumbnail===delSrc)setThumbnail(newImgs[0]||"");
                                  }}>✕</button>
                              </div>
                              {/* 캡션 입력창 - 필수 */}
                              <input
                                className="img-caption-inp"
                                placeholder={`캡션 입력 (예: ${keyword||"사진"} ${i===0?"대표":"현장"} 사진)`}
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



            {/* ===== 발행하기 ===== */}
            {tab==="photo"&&(
              <div className="photo-root">
                <UsageGuide theme={theme==="dark"?"dark":"light"} subtitle="사진만 올리면 그 사진으로 블로그 글을 만들어줄게요." steps={[{ico:"👤",title:"발행 계정 선택",desc:"‘네이버 발행 계정’에서 올릴 계정을 ◉ 로 골라요."},{ico:"📷",title:"사진 올리기",desc:"글에 넣을 사진을 업로드해요(최대 20장)."},{ico:"✨",title:"생성·발행",desc:"핵심 포인트를 적고 생성하면 사진 글이 만들어져요. 발행까지!"}]} />

                {/* 스토리 섹션 */}
                <div className="photo-story">
                  <div className="photo-story-step s1">
                    <span className="photo-story-ico">📸</span>
                    <div className="photo-story-num">STEP 1</div>
                    <div className="photo-story-title">사진 업로드</div>
                    <div className="photo-story-desc">내 사진을<br/>최대 20장 업로드</div>
                    <span className="photo-story-arrow">›</span>
                  </div>
                  <div className="photo-story-step s2">
                    <span className="photo-story-ico">✏️</span>
                    <div className="photo-story-num">STEP 2</div>
                    <div className="photo-story-title">키포인트 입력</div>
                    <div className="photo-story-desc">장소, 가격, 느낌 등<br/>핵심 정보 입력</div>
                    <span className="photo-story-arrow">›</span>
                  </div>
                  <div className="photo-story-step s3">
                    <span className="photo-story-ico">🌸</span>
                    <div className="photo-story-num">STEP 3</div>
                    <div className="photo-story-title">AI 글 생성</div>
                    <div className="photo-story-desc">사진 분석으로<br/>자연스러운 글 완성</div>
                  </div>
                </div>

                {/* ℹ️ 발행 한도 공유 안내 */}
                {(()=>{const cfg=PLAN_CONFIG[user.plan]??PLAN_CONFIG.free;const unlimited=cfg.dailyPublish>=9999;const remain=Math.max(0,cfg.dailyPublish-dailyPublishUsed);return(
                  <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap",padding:"11px 15px",borderRadius:12,background:"var(--card2)",border:"1px solid var(--border)",marginBottom:14,fontSize:12.5,color:"var(--text2)",lineHeight:1.55}}>
                    <span style={{fontSize:16}}>ℹ️</span>
                    <div style={{flex:1,minWidth:180}}>
                      <b>사진 글쓰기는 만드는 건 무제한</b>이에요. 단, <b style={{color:"#FF6B9D"}}>발행 한도는 일반 글쓰기와 함께 사용</b>돼요(둘이 같은 하루 발행 수를 나눠 써요).
                    </div>
                    <span style={{fontWeight:800,color:remain>0?"var(--text)":"var(--danger)",whiteSpace:"nowrap",padding:"4px 10px",borderRadius:99,background:"var(--bg)",border:"1px solid var(--border)"}}>
                      오늘 발행 {unlimited?"∞ 무제한":`${dailyPublishUsed}/${cfg.dailyPublish}건 · ${remain}건 남음`}
                    </span>
                  </div>
                );})()}

                {/* 네이버 발행 계정 */}
                <div className="card" style={{padding:"14px 16px",marginBottom:14}}>
                  <div className="card-title" style={{marginBottom:10}}>🔗 네이버 발행 계정</div>
                  {connAccs.length===0?(
                    <div style={{textAlign:"center",padding:"16px"}}>
                      <div style={{fontSize:13,color:"var(--text3)",marginBottom:10}}>연결된 계정이 없어요</div>
                      <button className="btn btn-primary btn-sm" onClick={()=>setTab("accounts")}>계정 관리에서 연결 →</button>
                    </div>
                  ):connAccs.map(a=>(
                    <label key={a.id} onClick={()=>{setPubAccId(a.id);loadCategories("naver");}} style={{display:"flex",alignItems:"center",gap:10,padding:"12px 14px",borderRadius:10,cursor:"pointer",marginBottom:6,background:pubAccId===a.id?"var(--accent-bg)":"var(--bg)",border:`2px solid ${pubAccId===a.id?"var(--accent)":"var(--border)"}`,transition:"all .15s"}}>
                      <input type="radio" name="photo-pacc" checked={pubAccId===a.id} onChange={()=>{}} style={{accentColor:"var(--accent)",width:16,height:16,flexShrink:0}}/>
                      <div style={{flex:1}}><div style={{fontSize:14,fontWeight:700,color:"var(--text)"}}>{a.username}</div>{a.blog_name&&<div style={{fontSize:11,color:"var(--text3)"}}>{a.blog_name}</div>}</div>
                      {pubAccId===a.id&&<span style={{fontSize:11,fontWeight:700,padding:"2px 8px",borderRadius:99,background:"var(--accent-bg)",color:"var(--accent-text)",border:"1px solid var(--accent-border)"}}>✅</span>}
                    </label>
                  ))}
                </div>

                {/* 사진 업로드 */}
                <div className="card" style={{padding:"18px",marginBottom:14}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
                    <label className="inp-label" style={{margin:0}}>📷 사진 업로드 <span style={{fontSize:11,color:"var(--text3)"}}>(최대 20장)</span></label>
                    {photoFiles.length>0&&<button onClick={()=>setPhotoFiles([])} style={{fontSize:11,color:"#FF6B9D",background:"none",border:"none",cursor:"pointer",fontFamily:"inherit"}}>전체 삭제</button>}
                  </div>

                  {/* 드래그 드롭 영역 */}
                  <div
                    className={`photo-drop${photoDragOver?" drag-over":""}`}
                    onClick={()=>{const inp=document.createElement("input");inp.type="file";inp.multiple=true;inp.accept="image/*";inp.onchange=e=>handlePhotoUpload((e.target as HTMLInputElement).files);inp.click();}}
                    onDragOver={e=>{e.preventDefault();setPhotoDragOver(true);}}
                    onDragLeave={()=>setPhotoDragOver(false)}
                    onDrop={e=>{e.preventDefault();setPhotoDragOver(false);handlePhotoUpload(e.dataTransfer.files);}}
                  >
                    <div className="photo-drop-ico"><span className="flower-deco">🌸</span></div>
                    <div className="photo-drop-title">사진을 여기에 끌어다 놓거나 클릭하세요</div>
                    <div className="photo-drop-desc">JPG, PNG 지원 · 최대 20장 · {photoFiles.length}/20장 업로드됨</div>
                  </div>

                  {/* 사진 미리보기 그리드 (드래그로 순서 변경 = 글에 들어가는 순서) */}
                  {photoFiles.length>0&&(
                    <>
                    <div style={{fontSize:11,color:"var(--text3)",marginBottom:8,display:"flex",alignItems:"center",gap:5}}>↕️ 사진을 <b style={{color:"#FF6B9D"}}>드래그</b>해서 순서를 바꿀 수 있어요 · 이 순서대로 글에 들어가요 (①번=대표)</div>
                    <div className="photo-grid">
                      {photoFiles.map((f,i)=>(
                        <div key={f.id} className="photo-thumb" draggable
                          onDragStart={()=>{(window as any).__photoDrag=i;}}
                          onDragOver={e=>e.preventDefault()}
                          onDrop={()=>{const from=(window as any).__photoDrag; if(from===undefined||from===i)return; setPhotoFiles(p=>{const n=[...p];const[m]=n.splice(from,1);n.splice(i,0,m);return n;}); (window as any).__photoDrag=undefined;}}
                          style={{cursor:"grab"}}>
                          <img src={f.src} alt={f.name}/>
                          <div style={{position:"absolute",top:4,left:4,fontSize:10,fontWeight:900,background:i===0?"#FF6B9D":"rgba(0,0,0,.6)",color:"#fff",width:20,height:20,borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center"}}>{i+1}</div>
                          {i===0&&<div style={{position:"absolute",bottom:4,left:4,fontSize:9,fontWeight:800,background:"#FF6B9D",color:"#fff",padding:"2px 6px",borderRadius:99}}>대표</div>}
                          <button className="photo-thumb-del" onClick={()=>setPhotoFiles(p=>p.filter(x=>x.id!==f.id))}>✕</button>
                        </div>
                      ))}
                    </div>
                    </>
                  )}
                </div>

                {/* 키포인트 입력 */}
                <div className="card" style={{padding:"18px",marginBottom:14}}>
                  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8,gap:8,flexWrap:"wrap"}}>
                    <label className="inp-label" style={{margin:0}}>✏️ 키포인트 <span style={{fontSize:11,color:"var(--text3)"}}>(선택사항)</span></label>
                    <div style={{display:"flex",gap:7,flexShrink:0}}>
                    <button onClick={suggestKeypoints} disabled={photoSuggesting||photoFiles.length===0} title={photoFiles.length===0?"사진을 먼저 올려주세요":"사진을 분석해 키포인트 초안을 자동으로 채워줘요"}
                      style={{padding:"5px 12px",borderRadius:20,background:(photoSuggesting||photoFiles.length===0)?"var(--card2)":"var(--accent)",color:(photoSuggesting||photoFiles.length===0)?"var(--text3)":"#fff",border:"none",cursor:(photoSuggesting||photoFiles.length===0)?"default":"pointer",fontSize:11,fontWeight:800,fontFamily:"inherit",whiteSpace:"nowrap"}}>
                      {photoSuggesting?"✨ 분석 중...":"✨ AI 추천"}
                    </button>
                    <button onClick={()=>{const html=`<!DOCTYPE html><html><head><meta charset="utf-8"><title>키포인트 예시</title><style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:'Malgun Gothic',sans-serif;background:#fdf0ff;color:#111}h1{background:linear-gradient(135deg,#f0417a,#ff6fa1);color:#fff;padding:20px 24px;font-size:18px;line-height:1.4}.content{padding:20px}.intro{font-size:14px;color:#555;line-height:1.8;margin-bottom:18px;padding:12px 16px;background:#fff;border-radius:12px;border-left:4px solid #C77DFF}.cat-title{font-size:13px;font-weight:800;color:#FF6B9D;margin:16px 0 8px;padding:4px 10px;background:#FF6B9D11;border-radius:6px;display:inline-block}.bad{background:#fff0f0;border:1px solid #ffcccc;border-radius:10px;padding:10px 14px;margin-bottom:6px;font-size:13px;color:#c00;line-height:1.7}.good{background:#f0fff4;border:1px solid #99ddaa;border-radius:10px;padding:10px 14px;font-size:13px;color:#005c1a;line-height:1.8;margin-bottom:16px}.lbl{font-size:10px;font-weight:800;margin-bottom:3px}.tip{background:linear-gradient(135deg,#FF6B9D11,#C77DFF11);border:1px solid #C77DFF33;border-radius:12px;padding:14px;margin-top:4px;font-size:13px;line-height:1.9}</style></head><body><h1>✏️ 키포인트 이렇게 쓰면 글이 잘 나와요</h1><div class="content"><div class="intro">구체적으로 쓸수록 실제 경험처럼 자연스러운 글이 나옵니다.<br>장소 + 가격 + 시간 + 특징 + 개인 의견을 담아주세요.</div><div class="cat-title">🍽️ 맛집 방문</div><div class="bad"><div class="lbl">❌ 아쉬운 예</div>강원도 맛집, 고기집, 맛있었음</div><div class="good"><div class="lbl">✅ 좋은 예</div>강원도 홍천 태장동 / 한우 소갈비찜 전문점 / 2인 45,000원 / 웨이팅 40분 / 주차 무료 / 반찬 10가지 / 아이 동반 가능 / 재방문 의향 있음</div><div class="cat-title">✈️ 여행 후기</div><div class="bad"><div class="lbl">❌ 아쉬운 예</div>제주도 여행, 경치 좋았다</div><div class="good"><div class="lbl">✅ 좋은 예</div>제주 성산읍 성산일출봉 / 오전 6시 방문 / 입장료 5,000원 / 일출 40분 전 도착 권장 / 주차장에서 도보 10분 / 공항에서 1시간 소요</div><div class="cat-title">☕ 카페 방문</div><div class="bad"><div class="lbl">❌ 아쉬운 예</div>서울 카페, 인테리어 예쁨</div><div class="good"><div class="lbl">✅ 좋은 예</div>서울 성수동 공장 리모델링 카페 / 아메리카노 6,500원 / 대기 없이 입장 / 오전 11시 방문 / 좌석 80개 / 지하철 권장 주차 불가</div><div class="cat-title">📦 제품 리뷰</div><div class="bad"><div class="lbl">❌ 아쉬운 예</div>에어프라이어 구매, 좋음</div><div class="good"><div class="lbl">✅ 좋은 예</div>필립스 에어프라이어 5.6L / 129,000원 / 3인 가족 6개월 사용 / 치킨 20분 바삭 / 세척 쉬움 / 단점: 크기 커서 수납 불편 / 만족도 9점</div><div class="cat-title">💬 체험단 후기</div><div class="bad"><div class="lbl">❌ 아쉬운 예</div>협찬 받은 피부과, 좋았음</div><div class="good"><div class="lbl">✅ 좋은 예</div>[협찬] 강남 청담 피부과 / 리프팅 시술 1회 / 40분 소요 / 붓기 거의 없음 / 직원 친절 / 주차 2시간 무료 / 다음 달 추가 예약</div><div class="tip">💡 핵심: 장소 + 가격 + 소요시간 + 특징 2~3개 + 내 솔직한 의견<br>이렇게만 써도 AI가 훨씬 풍부하고 자연스러운 글을 써드려요!</div></div></body></html>`;setPhotoGuideModal("example");}} style={{padding:"5px 12px",borderRadius:20,background:"linear-gradient(135deg,#f0417a,#ff6fa1)",color:"#fff",border:"none",cursor:"pointer",fontSize:11,fontWeight:800,fontFamily:"inherit",whiteSpace:"nowrap",flexShrink:0}}>📝 예시 보기</button>
                    </div>
                  </div>
                  <textarea
                    className="photo-keypoints"
                    placeholder={"예시: 강원도 홍천 맛집, 갈비탕 12,000원, 웨이팅 30분, 주차 가능 / 제주 성산일출봉 근처, 해돋이 사진, 오전 6시 방문, 입장료 5,000원"}

                    value={photoKeypoints}
                    onChange={e=>setPhotoKeypoints(e.target.value)}
                  />
                </div>

                {/* 글 스타일 + 말투 */}
                <div className="card" style={{padding:"18px",marginBottom:14}}>
                  <div style={{marginBottom:14}}>
                    <label className="inp-label">✍️ 글 스타일</label>
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:7}}>
                      {WRITE_STYLES.map(s=>(
                        <button key={s.id} onClick={()=>{setWriteStyle(s.id);localStorage.setItem("publy_write_style",s.id);}}
                          style={{padding:"10px 12px",borderRadius:10,border:`1.5px solid ${writeStyle===s.id?"#FF6B9D":"var(--border)"}`,background:writeStyle===s.id?"#FF6B9D22":"var(--bg)",cursor:"pointer",textAlign:"left",fontFamily:"inherit",transition:"all .15s"}}>
                          <div style={{fontSize:13,fontWeight:700,color:writeStyle===s.id?"#FF6B9D":"var(--text)"}}>{s.i} {s.id}</div>
                          <div style={{fontSize:11,color:"var(--text3)",marginTop:2}}>{s.desc}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="inp-label">🎭 말투 설정 <span style={{fontSize:10,color:"var(--text3)",fontWeight:400}}>(선택)</span></label>
                    <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                      {PERSONA_STYLES.map(p=>(
                        <button key={p.id} onClick={()=>{setPersona(p.id);localStorage.setItem("publy_persona",p.id);}}
                          style={{padding:"6px 11px",borderRadius:20,border:`1.5px solid ${persona===p.id?"#C77DFF":"var(--border)"}`,background:persona===p.id?"#C77DFF22":"var(--bg)",cursor:"pointer",fontFamily:"inherit",fontSize:12,fontWeight:persona===p.id?700:500,color:persona===p.id?"#C77DFF":"var(--text2)",transition:"all .15s",whiteSpace:"nowrap"}}>
                          {p.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* 생성 버튼 */}
                <button className="photo-gen-btn" onClick={generateFromPhotos} disabled={photoGenerating||photoFiles.length===0}>
                  {photoGenerating
                    ?(()=>{const steps=[["📸","사진을 하나하나 구경하는 중"],["✏️","글감을 찾아 이야기 짜는 중"],["🌸","문장을 예쁘게 다듬는 중"]];const st=steps[Math.max(0,Math.min(2,photoGenStep-1))];return <><span style={{fontSize:18,marginRight:8}} className="flower-deco">{st[0]}</span>{st[1]}...</>;})()
                    :<><span className="flower-deco">🌸</span> 사진으로 글 생성하기</>}
                </button>
                {/* 생성 단계 진행바 */}
                {photoGenerating&&(
                  <div style={{display:"flex",gap:6,marginTop:10}}>
                    {[1,2,3].map(n=>(
                      <div key={n} style={{flex:1,height:5,borderRadius:99,background:photoGenStep>=n?"linear-gradient(90deg,#FF6B9D,#C77DFF)":"var(--card2)",transition:"background .4s"}}/>
                    ))}
                  </div>
                )}
                {photoGenerating&&(
                  <button onClick={()=>{setPhotoGenerating(false);}} style={{width:"100%",marginTop:8,padding:"10px",borderRadius:12,border:"1px solid var(--border)",background:"var(--bg2)",color:"var(--text2)",cursor:"pointer",fontSize:13,fontWeight:700,fontFamily:"inherit"}}>⏹️ 생성 취소</button>
                )}
                {/* 결제문의 플로팅에 생성 버튼이 가리지 않게 하단 여백 */}
                {!photoGenDone&&<div style={{height:90}} aria-hidden="true" />}

                {/* 🎉 꽃가루 축하 연출 */}
                {photoConfetti&&(
                  <div style={{position:"fixed",inset:0,pointerEvents:"none",zIndex:9998,overflow:"hidden"}}>
                    {Array.from({length:36}).map((_,i)=>{const c=["#FF6B9D","#C77DFF","#80FFDB","#FFD85E","#FF9E6C"][i%5];const left=Math.random()*100;const delay=Math.random()*0.5;const dur=1.8+Math.random()*1.2;const size=7+Math.random()*8;return <span key={i} style={{position:"absolute",top:"-20px",left:`${left}%`,width:size,height:size,background:c,borderRadius:i%2?"50%":"2px",animation:`confettiFall ${dur}s ${delay}s ease-in forwards`,opacity:.9}}/>;})}
                  </div>
                )}

                {/* 생성 완료 후 발행 패널 */}
                {photoGenDone&&genContent&&(
                  <div style={{marginTop:20}}>
                    {/* ⭐ 제목 후보 골라 쓰기 */}
                    {photoTitleOptions.length>1&&(
                      <div className="card" style={{marginBottom:12,padding:"14px 16px",border:"1.5px solid #C77DFF44"}}>
                        <div style={{fontSize:12.5,fontWeight:800,color:"#C77DFF",marginBottom:8}}>✨ 제목 골라 쓰기 <span style={{fontSize:10.5,color:"var(--text3)",fontWeight:600}}>· 검색 잘 잡히는 순서로 추천</span></div>
                        <div style={{display:"flex",flexDirection:"column",gap:7}}>
                          {photoTitleOptions.map((t,i)=>{const on=genTitle===t;return(
                            <button key={i} onClick={()=>{setGenTitle(t);setPubTitle(t);showToast("제목 적용!","success");}}
                              style={{display:"flex",alignItems:"center",gap:9,padding:"10px 12px",borderRadius:10,border:`1.5px solid ${on?"#C77DFF":"var(--border)"}`,background:on?"#C77DFF14":"var(--bg)",color:on?"#C77DFF":"var(--text)",cursor:"pointer",fontFamily:"inherit",textAlign:"left",fontSize:13,fontWeight:on?800:600,transition:"all .12s"}}>
                              <span style={{fontSize:14}}>{on?"🟣":"⚪"}</span><span style={{flex:1,minWidth:0}}>{t}</span>{on&&<span style={{fontSize:10,fontWeight:800}}>선택됨</span>}
                            </button>
                          );})}
                        </div>
                      </div>
                    )}
                    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12,padding:"12px 16px",borderRadius:14,background:"linear-gradient(135deg,#FF6B9D11,#C77DFF11)",border:"1px solid #FF6B9D33"}}>
                      <div style={{display:"flex",alignItems:"center",gap:8}}>
                        <span style={{fontSize:20}}>🎉</span>
                        <div>
                          <div style={{fontSize:13,fontWeight:800,color:"#FF6B9D"}}>글 생성 완료!</div>
                          <div style={{fontSize:11,color:"var(--text3)"}}>{genContent.length.toLocaleString()}자 · 📖 약 {Math.max(1,Math.round(genContent.length/450))}분 읽기 · 사진 {photoFiles.length}장 · 🏷️ 태그 {hashtags.length}개</div>
                        </div>
                      </div>
                      <div style={{display:"flex",gap:8}}>
                        <button onClick={()=>openPreview()} style={{padding:"7px 14px",borderRadius:9,border:"1px solid #C77DFF",background:"#C77DFF11",color:"#C77DFF",cursor:"pointer",fontSize:12,fontWeight:700,fontFamily:"inherit"}}>👁️ 미리보기</button>
                        <button onClick={()=>setTab("publish")} style={{padding:"7px 14px",borderRadius:9,border:"none",background:"linear-gradient(135deg,#f0417a,#ff6fa1)",color:"#fff",cursor:"pointer",fontSize:12,fontWeight:700,fontFamily:"inherit"}}>🚀 발행하기 →</button>
                      </div>
                    </div>

                    {/* SEO 품질 점수 */}
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

                    {/* 발행 설정 패널 */}
                    <div style={{background:"var(--bg2)",borderRadius:16,border:"1px solid var(--border)",padding:"16px"}}>
                      <div style={{fontSize:13,fontWeight:800,color:"#FF6B9D",marginBottom:14}}>🚀 발행 설정</div>
                      {renderPublishPanel()}
                    </div>

                    {/* 발행 버튼 */}
                    <div style={{marginTop:14,display:"flex",gap:10}}>
                      <button onClick={()=>copyForNaver()} style={{flex:1,padding:"14px",borderRadius:12,border:"1px solid #03C75A",background:"#03C75A11",color:"#03C75A",cursor:"pointer",fontSize:13,fontWeight:800,fontFamily:"inherit"}}>📋 N복사</button>
                      <button onClick={()=>handlePublish()} disabled={publishing||!pubAccId||!pubTitle} style={{flex:2,padding:"14px",borderRadius:12,border:"none",background:publishing?"#888":"linear-gradient(135deg,#f0417a,#ff6fa1)",color:"#fff",cursor:publishing?"not-allowed":"pointer",fontSize:14,fontWeight:900,fontFamily:"inherit",opacity:(publishing||!pubAccId||!pubTitle)?.6:1}}>
                        {publishing?<><span className="spinner" style={{width:16,height:16,marginRight:8}}/>발행 중...</>:<>🌸 블로그 발행하기</>}
                      </button>
                    </div>
                    {pubMsg&&<div className={`alert-box ${pubMsg.includes("✅")?"alert-success":"alert-danger"}`} style={{marginTop:10}}>{pubMsg}</div>}
                  </div>
                )}

                {/* 안내 버튼 — 데스크톱=인라인 중앙, 모바일=좌하단 고정(결제문의 우하단과 안 겹침) */}
                <div className="photo-guides">
                  <button className="photo-guide-btn" onClick={()=>setPhotoGuideModal("guide")}>📖 사용방법</button>
                  <button className="photo-guide-btn" style={{background:"linear-gradient(135deg,#FF8C00,#FF6B9D)"}} onClick={()=>setPhotoGuideModal("caution")}>⚠️ 유의할점</button>
                </div>
                <div style={{height:80}} aria-hidden="true" />

                {/* 📱 모바일 최적화 안내 모달 */}
                {photoGuideModal&&(
                  <div onClick={()=>setPhotoGuideModal(null)} style={{position:"fixed",inset:0,zIndex:9999,background:"rgba(0,0,0,.6)",backdropFilter:"blur(4px)",display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
                    <div onClick={e=>e.stopPropagation()} style={{width:"100%",maxWidth:460,maxHeight:"85vh",overflowY:"auto",background:"var(--card)",borderRadius:18,border:"1px solid var(--border)",boxShadow:"0 20px 60px rgba(0,0,0,.4)"}}>
                      <div style={{position:"sticky",top:0,padding:"16px 20px",background:photoGuideModal==="caution"?"linear-gradient(135deg,#FF8C00,#FF6B9D)":"linear-gradient(135deg,#f0417a,#ff6fa1)",color:"#fff",display:"flex",alignItems:"center",justifyContent:"space-between",gap:10}}>
                        <span style={{fontSize:16,fontWeight:900}}>{photoGuideModal==="caution"?"⚠️ 사진 글쓰기 유의할점":photoGuideModal==="example"?"✏️ 키포인트 이렇게 쓰면 잘 나와요":"📷 사진으로 글 쓰는 방법"}</span>
                        <button onClick={()=>setPhotoGuideModal(null)} style={{width:30,height:30,borderRadius:8,border:"none",background:"rgba(255,255,255,.25)",color:"#fff",cursor:"pointer",fontSize:16,fontWeight:900,flexShrink:0}}>✕</button>
                      </div>
                      <div style={{padding:"16px 18px",display:"flex",flexDirection:"column",gap:12}}>
                        {photoGuideModal==="example"?(()=>{
                          const ex=[
                            ["🍽️ 맛집","강원도 맛집, 고기집, 맛있었음","강원도 홍천 태장동 / 한우 소갈비찜 / 2인 45,000원 / 웨이팅 40분 / 주차 무료 / 반찬 10가지 / 재방문 의향"],
                            ["✈️ 여행","제주도 여행, 경치 좋았다","제주 성산일출봉 / 오전 6시 방문 / 입장료 5,000원 / 일출 40분 전 도착 / 주차장서 도보 10분"],
                            ["☕ 카페","서울 카페, 인테리어 예쁨","서울 성수동 공장 리모델링 카페 / 아메리카노 6,500원 / 오전 11시 방문 / 좌석 80개 / 주차 불가"],
                            ["📦 제품","에어프라이어 구매, 좋음","필립스 5.6L / 129,000원 / 3인가족 6개월 / 치킨 20분 바삭 / 단점: 커서 수납 불편 / 만족 9점"],
                            ["💬 체험단","협찬 받은 피부과, 좋았음","[협찬] 강남 청담 피부과 / 리프팅 1회 / 40분 / 붓기 없음 / 직원 친절 / 주차 2시간 무료"],
                          ];
                          return ex.map(([cat,bad,good])=>(
                            <div key={cat} style={{background:"var(--bg)",borderRadius:12,padding:"13px 15px",border:"1px solid var(--border)"}}>
                              <div style={{fontSize:13,fontWeight:800,color:"#FF6B9D",marginBottom:7}}>{cat}</div>
                              <div style={{fontSize:12,color:"#e06",background:"rgba(255,80,80,.08)",borderRadius:8,padding:"7px 10px",marginBottom:5,lineHeight:1.5}}>❌ {bad}</div>
                              <div style={{fontSize:12,color:"var(--text)",background:"rgba(0,200,120,.1)",borderRadius:8,padding:"7px 10px",lineHeight:1.6}}>✅ {good}</div>
                            </div>
                          ));
                        })():photoGuideModal==="guide"?[
                          ["1","사진을 올려주세요","업로드 버튼을 누르거나 끌어다 놓으세요. 최대 20장, 첫 사진이 대표 사진이 돼요."],
                          ["2","키포인트를 적어요 (선택)","장소·가격·시간 등 넣고 싶은 내용을 간단히. 안 적어도 AI가 사진만 보고 써요."],
                          ["3","글 스타일·말투 선택","맛집후기·여행기·감성일기·정보글 중에서. 말투까지 고르면 더 자연스러워요."],
                          ["4","🌸 사진으로 글 생성하기","AI가 사진을 분석해 글을 써요. 30초~1분 기다려주세요."],
                          ["5","블로그에 발행","발행하기 탭에서 계정 선택 후 발행하면 자동으로 올라가요."],
                        ].map(([n,t,d])=>(
                          <div key={n} style={{background:"var(--bg)",borderRadius:12,padding:"13px 15px",border:"1px solid var(--border)"}}>
                            <div style={{fontSize:13.5,fontWeight:800,color:"#FF6B9D",marginBottom:5}}>{n}. {t}</div>
                            <div style={{fontSize:13,lineHeight:1.7,color:"var(--text2)"}}>{d}</div>
                          </div>
                        )):[
                          ["🔑 Gemini 키가 없다면?","왼쪽 메뉴 맨 아래 설정 → AI 설정에서 Gemini 발급받기 → 키 입력·저장."],
                          ["⏱️ 분당 한도 초과 오류","무료 Gemini는 분당 제한이 있어요. 1분 기다렸다 다시. 자주 나면 키 새로 발급."],
                          ["🖼️ 사진 주의사항","20장 올려도 AI 분석은 처음 10장. 첫 사진=대표. 밝고 선명할수록 좋아요."],
                          ["⏳ 생성 시간","사진 많으면 오래 걸려요(30초~1분). 생성 중엔 다른 버튼 누르지 마세요."],
                        ].map(([t,d])=>(
                          <div key={t} style={{background:"var(--bg)",borderRadius:12,padding:"13px 15px",border:"1px solid var(--border)"}}>
                            <div style={{fontSize:13.5,fontWeight:800,color:"#FF8C00",marginBottom:5}}>{t}</div>
                            <div style={{fontSize:13,lineHeight:1.7,color:"var(--text2)"}}>{d}</div>
                          </div>
                        ))}
                        <div style={{background:"rgba(255,107,157,.1)",border:"1px solid rgba(255,107,157,.3)",borderRadius:12,padding:"12px 14px",fontSize:12.5,lineHeight:1.7,color:"var(--text2)"}}>💡 밝고 선명한 사진일수록, 키포인트를 자세히 적을수록 글이 잘 나와요!</div>
                      </div>
                    </div>
                  </div>
                )}

              </div>
            )}

            


            {tab==="publish"&&(
              <div className="tab-publish" style={{animation:"fadeUp .25s ease both"}}>
                <UsageGuide theme={theme==="dark"?"dark":"light"} accent={theme==="dark"?"#ff8a6b":"#e0562f"} subtitle="다 된 글을 블로그에 자동으로 올려줄게요." steps={[{ico:"👤",title:"계정·플랫폼 선택",desc:"네이버/티스토리와 올릴 계정을 골라요."},{ico:"🧩",title:"발행 방식",desc:"전체/본문+FAQ/본문만 중 골라요. 예약 발행도 돼요."},{ico:"🚀",title:"발행",desc:"🚀 발행 버튼을 누르면 블로그에 자동으로 올라가요."}]} />
                {!botOnline&&<div className="alert-box alert-warn" style={{margin:"12px 16px 0"}}>⚠️ 봇 오프라인 — PC에서 Publy 앱 실행 시 즉시 발행, 아니면 대기열 저장돼요.</div>}
                {quota&&quota.remaining_quota<=0&&!(["unlimited","admin"] as string[]).includes(user.plan)&&<div className="alert-box alert-danger" style={{margin:"12px 16px 0"}}>⚠️ 발행 건수 초과. 플랜을 업그레이드해주세요.</div>}
                {renderAeoBanner()}

                {/* ── 발행 준비도 + 설정 스티키 바 ── */}
                <div className="pub-sticky-bar">
                  {/* 플랫폼 토글 */}
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
                      {label:`이미지 ${blocks.filter(b=>b.type==="image"||(b.type==="image-pair"&&(b as ImagePairBlock).images?.length>=2)).length}장`,ok:blocks.some(b=>b.type==="image"||(b.type==="image-pair"))},
                      {label:pubAccId?connAccs.find(a=>a.id===pubAccId)?.username||"계정":"계정 미선택",ok:!!pubAccId},
                    ].map(c=>(
                      <span key={c.label} className={`pub-ready-chip ${c.ok?"pub-ready-ok":"pub-ready-no"}`}>
                        {c.ok?"✅":"❌"} {c.label}
                      </span>
                    ))}
                  </div>
                  <div className="pub-actions" style={{marginLeft:"auto",display:"flex",gap:8,alignItems:"center"}}>
                    {/* 네이버 복사 */}
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
                    {/* 미리보기 */}
                    <button onClick={()=>openPreview()} style={{display:"flex",alignItems:"center",gap:5,padding:"7px 12px",borderRadius:8,background:"oklch(.62 .22 300)",color:"#fff",border:"none",cursor:"pointer",fontSize:12,fontWeight:700,fontFamily:"inherit",whiteSpace:"nowrap"}}>
                      👁️ 미리보기
                    </button>
                    {/* 발행 설정 토글 */}
                    <button onClick={()=>setShowPublishPanel(v=>!v)} style={{display:"flex",alignItems:"center",gap:5,padding:"7px 12px",borderRadius:8,border:"1px solid var(--border)",background:showPublishPanel?"var(--accent-bg)":"var(--card)",color:showPublishPanel?"var(--accent-text)":"var(--text2)",cursor:"pointer",fontSize:12,fontWeight:700,fontFamily:"inherit",whiteSpace:"nowrap"}}>
                      ⚙️ 발행 설정 {showPublishPanel?"▲":"▼"}
                    </button>
                    {/* 발행 버튼 */}
                    <button onClick={handlePublish} disabled={publishing||!pubAccId||!hasPublishableContent()||(quota!==null&&(quota.remaining_quota||0)<=0)||(scheduleOn&&!scheduleTime)}
                      style={{display:"flex",alignItems:"center",gap:5,padding:"7px 16px",borderRadius:8,border:"none",background:scheduleOn?"var(--warn)":"var(--accent)",color:"#000",cursor:"pointer",fontSize:13,fontWeight:800,fontFamily:"inherit",whiteSpace:"nowrap",opacity:(publishing||!pubAccId||!pubTitle)?.5:1}}>
                      {publishing?(scheduleOn?"예약 중...":"발행 중..."):scheduleOn?"⏰ 예약":"🚀 발행"}
                    </button>
                  </div>
                </div>

                {/* ── 발행 설정 패널 (접이식) ── */}
                {showPublishPanel&&(
                  <div style={{background:"var(--bg2)",borderBottom:"2px solid var(--accent-border)",padding:"16px"}}>
                    {renderPublishPanel()}
                  </div>
                )}

                {pubMsg&&<div className={`alert-box ${pubMsg.includes("✅")?"alert-success":"alert-danger"}`} style={{margin:"12px 16px 0"}}>{pubMsg}</div>}

                {/* ── 에디터 (전폭) ── */}
                <div style={{padding:"16px",display:"flex",flexDirection:"column",gap:16}}>

                    {/* 제목 */}
                    <div className="card" style={{padding:"14px 16px"}}>
                      <label className="inp-label">글 제목</label>
                      <input className="inp lg" placeholder="블로그 글 제목..." value={pubTitle} onChange={e=>setPubTitle(e.target.value)}/>
                    </div>

                    {/* 썸네일 + 인사말 접기 (이미지 있으면 자동 펼침) */}
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
                          {/* 썸네일 */}
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
                                        <button key={i} onClick={()=>setThumbnail(src)} style={{flexShrink:0,width:64,height:64,borderRadius:10,overflow:"hidden",border:"2px solid var(--border)",padding:0,cursor:"pointer",transition:"border-color .15s"}}>
                                          <img src={src} alt="" style={{width:"100%",height:"100%",objectFit:"cover"}} onError={e=>{(e.target as HTMLImageElement).style.display="none";}}/>
                                        </button>
                                      ))}
                                    </div>
                                  </div>
                                )}
                                <button onClick={()=>thumbnailRef.current?.click()} style={{width:"100%",padding:"18px",borderRadius:12,border:"2px dashed var(--border)",background:"var(--bg)",cursor:"pointer",color:"var(--text3)",fontSize:13,fontFamily:"inherit"}}>
                                  📁 직접 업로드
                                </button>
                              </div>
                            )}
                            <input ref={thumbnailRef} type="file" accept="image/*" style={{display:"none"}} onChange={e=>{const f=e.target.files?.[0];if(!f)return;const r=new FileReader();r.onload=ev=>setThumbnail(ev.target?.result as string);r.readAsDataURL(f);}}/>
                          </div>
                          {/* 인사말 — 한 번 저장하면 모든 글에 계속 자동 삽입. 바꾸려면 고치고 다시 저장. */}
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
                              {savedGreeting && <button type="button" onClick={()=>{setGreeting("");localStorage.removeItem("publy_greeting");setSavedGreeting("");showToast("저장된 인사말을 비웠어요","success");}} title="저장된 인사말 지우기" style={{padding:"9px 12px",borderRadius:10,border:"1px solid var(--border)",background:"var(--card)",color:"var(--text3)",cursor:"pointer",fontSize:12,fontWeight:700,fontFamily:"inherit"}}>비우기</button>}
                            </div>
                            <p style={{margin:"6px 2px 0",fontSize:11,color:"var(--text3)",lineHeight:1.55}}>저장하면 앞으로 <b style={{color:"var(--text2)"}}>모든 글의 썸네일 다음</b>에 자동으로 들어가요. 바꾸려면 고치고 다시 저장하면 돼요.</p>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* 이미지 삽입 모드 */}
                    <div className="card" style={{padding:0,overflow:"hidden"}}>
                      <div style={{padding:"13px 16px",borderBottom:"1px solid var(--border)"}}>
                        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10}}>
                          <span style={{fontSize:15}}>🖼️</span>
                          <span style={{fontSize:14,fontWeight:700,color:"var(--text)"}}>이미지 삽입 모드</span>
                        </div>
                        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:10}}>
                          {[{v:"auto",ico:"✨",label:"자동",desc:"AI 이미지 자동 배치"},{v:"manual",ico:"📁",label:"수동",desc:"원하는 위치에 삽입"}].map(m=>(
                            <button key={m.v} onClick={()=>setImageMode(m.v as "auto"|"manual")} style={{padding:"10px 12px",borderRadius:10,border:`2px solid ${imageMode===m.v?"var(--accent)":"var(--border)"}`,background:imageMode===m.v?"var(--accent-bg)":"var(--bg)",cursor:"pointer",textAlign:"left",fontFamily:"inherit",transition:"all .15s"}}>
                              <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:3}}>
                                <span>{m.ico}</span>
                                <span style={{fontSize:13,fontWeight:700,color:imageMode===m.v?"var(--accent-text)":"var(--text)"}}>{m.label}</span>
                                {imageMode===m.v&&blocks.filter(b=>b.type==="image").length>0&&<span style={{fontSize:10,fontWeight:700,padding:"1px 7px",borderRadius:99,background:"var(--accent-text)",color:"#000"}}>{blocks.filter(b=>b.type==="image").length}개</span>}
                              </div>
                              <div style={{fontSize:11,color:"var(--text3)"}}>{m.desc}</div>
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
                            <div style={{padding:"8px 12px",borderRadius:8,border:"1px solid var(--accent-border)",background:"var(--accent-bg)",color:"var(--accent-text)",fontSize:12,fontWeight:600}}>⌨️ Ctrl+V</div>
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
                        }}/>                      </div>

                      {/* 본문 편집 헤더 */}
                      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"12px 16px",borderBottom:"1px solid var(--border)"}}>
                        <div style={{display:"flex",alignItems:"center",gap:8}}>
                          <span style={{fontSize:14,fontWeight:700,color:"var(--text)"}}>📝 본문 편집</span>
                          <span style={{fontSize:11,padding:"2px 8px",borderRadius:99,background:"var(--bg2)",color:"var(--text3)"}}>{blocks.length}블록</span>
                        </div>
                        <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                          <button onClick={()=>addTextBlock()} style={{padding:"5px 10px",borderRadius:7,border:"1px solid var(--border)",background:"var(--bg2)",color:"var(--text2)",cursor:"pointer",fontSize:11,fontWeight:700,fontFamily:"inherit"}}>+ 텍스트</button>
                          {imageMode==="manual"&&<button onClick={()=>addManualImageBlock()} style={{padding:"5px 10px",borderRadius:7,border:"1px solid var(--border)",background:"var(--bg2)",color:"var(--text2)",cursor:"pointer",fontSize:11,fontWeight:700,fontFamily:"inherit"}}>+ 이미지</button>}
                          {imageMode==="manual"&&getActiveImages().length>=2&&<button onClick={()=>{
                            const imgs=getActiveImages().slice(0,2);
                            const pair:ImagePairBlock={id:Date.now().toString(),type:"image-pair",images:imgs.map((src,i)=>({src,alt:`${keyword||"이미지"} ${i+1}`}))};
                            setBlocks(p=>[...p,pair]);
                            showToast("🖼️🖼️ 2열 이미지 추가됐어요!");
                          }} style={{padding:"5px 10px",borderRadius:7,border:"1px solid oklch(.75 .12 300 / 40%)",background:"oklch(.75 .12 300 / 8%)",color:"oklch(.75 .12 300)",cursor:"pointer",fontSize:11,fontWeight:700,fontFamily:"inherit"}}>🖼️🖼️ 2열</button>}
                          <span style={{fontSize:10,color:"var(--text3)",alignSelf:"center",marginLeft:4}}>Ctrl+V로 이미지 붙여넣기 가능</span>
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
                                    // 높이 자동 조절 — height:"auto" 리셋 없이 scrollHeight만 적용 (한글 조합 중 커서 튀는 버그 방지)
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
                            ):block.type==="image-pair"?(
                              <div style={{borderRadius:12,overflow:"hidden",border:"2px solid oklch(.75 .12 300 / 50%)"}}>
                                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"7px 12px",background:"oklch(.75 .12 300 / 8%)"}}>
                                  <span style={{fontSize:11,fontWeight:700,color:"oklch(.75 .12 300)"}}>🖼️🖼️ 2열 나란히</span>
                                  <button onClick={()=>removeBlock(block.id)} style={{background:"transparent",border:"none",color:"var(--text3)",cursor:"pointer",fontSize:14}}>✕</button>
                                </div>
                                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:4,padding:"8px 12px"}}>
                                  {(block as ImagePairBlock).images.map((img,i)=>(
                                    <div key={i} style={{borderRadius:8,overflow:"hidden",aspectRatio:"1/1",background:"var(--bg2)"}}>
                                      {img.src?<img src={img.src} alt={img.alt} style={{width:"100%",height:"100%",objectFit:"cover",display:"block"}} onError={e=>{(e.target as HTMLImageElement).style.display="none";}}/>
                                      :<div style={{width:"100%",height:"100%",display:"flex",alignItems:"center",justifyContent:"center",color:"var(--text3)",fontSize:11}}>📁 {i+1}번</div>}
                                    </div>
                                  ))}
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
                        <span style={{fontSize:11,color:"var(--text3)"}}>5~8개 권장</span>
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


            {/* ===== ⚡ 원터치 발행 (BEST) ===== */}
            {tab==="onetouch"&&(()=>{
              const OT="#7c3aed";
              const naverAccs=connAccs.filter(a=>a.platform==="naver");
              const kwList=otKeywords.split(/[\n,]+/).map(s=>s.trim()).filter(Boolean);
              const isUnlim=(["unlimited","admin"] as string[]).includes(user.plan);
              const remain=isUnlim?Infinity:Math.max(0,(PLAN_CONFIG[user.plan]?.dailyPublish??2)-dailyPublishUsed);
              const willRun=isUnlim?kwList.length:Math.min(kwList.length,remain);
              const termMin=otCustomTerm.trim()?Math.max(1,parseInt(otCustomTerm,10)||otTermMin):otTermMin;
              const stepColor=(s:string,st?:string)=>st==="done"?"#00b487":st==="fail"?"#e5397f":st==="limit"?"#f59e0b":st==="run"?OT:"var(--text3)";
              return (
              <div className="tab-onetouch" style={{animation:"fadeUp .25s ease both"}}>
                <UsageGuide theme={theme==="dark"?"dark":"light"} accent={OT} subtitle="키워드만 넣으면 제목·글·이미지·카테고리까지 자동으로 만들어 순서대로 발행해요." steps={[{ico:"⌨️",title:"키워드 입력",desc:"한 줄에 하나씩, 몇 개든 넣어요."},{ico:"⏱️",title:"텀 설정",desc:"발행 간격을 정해요(네이버 안전상 넉넉히)."},{ico:"⚡",title:"시작",desc:"나머지는 봇이 알아서 — 로그로 다 확인돼요."}]} />
                {renderAeoBanner()}

                {/* ✨ 글 살리기 진행상황 (블로그지수에서 넘어옴) */}
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

                {/* 등급별 하루 발행 한도 (원터치도 기본 발행 한도에 포함) */}
                <div className="card" style={{marginBottom:14,border:`1.5px solid ${OT}33`}}>
                  <div className="card-title" style={{marginBottom:4,color:OT}}>📊 등급별 하루 발행 한도</div>
                  <div style={{fontSize:12.5,color:"var(--text2)",lineHeight:1.5,marginBottom:12}}>원터치 발행도 <b style={{color:OT}}>기본 발행 한도에 포함</b>돼요. 일반 발행이든 원터치든 <b>합쳐서 하루 이만큼</b>까지예요. (예: 무료는 하루 2건)</div>
                  <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8}}>
                    {[["free","무료",2],["basic","베이직",6],["pro","프로",15]].map(([pk,pl,cnt])=>{const cur=user.plan===pk;return(
                      <div key={pk as string} style={{textAlign:"center",padding:"14px 8px",borderRadius:12,background:cur?`${OT}14`:"var(--bg)",border:`2px solid ${cur?OT:"var(--border)"}`,position:"relative"}}>
                        {cur&&<div style={{position:"absolute",top:-9,left:"50%",transform:"translateX(-50%)",background:OT,color:"#fff",fontSize:10,fontWeight:900,padding:"2px 9px",borderRadius:99,whiteSpace:"nowrap"}}>내 등급</div>}
                        <div style={{fontSize:13,fontWeight:800,color:cur?OT:"var(--text2)"}}>{pl as string}</div>
                        <div style={{fontSize:22,fontWeight:900,color:cur?OT:"var(--text)",marginTop:4,lineHeight:1}}>{cnt as number}<span style={{fontSize:12,fontWeight:700,marginLeft:1}}>건</span></div>
                        <div style={{fontSize:10.5,color:"var(--text3)",marginTop:3}}>하루 발행</div>
                      </div>
                    );})}
                  </div>
                  {isUnlim
                    ? <div style={{marginTop:10,fontSize:12.5,fontWeight:700,color:"#00b487",textAlign:"center"}}>✨ 회원님은 무제한 등급 — 한도 없이 발행할 수 있어요</div>
                    : <div style={{marginTop:10,fontSize:12,color:"var(--text3)",textAlign:"center"}}>더 많이 발행하려면 등급을 올려주세요 · 오늘 남은 발행 <b style={{color:OT}}>{remain}건</b></div>}
                </div>

                {/* 키워드 입력 */}
                <div className="card" style={{marginBottom:14,border:`1.5px solid ${OT}33`}}>
                  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,flexWrap:"wrap",marginBottom:8}}>
                    <div className="card-title" style={{margin:0,color:OT}}>⌨️ 키워드 <span style={{fontSize:12,fontWeight:600,color:"var(--text3)"}}>· {otAiKw?"AI가 자동 생성":"한 줄에 하나씩"}</span></div>
                    {/* AI 자동추천 토글 */}
                    <button onClick={()=>{const v=!otAiKw;setOtAiKw(v);localStorage.setItem("publy_ot_aikw",v?"1":"0");}} disabled={otRunning}
                      style={{display:"flex",alignItems:"center",gap:8,padding:"6px 12px",borderRadius:99,border:`2px solid ${otAiKw?OT:"var(--border)"}`,background:otAiKw?`${OT}16`:"var(--bg)",cursor:otRunning?"default":"pointer",fontFamily:"inherit"}}>
                      <span style={{fontSize:12.5,fontWeight:800,color:otAiKw?OT:"var(--text2)"}}>✨ AI 자동추천 키워드</span>
                      <span style={{width:34,height:20,borderRadius:99,background:otAiKw?OT:"var(--border)",position:"relative",transition:"all .15s",flexShrink:0}}>
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
                          <input className="inp" type="number" min={1} max={30} disabled={otRunning} value={otAiKwCount} onChange={e=>setOtAiKwCount(Math.max(1,Math.min(30,parseInt(e.target.value)||5)))} style={{width:74}}/>
                          <span style={{fontSize:13,color:"var(--text2)",fontWeight:700}}>개</span>
                        </div>
                        <button onClick={()=>{localStorage.setItem("publy_ot_aikw_count",String(otAiKwCount));localStorage.setItem("publy_ot_aikw","1");localStorage.setItem("publy_ot_aicats",JSON.stringify(otAiCats));showToast(`✅ 저장! 시작하면 AI가 ${otAiKwCount}개 자동 생성해요${otAiCats.length?` (${otAiCats.length}개 주제)`:""}`,"success");}} disabled={otRunning}
                          style={{padding:"9px 18px",borderRadius:9,border:"none",background:`linear-gradient(135deg,${OT},#c026d3)`,color:"#fff",cursor:otRunning?"default":"pointer",fontSize:13,fontWeight:800,fontFamily:"inherit"}}>💾 저장</button>
                        <div style={{fontSize:11.5,color:"var(--text3)",marginTop:10}}>👉 아래 <b style={{color:OT}}>⚡ 원터치 발행 시작</b>을 누르면 그 순간 {otAiKwCount}개{otAiCats.length?` (${otAiCats.join("·")})`:""}를 생성해서 순서대로 올려요.</div>
                      </div>
                    : <>
                        <textarea className="inp" value={otKeywords} onChange={e=>setOtKeywords(e.target.value)} disabled={otRunning}
                          placeholder={"예)\n원주 맛집\n겨울 제철 음식\n소상공인 정책자금 신청"} rows={6}
                          style={{width:"100%",resize:"vertical",lineHeight:1.6,fontSize:14}}/>
                        <div style={{fontSize:12,color:"var(--text2)",marginTop:6}}>지금 <b style={{color:OT}}>{kwList.length}개</b> 키워드 · 오늘 발행 가능 <b>{isUnlim?"무제한":`${remain}건`}</b>
                          {!isUnlim&&kwList.length>remain&&<span style={{color:"#f59e0b",fontWeight:700}}> · {willRun}개만 발행되고 나머지는 한도 부족 안내가 떠요</span>}</div>
                      </>}
                </div>

                {/* 발행 계정 */}
                <div className="card" style={{marginBottom:14}}>
                  <div className="card-title" style={{marginBottom:4}}>🔗 발행 네이버 계정</div>
                  <div style={{fontSize:12.5,color:"var(--text2)",lineHeight:1.5,marginBottom:10}}>계정은 <b onClick={()=>setTab("accounts")} style={{color:OT,cursor:"pointer",textDecoration:"underline"}}>계정 관리</b>에서 한 번만 연결하면 <b>일반 발행이랑 똑같이</b> 여기 자동으로 떠요. 원터치용으로 따로 로그인할 필요 없어요.</div>
                  {naverAccs.length===0
                    ? <div style={{fontSize:13,color:"var(--text2)"}}>연결된 네이버 계정이 없어요. <b onClick={()=>setTab("accounts")} style={{color:OT,cursor:"pointer",textDecoration:"underline"}}>계정 관리</b>에서 먼저 연결해주세요.</div>
                    : naverAccs.map(a=>(
                      <label key={a.id} onClick={()=>!otRunning&&setPubAccId(a.id)} style={{display:"flex",alignItems:"center",gap:10,padding:"12px 14px",borderRadius:10,cursor:otRunning?"default":"pointer",marginBottom:6,background:pubAccId===a.id?`${OT}14`:"var(--bg)",border:`2px solid ${pubAccId===a.id?OT:"var(--border)"}`,transition:"all .15s"}}>
                        <div style={{width:18,height:18,borderRadius:99,border:`2px solid ${pubAccId===a.id?OT:"var(--border)"}`,display:"flex",alignItems:"center",justifyContent:"center"}}>{pubAccId===a.id&&<div style={{width:9,height:9,borderRadius:99,background:OT}}/>}</div>
                        <div><div style={{fontWeight:700,fontSize:14}}>{a.username}</div>{(a as any).name&&<div style={{fontSize:12,color:"var(--text3)"}}>{(a as any).name}</div>}</div>
                      </label>
                    ))}
                </div>

                {/* 글·이미지 설정 — 2컬럼: 왼쪽 설정 / 오른쪽 Flow 준비(세로 절약) */}
                <div className="card" style={{marginBottom:14}}>
                  <div className="card-title" style={{marginBottom:10}}>✍️ 글·이미지 설정</div>
                  <div style={{display:"flex",gap:18,flexWrap:"wrap",alignItems:"flex-start"}}>
                    <div style={{flex:"1 1 320px",minWidth:0}}>
                      <div style={{fontSize:13,fontWeight:700,marginBottom:6}}>글 패턴</div>
                      <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:6}}>
                        {(()=>{const on=otWriteStyle==="자동";return(
                          <button disabled={otRunning} onClick={()=>{setOtWriteStyle("자동");localStorage.setItem("publy_ot_style","자동");}} style={{padding:"9px 14px",borderRadius:10,border:`2px solid ${on?OT:"var(--border)"}`,background:on?`${OT}16`:"var(--bg)",color:on?OT:"var(--text2)",cursor:otRunning?"default":"pointer",fontSize:13,fontWeight:800,fontFamily:"inherit"}}>✨ 자동(키워드마다 AI가 선택)</button>
                        );})()}
                        {WRITE_STYLES.map(s=>{const on=otWriteStyle===s.id;return(
                          <button key={s.id} disabled={otRunning} onClick={()=>{setOtWriteStyle(s.id);localStorage.setItem("publy_ot_style",s.id);}} style={{padding:"9px 14px",borderRadius:10,border:`2px solid ${on?OT:"var(--border)"}`,background:on?`${OT}16`:"var(--bg)",color:on?OT:"var(--text2)",cursor:otRunning?"default":"pointer",fontSize:13,fontWeight:800,fontFamily:"inherit"}}>{s.i} {s.id}</button>
                        );})}
                      </div>
                      <div style={{fontSize:11,color:"var(--text3)",marginBottom:14,lineHeight:1.5}}>{otWriteStyle==="자동"?"키워드 성격에 맞춰 맛집후기·여행기·감성일기·정보글 중 알아서 골라 써요.":"모든 키워드를 이 패턴으로 통일해서 써요."}</div>
                      <div style={{fontSize:13,fontWeight:700,marginBottom:6}}>글자수</div>
                      <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center",marginBottom:14}}>
                        {(["auto","manual"] as const).map(m=>{const on=otCharMode===m;return(
                          <button key={m} disabled={otRunning} onClick={()=>setOtCharMode(m)} style={{padding:"9px 14px",borderRadius:10,border:`2px solid ${on?OT:"var(--border)"}`,background:on?`${OT}16`:"var(--bg)",color:on?OT:"var(--text2)",cursor:otRunning?"default":"pointer",fontSize:13,fontWeight:800,fontFamily:"inherit"}}>{m==="auto"?"✨ 자동":"✍️ 직접"}</button>
                        );})}
                        {otCharMode==="manual"&&<><input className="inp" type="number" min={500} max={5000} step={100} disabled={otRunning} value={otTargetChars} onChange={e=>setOtTargetChars(Math.max(500,Math.min(5000,parseInt(e.target.value)||1500)))} style={{width:100}}/><span style={{fontSize:13,color:"var(--text2)",fontWeight:700}}>자</span></>}
                      </div>
                      <div style={{fontSize:13,fontWeight:700,marginBottom:6}}>이미지 방식</div>
                      <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                        {([["flow","🆓 Flow (무료)"],["ai","🎨 AI (유료 키)"]] as const).map(([m,l])=>{const on=otImgMode===m;return(
                          <button key={m} disabled={otRunning} onClick={()=>setOtImgMode(m)} style={{padding:"9px 14px",borderRadius:10,border:`2px solid ${on?OT:"var(--border)"}`,background:on?`${OT}16`:"var(--bg)",color:on?OT:"var(--text2)",cursor:otRunning?"default":"pointer",fontSize:13,fontWeight:800,fontFamily:"inherit"}}>{l}</button>
                        );})}
                      </div>
                      <div style={{marginTop:8,fontSize:12,color:"var(--text3)",lineHeight:1.5}}>{otImgMode==="flow"?"무료 Flow는 옆의 'Flow 준비'를 먼저 눌러 연결하세요. 그 창으로 이미지를 만들어 넣어요.":"AI 이미지는 설정 탭에 OpenAI/Replicate 키가 있어야 해요. 키가 없으면 이미지 없이 글만 올라가요."}</div>
                      <div style={{fontSize:13,fontWeight:700,marginTop:14,marginBottom:6}}>이미지 콘셉트</div>
                      <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                        {([['cycle','🔄 실사 2 : 만화 1','글마다 2:1로 자동 순환'],['photo','📷 실사형','모든 글을 실사로'],['comic','🖍️ 만화형','모든 글을 만화로']] as const).map(([v,label,tip])=>{const on=otImageConcept===v;return <button key={v} disabled={otRunning} title={tip} onClick={()=>{setOtImageConcept(v);localStorage.setItem("publy_ot_image_concept",v);}} style={{padding:"9px 12px",borderRadius:10,border:`2px solid ${on?OT:"var(--border)"}`,background:on?`${OT}16`:"var(--bg)",color:on?OT:"var(--text2)",cursor:otRunning?"default":"pointer",fontSize:12,fontWeight:800,fontFamily:"inherit"}}>{label}</button>;})}
                      </div>
                      <div style={{marginTop:6,fontSize:11,color:"var(--text3)"}}>{otImageConcept==="cycle"?"첫 두 글은 실사, 다음 한 글은 만화로 반복해 피드를 자연스럽게 섞어요.":"원터치로 만드는 모든 새 글에 같은 콘셉트를 적용해요."}</div>
                    </div>
                    {otImgMode==="flow"&&(
                      <div style={{flex:"1 1 300px",minWidth:260,maxWidth:440,padding:"14px 16px",borderRadius:12,border:`1.5px solid ${OT}33`,background:`${OT}08`}}>
                        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,marginBottom:8,flexWrap:"wrap"}}>
                          <div style={{fontSize:13,fontWeight:800,color:OT}}>🎬 Flow 계정 <span style={{fontSize:11,fontWeight:600,color:"var(--text3)"}}>· 크레딧 떨어지면 다른 계정으로 전환</span></div>
                          <div style={{display:"flex",gap:6}}>
                            <button onClick={handleFlowConnectAll} disabled={flowLaunching} style={{fontSize:11,fontWeight:800,padding:"5px 10px",borderRadius:8,border:`1px solid ${OT}55`,background:"var(--bg)",color:OT,cursor:flowLaunching?"wait":"pointer",fontFamily:"inherit"}}>전체 연결</button>
                            <button onClick={()=>{const id=(flowSlots.reduce((m,s)=>Math.max(m,s.id),-1))+1; setFlowSlots(p=>[...p,{id,name:`계정 ${id+1}`}]);}} disabled={flowLaunching} style={{fontSize:11,fontWeight:800,padding:"5px 10px",borderRadius:8,border:`1px solid ${OT}55`,background:"var(--bg)",color:OT,cursor:"pointer",fontFamily:"inherit"}}>➕ 계정 추가</button>
                          </div>
                        </div>
                        <div style={{fontSize:11,color:"var(--text3)",lineHeight:1.5,marginBottom:10}}>계정마다 <b>최초 1회</b> [열어서 로그인] → 이후 [전환]으로 바로 사용. 로그인은 각자 저장돼요.</div>
                        <div style={{display:"flex",flexDirection:"column",gap:6}}>
                          {flowSlots.map(s=>{const active=flowSlot===s.id; const ready=!!flowSlotReady[s.id]; return(
                            <div key={s.id} style={{display:"flex",alignItems:"center",gap:8,padding:"9px 11px",borderRadius:10,background:active?`${OT}14`:"var(--bg)",border:`2px solid ${active?OT:"var(--border)"}`}}>
                              <span style={{fontSize:15}}>{ready?"✅":"⚪"}</span>
                              <input value={s.name} onChange={e=>setFlowSlots(p=>p.map(x=>x.id===s.id?{...x,name:e.target.value}:x))} disabled={otRunning}
                                style={{flex:1,minWidth:0,fontSize:12.5,fontWeight:700,padding:"4px 6px",borderRadius:6,border:"1px solid var(--border)",background:"var(--card)",color:"var(--text)",fontFamily:"inherit"}}/>
                              {active
                                ? <span style={{fontSize:10.5,fontWeight:800,color:OT,padding:"3px 7px",borderRadius:99,background:`${OT}18`}}>사용 중</span>
                                : <button onClick={()=>{setFlowSlot(s.id);handleFlowLaunchChrome(s.id);}} disabled={flowLaunching} style={{fontSize:11,fontWeight:800,padding:"5px 9px",borderRadius:7,border:`1px solid ${OT}55`,background:"var(--card)",color:OT,cursor:"pointer",fontFamily:"inherit",whiteSpace:"nowrap"}}>전환</button>}
                              <button onClick={()=>handleFlowLaunchChrome(s.id)} disabled={flowLaunching} title="이 계정 창 열어서 로그인" style={{fontSize:11,fontWeight:800,padding:"5px 9px",borderRadius:7,border:"none",background:"linear-gradient(135deg,#a855f7,#7c3aed)",color:"#fff",cursor:flowLaunching?"wait":"pointer",fontFamily:"inherit",whiteSpace:"nowrap"}}>{ready?"열기":"로그인"}</button>
                              {flowSlots.length>1&&<button onClick={()=>{setFlowSlots(p=>p.filter(x=>x.id!==s.id)); if(flowSlot===s.id)setFlowSlot(flowSlots.find(x=>x.id!==s.id)?.id||0);}} disabled={otRunning} title="삭제" style={{fontSize:13,padding:"2px 6px",borderRadius:6,border:"none",background:"transparent",color:"var(--text3)",cursor:"pointer"}}>✕</button>}
                            </div>
                          );})}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* 💬 글쓴이 인사말 (발행하기와 동일 저장소 공유 · 저장하면 계속·수정 가능) */}
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
                    {savedGreeting && <button type="button" onClick={()=>{setGreeting("");localStorage.removeItem("publy_greeting");setSavedGreeting("");showToast("저장된 인사말을 비웠어요","success");}} disabled={otRunning} style={{padding:"9px 12px",borderRadius:10,border:"1px solid var(--border)",background:"var(--card)",color:"var(--text3)",cursor:"pointer",fontSize:12,fontWeight:700,fontFamily:"inherit"}}>비우기</button>}
                  </div>
                </div>

                {/* 🌱 온파트너 상품 링크 (발행하기와 동일) */}
                <div className="card" style={{marginBottom:14,borderColor:onPartnerItems.length>0?"rgba(190,255,0,.38)":undefined}}>
                  <div className="card-title" style={{marginBottom:6}}>🌱 온파트너 상품 링크 <span style={{fontSize:11,color:"var(--text3)",fontWeight:600}}>({onPartnerItems.length}/{MAX_ONPARTNER})</span></div>
                  <div style={{fontSize:11,color:"var(--text3)",lineHeight:1.6,marginBottom:10}}>링크 넣고 <b>조회</b> → <b>저장</b>을 <b>최대 {MAX_ONPARTNER}개까지</b> 반복하면, 각 상품이 <b>가격 나온 상품 카드</b>로 이미지 바로 밑에 자동 삽입돼요(Q&A·해시태그 위).</div>
                  {onPartnerItems.length<MAX_ONPARTNER&&(
                    <div style={{display:"flex",gap:7,alignItems:"stretch"}}>
                      <input className="inp" value={onPartnerLink} onChange={e=>{setOnPartnerLink(e.target.value);setOnPartnerError("");setOnPartnerPreview(null);}} onKeyDown={e=>e.key==="Enter"&&loadOnPartnerProduct()} placeholder="https://partner.yuanfnb.com/r/추천코드" style={{flex:1,minWidth:0}}/>
                      <button className="btn btn-secondary" onClick={loadOnPartnerProduct} disabled={onPartnerLoading} style={{flexShrink:0}}>{onPartnerLoading?<><span className="spinner"/>조회 중</>:"🔍 조회"}</button>
                    </div>
                  )}
                  {onPartnerError&&<div style={{fontSize:11,color:"var(--danger)",marginTop:7}}>⚠️ {onPartnerError}</div>}
                  {onPartnerPreview&&(
                    <div style={{marginTop:12,padding:10,borderRadius:11,background:"var(--accent-bg)",border:"1.5px solid var(--accent-border)"}}>
                      <div style={{display:"flex",gap:12,alignItems:"center"}}>
                        {onPartnerPreview.product.image?<img src={onPartnerPreview.product.image} alt={onPartnerPreview.product.name} style={{width:56,height:56,borderRadius:9,objectFit:"cover",flexShrink:0}}/>:<div style={{width:56,height:56,borderRadius:9,background:"var(--bg2)",display:"grid",placeItems:"center",fontSize:22,flexShrink:0}}>🌱</div>}
                        <div style={{minWidth:0,flex:1}}>
                          <div style={{fontSize:13,fontWeight:800,color:"var(--text)",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{onPartnerPreview.product.name}</div>
                          <div style={{fontSize:12,fontWeight:800,color:"var(--accent-text)",marginTop:3}}>{onPartnerPreview.product.price?`${onPartnerPreview.product.price.toLocaleString("ko-KR")}원`:"가격은 상품 페이지에서 확인"}</div>
                          <div style={{fontSize:10,color:onPartnerPreview.product.available?"var(--success)":"var(--danger)",marginTop:3}}>{onPartnerPreview.product.available?"● 판매 중":"● 현재 판매 중지"}</div>
                        </div>
                      </div>
                      <div style={{display:"flex",gap:7,marginTop:10}}>
                        <button className="btn btn-primary" onClick={addOnPartnerProduct} style={{flex:1,justifyContent:"center"}}>💾 저장 (목록에 추가)</button>
                        <button className="btn btn-secondary" onClick={()=>{setOnPartnerPreview(null);setOnPartnerLink("");}} style={{flexShrink:0}}>취소</button>
                      </div>
                    </div>
                  )}
                  {onPartnerItems.map((it,idx)=>(
                    <div key={it.product.partnerUrl||idx} style={{marginTop:8,padding:"8px 10px",borderRadius:10,background:"var(--card2)",border:"1px solid var(--border)",display:"flex",gap:10,alignItems:"center"}}>
                      <span style={{fontSize:11,fontWeight:800,color:"var(--accent-text)",flexShrink:0}}>{idx+1}</span>
                      {it.product.image?<img src={it.product.image} alt={it.product.name} style={{width:50,height:50,borderRadius:7,objectFit:"cover",flexShrink:0}}/>:<div style={{width:50,height:50,borderRadius:7,background:"var(--bg2)",display:"grid",placeItems:"center",fontSize:20,flexShrink:0}}>🌱</div>}
                      <div style={{minWidth:0,flex:1}}>
                        <div style={{fontSize:12.5,fontWeight:800,color:"var(--text)",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{it.product.name}</div>
                        <div style={{fontSize:11,fontWeight:800,color:"var(--accent-text)",marginTop:2}}>{it.product.price?`${it.product.price.toLocaleString("ko-KR")}원`:"가격 상품페이지 확인"}<span style={{fontSize:9,color:"var(--text3)",fontWeight:600,marginLeft:6}}>· 링크 자동삽입</span></div>
                      </div>
                      <button type="button" onClick={()=>setOnPartnerItems(prev=>prev.filter((_,i)=>i!==idx))} title="빼기" style={{border:0,background:"transparent",color:"var(--text3)",cursor:"pointer",fontSize:15,flexShrink:0}}>✕</button>
                    </div>
                  ))}
                  {onPartnerItems.length>1&&<div style={{marginTop:8,color:"var(--accent-text)",fontSize:10,fontWeight:800}}>본문에 골고루 분산 배치돼요 (Q&A·해시태그 위).</div>}
                </div>

                {/* 🔗 내 링크 넣기 (발행하기와 동일 · OG 썸네일 카드) */}
                <div className="card" style={{marginBottom:14,borderColor:myLinks.length>0?"rgba(0,150,255,.35)":undefined}}>
                  <div className="card-title" style={{marginBottom:6}}>🔗 내 링크 넣기 <span style={{fontSize:11,color:"var(--text3)",fontWeight:600}}>({myLinks.length}/{MAX_MYLINK})</span></div>
                  <div style={{fontSize:11,color:"var(--text3)",lineHeight:1.6,marginBottom:10}}>내 사이트·블로그 등 <b>아무 링크</b>나 넣고 <b>추가</b>하면, 발행 시 이미지 바로 밑에 <b>썸네일 카드(OG)</b>로 자동 배치돼요. 온파트너와 안 섞여요. (최대 {MAX_MYLINK}개)</div>
                  {myLinks.length<MAX_MYLINK&&(
                    <div style={{display:"flex",gap:7,alignItems:"stretch"}}>
                      <input className="inp" value={myLinkInput} onChange={e=>{setMyLinkInput(e.target.value);setMyLinkError("");}} onKeyDown={e=>e.key==="Enter"&&addMyLink()} placeholder="https://내사이트.com  (또는 pick.온종일.com)" style={{flex:1,minWidth:0}}/>
                      <button className="btn btn-secondary" onClick={addMyLink} style={{flexShrink:0}}>＋ 추가</button>
                    </div>
                  )}
                  {myLinkError&&<div style={{fontSize:11,color:"var(--danger)",marginTop:7}}>⚠️ {myLinkError}</div>}
                  {myLinks.map((url,idx)=>(
                    <div key={url} style={{marginTop:8,padding:"9px 11px",borderRadius:10,background:"var(--card2)",border:"1px solid var(--border)",display:"flex",gap:10,alignItems:"center"}}>
                      <span style={{fontSize:14,flexShrink:0}}>🔗</span>
                      <div style={{minWidth:0,flex:1}}>
                        <div style={{fontSize:12.5,fontWeight:800,color:"var(--text)",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{url.replace(/^https?:\/\//,"")}</div>
                        <div style={{fontSize:10,color:"var(--text3)",fontWeight:600,marginTop:2}}>발행 시 썸네일 카드로 자동 삽입</div>
                      </div>
                      <button type="button" onClick={()=>setMyLinks(prev=>prev.filter((_,i)=>i!==idx))} title="빼기" style={{border:0,background:"transparent",color:"var(--text3)",cursor:"pointer",fontSize:15,flexShrink:0}}>✕</button>
                    </div>
                  ))}
                  {myLinks.length>1&&<div style={{marginTop:8,color:"#0096ff",fontSize:10,fontWeight:800}}>본문 이미지 밑에 골고루 배치돼요 (Q&A·해시태그 위).</div>}
                </div>

                {/* 텀 + 이미지 + 카테고리 */}
                <div className="card" style={{marginBottom:14}}>
                  <div className="card-title" style={{marginBottom:10}}>⏱️ 발행 텀 <span style={{fontSize:12,fontWeight:600,color:"var(--text3)"}}>· 글 하나 올리고 다음까지 기다리는 시간</span></div>
                  <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:10}}>
                    {[[10,"10분"],[30,"30분"],[60,"1시간"],[120,"2시간"]].map(([m,l])=>{const on=!otCustomTerm.trim()&&otTermMin===m;return(
                      <button key={m as number} disabled={otRunning} onClick={()=>{setOtTermMin(m as number);setOtCustomTerm("");}}
                        style={{padding:"9px 16px",borderRadius:10,border:`2px solid ${on?OT:"var(--border)"}`,background:on?`${OT}16`:"var(--bg)",color:on?OT:"var(--text2)",cursor:otRunning?"default":"pointer",fontSize:14,fontWeight:800,fontFamily:"inherit",transition:"all .15s"}}>{l}</button>
                    );})}
                    <div style={{display:"flex",alignItems:"center",gap:6,padding:"0 4px"}}>
                      <input className="inp" type="number" min={1} disabled={otRunning} value={otCustomTerm} onChange={e=>setOtCustomTerm(e.target.value)} placeholder="직접" style={{width:80}}/>
                      <span style={{fontSize:13,color:"var(--text2)",fontWeight:700}}>분</span>
                    </div>
                  </div>
                  {termMin<10&&<div style={{fontSize:12,color:"#f59e0b",fontWeight:700,marginBottom:8}}>⚠️ 너무 짧으면 네이버가 스팸으로 볼 수 있어요. 넉넉한 간격을 권장해요.</div>}
                  <div style={{fontSize:11.5,color:"var(--text3)",marginBottom:8,lineHeight:1.5}}>🛡️ 계정 보호를 위해 실제 발행 간격은 설정값에서 <b>조금씩 랜덤(±15%)</b>으로 흔들려요. 칼같이 같은 간격으로 올리면 봇으로 보여 불이익을 받을 수 있거든요.</div>
                  <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
                    <span style={{fontSize:13,fontWeight:700}}>🖼️ 글당 이미지</span>
                    {[1,2,3,4,5].map(n=>(
                      <button key={n} disabled={otRunning} onClick={()=>setOtImgCount(n)} style={{width:38,height:38,borderRadius:10,border:`2px solid ${otImgCount===n?OT:"var(--border)"}`,background:otImgCount===n?`${OT}16`:"var(--bg)",color:otImgCount===n?OT:"var(--text2)",cursor:otRunning?"default":"pointer",fontSize:14,fontWeight:800,fontFamily:"inherit"}}>{n}</button>
                    ))}
                    <span style={{fontSize:12,color:"var(--text3)"}}>장</span>
                  </div>
                  <div style={{marginTop:12,padding:"10px 12px",borderRadius:10,background:`${OT}0d`,border:`1px solid ${OT}22`,fontSize:12.5,color:"var(--text2)",lineHeight:1.5}}>📂 <b style={{color:OT}}>카테고리는 자동</b>이에요 — 글 주제에 맞는 네이버 카테고리를 AI가 골라 넣어요. (실패 시 첫 카테고리)</div>
                </div>

                {/* 일시정지(크레딧 부족 등) → 이어가기 배너 */}
                {otPaused&&!otRunning&&(
                  <div style={{marginBottom:12,padding:"16px",borderRadius:14,border:"2px solid #f59e0b",background:"rgba(245,158,11,.08)"}}>
                    <div style={{fontSize:14.5,fontWeight:800,color:"#f59e0b",marginBottom:6}}>{otPaused.reason==="stopped"?`⏸ 멈췄어요 — 남은 ${otPaused.kws.length-otPaused.idx}개 (${otPaused.idx+1}번째 키워드부터)`:`⏸ Flow 크레딧 부족으로 멈췄어요 (${otPaused.idx+1}번째 키워드에서)`}</div>
                    <div style={{fontSize:12.5,color:"var(--text2)",lineHeight:1.6,marginBottom:10}}>{otPaused.reason==="stopped"?<><b>발행 텀을 바꾸려면</b> 위 <b>텀 설정</b>에서 바꾼 다음, 아래 <b>이어가기</b>를 누르면 <b>남은 키워드부터</b> 새 텀으로 계속돼요.</>:<>다른 Flow 계정으로 <b>전환</b>한 다음, <b>이어가기</b>를 누르면 <b>멈춘 그 키워드부터</b> 계속돼요. (자리에 없어도 돼요)</>}</div>
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
                    {/* 이 토글이 예약의 ON/OFF 스위치 — 켜야 아래 설정한 시각에 자동 시작 */}
                    <div style={{display:"flex",alignItems:"center",gap:8}}>
                      <span style={{fontSize:12.5,fontWeight:800,color:otSchedOn?"#7c3aed":"var(--text3)"}}>{otSchedOn?"켜짐":"꺼짐"}</span>
                      <button onClick={()=>{const v=!otSchedOn; if(v&&!(otAiKw||kwList.length>0)){showToast("먼저 키워드를 넣거나 AI 자동추천을 켜주세요","error");return;} if(v&&!pubAccId){showToast("발행할 네이버 계정을 먼저 선택해주세요","error");return;} setOtSchedOn(v); /* ★otSchedFiredRef 비우지 않음 — 감시 effect의 armStamp(켠 분 실행금지)를 지우면 켜자마자 실행되는 버그 */}}
                        title={otSchedOn?"예약 끄기":"예약 켜기"} style={{flexShrink:0,width:52,height:28,borderRadius:16,border:"none",cursor:"pointer",background:otSchedOn?"#7c3aed":"var(--border)",position:"relative",transition:"all .2s"}}>
                        <span style={{position:"absolute",top:3,left:otSchedOn?27:3,width:22,height:22,borderRadius:"50%",background:"#fff",transition:"all .2s",boxShadow:"0 1px 3px rgba(0,0,0,.3)"}}/>
                      </button>
                    </div>
                  </div>
                  <div style={{display:"flex",alignItems:"center",gap:12,flexWrap:"wrap",marginTop:12}}>
                    <div style={{display:"flex",flexDirection:"column",gap:4}}>
                      <span style={{fontSize:11.5,fontWeight:700,color:"var(--text3)"}}>발행 시각</span>
                      <input type="time" value={otSchedTime} disabled={otSchedOn} onChange={e=>{setOtSchedTime(e.target.value);localStorage.setItem("publy_ot_sched_time",e.target.value);}} style={{padding:"12px 14px",borderRadius:10,border:`2px solid ${otSchedOn?"var(--border)":"#7c3aed55"}`,background:"var(--bg)",color:"var(--text)",fontFamily:"inherit",fontSize:20,fontWeight:800,letterSpacing:1,minWidth:150,opacity:otSchedOn?.6:1}}/>
                    </div>
                    <label style={{display:"flex",alignItems:"center",gap:7,cursor:"pointer",fontSize:13,fontWeight:700,color:"var(--text2)",alignSelf:"flex-end",paddingBottom:12}}>
                      <input type="checkbox" checked={otSchedDaily} disabled={otSchedOn} onChange={e=>{setOtSchedDaily(e.target.checked);localStorage.setItem("publy_ot_sched_daily",e.target.checked?"1":"0");}} style={{width:18,height:18,accentColor:"#7c3aed"}}/>
                      매일 이 시각에 반복
                    </label>
                  </div>
                  <div style={{fontSize:11.5,color:"var(--text3)",lineHeight:1.55,marginTop:10}}>
                    {otSchedOn
                      ? <>✅ 예약 <b style={{color:"#7c3aed"}}>켜짐</b> — <b style={{color:"#7c3aed"}}>{otSchedTime}</b>{otSchedDaily?" 마다":"에"} 지금 설정(키워드·글패턴·이미지·텀)으로 <b>자동 시작</b>해요. <b>노트북만 켜두면</b> 자리에 없어도 돼요 — 그 시각까지 <b>절전으로 안 꺼지게</b> 막아둬요.</>
                      : <>① 위 <b>시각</b>과 <b>반복</b>을 정하고 → ② 오른쪽 위 <b style={{color:"#7c3aed"}}>토글을 켜야</b> 예약이 작동해요. 켜면 그 시각에 원터치가 자동 시작되고, 노트북이 안 꺼지게 막아요.</>}
                  </div>
                </div>
                {/* 시작/멈춤 */}
                {!otRunning
                  ? (()=>{const ready=(otAiKw?otAiKwCount>0:kwList.length>0)&&!!pubAccId; return (
                    <button onClick={()=>runOneTouch()} disabled={!ready} style={{width:"100%",padding:"16px",borderRadius:14,border:"none",background:ready?`linear-gradient(135deg,${OT},#c026d3)`:"var(--border)",color:"#fff",fontSize:17,fontWeight:900,fontFamily:"inherit",cursor:ready?"pointer":"default",boxShadow:ready?`0 6px 20px ${OT}44`:"none",transition:"all .15s"}}>⚡ 원터치 발행 시작 {otAiKw?`(AI ${otAiKwCount}개 자동생성)`:(kwList.length>0?`(${willRun}개)`:"")}</button>
                  );})()
                  : <button onClick={stopOneTouch} style={{width:"100%",padding:"16px",borderRadius:14,border:"none",background:"linear-gradient(135deg,#ef4444,#f43f5e)",color:"#fff",fontSize:17,fontWeight:900,fontFamily:"inherit",cursor:"pointer"}}>⏹ 전체 중단 {otNextAt&&`· 다음 발행까지 ${Math.max(0,Math.ceil((otNextAt-Date.now())/60000))}분`}</button>}

                {/* 로그 — 항상 표시(작업 안 할 때도 지난 기록 확인), 자동 저장 */}
                <div className="card" style={{marginTop:14}}>
                  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,marginBottom:10}}>
                    <div className="card-title" style={{margin:0}}>📋 진행 상황 · 로그 {otRunning&&<span style={{fontSize:11,fontWeight:800,color:"#fff",background:OT,padding:"2px 9px",borderRadius:99,marginLeft:6}}><span className="spinner" style={{marginRight:4}}/>작업 중</span>}</div>
                    {otLog.length>0&&!otRunning&&<button onClick={()=>{setOtLog([]);try{localStorage.removeItem("publy_ot_log");}catch{}}} style={{fontSize:11,padding:"5px 10px",borderRadius:8,border:"1px solid var(--border)",background:"var(--card2)",color:"var(--text3)",cursor:"pointer",fontWeight:700,fontFamily:"inherit"}}>🗑 기록 지우기</button>}
                  </div>
                  {otLog.length===0
                    ? <div style={{fontSize:12.5,color:"var(--text3)",padding:"14px 0",textAlign:"center"}}>아직 작업 기록이 없어요. 위에서 키워드를 넣고 <b style={{color:OT}}>원터치 발행 시작</b>을 누르면 여기에 단계별 진행이 실시간으로 쌓여요.</div>
                    : otLog.map((r,i)=>(
                      <div key={r.id} style={{display:"flex",alignItems:"center",gap:10,padding:"11px 12px",borderRadius:10,marginBottom:6,background:"var(--bg)",border:`1px solid ${r.status==="done"?"#00b48733":r.status==="fail"?"#e5397f33":r.status==="limit"?"#f59e0b33":"var(--border)"}`}}>
                        <div style={{width:24,height:24,borderRadius:99,flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:800,background:`${stepColor(r.step,r.status)}1a`,color:stepColor(r.step,r.status)}}>{i+1}</div>
                        <div style={{flex:1,minWidth:0}}>
                          <div style={{fontSize:13.5,fontWeight:700,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{r.title||r.kw}</div>
                          <div style={{fontSize:12,color:stepColor(r.step,r.status),fontWeight:600,marginTop:1}}>
                            {r.status==="run"&&<span className="spinner" style={{marginRight:5}}/>}
                            {r.step}{r.cat&&r.status!=="fail"&&<span style={{color:"var(--text3)"}}> · 📂 {r.cat}</span>}{r.at&&<span style={{color:"var(--text3)"}}> · {r.at}</span>}
                          </div>
                        </div>
                        {r.postUrl&&<a href={r.postUrl} target="_blank" rel="noreferrer" style={{flexShrink:0,fontSize:12,fontWeight:800,color:OT,textDecoration:"none",padding:"5px 10px",borderRadius:8,border:`1px solid ${OT}44`}}>🔗 보기</a>}
                      </div>
                    ))}
                  </div>
                {/* 하단 고정 로그창에 가리지 않게 여백 */}
                <div style={{height:otDockOpen?"46vh":"70px"}}/>
              </div>
              );
            })()}

            {/* ⚡ 원터치 로그 — 화면 하단 넓게 고정. 스크롤 안 해도 항상 보임 + 전체 복사 + 중단 */}
            {tab==="onetouch"&&(
              <div className="ot-logdock">
                <div className="ot-logdock-head">
                  <span style={{fontSize:14.5,fontWeight:900,color:"#7c3aed"}}>📋 원터치 로그</span>
                  {otRunning
                    ? <span style={{fontSize:11,fontWeight:800,color:"#fff",background:"#7c3aed",padding:"3px 10px",borderRadius:99}}><span className="spinner" style={{marginRight:4}}/>작업 중{otNextAt?` · 다음 ${Math.max(0,Math.ceil((otNextAt-Date.now())/60000))}분`:""}</span>
                    : <span style={{fontSize:11,fontWeight:700,color:"var(--text3)"}}>{otLiveLog.length>0?"대기 중 (지난 기록)":"대기 중"}</span>}
                  <span style={{marginLeft:"auto",display:"flex",gap:6,flexWrap:"wrap"}}>
                    <button className="ot-logdock-btn" onClick={()=>{const t=otLiveLog.join("\n"); if(!t){showToast("복사할 로그가 없어요","info");return;} navigator.clipboard.writeText(t).then(()=>showToast("📋 로그 전체를 복사했어요","success")).catch(()=>showToast("복사 실패","error"));}}>📋 전체 복사</button>
                    {otRunning&&<button className="ot-logdock-btn" style={{borderColor:"#ef4444",color:"#ef4444",fontWeight:900}} onClick={stopOneTouch}>⏹ 중단</button>}
                    {!otRunning&&otLiveLog.length>0&&<button className="ot-logdock-btn" onClick={()=>{setOtLiveLog([]);try{localStorage.removeItem("publy_ot_livelog");}catch{}}}>🗑 지우기</button>}
                    <button className="ot-logdock-btn" onClick={()=>setOtDockOpen(v=>!v)}>{otDockOpen?"▽ 접기":"△ 펼치기"}</button>
                  </span>
                </div>
                {otDockOpen&&<div className="ot-logdock-body" style={{height:"40vh"}} ref={el=>{if(el&&otRunning)el.scrollTop=el.scrollHeight;}}>
                  {otLiveLog.length===0
                    ? <span style={{color:"var(--text3)"}}>아직 작업 기록이 없어요.{"\n"}위에서 키워드를 넣고 "⚡ 원터치 발행 시작"을 누르면 여기에 제목→본문→이미지→발행까지 모든 진행이 한 줄씩 실시간으로 쌓여요.</span>
                    : otLiveLog.join("\n")}
                </div>}
              </div>
            )}


            {/* ===== 발행 기록 ===== */}
            {tab==="manage"&&(
              <div className="tab-manage" style={{animation:"fadeUp .25s ease both"}}>
                <UsageGuide theme={theme==="dark"?"dark":"light"} accent={theme==="dark"?"#a5b4ff":"#4f46e5"} subtitle="지금까지 올린 글을 모아서 관리해요." steps={[{ico:"📋",title:"목록 확인",desc:"발행한 글이 모두 여기 모여요."},{ico:"✅",title:"상태 보기",desc:"성공/실패와 올라간 주소를 확인해요."},{ico:"📈",title:"성과 추적",desc:"순위·조회 변화를 보고 다음 글에 참고해요."}]} />

                {/* ── 발행 통계 + 수익 예측 ── */}
                {(()=>{
                  const now=new Date();
                  const thisMonth=history.filter(h=>new Date(h.published_at).getMonth()===now.getMonth()&&new Date(h.published_at).getFullYear()===now.getFullYear());
                  const thisWeek=history.filter(h=>{const d=new Date(h.published_at);const diff=(now.getTime()-d.getTime())/(1000*60*60*24);return diff<=7;});
                  const success=history.filter(h=>h.status==="success");
                  const successRate=history.length>0?Math.round((success.length/history.length)*100):0;
                  const naverCnt=success.filter(h=>h.platform==="naver").length;
                  const tistoryCnt=success.filter(h=>h.platform==="tistory").length;
                  const estViews=success.length*120;
                  const estRevenue=Math.round(estViews*0.35);
                  return(
                    <div className="card" style={{marginBottom:14}}>
                      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14,gap:8,flexWrap:"wrap"}}>
                        <div className="card-title" style={{margin:0}}>📊 발행 통계 & 수익 예측</div>
                        <button onClick={checkPostRanks} disabled={rankChecking} style={{padding:"7px 13px",borderRadius:9,border:"none",background:rankChecking?"var(--card2)":"linear-gradient(135deg,#00c896,#00a5ff)",color:rankChecking?"var(--text3)":"#fff",cursor:rankChecking?"default":"pointer",fontSize:12,fontWeight:800,fontFamily:"inherit",whiteSpace:"nowrap"}}>{rankChecking?"📈 순위 확인 중...":"📈 순위 성과 확인"}</button>
                      </div>
                      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(120px,1fr))",gap:10,marginBottom:14}}>
                        {[
                          {label:"이번 달 발행",value:`${thisMonth.length}건`,color:"var(--accent-text)"},
                          {label:"이번 주 발행",value:`${thisWeek.length}건`,color:"var(--info)"},
                          {label:"성공률",value:`${successRate}%`,color:successRate>=80?"var(--success)":successRate>=50?"var(--warn)":"var(--danger)"},
                          {label:"예상 누적 조회",value:`${estViews.toLocaleString()}회`,color:"var(--purple)"},
                          {label:"예상 수익",value:`₩${estRevenue.toLocaleString()}`,color:"var(--warn)"},
                        ].map((s,i)=>(
                          <div key={i} style={{padding:"12px 14px",borderRadius:12,background:"var(--card2)",border:"1px solid var(--border)",textAlign:"center"}}>
                            <div style={{fontSize:18,fontWeight:900,color:s.color,fontFamily:"'Space Grotesk',sans-serif"}}>{s.value}</div>
                            <div style={{fontSize:11,color:"var(--text3)",marginTop:4,fontWeight:600}}>{s.label}</div>
                          </div>
                        ))}
                      </div>
                      <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                        <div style={{flex:1,minWidth:120,padding:"10px 14px",borderRadius:10,background:"rgba(3,199,90,.08)",border:"1px solid rgba(3,199,90,.2)"}}>
                          <div style={{fontSize:11,color:"var(--naver)",fontWeight:700,marginBottom:2}}>🟢 네이버</div>
                          <div style={{fontSize:16,fontWeight:900,color:"var(--naver)"}}>{naverCnt}건</div>
                        </div>
                        <div style={{flex:1,minWidth:120,padding:"10px 14px",borderRadius:10,background:"rgba(255,107,53,.08)",border:"1px solid rgba(255,107,53,.2)"}}>
                          <div style={{fontSize:11,color:"var(--tistory)",fontWeight:700,marginBottom:2}}>🟠 티스토리</div>
                          <div style={{fontSize:16,fontWeight:900,color:"var(--tistory)"}}>{tistoryCnt}건</div>
                        </div>
                        <div style={{flex:1,minWidth:120,padding:"10px 14px",borderRadius:10,background:"var(--accent-dim)",border:"1px solid var(--accent-border)"}}>
                          <div style={{fontSize:11,color:"var(--accent-text)",fontWeight:700,marginBottom:2}}>📈 누적 총계</div>
                          <div style={{fontSize:16,fontWeight:900,color:"var(--accent-text)"}}>{success.length}건 성공</div>
                        </div>
                      </div>
                    </div>
                  );
                })()}

                {/* 발행 기록 */}
                <div className="card">
                  <div className="card-header">
                    <div className="card-title">📋 발행 기록</div>
                    <div style={{display:"flex",gap:8,alignItems:"center"}}>
                      <span style={{fontSize:13,color:"var(--text2)"}}>총 {history.length}건</span>
                      <button className="btn btn-secondary btn-sm" onClick={()=>void loadHistory(true)}>🔄 새로고침</button>
                      {(()=>{ const failCnt=history.filter(h=>h.status==="fail").length; return failCnt>0 && <button className="btn btn-sm" style={{border:"1px solid var(--warn)",background:"rgba(255,159,10,.1)",color:"var(--warn)",fontWeight:800}} onClick={async()=>{if(!window.confirm(`실패한 발행 기록 ${failCnt}건을 삭제할까요?\n(성공한 글은 그대로 남아요)`))return;await deleteFailedHistory(user.id);setHistory(prev=>prev.filter(h=>h.status!=="fail"));showToast(`🗑 실패 기록 ${failCnt}건 삭제 완료`,"success");}}>⚠️ 실패 {failCnt}건 삭제</button>; })()}
                      {history.length>0&&<button className="btn btn-danger btn-sm" onClick={async()=>{if(!window.confirm(`발행 기록 ${history.length}건을 정말 모두 삭제할까요?\n(되돌릴 수 없습니다)`))return;if(!window.confirm("한 번 더 확인할게요. 전체 삭제를 진행할까요?"))return;await deleteAllHistory(user.id);setHistory([]);showToast("🗑 발행 기록 전체 삭제 완료","success");}}>🗑 전체삭제</button>}
                    </div>
                  </div>
                  {historyError&&<div style={{margin:"0 0 12px",padding:"10px 12px",borderRadius:10,background:"rgba(255,71,87,.08)",border:"1px solid rgba(255,71,87,.35)",fontSize:12,color:"var(--danger)",lineHeight:1.6,wordBreak:"break-word"}}>❌ {historyError}</div>}
                  {/* 발행 기록 기능설명 */}
                  <div style={{margin:"0 0 12px",padding:"10px 12px",borderRadius:10,background:"var(--card2)",border:"1px solid var(--border)",fontSize:12,color:"var(--text2)",lineHeight:1.6}}>
                    💡 <b>발행 기록이란?</b> 발행에 성공한 글이 여기에 <b>차곡차곡 쌓여요.</b> 서버에 안전하게 <b>영구 저장</b>돼서 앱을 껐다 켜거나 업데이트해도 안 사라져요. 위쪽 <b>📈 순위 성과 확인</b>으로 각 글의 검색 순위도 여기서 관리해요.
                    <br/><span style={{color:"var(--text3)"}}><b>🔄 새로고침</b> — 기록이 안 보이거나 방금 발행한 글이 아직 없으면 눌러서 <b>서버에서 최신 목록을 다시 불러와요.</b></span>
                  </div>
                  {/* 기간·상태 필터 (발행이 많아지면 골라 보기) */}
                  {history.length>0&&(()=>{
                    const now=new Date();
                    const inPeriod=(h:PublyHistory)=>{ const d=new Date(h.published_at);
                      if(histPeriod==="today") return d.toDateString()===now.toDateString();
                      if(histPeriod==="week") return (now.getTime()-d.getTime())/(864e5)<=7;
                      if(histPeriod==="month") return d.getMonth()===now.getMonth()&&d.getFullYear()===now.getFullYear();
                      return true; };
                    const cnt=(p:typeof histPeriod)=>history.filter(h=>{const d=new Date(h.published_at); if(p==="today")return d.toDateString()===now.toDateString(); if(p==="week")return (now.getTime()-d.getTime())/(864e5)<=7; if(p==="month")return d.getMonth()===now.getMonth()&&d.getFullYear()===now.getFullYear(); return true;}).length;
                    const chip=(active:boolean,color:string)=>({padding:"5px 12px",borderRadius:99,border:`1.5px solid ${active?color:"var(--border)"}`,background:active?color+"22":"transparent",color:active?color:"var(--text3)",cursor:"pointer",fontSize:12,fontWeight:800,fontFamily:"inherit" as const});
                    void inPeriod;
                    return <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:14,alignItems:"center"}}>
                      <span style={{fontSize:11,color:"var(--text3)",fontWeight:700,marginRight:2}}>기간</span>
                      {([["all","전체"],["today","오늘"],["week","이번주"],["month","이번달"]] as const).map(([k,l])=>
                        <button key={k} onClick={()=>setHistPeriod(k)} style={chip(histPeriod===k,"#3b82f6")}>{l} {cnt(k)}</button>)}
                      <span style={{width:1,height:16,background:"var(--border)",margin:"0 4px"}}/>
                      <span style={{fontSize:11,color:"var(--text3)",fontWeight:700,marginRight:2}}>상태</span>
                      {([["all","전체"],["success","성공"],["fail","실패"]] as const).map(([k,l])=>
                        <button key={k} onClick={()=>setHistStatus(k)} style={chip(histStatus===k,k==="fail"?"#ff6b6b":k==="success"?"#00c896":"#3b82f6")}>{l}</button>)}
                    </div>;
                  })()}
                  {(()=>{
                    const now=new Date();
                    const filtered=history.filter(h=>{
                      const d=new Date(h.published_at);
                      const okP=histPeriod==="all"||(histPeriod==="today"&&d.toDateString()===now.toDateString())||(histPeriod==="week"&&(now.getTime()-d.getTime())/(864e5)<=7)||(histPeriod==="month"&&d.getMonth()===now.getMonth()&&d.getFullYear()===now.getFullYear());
                      const okS=histStatus==="all"||h.status===histStatus;
                      return okP&&okS;
                    });
                    return history.length===0?(
                    <div className="empty-state" style={{padding:"32px 24px"}}>
                      <span className="empty-ico">🚀</span>
                      <div className="empty-title">아직 발행 기록이 없어요</div>
                      <div className="empty-sub">글 생성 탭에서 첫 번째 글을 발행해보세요!</div>
                      <button className="btn btn-primary" onClick={()=>setTab("write")}>글 생성 시작하기 →</button>
                    </div>
                  ):filtered.length===0?(
                    <div style={{textAlign:"center",padding:"28px",color:"var(--text3)",fontSize:13}}>이 조건에 맞는 발행 기록이 없어요.</div>
                  ):filtered.map((h,i)=>(
                    <div key={h.id} className="hist-item" style={{animationDelay:`${i*.04}s`}}>
                      <span style={{fontSize:22,flexShrink:0}}>{h.platform==="naver"?"🟢":"🟠"}</span>
                      <div className="hist-info">
                        <div className="hist-title">{h.title}</div>
                        <div className="hist-meta">{new Date(h.published_at).toLocaleString("ko-KR")}</div>
                        {/* 📈 순위 성과 배지 */}
                        {(()=>{const ln=scLogNoOf(h.post_url); const rd=ln?rankData[ln]:null; if(!rd)return null;
                          const diff=(rd.prev!=null&&rd.rank!=null)?rd.prev-rd.rank:null;   // +면 순위 상승
                          return(
                            <div style={{fontSize:11,marginTop:3,display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
                              <span style={{fontWeight:800,color:rd.rank!=null?"#00c896":"var(--text3)"}}>{rd.rank!=null?`🔍 현재 ${rd.rank}위`:"🔍 순위권 밖"}</span>
                              {diff!=null&&diff!==0&&<span style={{fontWeight:800,color:diff>0?"#00c896":"#ff6b6b"}}>{diff>0?`▲${diff} 상승`:`▼${-diff} 하락`}</span>}
                              {diff===0&&<span style={{color:"var(--text3)"}}>변동 없음</span>}
                            </div>
                          );
                        })()}
                        {h.error_message&&<div style={{fontSize:11,color:"var(--danger)",marginTop:2}}>❌ {h.error_message}</div>}
                      </div>
                      <span className={`sbadge ${h.status==="success"?"sbadge-ok":h.status==="fail"?"sbadge-fail":"sbadge-pend"}`}>
                        {h.status==="success"?"✅ 성공":h.status==="fail"?"❌ 실패":"⏳ 대기"}
                      </span>
                      {h.post_url&&<a href={h.post_url} target="_blank" rel="noopener noreferrer" className="view-link">보기</a>}
                      <button style={{padding:"4px 10px",borderRadius:7,border:"1px solid rgba(255,71,87,.4)",background:"rgba(255,71,87,.08)",color:"var(--danger)",cursor:"pointer",fontSize:12,fontWeight:800,flexShrink:0}} onClick={async()=>{if(!window.confirm(`이 발행 기록을 삭제할까요?\n\n"${h.title}"\n(이 기록만 지워지고, 실제 블로그 글은 그대로예요)`))return;await deleteHistory(h.id);setHistory(prev=>prev.filter(x=>x.id!==h.id));showToast("🗑 발행 기록 1건 삭제 완료","success");}}>🗑 삭제</button>
                          {h.status!=="fail"&&(
                            <button onClick={async()=>{
                              let c:any=(h as any).content;
                              if(typeof c==="string"){ try{c=JSON.parse(c);}catch{c=null;} }
                              // 목록엔 content를 안 싣는다(성능) → 이 한 건만 DB에서 단건 조회로 보충
                              if(!c){ try{ showToast("📄 발행했던 글·이미지를 불러오는 중…","info"); c=await getHistoryContent(h.id); }catch{ c=null; } }
                              if(c){
                                setPubTitle(c.title||h.title||"");
                                if(c.content)setGenContent(c.content);
                                if(Array.isArray(c.blocks))setBlocks(c.blocks.map((b:any)=>b.type==="text"?{type:"text",id:uid(),content:b.content}:b.type==="image"?{type:"image",id:uid(),src:b.src,alt:b.alt||"",position:"center",source:"auto"}:b.type==="image-pair"?{type:"image-pair",id:uid(),images:b.images}:null).filter(Boolean) as any);
                                if(c.imageUrl)setThumbnail(c.imageUrl);
                                if(Array.isArray(c.tags))setHashtags(c.tags.map((t:string)=>t.startsWith("#")?t:"#"+t));
                                if(c.visibility)setVisibility(c.visibility);
                                if(c.pubScope)setPubScope(c.pubScope);
                                setTab("publish");
                                showToast("✅ 글·이미지 통째로 복원 완료! 발행 버튼만 누르면 돼요","success");
                              }else{
                                setPubTitle(h.title||"");setTab("publish");
                                showToast("제목만 복원됐어요 (이전 발행은 내용 미저장)","info");
                              }
                            }} style={{padding:"4px 10px",borderRadius:7,border:"1px solid rgba(0,200,120,.3)",background:"transparent",color:"var(--success)",cursor:"pointer",fontSize:12,fontWeight:700,flexShrink:0}}>🔄 재발행</button>
                          )}
                    </div>
                  ));})()}
                </div>
                {/* 하단 여백: 마지막 기록의 삭제/재발행 버튼이 '결제 문의' 플로팅·모바일바에 가리지 않게 */}
                <div style={{height:120}} aria-hidden="true" />
              </div>
            )}

            {/* ===== 계정 관리 ===== */}
            {tab==="accounts"&&(
              <div style={{animation:"fadeUp .25s ease both"}}>
                {!botOnline&&<div className="alert-box alert-warn">⚠️ PC에서 Publy 앱을 실행해야 계정 연결이 가능해요</div>}
                <div className="card">
                  <div className="card-title" style={{marginBottom:14}}>➕ 계정 추가</div>
                  <div className="acc-form-grid" style={{display:"grid",gridTemplateColumns:"100px 1fr 1fr",gap:10,marginBottom:12}}>
                    <div><label className="inp-label">플랫폼</label><select className="inp" value={newPlat} onChange={e=>setNewPlat(e.target.value as any)}><option value="naver">네이버</option><option value="tistory">티스토리</option></select></div>
                    <div><label className="inp-label">아이디</label><input className="inp" placeholder="블로그 아이디" value={newUser} onChange={e=>setNewUser(e.target.value)}/></div>
                    <div><label className="inp-label">비밀번호</label><div style={{position:"relative"}}><input className="inp" type={showPw?"text":"password"} placeholder="비밀번호" value={newPw} onChange={e=>setNewPw(e.target.value)} style={{paddingRight:40}}/><button type="button" onClick={()=>setShowPw(v=>!v)} style={{position:"absolute",right:10,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",cursor:"pointer",fontSize:18,color:"var(--text3)"}}>{showPw?"🙈":"👁️"}</button></div></div>
                  </div>
                  <div style={{marginBottom:14}}><label className="inp-label">블로그명 <span style={{color:"var(--text3)",fontWeight:400}}>(티스토리만)</span></label><input className="inp" placeholder="예: myblog" value={newBlog} onChange={e=>setNewBlog(e.target.value)}/></div>
                  <button className="btn btn-primary" onClick={handleAddAccount} disabled={addingAcc||!newUser||!newPw}>{addingAcc?<><span className="spinner"/>추가 중...</>:<>➕ 계정 추가</>}</button>
                </div>
                {accounts.filter(a=>a.platform!=="google").length===0?(
                  <div className="empty-state"><span className="empty-ico">🔗</span><div className="empty-title">등록된 계정이 없어요</div><div className="empty-sub">위에서 블로그 계정을 추가해주세요</div></div>
                ):accounts.filter(a=>a.platform!=="google").map((a,i)=>(
                  <div key={a.id} style={{animationDelay:`${i*.06}s`}}>
                    <div className={`acc-card ${a.is_connected?(a.platform==="naver"?"conn-naver":"conn-tistory"):""}`}>
                      <span style={{fontSize:26}}>{a.platform==="naver"?"🟢":"🟠"}</span>
                      <div style={{flex:1,minWidth:0}}><div style={{fontSize:15,fontWeight:700,color:"var(--text)"}}>{a.username}</div><div style={{fontSize:11,color:"var(--text2)",marginTop:2}}>{a.platform}{a.blog_name&&` · ${a.blog_name}`}</div></div>
                      {(()=>{
                        const rs = a.platform==="naver"?realSession.naver:a.platform==="tistory"?realSession.tistory:undefined;
                        // 봇 온라인이면 실제 세션 기준, 오프라인이면 확인 불가라 DB값 기준.
                        const needReconnect = botOnline && a.is_connected && rs===false; // 저장은 됐다는데 실제 세션이 없음
                        const ok = botOnline ? !!rs : a.is_connected;
                        const label = ok?"✅ 연결됨":needReconnect?"⚠️ 재연결 필요":"미연결";
                        return <span style={{fontSize:11,fontWeight:700,padding:"4px 11px",borderRadius:99,background:ok?"var(--accent-bg)":needReconnect?"rgba(255,140,0,.14)":"var(--card-hover)",color:ok?"var(--accent-text)":needReconnect?"#ff8c00":"var(--text2)",border:"1px solid",borderColor:ok?"var(--accent-border)":needReconnect?"rgba(255,140,0,.5)":"var(--border)"}}>{label}</span>;
                      })()}
                      <button className="btn btn-secondary btn-sm" onClick={()=>handleConnect(a)} disabled={!!connId||!botOnline}>{connId===a.id?<><span className="sp-w spinner"/>연결 중...</>:a.is_connected?"재연결":"연결"}</button>
                      <button className="btn btn-danger btn-sm" onClick={()=>handleDeleteAccount(a.id)}>🗑 삭제</button>
                      <button onClick={()=>setEditingCatAccId(editingCatAccId===a.id?null:a.id)} style={{padding:"5px 11px",borderRadius:8,border:"1px solid var(--border)",background:"var(--bg2)",color:"var(--text2)",cursor:"pointer",fontSize:12,fontWeight:700,fontFamily:"inherit",flexShrink:0}}>
                        📂 카테고리 {(accCats[a.id]||[]).length>0?`(${(accCats[a.id]||[]).length})`:""}
                      </button>
                    </div>

                    {/* 카테고리 관리 패널 */}
                    {editingCatAccId===a.id&&(
                      <div style={{margin:"-8px 0 8px",padding:"14px 16px",borderRadius:"0 0 14px 14px",background:"var(--bg2)",border:"1px solid var(--border)",borderTop:"none"}}>
                        <div style={{fontSize:12,fontWeight:700,color:"var(--text3)",marginBottom:10}}>
                          📂 {a.username} 카테고리 목록
                          <span style={{fontWeight:400,marginLeft:6}}>발행 시 선택 가능해요</span>
                        </div>
                        {/* 등록된 카테고리 */}
                        <div style={{display:"flex",flexWrap:"wrap",gap:7,marginBottom:10}}>
                          {(accCats[a.id]||[]).length===0?(
                            <span style={{fontSize:12,color:"var(--text3)"}}>등록된 카테고리 없음</span>
                          ):(accCats[a.id]||[]).map((cat,ci)=>(
                            <div key={ci} style={{display:"flex",alignItems:"center",gap:5,padding:"5px 12px",borderRadius:99,background:"var(--accent-bg)",border:"1px solid var(--accent-border)",fontSize:13,fontWeight:600,color:"var(--accent-text)"}}>
                              {cat}
                              <button onClick={()=>removeCatFromAcc(a.id,cat)} style={{background:"transparent",border:"none",cursor:"pointer",color:"var(--accent-text)",fontSize:14,lineHeight:1,padding:0}}>✕</button>
                            </div>
                          ))}
                        </div>
                        {/* 카테고리 추가 */}
                        <div style={{display:"flex",gap:8}}>
                          <input
                            className="inp"
                            placeholder="카테고리명 입력 (예: 맛집, 여행, 리뷰)"
                            value={catInput}
                            onChange={e=>setCatInput(e.target.value)}
                            onKeyDown={e=>{if(e.key==="Enter")addCatToAcc(a.id);}}
                            style={{flex:1,fontSize:13}}
                          />
                          <button onClick={()=>addCatToAcc(a.id)} className="btn btn-primary" style={{padding:"0 16px",flexShrink:0}}>추가</button>
                        </div>
                        {botOnline&&(
                          <button onClick={async()=>{setEditingCatAccId(a.id);await loadCategories(a.platform,a.id);}} disabled={loadingCats} style={{marginTop:8,width:"100%",padding:"8px",borderRadius:9,border:"1px solid var(--border)",background:"var(--bg)",color:"var(--text2)",cursor:loadingCats?"wait":"pointer",fontSize:12,fontWeight:700,fontFamily:"inherit"}}>
                            {loadingCats?"⏳ 불러오는 중...":"🔄 봇에서 카테고리 자동 불러오기"}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                ))}

                {/* ===== 🎨 Google Flow 계정 연결 ===== */}
                <GoogleFlowCard botOnline={botOnline} botUrl={BOT} userId={user?.id||""} />
              </div>
            )}

            {/* ===== 📊 블로그 순위 ===== */}
            {tab==="rank"&&(
              <div style={{animation:"fadeUp .25s ease both",height:"calc(100vh - 58px - 40px)",display:"flex",flexDirection:"column"}}>
                {/* 헤더 */}
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
                {/* iframe */}
                <div style={{flex:1,borderRadius:"0 0 0 0",overflow:"hidden",border:"1px solid var(--border)",borderLeft:"none",borderRight:"none",borderBottom:"none"}}>
                  <iframe
                    src="https://rank.xn--zk5biyyw.com/"
                    style={{width:"100%",height:"100%",border:"none",display:"block"}}
                    title="블로그 순위 확인"
                    allow="clipboard-read; clipboard-write"
                  />
                </div>
              </div>
            )}

            {/* ===== 설정 ===== */}
            {/* ===== 📅 콘텐츠 캘린더 ===== */}
            {tab==="calendar"&&(
              <div className="tab-calendar" style={{animation:"fadeUp .25s ease both"}}>
                <UsageGuide theme={theme==="dark"?"dark":"light"} accent={theme==="dark"?"#6fca8f":"#3f8f5f"} subtitle="매일 뭘 쓸지 정해주고, 꾸준함도 챙겨줄게요." steps={[{ico:"🗓️",title:"글감 보기",desc:"날짜별 추천 주제와 핫이슈를 봐요."},{ico:"✍️",title:"글쓰기",desc:"글쓰기 버튼으로 바로 작성을 시작해요."},{ico:"🔥",title:"완료 체크",desc:"쓴 날은 체크! 며칠 연속 썼는지 스트릭도 쌓여요."}]} />

                {/* 🔥 핫이슈 추천 (무료·누구나) */}
                <div className="card" style={{marginBottom:14,border:"1.5px solid rgba(255,180,0,.35)",background:"linear-gradient(135deg,rgba(255,196,0,.06),rgba(255,146,10,.03))"}}>
                  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,flexWrap:"wrap",marginBottom:8}}>
                    <div className="card-title" style={{margin:0}}>🔥 오늘의 핫이슈 <span style={{fontSize:11,fontWeight:800,color:"#ff8c00",background:"rgba(255,180,0,.15)",padding:"2px 8px",borderRadius:99,marginLeft:4}}>무료</span></div>
                    <button onClick={()=>loadHotIssues(hotCat,{refreshed:true})} disabled={hotLoading} style={{fontSize:11,padding:"5px 10px",borderRadius:8,border:"1px solid var(--border)",background:"var(--card2)",color:"var(--text2)",cursor:"pointer",fontWeight:700,fontFamily:"inherit",transition:"all .15s"}} onMouseEnter={e=>{e.currentTarget.style.borderColor="#ff8c00";e.currentTarget.style.color="#ff8c00";}} onMouseLeave={e=>{e.currentTarget.style.borderColor="var(--border)";e.currentTarget.style.color="var(--text2)";}}>{hotLoading?"⏳ 불러오는 중...":"🔄 새로고침"}</button>
                  </div>
                  <div style={{fontSize:11.5,color:"var(--text2)",lineHeight:1.5,marginBottom:11}}>지금 <b>실시간·분야별로 뜨는 주제</b>예요. 관심 있는 걸 <b style={{color:"#ff8c00"}}>탭하면 아래 키워드에 바로 추가</b>돼요. (실시간=구글 트렌드·뉴스, 분야별=뉴스+검색어 · <b style={{color:"#ff8c00"}}>매일 자동 갱신</b>)</div>
                  {/* 카테고리 탭 */}
                  <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:12}}>
                    {HOT_CATS.map(c=>(
                      <button key={c} onClick={()=>loadHotIssues(c)}
                        style={{padding:"6px 12px",borderRadius:99,border:`1.5px solid ${hotCat===c?"#ff8c00":"var(--border)"}`,background:hotCat===c?"rgba(255,140,0,.12)":"var(--bg)",color:hotCat===c?"#ff8c00":"var(--text2)",cursor:"pointer",fontSize:12,fontWeight:800,fontFamily:"inherit",transition:"all .15s"}}>
                        {c==="실시간"?"🔥 실시간":c}
                      </button>
                    ))}
                  </div>
                  {/* 핫이슈 칩 */}
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
                        <button onClick={()=>{const kw=quickKw.trim(); if(!kw){showToast("먼저 핫이슈를 골라주세요","info");return;} setKeyword(kw);setSelectedTitle(kw);setPendingPromo(null);setTab("write");showToast(`✍️ "${kw.slice(0,16)}…" 바로 글쓰기로 이동!`,"success");}}
                          style={{flexShrink:0,padding:"10px 18px",borderRadius:10,border:"none",background:"linear-gradient(135deg,#ff922e,#ff6a3d)",color:"#fff",fontSize:13,fontWeight:800,fontFamily:"inherit",cursor:"pointer",whiteSpace:"nowrap",boxShadow:"0 6px 16px -6px rgba(255,122,61,.5)"}}>바로 글쓰기 →</button>
                      </div>
                    </div>
                  )}
                </div>

                {/* 💡 추천 글감 — 우리 서비스를 '주제'로 자연스럽게 녹임(링크 X, 클릭 시 키워드에 추가) */}
                {(()=>{
                  // 각 서비스가 블로그 글 주제로 자연스럽게 들어가는 글감들
                  const ideas=[
                    "제철 농수산물 고르는 법","산지직송 장보기 후기","집밥 식재료 추천",
                    "블로그 체험단 신청 꿀팁","협찬 후기 잘 쓰는 법","무료로 즐기는 웹게임 추천",
                    "부업으로 제휴마케팅 시작하기","소자본 창업 아이템","정부지원금 신청 방법",
                    "AI로 블로그 글 쓰는 법","무료 마케팅 툴 모음","홈페이지 없이 브랜드 알리기",
                    "온라인 부수입 만드는 법","1인 창업 준비 체크리스트","요즘 뜨는 부업 트렌드",
                  ];
                  return (
                  <div className="card" style={{marginBottom:14,padding:"13px 15px"}}>
                    <div style={{fontSize:12,fontWeight:800,color:"var(--text2)",marginBottom:4}}>💡 오늘의 추천 글감 <span style={{fontSize:10.5,color:"var(--text3)",fontWeight:600}}>· 탭하면 키워드에 추가돼요</span></div>
                    <div style={{fontSize:11,color:"var(--text3)",lineHeight:1.5,marginBottom:10}}>뭘 쓸지 막막할 때, 반응 좋은 <b>실생활·수익·창업</b> 주제를 골라 바로 시작해보세요.</div>
                    <div style={{display:"flex",flexWrap:"wrap",gap:7}}>
                      {ideas.map((it,i)=>(
                        <button key={i} onClick={()=>{setCalKeywords(prev=>{const list=prev.split(/[,\n]+/).map(s=>s.trim()).filter(Boolean); if(!list.includes(it)) list.push(it); return list.join(", ");}); showToast(`➕ "${it}" 키워드에 추가!`);}}
                          style={{padding:"7px 12px",borderRadius:10,border:"1px solid var(--border)",background:"var(--bg)",color:"var(--text)",cursor:"pointer",fontSize:12.5,fontWeight:600,fontFamily:"inherit",transition:"all .12s"}}
                          onMouseEnter={e=>{e.currentTarget.style.borderColor="#03c75a";e.currentTarget.style.background="rgba(3,199,90,.07)";}}
                          onMouseLeave={e=>{e.currentTarget.style.borderColor="var(--border)";e.currentTarget.style.background="var(--bg)";}}>
                          {it}
                        </button>
                      ))}
                    </div>
                  </div>
                  );
                })()}

                {/* 설정 카드 */}
                <div className="card">
                  <div className="card-title" style={{marginBottom:8}}>📅 콘텐츠 캘린더 생성</div>
                  <div style={{fontSize:12.5,color:"var(--text2)",lineHeight:1.6,marginBottom:16,padding:"11px 14px",borderRadius:11,background:"var(--card2)",border:"1px solid var(--border)"}}>
                    💡 <b>키워드만 넣으면 AI가 며칠치 발행 계획표를 자동으로</b> 짜줘요. 날짜별로 <b>어떤 키워드·제목</b>으로 쓸지 정해주고(주말=감성/맛집, 평일=정보성), 각 줄의 <b style={{color:"var(--accent-text)"}}>✍️ 글쓰기</b>를 누르면 그 제목으로 바로 글 생성으로 이동해요. <b>발행한 글은 ✓ 체크</b>하면 진행률과 <b style={{color:"#ff7a30"}}>🔥 연속 발행일</b>이 쌓여요. <span style={{color:"var(--text3)"}}>계획표는 저장돼서 다시 들어와도 그대로 있어요.</span>
                  </div>
                  <div style={{marginBottom:14}}>
                    <label className="inp-label">🔑 키워드 입력 (쉼표 또는 줄바꿈으로 구분)</label>
                    <textarea className="inp" rows={4} placeholder={"예: 다이어트 방법, 제주도 여행, 강남 맛집\n오징어 젓갈, 홈카페 레시피"}
                      value={calKeywords} onChange={e=>setCalKeywords(e.target.value)} style={{resize:"vertical"}}/>
                  </div>
                  <div className="cal-grid" style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:14}}>
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

                {/* 스케줄 결과 (저장된 것도 표시) */}
                {calSchedule.length>0&&(()=>{
                  const todayStr=new Date().toISOString().slice(0,10);
                  const total=calSchedule.length;
                  const doneCount=calSchedule.filter(s=>calCompleted[s.date]).length;
                  const pct=total?Math.round(doneCount/total*100):0;
                  // 🔥연속 발행 스트릭: 완료한 날짜가 오늘(또는 어제)부터 며칠 연속 이어졌는지
                  const doneDates=new Set(calSchedule.filter(s=>calCompleted[s.date]).map(s=>s.date));
                  let streak=0; const cur=new Date();
                  if(!doneDates.has(todayStr)) cur.setDate(cur.getDate()-1);   // 오늘 아직이면 어제부터
                  while(doneDates.has(cur.toISOString().slice(0,10))){streak++;cur.setDate(cur.getDate()-1);}
                  const todayItem=calSchedule.find(s=>s.date===todayStr);
                  const todayDone=todayItem&&!!calCompleted[todayItem.date];
                  const cheer=pct===100?"🎉 완주했어요! 정말 대단해요":pct>=70?"🔥 거의 다 왔어요, 조금만 더!":pct>=40?"👍 절반 넘었어요, 이 페이스 유지!":pct>0?"💪 시작이 반이에요":"✨ 오늘 한 편부터 가볍게 시작해요";
                  return(
                  <>
                    {/* ===== 후킹: 진행률 + 스트릭 + 오늘의 글 ===== */}
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
                      {/* 오늘 쓸 글 배너 */}
                      {todayItem&&(
                        <div style={{marginTop:13,padding:"13px 15px",borderRadius:12,background:todayDone?"rgba(3,199,90,.08)":"var(--accent-bg)",border:`1.5px solid ${todayDone?"rgba(3,199,90,.35)":"var(--accent-border)"}`,display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
                          <div style={{flex:1,minWidth:180}}>
                            <div style={{fontSize:11,fontWeight:800,color:todayDone?"var(--success)":"var(--accent-text)",marginBottom:3,letterSpacing:".02em"}}>{todayDone?"✅ 오늘 글 완료!":"📌 오늘 쓸 글"}</div>
                            <div style={{fontSize:14,fontWeight:800,color:"var(--text)",lineHeight:1.35,textDecoration:todayDone?"line-through":"none",opacity:todayDone?.6:1}}>{todayItem.title}</div>
                            <div style={{fontSize:11,color:"var(--text3)",marginTop:3}}>🔑 {todayItem.keyword} · {todayItem.style}</div>
                          </div>
                          {!todayDone&&<button onClick={()=>writeFromSchedule(todayItem)} className="btn btn-primary" style={{padding:"11px 18px",fontSize:13,whiteSpace:"nowrap"}}>✍️ 지금 쓰기 →</button>}
                        </div>
                      )}
                    </div>

                    {/* ===== 발행 스케줄 표 ===== */}
                    <div className="card" style={{marginTop:0,padding:0,overflow:"hidden",animation:"fadeUp .2s ease both"}}>
                      <div style={{padding:"14px 16px",borderBottom:"1px solid var(--border)",display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,flexWrap:"wrap"}}>
                        <div className="card-title" style={{margin:0}}>📋 {total}일치 발행 스케줄</div>
                        <div style={{display:"flex",gap:8}}>
                          <button onClick={()=>{
                            const csv=["날짜,키워드,제목,스타일,수익유형,완료",...calSchedule.map(s=>`${s.date},${s.keyword},"${s.title}",${s.style},${s.adType},${calCompleted[s.date]?"완료":""}`)].join("\n");
                            const a=document.createElement("a");a.href=URL.createObjectURL(new Blob(["﻿"+csv],{type:"text/csv"}));a.download="콘텐츠캘린더.csv";a.click();
                          }} style={{padding:"6px 14px",borderRadius:8,border:"1px solid var(--border)",background:"var(--card2)",color:"var(--text2)",cursor:"pointer",fontSize:12,fontWeight:700,fontFamily:"inherit"}}>📥 CSV</button>
                          <button onClick={()=>{if(window.confirm("이 스케줄을 지울까요? 완료 기록도 함께 삭제돼요.")){setCalSchedule([]);setCalCompleted({});setCalDone(false);localStorage.removeItem("publy_cal_schedule");localStorage.removeItem("publy_cal_done");}}}
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

            {/* ⚠️ 인스타 DM 안전 수칙 팝업 */}
            {showCrawlLock&&(
              <div onClick={()=>setShowCrawlLock(false)} style={{position:"fixed",inset:0,background:"rgba(12,8,20,.62)",backdropFilter:"blur(4px)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:99999,padding:20}}>
                <div onClick={e=>e.stopPropagation()} style={{background:"#fff",borderRadius:26,padding:"30px 26px 26px",maxWidth:360,width:"100%",textAlign:"center",boxShadow:"0 26px 70px rgba(255,111,165,.4)",border:"2px solid #ffe0ec",animation:"crawlPop .32s cubic-bezier(.34,1.56,.64,1)"}}>
                  <img src={dodoImg} alt="도도" onError={(e)=>{const d=document.createElement("div");d.textContent="🔒";d.style.cssText="font-size:74px;line-height:1;margin:8px 0";e.currentTarget.replaceWith(d);}} style={{width:118,height:118,objectFit:"contain",filter:"drop-shadow(0 10px 16px rgba(255,111,165,.32))",animation:"crawlBob 1.6s ease-in-out infinite"}}/>
                  <div style={{fontSize:20,fontWeight:900,color:"#20242b",margin:"6px 0 8px"}}>🔒 관리자 승인이 필요해요</div>
                  <div style={{fontSize:13.5,color:"#6b7280",lineHeight:1.65,marginBottom:22}}>크롤링은 <b style={{color:"#ff6fa5"}}>관리자 승인</b>을 받은 회원만 쓸 수 있어요.<br/>승인을 요청하면 도도가 열어드릴게요! ✨</div>
                  <button onClick={()=>setShowCrawlLock(false)} style={{width:"100%",padding:"14px",borderRadius:15,border:"none",background:"linear-gradient(135deg,#ff6fa5,#ff9ec4)",color:"#fff",fontSize:15,fontWeight:800,cursor:"pointer",boxShadow:"0 10px 24px rgba(255,111,165,.42)"}}>알겠어요</button>
                </div>
              </div>
            )}
            {showInstaWarn&&(
              <div style={{position:"fixed",inset:0,zIndex:9999,background:"rgba(0,0,0,.78)",backdropFilter:"blur(8px)",display:"flex",alignItems:"center",justifyContent:"center",padding:16}} onClick={()=>setShowInstaWarn(false)}>
                <div onClick={e=>e.stopPropagation()} style={{width:"100%",maxWidth:440,background:"var(--card)",border:"1px solid var(--border)",borderRadius:18,overflow:"hidden",boxShadow:"0 20px 60px rgba(0,0,0,.4)"}}>
                  <div style={{padding:"20px 22px",background:"linear-gradient(135deg,#f0417a,#ff6fa1)",color:"#fff"}}>
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
                    <button onClick={()=>setShowInstaWarn(false)} style={{marginTop:4,padding:"13px",borderRadius:11,border:"none",background:"linear-gradient(135deg,#f0417a,#ff6fa1)",color:"#fff",fontSize:14,fontWeight:800,fontFamily:"inherit",cursor:"pointer"}}>
                      확인했어요 👍
                    </button>
                  </div>
                </div>
              </div>
            )}

            {tab==="insta_dm"&&(
              <div className="tab-insta" style={{animation:"fadeUp .25s ease both"}}>
                <UsageGuide theme={theme==="dark"?"dark":"light"} accent={theme==="dark"?"#e884b8":"#c13584"} subtitle="인스타에서 관심 고객을 찾아 DM을 보내요." steps={[{ico:"📱",title:"인스타 로그인",desc:"인스타 계정으로 로그인해요."},{ico:"🔍",title:"대상 수집",desc:"키워드로 보낼 대상을 모아요."},{ico:"✉️",title:"메시지 발송",desc:"메시지를 적고 천천히 안전하게 보내요."}]} />

                {/* 헤더 */}
                <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:20}}>
                  <div style={{width:48,height:48,borderRadius:16,background:"linear-gradient(135deg,#f0417a,#ff6fa1)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:24,boxShadow:"0 6px 20px rgba(255,107,157,.3)",flexShrink:0}}>📱</div>
                  <div>
                    <div style={{fontSize:20,fontWeight:900,color:"var(--text)"}}>인스타그램 DM</div>
                    <div style={{fontSize:12,color:"var(--text3)",marginTop:2}}>체험단·협찬 모집을 위한 인스타 DM 발송 서비스</div>
                  </div>
                </div>

                <div aria-label="인스타그램 DM 진행 단계" style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,marginBottom:16}}>
                  {["계정 연결","대상 준비","문구 확인","안전 발송"].map((label,index)=>{
                    const step=index+1;
                    const done=step<dmCurrentStep;
                    const active=step===dmCurrentStep;
                    return <div key={label} style={{padding:"10px 8px",borderRadius:12,textAlign:"center",border:`1px solid ${done||active?"rgba(255,107,157,.55)":"var(--border)"}`,background:active?"linear-gradient(135deg,rgba(255,107,157,.16),rgba(199,125,255,.14))":done?"rgba(255,107,157,.07)":"var(--card)",color:done||active?"#FF6B9D":"var(--text3)",fontSize:11,fontWeight:800}}>
                      <span aria-hidden="true">{done?"✓":step}</span> {label}
                    </div>;
                  })}
                </div>

                {/* 사용량 카드 */}
                <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(130px,1fr))",gap:10,marginBottom:18}}>
                  {[
                    {label:"오늘 발송",value:instaUsed,total:INSTA_DM_DAILY_LIMIT[user.plan]??5,color:"#FF6B9D"},
                    {label:"전체 타겟",value:dmTargets.length,color:"var(--text)"},
                    {label:"✅ 발송완료",value:dmTargets.filter(t=>t.status==="sent").length,color:"var(--success)"},
                    {label:"⏳ 대기중",value:dmTargets.filter(t=>t.status==="pending").length,color:"var(--info)"},
                  ].map((s,i)=>(
                    <div key={i} style={{padding:"16px",borderRadius:14,background:"var(--card)",border:"1px solid var(--border)",textAlign:"center",position:"relative",overflow:"hidden"}}>
                      {i===0&&(s.total??0)>0&&(
                        <div style={{position:"absolute",bottom:0,left:0,height:3,width:`${Math.min(100,(s.value/(s.total||1))*100)}%`,background:"linear-gradient(90deg,#FF6B9D,#C77DFF)",borderRadius:99,transition:"width .5s"}}/>
                      )}
                      <div style={{fontSize:24,fontWeight:900,color:s.color,lineHeight:1,fontFamily:"'Space Grotesk',sans-serif"}}>{s.value}{i===0&&(s.total??0)>0?<span style={{fontSize:14,color:"var(--text3)",fontWeight:500}}>/{s.total}</span>:""}</div>
                      <div style={{fontSize:10,color:"var(--text3)",marginTop:5,fontWeight:600}}>{s.label}</div>
                    </div>
                  ))}
                </div>

                {/* 서브탭 */}
                <div style={{display:"flex",gap:4,marginBottom:16,background:"var(--card)",border:"1px solid var(--border)",borderRadius:12,padding:4}}>
                  {([{k:"guide",l:"📖 사용 방법"},{k:"send",l:"🚀 DM 발송"},{k:"history",l:"📨 발송 이력"}] as const).map(t=>(
                    <button key={t.k} onClick={()=>{setDmSubTab(t.k);if(t.k==="history")getInstaDmHistory(user.id).then(setDmHistory);}}
                      style={{flex:1,padding:"9px",borderRadius:9,border:"none",cursor:"pointer",fontSize:12,fontWeight:700,fontFamily:"inherit",
                        background:dmSubTab===t.k?"linear-gradient(135deg,rgba(255,107,157,.15),rgba(199,125,255,.15))":"transparent",
                        color:dmSubTab===t.k?"#FF6B9D":"var(--text2)",
                        borderBottom:dmSubTab===t.k?"2px solid #FF6B9D":"2px solid transparent",transition:"all .15s"}}>
                      {t.l}
                    </button>
                  ))}
                </div>

                {/* 사용 방법 */}
                {dmSubTab==="guide"&&(
                  <div style={{display:"flex",flexDirection:"column",gap:12}}>
                    <div style={{padding:"20px",borderRadius:16,background:"linear-gradient(135deg,rgba(255,107,157,.08),rgba(199,125,255,.08))",border:"1px solid rgba(255,107,157,.2)"}}>
                      <div style={{fontSize:14,fontWeight:900,color:"#FF6B9D",marginBottom:14,display:"flex",alignItems:"center",gap:8}}>
                        📱 인스타 DM 서비스란?
                      </div>
                      <div style={{fontSize:13,color:"var(--text2)",lineHeight:1.8,marginBottom:16}}>
                        키워드와 팔로워 수를 기반으로 인스타그램 계정을 자동 수집하고, 체험단·협찬 모집 DM을 발송하는 서비스예요. 실제 발송은 로컬 PC의 봇 프로그램이 처리해요.
                      </div>
                      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(200px,1fr))",gap:10}}>
                        {[
                          {step:"01",ico:"🎯",title:"타겟 설정",desc:"발송할 인스타 계정 목록을 직접 입력하거나 키워드로 크롤링해요"},
                          {step:"02",ico:"✍️",title:"문구 작성",desc:"AI로 체험단 DM 문구를 자동 생성하거나 직접 입력해요"},
                          {step:"03",ico:"✨",title:"봇 실행",desc:"로컬 PC에서 봇 프로그램을 실행하면 자동으로 발송돼요"},
                          {step:"04",ico:"📊",title:"결과 확인",desc:"발송 이력 탭에서 성공/실패 현황을 확인해요"},
                        ].map((s,i)=>(
                          <div key={i} style={{padding:"14px",borderRadius:12,background:"rgba(255,255,255,.04)",border:"1px solid rgba(255,255,255,.08)"}}>
                            <div style={{fontSize:10,fontWeight:800,color:"rgba(255,107,157,.6)",marginBottom:6,letterSpacing:".1em"}}>STEP {s.step}</div>
                            <div style={{fontSize:13,fontWeight:700,color:"var(--text)",marginBottom:5}}>{s.ico} {s.title}</div>
                            <div style={{fontSize:11,color:"var(--text3)",lineHeight:1.6}}>{s.desc}</div>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
                      <div style={{padding:"16px",borderRadius:14,background:"var(--card)",border:"1px solid var(--border)"}}>
                        <div style={{fontSize:12,fontWeight:800,color:"var(--success)",marginBottom:10}}>✅ 안전한 사용법</div>
                        <div style={{display:"flex",flexDirection:"column",gap:6}}>
                          {["하루 {limit}개 이하 발송 유지","자연스러운 개인화 문구 사용","첫 메시지에 링크 미포함","2~5분 랜덤 간격 발송 (자동)","응답받은 계정 위주 관리"].map((t,i)=>(
                            <div key={i} style={{fontSize:12,color:"var(--text2)",display:"flex",gap:6,alignItems:"flex-start"}}>
                              <span style={{color:"var(--success)",flexShrink:0}}>✓</span>
                              {t.replace("{limit}",String(INSTA_DM_DAILY_LIMIT[user.plan]??5))}
                            </div>
                          ))}
                        </div>
                      </div>
                      <div style={{padding:"16px",borderRadius:14,background:"rgba(248,81,73,.04)",border:"1px solid rgba(248,81,73,.2)"}}>
                        <div style={{fontSize:12,fontWeight:800,color:"var(--danger)",marginBottom:10}}>⚠️ 주의사항</div>
                        <div style={{display:"flex",flexDirection:"column",gap:6}}>
                          {["동일 문구 반복 대량 발송 금지","신고 누적 시 계정 제한 가능","로컬 PC에서만 실행 권장","VPN 사용 비권장","신규 계정은 20~30개 이하 권장"].map((t,i)=>(
                            <div key={i} style={{fontSize:12,color:"var(--text2)",display:"flex",gap:6,alignItems:"flex-start"}}>
                              <span style={{color:"var(--danger)",flexShrink:0}}>!</span>{t}
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>

                    <div style={{padding:"14px 18px",borderRadius:12,background:"rgba(88,166,255,.06)",border:"1px solid rgba(88,166,255,.2)",display:"flex",alignItems:"center",gap:12}}>
                      <span style={{fontSize:24}}>💎</span>
                      <div>
                        <div style={{fontSize:13,fontWeight:800,color:"var(--info)",marginBottom:3}}>내 플랜 한도: {INSTA_DM_DAILY_LIMIT[user.plan]??0}개/일</div>
                        <div style={{fontSize:11,color:"var(--text3)"}}>한도 증가는 관리자에게 문의하세요. PRO 플랜은 하루 60개까지 발송 가능해요.</div>
                      </div>
                    </div>

                    <button onClick={()=>setDmSubTab("send")}
                      style={{padding:"14px",borderRadius:12,border:"none",background:"linear-gradient(135deg,#f0417a,#ff6fa1)",color:"#fff",cursor:"pointer",fontSize:14,fontWeight:800,fontFamily:"inherit",display:"flex",alignItems:"center",justifyContent:"center",gap:8,boxShadow:"0 6px 20px rgba(255,107,157,.3)"}}>
                      🚀 DM 발송 시작하기 →
                    </button>
                  </div>
                )}

                {/* DM 발송 */}
                {dmSubTab==="send"&&(
                  <div style={{display:"flex",flexDirection:"column",gap:14}}>

                    {/* 1) 계정 연결 */}
                    <div className="card">
                      <div className="card-title" style={{color:"#FF6B9D"}}>🔗 인스타 계정 연결 {dmSessionOk&&<span style={{fontSize:11,color:"var(--success)",fontWeight:700,marginLeft:6}}>● 연결됨</span>}</div>
                      <div style={{fontSize:11,color:"var(--text3)",marginBottom:10}}>발송·크롤링은 로컬 봇(:3335)에서 실행돼요. 연결 시 창이 뜨면 2단계 인증/캡차는 직접 통과시켜 주세요.</div>
                      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr auto",gap:8,alignItems:"end"}}>
                        <div><label className="inp-label">인스타 아이디</label><input className="inp" placeholder="@내계정" value={dmAccount} onChange={e=>setDmAccount(e.target.value)} onBlur={()=>checkDmSession(dmAccount.trim().replace(/^@/,""))}/></div>
                        <div><label className="inp-label">비밀번호</label><div style={{position:"relative"}}><input className="inp" type={showDmIgPw?"text":"password"} placeholder="비밀번호" value={dmIgPw} onChange={e=>setDmIgPw(e.target.value)} style={{paddingRight:40}}/><button type="button" onClick={()=>setShowDmIgPw(v=>!v)} aria-label="비밀번호 보기" style={{position:"absolute",right:10,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",cursor:"pointer",fontSize:18,color:"var(--text3)"}}>{showDmIgPw?"🙈":"👁️"}</button></div></div>
                        <button onClick={connectIg} disabled={dmConnecting} style={{padding:"11px 18px",borderRadius:10,border:"none",background:dmConnecting?"var(--border)":"linear-gradient(135deg,#f0417a,#ff6fa1)",color:"#fff",cursor:dmConnecting?"default":"pointer",fontSize:13,fontWeight:800,fontFamily:"inherit",whiteSpace:"nowrap"}}>{dmConnecting?"연결 중...":dmSessionOk?"재연결":"계정 연결"}</button>
                      </div>
                    </div>

                    {/* 2) 키워드로 타겟 크롤링 */}
                    <div className="card">
                      <div className="card-title" style={{color:"#FF6B9D"}}>🔍 키워드로 타겟 수집 <span style={{fontSize:11,color:"var(--text3)",fontWeight:500}}>(팔로워 수 필터)</span></div>
                      <div style={{display:"grid",gridTemplateColumns:"1fr",gap:8,marginBottom:8}}>
                        <div><label className="inp-label">검색 키워드</label><input className="inp" placeholder="예: 뷰티, 다이어트, 캠핑" value={dmCrawlKw} onChange={e=>setDmCrawlKw(e.target.value)}/></div>
                      </div>
                      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:12}}>
                        <div><label className="inp-label">최소 팔로워</label><input className="inp" type="number" inputMode="numeric" placeholder="1000" value={dmMinFollow} onChange={e=>setDmMinFollow(e.target.value)}/></div>
                        <div><label className="inp-label">최대 팔로워</label><input className="inp" type="number" inputMode="numeric" placeholder="50000" value={dmMaxFollow} onChange={e=>setDmMaxFollow(e.target.value)}/></div>
                        <div><label className="inp-label">수집 개수</label><input className="inp" type="number" inputMode="numeric" placeholder="30" value={dmCrawlLimit} onChange={e=>setDmCrawlLimit(e.target.value)}/></div>
                      </div>
                      <button onClick={crawlIg} disabled={dmRunning} style={{padding:"11px 20px",borderRadius:10,border:"none",background:dmRunning?"var(--border)":"linear-gradient(135deg,#f0417a,#ff6fa1)",color:"#fff",cursor:dmRunning?"default":"pointer",fontSize:13,fontWeight:800,fontFamily:"inherit"}}>{dmRunning?"수집 중...":"🔍 키워드 수집 시작"}</button>
                    </div>

                    {/* 타겟 추가 */}
                    <div className="card">
                      <div className="card-title" style={{color:"#FF6B9D"}}>🎯 발송 대상 추가</div>
                      <div style={{marginBottom:12}}>
                        <label className="inp-label">인스타 계정 <span style={{color:"var(--text3)",fontSize:11}}>(쉼표 또는 줄바꿈으로 여러 개)</span></label>
                        <textarea className="inp" rows={3} placeholder={"@계정명1\n@계정명2\n계정명3"} value={dmTargetInput} onChange={e=>setDmTargetInput(e.target.value)} style={{resize:"vertical",fontFamily:"inherit"}}/>
                      </div>
                      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:12}}>
                        <div>
                          <label className="inp-label">키워드 메모</label>
                          <input className="inp" placeholder="예: 뷰티 체험단" value={dmKeyword} onChange={e=>setDmKeyword(e.target.value)}/>
                        </div>
                        <div>
                          <label className="inp-label">발송 인스타 계정</label>
                          <input className="inp" placeholder="@내계정명" value={dmAccount} onChange={e=>setDmAccount(e.target.value)}/>
                        </div>
                      </div>
                      <button onClick={async()=>{
                        const existing=new Set(dmTargets.map(target=>target.username.toLowerCase()));
                        const parsed=dmTargetInput.split(/[,\n]/).map(s=>s.trim().replace(/^@/,"")).filter(Boolean);
                        const list=[...new Map(parsed.map(username=>[username.toLowerCase(),username])).values()].filter(username=>!existing.has(username.toLowerCase()));
                        const skipped=parsed.length-list.length;
                        if(!list.length){showToast("이미 등록된 대상이거나 올바른 계정명이 없어요","error");return;}
                        for(const u of list){
                          await addInstaDmTarget({user_id:user.id,username:u,followers:0,bio:"",keywords:dmKeyword,status:"pending",instagram_account:dmAccount});
                        }
                        setDmTargetInput("");
                        getInstaDmTargets(user.id).then(setDmTargets);
                        showToast(skipped?`대상 ${list.length}명 추가 · 중복 ${skipped}명 제외`:`대상 ${list.length}명을 추가했어요`);
                      }} style={{padding:"11px 20px",borderRadius:10,border:"none",background:"linear-gradient(135deg,#f0417a,#ff6fa1)",color:"#fff",cursor:"pointer",fontSize:13,fontWeight:800,fontFamily:"inherit",display:"inline-flex",alignItems:"center",gap:8,boxShadow:"0 4px 16px rgba(255,107,157,.25)"}}>
                        ➕ 타겟 추가
                      </button>
                    </div>

                    {/* DM 문구 */}
                    <div className="card">
                      <div className="card-title">✍️ DM 문구</div>
                      <div style={{display:"flex",gap:7,flexWrap:"wrap",margin:"10px 0 12px"}}>
                        {DM_TEMPLATES.map(template=><button key={template.label} type="button" onClick={()=>setDmMessage(template.message)} style={{padding:"7px 10px",borderRadius:99,border:"1px solid rgba(255,107,157,.35)",background:"rgba(255,107,157,.07)",color:"#FF6B9D",fontSize:11,fontWeight:800,cursor:"pointer",fontFamily:"inherit"}}>{template.label}</button>)}
                      </div>
                      <div style={{marginBottom:10}}>
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
                          <label className="inp-label" style={{margin:0}}>메시지 내용</label>
                          <span style={{fontSize:11,color:dmMessage.length>900?"var(--danger)":"var(--text3)",fontWeight:600}}>{dmMessage.length}/1000</span>
                        </div>
                        <textarea className="inp" rows={6} placeholder={"안녕하세요! 저는 [브랜드명] 담당자예요 😊\n\n○○님의 콘텐츠가 너무 좋아서 연락드렸어요.\n\n저희 제품 체험 기회를 드리고 싶어요!\n무료로 제품 보내드리고 솔직한 리뷰만 부탁드려요 🙏\n\n관심 있으시면 짧게 답장 주세요!"}
                          value={dmMessage} onChange={e=>{if(e.target.value.length<=1000)setDmMessage(e.target.value);}}
                          style={{resize:"vertical",fontFamily:"inherit"}}/>
                      </div>
                      <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                        <button onClick={async()=>{
                          const key=localStorage.getItem("publy_gemini_key")||localStorage.getItem("publy_adm_gemini_key")||"";
                          if(!key){alert("설정 탭에서 Gemini API 키를 먼저 입력해주세요");return;}
                          const r=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${key}`,
                            {method:"POST",headers:{"Content-Type":"application/json"},
                             body:JSON.stringify({contents:[{parts:[{text:`인스타그램 체험단 모집 DM을 자연스럽게 작성해줘. 키워드: "${dmKeyword||"뷰티/식품 체험단"}". 조건: 1000자 이내, 링크 미포함, 친근한 말투, 브랜드명은 [브랜드명]으로 표시, 담당자명은 [담당자명]. DM 내용만 출력.`}]}],generationConfig:{maxOutputTokens:500}})});
                          const d=await r.json();
                          const text=d.candidates?.[0]?.content?.parts?.[0]?.text||"";
                          if(text)setDmMessage(text.slice(0,1000));
                        }} style={{padding:"10px 16px",borderRadius:9,border:"none",background:"linear-gradient(135deg,#4285F4,#0F9D58)",color:"#fff",cursor:"pointer",fontSize:12,fontWeight:800,fontFamily:"inherit",display:"inline-flex",alignItems:"center",gap:6}}>
                          ✨ AI 문구 생성
                        </button>
                        <button onClick={()=>setDmMessage("")}
                          style={{padding:"10px 14px",borderRadius:9,border:"1px solid var(--border)",background:"transparent",color:"var(--text2)",cursor:"pointer",fontSize:12,fontWeight:700,fontFamily:"inherit"}}>
                          초기화
                        </button>
                      </div>
                    </div>

                    {/* 타겟 목록 */}
                    {dmTargets.length>0&&(
                      <div className="card" style={{padding:0,overflow:"hidden"}}>
                        <div style={{padding:"12px 16px",borderBottom:"1px solid var(--border)",display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:8}}>
                          <div style={{fontWeight:800,fontSize:13}}>🎯 타겟 목록</div>
                          <div style={{display:"flex",gap:6}}>
                            {(["all","pending","sent","fail"] as const).map(f=>(
                              <button key={f} onClick={()=>setDmFilter(f)}
                                style={{padding:"5px 10px",borderRadius:7,border:`1.5px solid ${dmFilter===f?"#FF6B9D":"var(--border)"}`,background:dmFilter===f?"rgba(255,107,157,.1)":"transparent",color:dmFilter===f?"#FF6B9D":"var(--text2)",cursor:"pointer",fontSize:11,fontWeight:700,fontFamily:"inherit"}}>
                                {f==="all"?"전체":f==="pending"?"⏳대기":f==="sent"?"✅발송":"❌실패"}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div style={{maxHeight:320,overflowY:"auto"}}>
                          {dmTargets.filter(t=>dmFilter==="all"||t.status===dmFilter).map(t=>(
                            <div key={t.id} style={{padding:"12px 16px",borderBottom:"1px solid var(--border)",display:"flex",alignItems:"center",gap:10}}
                              onMouseEnter={e=>(e.currentTarget.style.background="var(--card-hover)")}
                              onMouseLeave={e=>(e.currentTarget.style.background="")}>
                              <div style={{width:36,height:36,borderRadius:99,background:"linear-gradient(135deg,#FF6B9D22,#C77DFF22)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,flexShrink:0}}>👤</div>
                              <div style={{flex:1,minWidth:0}}>
                                <a href={`https://instagram.com/${t.username}`} target="_blank" rel="noreferrer"
                                  style={{color:"#FF6B9D",fontWeight:700,textDecoration:"none",fontSize:13}}>@{t.username}</a>
                                <div style={{fontSize:11,color:"var(--text3)",marginTop:2}}>{t.keywords||"키워드 없음"}</div>
                              </div>
                              <span style={{fontSize:11,padding:"3px 9px",borderRadius:99,fontWeight:700,flexShrink:0,
                                background:t.status==="sent"?"rgba(0,214,143,.12)":t.status==="fail"?"rgba(255,83,99,.12)":t.status==="pending"?"rgba(88,166,255,.12)":"rgba(120,120,120,.12)",
                                color:t.status==="sent"?"var(--success)":t.status==="fail"?"var(--danger)":t.status==="pending"?"var(--info)":"var(--text3)"}}>
                                {t.status==="sent"?"✅":t.status==="fail"?"❌":t.status==="pending"?"⏳":"⏭️"} {t.status==="sent"?"발송완료":t.status==="fail"?"실패":"대기"}
                              </span>
                              <button onClick={async()=>{await deleteInstaDmTarget(t.id);setDmTargets(p=>p.filter(x=>x.id!==t.id));}}
                                style={{padding:"4px 8px",borderRadius:6,border:"1px solid rgba(248,81,73,.3)",background:"rgba(248,81,73,.06)",color:"var(--danger)",cursor:"pointer",fontSize:11,fontWeight:700,fontFamily:"inherit",flexShrink:0}}>삭제</button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* 발송 실행 + 실시간 로그 (send 탭) */}
                {dmSubTab==="send"&&(
                  <div className="card" style={{marginTop:14}}>
                    <div className="card-title" style={{color:"#FF6B9D"}}>🚀 DM 발송 실행</div>
                    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(120px,1fr))",gap:8,margin:"12px 0"}}>
                      {[
                        ["발송 대기",`${dmPendingCount}명`],["이번 발송",`${dmSendableCount}명`],["오늘 남은 한도",`${dmRemaining}명`],["예상 시간",dmEstimatedMinutes?`약 ${dmEstimatedMinutes}분`:"—"],
                      ].map(([label,value])=><div key={label} style={{padding:"11px",borderRadius:11,background:"linear-gradient(135deg,rgba(255,107,157,.08),rgba(199,125,255,.06))",border:"1px solid rgba(255,107,157,.2)"}}><div style={{fontSize:10,color:"var(--text3)",fontWeight:700}}>{label}</div><div style={{fontSize:16,color:"var(--text)",fontWeight:900,marginTop:3}}>{value}</div></div>)}
                    </div>
                    <div style={{fontSize:11,color:"var(--text3)",marginBottom:10}}>중복 대상은 추가할 때 자동 제외하며, 오늘 남은 안전 한도까지만 발송해요. 발송 간격은 봇이 랜덤(40~90초) 적용합니다.</div>
                    <div style={{display:"flex",gap:8,marginBottom:dmLogs.length?12:0}}>
                      {!dmRunning ? (
                        <button onClick={sendIg} disabled={!dmSendableCount||!dmMessage.trim()||!dmSessionOk} title={!dmSessionOk?"인스타 계정을 먼저 연결해주세요":!dmMessage.trim()?"DM 문구를 먼저 작성해주세요":!dmSendableCount?"발송 가능한 대상이 없어요":undefined} style={{flex:1,padding:"13px",borderRadius:11,border:"none",background:"linear-gradient(135deg,#f0417a,#ff6fa1)",color:"#fff",cursor:dmSendableCount&&dmMessage.trim()&&dmSessionOk?"pointer":"not-allowed",opacity:dmSendableCount&&dmMessage.trim()&&dmSessionOk?1:.45,fontSize:14,fontWeight:800,fontFamily:"inherit"}}>🚀 안전 발송 시작</button>
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
                )}

                {/* 발송 이력 */}
                {dmSubTab==="history"&&(
                  <div className="card" style={{padding:0,overflow:"hidden"}}>
                    <div style={{padding:"14px 16px",borderBottom:"1px solid var(--border)",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                      <div style={{fontWeight:800,fontSize:13}}>📨 내 발송 이력</div>
                      <span style={{fontSize:12,color:"var(--text3)"}}>{dmHistory.length}건</span>
                    </div>
                    {dmHistory.length===0 ? (
                      <div style={{padding:40,textAlign:"center",color:"var(--text3)"}}>
                        <div style={{fontSize:32,marginBottom:8}}>📭</div>
                        아직 발송 이력이 없어요
                      </div>
                    ) : (
                      <div style={{maxHeight:520,overflowY:"auto"}}>
                        {dmHistory.map(h=>(
                          <div key={h.id} style={{padding:"12px 16px",borderBottom:"1px solid var(--border)",display:"flex",gap:12,alignItems:"center"}}
                            onMouseEnter={e=>(e.currentTarget.style.background="var(--card-hover)")}
                            onMouseLeave={e=>(e.currentTarget.style.background="")}>
                            <div style={{width:36,height:36,borderRadius:99,background:"linear-gradient(135deg,#FF6B9D22,#C77DFF22)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:15,flexShrink:0}}>📨</div>
                            <div style={{flex:1,minWidth:0}}>
                              <a href={`https://instagram.com/${h.target_username}`} target="_blank" rel="noreferrer"
                                style={{color:"#FF6B9D",fontWeight:700,textDecoration:"none",fontSize:13}}>@{h.target_username}</a>
                              <div style={{fontSize:11,color:"var(--text3)",marginTop:2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{h.message}</div>
                            </div>
                            <div style={{textAlign:"right",flexShrink:0}}>
                              <span style={{fontSize:11,padding:"3px 9px",borderRadius:99,fontWeight:700,display:"block",marginBottom:4,
                                background:h.status==="sent"?"rgba(0,214,143,.12)":"rgba(255,83,99,.12)",
                                color:h.status==="sent"?"var(--success)":"var(--danger)"}}>
                                {h.status==="sent"?"✅ 발송":"❌ 실패"}
                              </span>
                              <div style={{fontSize:10,color:"var(--text3)"}}>{new Date(h.created_at).toLocaleDateString("ko-KR")}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* ★자동화 탭 keep-alive: 방문한 탭은 언마운트하지 않고 display로만 숨김 → 탭 이동해도 작업·데이터 유지 */}
            {visitedAutoTabs.has("neighbor") && (
              <div className="tab-neighbor" aria-hidden={tab!=="neighbor"} style={{ display: tab==="neighbor" ? "block" : "none", pointerEvents: tab==="neighbor" ? "auto" : "none" }}>
                <NeighborPage theme={theme as "dark"|"light"} userId={user.id} plan={user.plan} singleTab isActive={tab==="neighbor"} initialNeighborUsed={neighborUsed} onBusyChange={setNeighborBusy} />
              </div>
            )}
            {visitedAutoTabs.has("engage") && (
              <div className="tab-engage" aria-hidden={tab!=="engage"} style={{ display: tab==="engage" ? "block" : "none", pointerEvents: tab==="engage" ? "auto" : "none" }}>
                <NeighborPage theme={theme as "dark"|"light"} userId={user.id} plan={user.plan} initialTab="engage" singleTab isActive={tab==="engage"} onEngageUsageChange={setEngageUsed} initialEngageUsed={engageUsed} onBusyChange={setNeighborBusy} />
              </div>
            )}
            {visitedAutoTabs.has("reply") && (
              <div className="tab-reply" aria-hidden={tab!=="reply"} style={{ display: tab==="reply" ? "block" : "none", pointerEvents: tab==="reply" ? "auto" : "none" }}>
                <NeighborPage theme={theme as "dark"|"light"} userId={user.id} plan={user.plan} initialTab="reply" singleTab isActive={tab==="reply"} onBusyChange={setNeighborBusy} />
              </div>
            )}
            {visitedAutoTabs.has("crawl") && crawlEnabled && (
              <div aria-hidden={tab!=="crawl"} style={{ display: tab==="crawl" ? "block" : "none", pointerEvents: tab==="crawl" ? "auto" : "none" }}><CrawlCenter showToast={showToast} theme={theme==="dark"?"dark":"light"} userId={user.id} plan={user.plan} /></div>
            )}
            {visitedAutoTabs.has("inflow") && inflowEnabled && (
              <div aria-hidden={tab!=="inflow"} style={{ display: tab==="inflow" ? "block" : "none", pointerEvents: tab==="inflow" ? "auto" : "none" }}><InflowCenter showToast={showToast} theme={theme==="dark"?"dark":"light"} userId={user.id} plan={user.plan} allowedFeatures={allowedFeatures} licenseSaver={licenseSaver} /></div>
            )}
            {visitedAutoTabs.has("place") && place360Enabled && (
              <div aria-hidden={tab!=="place"} style={{ display: tab==="place" ? "block" : "none", pointerEvents: tab==="place" ? "auto" : "none" }}><Place360 showToast={showToast} theme={theme==="dark"?"dark":"light"} userId={user.id} plan={user.plan} onOpenCrawl={()=>setTab("crawl")} onOpenReview={()=>setTab("place_reply")} /></div>
            )}
            {tab==="place_reply" && place360Enabled && (
              <PlaceReview showToast={showToast} theme={theme==="dark"?"dark":"light"} userId={user.id} plan={user.plan} onOpenPlace={()=>setTab("place")} />
            )}
            {visitedAutoTabs.has("pumasi") && (
              <div className="tab-pumasi" aria-hidden={tab!=="pumasi"} style={{ display: tab==="pumasi" ? "block" : "none", pointerEvents: tab==="pumasi" ? "auto" : "none" }}>
                <NeighborPage theme={theme as "dark"|"light"} userId={user.id} plan={user.plan} initialTab="pumasi" singleTab isActive={tab==="pumasi"} onBusyChange={setNeighborBusy} />
              </div>
            )}
            {visitedAutoTabs.has("blogscore") && (
              <div className="tab-blogscore" aria-hidden={tab!=="blogscore"} style={{ display: tab==="blogscore" ? "block" : "none", pointerEvents: tab==="blogscore" ? "auto" : "none" }}>
                <NeighborPage theme={theme as "dark"|"light"} userId={user.id} plan={user.plan} initialTab="score" singleTab isActive={tab==="blogscore"} onBusyChange={setNeighborBusy} />
              </div>
            )}

            {tab==="settings"&&(
              <div style={{animation:"fadeUp .25s ease both"}}>

                {/* 버그 신고 — 문제 발생 시 로그를 관리자에게 보내면 아이디로 확인·수정 */}
                <div className="card">
                  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:10}}>
                    <div>
                      <div className="card-title" style={{marginBottom:4}}>🐞 버그 신고</div>
                      <div style={{fontSize:12,color:"var(--text3)"}}>문제가 생기면 아래 버튼으로 신고해주세요. 로그가 함께 전송돼 원인을 빠르게 찾아드려요.</div>
                    </div>
                    <div style={{display:"flex",gap:8,flexShrink:0}}>
                      <button onClick={openFullLog} disabled={fullLogLoading||!window.electron?.readBotLog}
                        style={{padding:"9px 15px",borderRadius:10,border:"1px solid var(--border)",background:"var(--bg)",color:"var(--text2)",cursor:"pointer",fontSize:12,fontWeight:700,fontFamily:"inherit"}}>{fullLogLoading?"불러오는 중...":"📋 전체 로그 보기"}</button>
                      <button onClick={()=>(window as any).electron?.openLogFolder?.()}
                        style={{padding:"9px 15px",borderRadius:10,border:"1px solid var(--border)",background:"var(--bg)",color:"var(--text2)",cursor:"pointer",fontSize:12,fontWeight:700,fontFamily:"inherit"}}>📂 로그 폴더 열기</button>
                      <button onClick={submitBugReport} disabled={bugSending}
                        style={{padding:"9px 18px",borderRadius:10,border:"none",background:bugSending?"var(--card2)":"var(--accent)",color:bugSending?"var(--text2)":"#000",cursor:bugSending?"default":"pointer",fontSize:12,fontWeight:800,fontFamily:"inherit"}}>{bugSending?"전송 중...":"🐞 버그 신고하기"}</button>
                    </div>
                  </div>
                  <textarea value={bugMemo} onChange={e=>setBugMemo(e.target.value)} placeholder="어떤 문제가 있었는지 적어주세요 (선택) — 예: 카테고리 누르면 화면이 멈춰요"
                    style={{width:"100%",marginTop:12,minHeight:64,padding:"10px 12px",borderRadius:10,border:"1px solid var(--border)",background:"var(--bg)",color:"var(--text)",fontSize:13,fontFamily:"inherit",resize:"vertical",outline:"none",boxSizing:"border-box"}}/>
                  {bugMsg&&<div style={{marginTop:8,fontSize:12,fontWeight:700,color:bugMsg.startsWith("✅")?"var(--success)":"var(--danger)"}}>{bugMsg}</div>}
                </div>

                <div className="card">
                  <div className="card-title" style={{marginBottom:5}}>🌐 퍼블리와 함께 쓰는 온종일 서비스</div>
                  <div style={{fontSize:11,color:"var(--text3)",marginBottom:13}}>상품 선택부터 체험 리뷰와 판매 수익까지 자연스럽게 이어보세요.</div>
                  <div className="on-service-grid">
                    {(["farm","trial","partner","onai","oncatch","gostop","messenger","studio"] as ServiceInfoKey[]).map(key=>{const s=PUBLY_SERVICE_INFO[key];const feat=key==="farm"||key==="trial"||key==="partner";return <button key={key} className={`on-service-card${feat?" featured":""}`} type="button" onClick={()=>setServiceInfo(key)}>{feat&&<span className="svc-badge">⭐ 대표</span>}<span style={{fontSize:24}}>{s.icon}</span><b>{s.name}</b><small>{s.summary}</small><em>{s.coming?"곳 출시 · 자세히":"기능·혜택 자세히"} →</em></button>})}
                  </div>
                </div>

                {/* 큰 글씨 모드 */}
                <div className="card">
                  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                    <div>
                      <div className="card-title" style={{marginBottom:4}}>🔠 큰 글씨 모드</div>
                      <div style={{fontSize:12,color:"var(--text3)"}}>어르신·시력 불편한 분께 추천 — 전체 글씨 크기 확대</div>
                    </div>
                    <button onClick={()=>{const next=fontMode==="normal"?"large":"normal";setFontMode(next);localStorage.setItem("publy_font_mode",next);}}
                      style={{padding:"8px 20px",borderRadius:99,border:"none",cursor:"pointer",fontSize:13,fontWeight:800,fontFamily:"inherit",transition:"all .2s",
                        background:fontMode==="large"?"var(--accent)":"var(--card2)",
                        color:fontMode==="large"?"#000":"var(--text2)",
                        boxShadow:fontMode==="large"?"0 3px 12px var(--accent-30)":"none"}}>
                      {fontMode==="large"?"✅ 켜짐":"OFF"}
                    </button>
                  </div>
                </div>

                <div className="card">
                  <div className="card-title" style={{marginBottom:14}}>✨ 글쓰기 AI 선택</div>
                  <div className="ai-grid">
                    {WRITE_AI_LIST.map(item=>(
                      <button key={item.id} className={`ai-card ${writeAI===item.id?"sel-ai":""}`} style={{borderColor:writeAI===item.id?item.color:"var(--border)",background:writeAI===item.id?`${item.color}12`:"var(--bg)"}} onClick={()=>{setWriteAI(item.id);localStorage.setItem("publy_write_ai",item.id);}}>
                        <div className="ai-card-top"><div className="ai-logo" style={{background:writeAI===item.id?item.color:`${item.color}20`,color:writeAI===item.id?"#000":item.color}}>{item.logo}</div>{writeAI===item.id?<span className="ai-sel-badge" style={{background:item.color}}>✓ 선택됨</span>:item.free?<span className="ai-free">무료</span>:<span className="ai-paid">유료</span>}</div>
                        <div className="ai-name">{item.label}</div><div className="ai-sub">{item.sub}</div>
                      </button>
                    ))}
                  </div>
                  <div className="card-title" style={{marginBottom:14,marginTop:8}}>🖼️ 이미지 AI 선택</div>
                  <div className="ai-grid">
                    {IMAGE_AI_LIST.map(item=>(
                      <button key={item.id} className={`ai-card ${imageAI===item.id?"sel-ai":""}`} style={{borderColor:imageAI===item.id?item.color:"var(--border)",background:imageAI===item.id?`${item.color}12`:"var(--bg)"}} onClick={()=>{setImageAI(item.id);localStorage.setItem("publy_image_ai",item.id);}}>
                        <div className="ai-card-top"><div className="ai-logo" style={{background:imageAI===item.id?item.color:`${item.color}20`,color:imageAI===item.id?"#000":item.color}}>{item.logo}</div>{imageAI===item.id?<span className="ai-sel-badge" style={{background:item.color}}>✓ 선택됨</span>:<span className="ai-paid">유료</span>}</div>
                        <div className="ai-name">{item.label}</div><div className="ai-sub">{item.sub}</div>
                      </button>
                    ))}
                  </div>
                  <div className="alert-box alert-info" style={{margin:"4px 0 0"}}>💡 OpenAI 키 하나로 GPT-4o(글쓰기) + DALL-E 3(이미지) 모두 사용 가능해요</div>
                </div>
                <div className="card">
                  <div className="card-title" style={{marginBottom:14}}>🔑 API 키 관리</div>
                  <div className="key-section" style={{background:"var(--accent-bg)",borderColor:"var(--accent-border)"}}><div className="key-section-title" style={{color:"var(--accent-text)"}}>📝 글쓰기 API 키</div>{WRITE_AI_LIST.map(k=><KeyInput key={k.id} k={k}/>)}</div>
                  <div className="key-section" style={{background:"rgba(155,125,255,.07)",borderColor:"rgba(155,125,255,.2)"}}><div className="key-section-title" style={{color:"var(--purple)"}}>🖼️ 이미지 API 키</div>{IMAGE_AI_LIST.map(k=><KeyInput key={k.id} k={k}/>)}</div>
                </div>
                <div className="card">
                  <div className="card-title" style={{marginBottom:14}}>👤 내 계정 정보</div>
                  <div className="info-table">
                    {[{k:"이름",v:user.name||"-"},{k:"이메일",v:user.email},{k:"플랜",v:PLAN_LABELS[user.plan]},{k:"잔여 건수",v:`${quota?.remaining_quota??"-"}건`},{k:"만료일",v:quota?new Date(quota.reset_date).toLocaleDateString("ko-KR"):"-"}].map(row=>(
                      <div key={row.k} className="info-row"><span className="info-key">{row.k}</span><span className="info-val">{row.v}</span></div>
                    ))}
                  </div>
                </div>
                <div className="card">
                  <div className="card-title" style={{marginBottom:14}}>🔐 비밀번호 변경</div>
                  <div style={{display:"flex",flexDirection:"column",gap:10}}>
                    <div>
                      <label className="inp-label">현재 비밀번호</label>
                      <div style={{position:"relative"}}><input className="inp" type={showCurrentPw?"text":"password"} placeholder="현재 비밀번호" value={currentPw} onChange={e=>setCurrentPw(e.target.value)} style={{paddingRight:40}}/><button type="button" onClick={()=>setShowCurrentPw(v=>!v)} aria-label="비밀번호 보기" style={{position:"absolute",right:10,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",cursor:"pointer",fontSize:18,color:"var(--text3)"}}>{showCurrentPw?"🙈":"👁️"}</button></div>
                    </div>
                    <div>
                      <label className="inp-label">새 비밀번호 (6자 이상)</label>
                      <div style={{position:"relative"}}><input className="inp" type={showNewPw1?"text":"password"} placeholder="새 비밀번호" value={newPw1} onChange={e=>setNewPw1(e.target.value)} style={{paddingRight:40}}/><button type="button" onClick={()=>setShowNewPw1(v=>!v)} aria-label="비밀번호 보기" style={{position:"absolute",right:10,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",cursor:"pointer",fontSize:18,color:"var(--text3)"}}>{showNewPw1?"🙈":"👁️"}</button></div>
                    </div>
                    <div>
                      <label className="inp-label">새 비밀번호 확인</label>
                      <div style={{position:"relative"}}><input className="inp" type={showNewPw2?"text":"password"} placeholder="새 비밀번호 재입력" value={newPw2} onChange={e=>setNewPw2(e.target.value)} style={{paddingRight:40}}/><button type="button" onClick={()=>setShowNewPw2(v=>!v)} aria-label="비밀번호 보기" style={{position:"absolute",right:10,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",cursor:"pointer",fontSize:18,color:"var(--text3)"}}>{showNewPw2?"🙈":"👁️"}</button></div>
                    </div>
                    <button className="btn btn-primary" onClick={handleChangePw} disabled={pwChanging} style={{alignSelf:"flex-start"}}>
                      {pwChanging?<><span className="spinner"/>변경 중...</>:"🔐 비밀번호 변경"}
                    </button>
                    {pwMsg&&<div className={`alert-box ${pwMsg.includes("✅")?"alert-success":"alert-danger"}`} style={{margin:0}}>{pwMsg}</div>}
                  </div>
                </div>

                {/* 네이버 API 키 */}
                <div className="card">
                  <div className="card-title" style={{marginBottom:4}}>🟢 네이버 검색광고 API <span style={{fontSize:10,fontWeight:400,color:"var(--text3)"}}>(선택 — 없으면 관리자 공용키 사용)</span></div>
                  <div style={{fontSize:11,color:"var(--text3)",marginBottom:8}}>개인 키 입력 시 일일 한도 없이 무제한 사용 가능해요</div>
                  <div style={{display:"flex",gap:8,marginBottom:12,flexWrap:"wrap"}}>
                    <a href="https://searchad.naver.com" target="_blank" rel="noreferrer"
                      style={{display:"inline-flex",alignItems:"center",gap:5,padding:"6px 12px",borderRadius:8,border:"1px solid rgba(3,199,90,.4)",background:"rgba(3,199,90,.08)",color:"var(--naver)",fontSize:12,fontWeight:700,textDecoration:"none",whiteSpace:"nowrap"}}>
                      🔗 검색광고 API 발급 →
                    </a>
                    <a href="https://developers.naver.com/apps/#/list" target="_blank" rel="noreferrer"
                      style={{display:"inline-flex",alignItems:"center",gap:5,padding:"6px 12px",borderRadius:8,border:"1px solid rgba(3,199,90,.3)",background:"transparent",color:"var(--naver)",fontSize:12,fontWeight:700,textDecoration:"none",whiteSpace:"nowrap"}}>
                      🔗 DataLab API 발급 →
                    </a>
                  </div>
                  <div style={{display:"flex",flexDirection:"column",gap:8}}>
                    {[
                      {label:"Customer ID",key:"naver_customer_id",ph:"123456789"},
                      {label:"Access License",key:"naver_access_license",ph:"xxxx-xxxx-xxxx"},
                      {label:"Secret Key",key:"naver_secret_key",ph:"secret"},
                    ].map(f=>(
                      <div key={f.key}>
                        <label className="inp-label">{f.label}</label>
                        <input className="inp" placeholder={f.ph} value={(naverKeys as any)[f.key]||""} onChange={e=>setNaverKeys(p=>({...p,[f.key]:e.target.value}))}/>
                      </div>
                    ))}
                    <div className="card-title" style={{marginBottom:4,marginTop:8}}>📊 네이버 DataLab API</div>
                    <div style={{fontSize:11,color:"var(--text3)",marginBottom:4}}>검색 트렌드 분석에 사용</div>
                    {[
                      {label:"Client ID",key:"naver_datalab_client_id",ph:"Client ID"},
                      {label:"Client Secret",key:"naver_datalab_client_secret",ph:"Client Secret"},
                    ].map(f=>(
                      <div key={f.key}>
                        <label className="inp-label">{f.label}</label>
                        <input className="inp" placeholder={f.ph} value={(naverKeys as any)[f.key]||""} onChange={e=>setNaverKeys(p=>({...p,[f.key]:e.target.value}))}/>
                      </div>
                    ))}
                    <button className="btn btn-primary" style={{alignSelf:"flex-start"}} disabled={naverKeysSaving} onClick={async()=>{
                      setNaverKeysSaving(true); setNaverKeysMsg("");
                      try{ await saveNaverApiKeys(user.id, naverKeys); setNaverKeysMsg("✅ 저장 완료!"); showToast("🟢 네이버 API 키 저장됐어요!"); }
                      catch(e:any){ setNaverKeysMsg("❌ "+e.message); }
                      finally{ setNaverKeysSaving(false); setTimeout(()=>setNaverKeysMsg(""),3000); }
                    }}>
                      {naverKeysSaving?<><span className="spinner"/>저장 중...</>:"💾 키 저장"}
                    </button>
                    {naverKeysMsg&&<div className={`alert-box ${naverKeysMsg.includes("✅")?"alert-success":"alert-danger"}`} style={{margin:0}}>{naverKeysMsg}</div>}
                  </div>
                </div>
              </div>
            )}
          </div>{/* main */}
        </div>{/* layout */}

        {/* ── 카카오 결제문의 플로팅 버튼 ── */}
        <a href="https://open.kakao.com/o/s0lQ66wi" target="_blank" rel="noopener noreferrer"
          className="kakao-float"
          style={{position:"fixed",bottom:90,right:24,zIndex:500,display:"flex",alignItems:"center",gap:8,padding:"12px 18px",borderRadius:99,background:"#FEE500",color:"#3A1D1D",fontWeight:900,fontSize:13,fontFamily:"'Noto Sans KR',sans-serif",textDecoration:"none",boxShadow:"0 4px 20px rgba(254,229,0,.5)",animation:"float 2.5s ease-in-out infinite",whiteSpace:"nowrap",border:"none",cursor:"pointer"}}>
          <span style={{fontSize:18}}>💬</span><span className="kakao-float-text"> 결제 문의</span>
        </a>

        <div className="mob-bar">
          {/* 모바일도 PC 사이드바와 동일한 전체 탭 노출(회원=관리자 동일 원칙). 크롤링·플레이스 365·캘린더·인스타DM·계정관리가 모바일에서 빠져 있던 것 복구.
              잠금(crawl/place)·곧 출시(insta_dm) 게이팅은 데스크탑 사이드바와 동일하게 처리 */}
          {MAIN_TABS.map(t=>{
            const lbl:Record<string,string>={control:"홈",keyword:"키워드",write:"글쓰기",image:"이미지",photo:"사진글쓰기",publish:"발행",calendar:"캘린더",manage:"발행관리",blogscore:"지수",crawl:"크롤링",inflow:"트래픽유입",place:"플레이스",neighbor:"서이추",engage:"공감댓글",reply:"답방",pumasi:"품앗이",insta_dm:"인스타DM",accounts:"계정관리",settings:"설정"};
            const locked = (t.k==="crawl"&&!crawlEnabled)||(t.k==="place"&&!place360Enabled)||(t.k==="inflow"&&!inflowEnabled);
            const onClick=()=>{
              if(t.k==="insta_dm"){showToast("📱 인스타 DM은 곧 출시됩니다!","info");return;}
              if(locked){setShowCrawlLock(true);return;}
              setTab(t.k as MainTab);
            };
            return (<button key={t.k} className={`mob-btn ${tab===t.k&&!locked?"active":""}`} onClick={onClick}><span className="mob-btn-ico">{locked?"🔒":t.i}</span><span className="mob-btn-lbl">{lbl[t.k]||t.l}</span></button>);
          })}
        </div>
      </div>

      {showDaebaekseo&&<Daebaekseo theme={theme==="dark"?"dark":"light"} onClose={()=>setShowDaebaekseo(false)} />}
      {serviceInfo&&(()=>{const s=PUBLY_SERVICE_INFO[serviceInfo];return <div className={`service-info-overlay ${theme==="dark"?"service-info-dark":"service-info-light"}`} onMouseDown={e=>{if(e.target===e.currentTarget)setServiceInfo(null)}}><section className="service-info-dialog" role="dialog" aria-modal="true" aria-label={`${s.name} 알아보기`}><button className="service-info-close" type="button" onClick={()=>setServiceInfo(null)} aria-label="닫기">×</button><div className="service-info-kicker">MORE WITH ONJONGIL</div><h2>{s.name} 알아보기</h2><p className="service-info-hook">{s.hook}</p><div className="service-info-benefits">{s.benefits.map(([title,desc])=><div className="service-info-benefit" key={title}><b>✓ {title}</b><span>{desc}</span></div>)}</div><div className="service-info-flow">{s.flow}</div><div className="service-info-footer">{s.coming?<><button className="service-info-cta" disabled>신청하기</button><span className="service-info-coming">곧 출시됩니다</span></>:<a className="service-info-cta" href={s.url} target="_blank" rel="noopener noreferrer">{s.cta} →</a>}</div></section></div>})()}

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
                {ico:"📅",title:"무료 사용 한도",desc:`FREE ${NAVER_DAILY_LIMIT.free}회/일 · PRO ${NAVER_DAILY_LIMIT.pro}회/일\n설정탭에서 내 API 키 입력하면 한도 없이 무제한!`},
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

      {/* 공지 팝업 */}
      {noticePopup&&(
        <div style={{position:"fixed",inset:0,zIndex:9100,background:"rgba(0,0,0,.85)",display:"flex",alignItems:"center",justifyContent:"center",padding:20}}
          onClick={()=>{localStorage.setItem("publy_dismissed_"+noticePopup.key,"1");setNoticePopup(null);}}>
          <div style={{width:"100%",maxWidth:440,borderRadius:20,background:"var(--card)",border:"1px solid var(--border)",overflow:"hidden",animation:"fadeUp .25s ease",boxShadow:"0 24px 60px rgba(0,0,0,.6)"}}
            onClick={e=>e.stopPropagation()}>
            <div style={{background:"linear-gradient(135deg,var(--accent),#ff8a4c)",padding:"18px 22px",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
              <div style={{fontSize:16,fontWeight:900,color:"#000"}}>📢 {noticePopup.title}</div>
              <button onClick={()=>{localStorage.setItem("publy_dismissed_"+noticePopup.key,"1");setNoticePopup(null);}}
                style={{background:"rgba(0,0,0,.2)",border:"none",color:"#000",width:30,height:30,borderRadius:8,cursor:"pointer",fontSize:15,fontFamily:"inherit"}}>✕</button>
            </div>
            <div style={{padding:"18px 22px",fontSize:14,color:"var(--text)",lineHeight:1.8,whiteSpace:"pre-line"}}>{noticePopup.body}</div>
            <div style={{padding:"0 22px 20px"}}>
              <button onClick={()=>{localStorage.setItem("publy_dismissed_"+noticePopup.key,"1");setNoticePopup(null);}}
                style={{width:"100%",padding:"12px",borderRadius:12,border:"none",background:"var(--accent)",color:"#000",fontSize:14,fontWeight:800,cursor:"pointer",fontFamily:"inherit"}}>
                확인했어요 👍
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 버그 신고 처리완료 알림 — 화면 어디에 있든 뜸 */}
      {liveLogActive&&(
        <div style={{position:"fixed",left:0,right:0,bottom:0,zIndex:500,height:liveLogCollapsed?42:180,background:theme==="dark"?"#0d1117":"#f6f8fa",borderTop:`1px solid ${theme==="dark"?"#30363d":"#d0d7de"}`,boxShadow:"0 -6px 20px rgba(0,0,0,.16)",display:"flex",flexDirection:"column",transition:"height .18s ease"}}>
          <div style={{height:42,flexShrink:0,padding:"0 14px",display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,color:theme==="dark"?"#e6edf3":"#24292f",borderBottom:liveLogCollapsed?"none":`1px solid ${theme==="dark"?"#30363d":"#d0d7de"}`}}>
            <span style={{fontSize:12,fontWeight:800,display:"flex",alignItems:"center",gap:8,minWidth:0}}>
              <span style={{whiteSpace:"nowrap"}}>📋 실시간 로그 · {tab==="publish"?"발행 중":"이미지 생성 중"}</span>
              {(()=>{const errN=liveLog?liveLog.split(/\r?\n/).filter(l=>/❌|실패|오류|error/i.test(l)).length:0;return errN>0?<span style={{fontSize:11,fontWeight:800,color:"#fff",background:theme==="dark"?"#cf222e":"#e5484d",padding:"2px 8px",borderRadius:20,whiteSpace:"nowrap"}}>⚠️ 오류 {errN}</span>:null;})()}
            </span>
            <span style={{display:"flex",alignItems:"center",gap:6,flexShrink:0}}>
              <button onClick={async()=>{try{await navigator.clipboard.writeText(liveLog||"");showToast("📋 로그를 복사했어요. 문제가 있으면 여기에 붙여넣어 보내주세요.","success");}catch{showToast("복사 실패 — '전체 로그 보기'에서 길게 눌러 복사해주세요.","error");}}} style={{border:`1px solid ${theme==="dark"?"#30363d":"#d0d7de"}`,background:"transparent",color:"inherit",cursor:"pointer",fontSize:11.5,fontWeight:700,fontFamily:"inherit",padding:"5px 10px",borderRadius:8}}>📋 복사</button>
              <button onClick={()=>setLiveLogCollapsed(value=>!value)} style={{border:0,background:"transparent",color:"inherit",cursor:"pointer",fontSize:12,fontWeight:700,fontFamily:"inherit"}}>{liveLogCollapsed?"펼치기 ▲":"접기 ▼"}</button>
            </span>
          </div>
          {!liveLogCollapsed&&<div tabIndex={0} onKeyDown={event=>{if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==="a"){event.preventDefault();const selection=window.getSelection();const range=document.createRange();range.selectNodeContents(event.currentTarget);selection?.removeAllRanges();selection?.addRange(range);}}} style={{flex:1,overflowY:"auto",padding:"9px 14px",fontFamily:"ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",fontSize:11.5,lineHeight:1.55,whiteSpace:"pre-wrap",wordBreak:"break-word",userSelect:"text",outline:"none",color:theme==="dark"?"#b1bac4":"#57606a"}}>
            {liveLog?liveLog.split(/\r?\n/).map((line,index)=>{
              const success=/✅|완료|성공/i.test(line), failure=/❌|실패|오류|error/i.test(line);
              return <div key={index} style={{color:success?(theme==="dark"?"#3fb950":"#1a7f37"):failure?(theme==="dark"?"#f85149":"#cf222e"):undefined,minHeight:"1.55em"}}>{line}</div>;
            }):<div style={{color:theme==="dark"?"#8b949e":"#6e7781"}}>로그를 기다리는 중...</div>}
            <div ref={liveLogEndRef}/>
          </div>}
        </div>
      )}

      {fullLog!==null&&(
        <div style={{position:"fixed",inset:0,zIndex:10060,background:"rgba(0,0,0,.72)",display:"flex",alignItems:"center",justifyContent:"center",padding:20}} onClick={()=>setFullLog(null)}>
          <div style={{width:"min(900px,100%)",height:"min(680px,85vh)",background:theme==="dark"?"#0d1117":"#f6f8fa",border:`1px solid ${theme==="dark"?"#30363d":"#d0d7de"}`,borderRadius:16,overflow:"hidden",display:"flex",flexDirection:"column",boxShadow:"0 24px 70px rgba(0,0,0,.5)"}} onClick={event=>event.stopPropagation()}>
            <div style={{padding:"13px 16px",display:"flex",alignItems:"center",justifyContent:"space-between",borderBottom:`1px solid ${theme==="dark"?"#30363d":"#d0d7de"}`,color:theme==="dark"?"#e6edf3":"#24292f"}}><strong style={{fontSize:14}}>📋 전체 로그</strong><span style={{display:"flex",gap:8,alignItems:"center"}}><button onClick={async()=>{try{await navigator.clipboard.writeText(fullLog||"");showToast("📋 전체 로그를 복사했어요. 문제 신고 시 붙여넣어 주세요.","success");}catch{showToast("복사 실패 — 로그를 길게 눌러 직접 복사해주세요.","error");}}} style={{border:`1px solid ${theme==="dark"?"#30363d":"#d0d7de"}`,background:"transparent",color:"inherit",cursor:"pointer",fontSize:12,fontWeight:700,fontFamily:"inherit",padding:"6px 12px",borderRadius:8}}>📋 복사</button><button onClick={()=>setFullLog(null)} style={{border:0,background:"transparent",color:"inherit",cursor:"pointer",fontSize:18}}>✕</button></span></div>
            <pre tabIndex={0} onKeyDown={event=>{if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==="a"){event.preventDefault();const selection=window.getSelection();const range=document.createRange();range.selectNodeContents(event.currentTarget);selection?.removeAllRanges();selection?.addRange(range);}}} style={{margin:0,padding:16,flex:1,overflow:"auto",whiteSpace:"pre-wrap",wordBreak:"break-word",userSelect:"text",outline:"none",fontFamily:"ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",fontSize:11.5,lineHeight:1.55,color:theme==="dark"?"#b1bac4":"#57606a"}}>{fullLog}</pre>
          </div>
        </div>
      )}

      {bugAlert&&(
        <div style={{position:"fixed",inset:0,zIndex:10050,background:"rgba(0,0,0,.85)",display:"flex",alignItems:"center",justifyContent:"center",padding:20}}
          onClick={dismissBugAlert}>
          <div style={{width:"100%",maxWidth:420,borderRadius:20,background:theme==="dark"?"#161d27":"#ffffff",border:`1px solid ${theme==="dark"?"#2a3542":"#e2e8f0"}`,overflow:"hidden",animation:"fadeUp .25s ease",boxShadow:"0 24px 60px rgba(0,0,0,.6)"}}
            onClick={e=>e.stopPropagation()}>
            <div style={{background:"linear-gradient(135deg,#3fb950,#2ea043)",padding:"20px 22px",textAlign:"center"}}>
              <div style={{fontSize:34,marginBottom:4}}>✅</div>
              <div style={{fontSize:17,fontWeight:900,color:"#fff"}}>신고하신 문제가 해결됐어요!</div>
            </div>
            <div style={{padding:"18px 22px",background:theme==="dark"?"#161d27":"#ffffff"}}>
              {bugAlert.memo&&<div style={{fontSize:12,color:theme==="dark"?"#8a97a6":"#64748b",marginBottom:10}}>신고 내용: {bugAlert.memo}</div>}
              <div style={{fontSize:14,color:theme==="dark"?"#e8edf2":"#1e293b",lineHeight:1.75}}>
                {bugAlert.admin_reply?.trim()
                  ? bugAlert.admin_reply
                  : "말씀해주신 문제를 처리했어요. 불편을 드려 죄송하고, 신고해주셔서 감사합니다 🙏"}
              </div>
              <button onClick={dismissBugAlert}
                style={{width:"100%",marginTop:18,padding:"13px",borderRadius:12,border:"none",background:"#3fb950",color:"#fff",fontSize:14,fontWeight:800,cursor:"pointer",fontFamily:"inherit"}}>
                확인
              </button>
            </div>
          </div>
        </div>
      )}

      {imageCountPopup&&(
        <div style={{position:"fixed",inset:0,zIndex:10070,background:"rgba(0,0,0,.78)",backdropFilter:"blur(5px)",display:"flex",alignItems:"center",justifyContent:"center",padding:20}} onClick={()=>setImageCountPopup(null)}>
          <div style={{width:"100%",maxWidth:420,borderRadius:22,overflow:"hidden",background:theme==="dark"?"#17111f":"#fff",border:"2px solid #a855f7",boxShadow:"0 24px 70px rgba(168,85,247,.45)",animation:"fadeUp .2s ease"}} onClick={e=>e.stopPropagation()}>
            <div style={{padding:"28px 24px 18px",textAlign:"center",background:"linear-gradient(135deg,rgba(168,85,247,.3),rgba(99,102,241,.18))"}}>
              <div style={{fontSize:44,marginBottom:8}}>{imageCountPopup.kind==="append"?"🎉":"✅"}</div>
              <div style={{fontSize:20,fontWeight:900,color:theme==="dark"?"#f5f3ff":"#3b0764"}}>
                {imageCountPopup.kind==="append"?`이미지 ${imageCountPopup.count}장이 추가되었습니다`:`이미지 ${imageCountPopup.count}장으로 설정되었습니다`}
              </div>
            </div>
            <div style={{padding:"18px 22px"}}>
              <button onClick={()=>setImageCountPopup(null)} style={{width:"100%",padding:"14px",borderRadius:12,border:0,background:"linear-gradient(135deg,#a855f7,#7c3aed)",color:"#fff",fontSize:15,fontWeight:900,cursor:"pointer",fontFamily:"inherit"}}>확인</button>
            </div>
          </div>
        </div>
      )}

      {/* 토스트 알림 */}
      <div className="toast-wrap">
        {toasts.map(t=>(
          <div key={t.id} className={`toast toast-${t.type}`}>
            {t.msg}
          </div>
        ))}
      </div>
    </>
  );
}
