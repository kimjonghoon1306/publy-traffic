/* 📖 퍼블리 대백서 — "어떤 순서로, 어떨 때 쓰면 좋은지" 상황별 사용 레시피.
   ★기능 나열이 아니라 목표/상황 → 단계 순서 → 팁. 어르신도 이해되게 큰 글씨·쉬운 말.
   ★새 기능이 생기면 아래 RECIPES 배열에 한 항목만 추가하면 대백서에 자동 반영된다.
   ★회원=관리자 공용. 다크/라이트 양쪽에서 글자 또렷하게(테마별 명시색). 마스코트 '펄리' 실사 이미지 사용.
   ★Safari(WebKit) 주의: 접이 헤더를 <button>+flex로 하면 자식이 뭉개진다 → <div role="button">로 구현. */
import React, { useState } from "react";
import pearlyImg from "../assets/pearly.png";

export const DAEBAEKSEO_VERSION = 4;   // 내용 크게 바뀌면 +1 → 로그인 자동팝업 다시 노출

type Step = { tab?: string; title: string; desc: string };
type Recipe = {
  ico: string;
  goal: string;         // 이럴 때(상황·목표)
  when: string;         // 한 줄 설명
  steps: Step[];        // 추천 순서
  tip?: string;         // 고수 팁
  accent: string;
};

/* ── 상황별 레시피(순서가 핵심) ── 새 기능은 여기에 항목 추가 ── */
const RECIPES: Recipe[] = [
  {
    ico: "⚡", goal: "⚡ 원터치 발행 — 키워드만 넣고 전부 자동 (BEST)", when: "제목·글·이미지·카테고리·발행까지 한 번에! 키워드 여러 개 + 텀만 정하면 봇이 순서대로 알아서 올려요",
    accent: "#7c3aed",
    steps: [
      { tab: "계정 관리", title: "① 네이버 계정 연결 (1회)", desc: "발행할 네이버 계정을 계정 관리에서 한 번만 연결해요. 원터치와 일반 발행이 같은 계정을 함께 써요(따로 로그인 X)." },
      { tab: "원터치 발행", title: "② Flow 준비 (무료 이미지)", desc: "이미지 방식을 'Flow(무료)'로 두면 오른쪽에 '🎬 Flow 준비' 카드가 떠요. 파란 버튼 눌러 크롬 열고 구글 로그인 1회 → '연결됨'. (유료 AI 키를 쓰면 생략)" },
      { tab: "원터치 발행", title: "③ 키워드·설정 넣기", desc: "키워드를 한 줄에 하나씩 여러 개. 글 패턴(정보글·감성일기·맛집후기·여행기)·글자수(자동/직접)·발행 텀(10분~2시간·직접입력)·이미지 장수를 골라요." },
      { tab: "원터치 발행", title: "④ ⚡ 시작 → 자동 반복", desc: "키워드마다 제목(최고점 선택)→본문(키워드 5~6회)→이미지→네이버 카테고리 자동 매칭→발행. 텀이 지나면 다음 키워드로 계속 이어가요." },
      { tab: "원터치 발행", title: "⑤ 로그로 확인·중단", desc: "화면 아래 고정된 로그창에 진행이 실시간으로 쌓여요. '📋 전체 복사'로 기록을 복사하고, '⏹ 중단'으로 언제든 멈출 수 있어요." },
    ],
    tip: "발행 한도는 일반 발행과 '함께' 써요(무료 2·베이직 6·프로 15건/일). 한도를 넘으면 그만큼만 올리고 나머지는 다음날이나 등급 업으로. 텀은 네이버 안전상 넉넉히(1시간 이상 권장).",
  },
  {
    ico: "🌱", goal: "블로그를 이제 막 시작할 때", when: "계정만 있고 뭐부터 할지 막막하다면, 이 순서 그대로 따라 해요",
    accent: "#ff7eb6",
    steps: [
      { tab: "계정 관리", title: "① 내 블로그 계정 연결", desc: "네이버·티스토리를 먼저 연결해요. 봇이 대신 로그인해 글을 올릴 수 있게 되는 첫 단계예요. (무료 이미지를 쓰려면 구글도 연결)" },
      { tab: "키워드/제목", title: "② 쓸 주제·제목 정하기", desc: "검색이 잘 되는 인기 키워드와, 사람들이 눌러보는 제목 후보를 추천받아 하나 골라요." },
      { tab: "글 생성", title: "③ 본문 자동 작성", desc: "고른 제목으로 본문을 자동으로 써줘요. 말투와 글 유형(정보형·후기형)을 골라 내 색깔을 넣어요." },
      { tab: "이미지 생성", title: "④ 어울리는 사진 넣기", desc: "무료(Google Flow)로 글에 맞는 이미지를 만들어 넣어요. 글자 없는 순수 사진으로 나와요." },
      { tab: "발행하기", title: "⑤ 블로그에 올리기", desc: "올릴 계정·플랫폼을 고르고 🚀 발행. 처음엔 '전체 공개'로 올려보세요." },
    ],
    tip: "처음 일주일은 하루 1개면 충분해요. 매일 비슷한 시간대에 꾸준히 올리면 방문자가 붙기 시작해요. 자리가 잡히면 그때 서이추로 이웃을 늘리세요.",
  },
  {
    ico: "📅", goal: "매일 꾸준히 글 하나 올리고 싶을 때", when: "무엇을 쓸지 고민 없이 매일 돌리는 '루틴'을 만들고 싶을 때",
    accent: "#22a35d",
    steps: [
      { tab: "콘텐츠 캘린더", title: "① 오늘의 글감 받기", desc: "날짜별 추천 주제와 요즘 핫이슈가 떠요. 그중 오늘 쓸 걸 하나 고르면 돼요." },
      { tab: "글 생성", title: "② 바로 작성", desc: "캘린더의 '글쓰기' 버튼으로 이어서 본문을 자동 생성해요." },
      { tab: "발행하기", title: "③ 예약 발행 걸기", desc: "아침에 예약 시간만 걸어두면, PC를 꺼도 그 시간에 네이버가 알아서 올려줘요." },
      { tab: "콘텐츠 캘린더", title: "④ 완료 체크 🔥", desc: "쓴 날은 체크! 며칠 연속 썼는지 스트릭이 쌓여서 계속 하게 돼요." },
    ],
    tip: "예약 발행은 네이버 예약 화면에 시간을 심어두는 방식이라, 하루 한 번만 세팅해두면 PC를 꺼도 계속 올라가요.",
  },
  {
    ico: "📈", goal: "검색 상위노출을 올리고 싶을 때", when: "글은 쓰는데 검색에 안 잡힐 때 — 무작정 고치지 말고 '진단'부터",
    accent: "#3b82f6",
    steps: [
      { tab: "블로그 지수", title: "① 건강검진 먼저", desc: "내 블로그 지수·저품질 여부·검색 노출 상태를 진단해요. 원인을 알아야 고쳐요." },
      { tab: "블로그 지수", title: "② 글별 진료차트(주치의)", desc: "글마다 순위를 기억하고 완치(상위노출)까지 관찰해줘요. '오늘의 회진'으로 챙길 글을 알려줘요." },
      { tab: "키워드/제목", title: "③ 제목·키워드 다듬기", desc: "노출이 잘 되는 키워드로 제목을 최적화해요." },
      { tab: "발행 관리", title: "④ 재발행·성과 추적", desc: "순위 ▲▼ 변화를 30일 누적으로 보고, 잘 된 글을 다음 글에 참고해요." },
    ],
    tip: "제목을 바꾼 글은 30일은 지켜보세요. 자꾸 바꾸면 오히려 순위가 흔들려요. 주치의가 무한 제목변경을 막아줘요.",
  },
  {
    ico: "🤝", goal: "이웃·방문자를 늘리고 싶을 때", when: "글은 쌓이는데 방문자가 적을 때 (자동·수동 둘 다 있어요)",
    accent: "#00b8d4",
    steps: [
      { tab: "서이추", title: "① 서로이웃 신청", desc: "내 주제와 맞는 블로거에게 서이추를 보내요. 등급별로 하루 한도가 있어요." },
      { tab: "공감·댓글", title: "② 공감·댓글로 인사", desc: "이웃 글에 진심 담긴 댓글로 관계를 쌓아요. 영혼 없는 복붙보다 한 줄이라도 진심이 낫대요." },
      { tab: "답방", title: "③ 답방하기", desc: "내 글에 댓글 단 사람에게 답방으로 보답해요. 관계가 이어져요." },
      { tab: "품앗이", title: "④ 내 계정끼리 품앗이", desc: "여러 계정이 있으면 서로 공감·댓글로 초반의 온기를 만들어요." },
    ],
    tip: "네이버가 과하다 싶으면 제한을 걸어요. 하루 한도 안에서 천천히! 처음엔 수동으로 감을 잡고, 익숙해지면 자동으로 돌리세요.",
  },
  {
    ico: "📷", goal: "사진만 있고 글쓰기는 귀찮을 때", when: "여행·맛집 사진으로 후기 글을 뚝딱 만들고 싶을 때",
    accent: "#f59e0b",
    steps: [
      { tab: "사진 글쓰기", title: "① 발행 계정 먼저 고르기", desc: "◉ 로 올릴 네이버 계정을 먼저 선택해요(계정이 섞여 엉뚱한 곳에 올라가는 것 방지)." },
      { tab: "사진 글쓰기", title: "② 사진 올리기", desc: "글에 넣을 사진을 업로드해요(최대 20장). 이야기 순서대로 올리면 좋아요." },
      { tab: "사진 글쓰기", title: "③ 핵심만 적고 생성", desc: "간단한 포인트만 적으면 사진에 딱 맞춘 글과 캡션이 만들어져요. 그대로 발행!" },
    ],
    tip: "사진을 시간·동선 순서대로 올리면 글 흐름이 훨씬 자연스러워요. 캡션도 사진 내용과 어긋나지 않게 나와요.",
  },
  {
    ico: "🔍", goal: "협업 블로거·체험단을 찾을 때", when: "내 업종에 맞는 블로거를 발굴해 직접 연락하고 싶을 때 (크롤링)",
    accent: "#8b5cf6",
    steps: [
      { tab: "크롤링", title: "① 블로거 발굴", desc: "키워드로 블로거를 찾아요. 활성도🔥·협찬비율📊·주제🏷️·인게이지먼트(💬댓글·❤️공감)까지 한눈에 봐요." },
      { tab: "크롤링", title: "② 연락처 수집", desc: "이메일·카톡·오픈챗 등 연락 수단을 모아요." },
      { tab: "크롤링", title: "③ 아웃리치(연락)", desc: "웹메일 자동발송 또는 블로그 댓글로 연락해요. 도배로 막히지 않게 딜레이가 들어가요." },
    ],
    tip: "협찬% 낮고 댓글·공감이 많은 '진짜 독자가 있는' 블로거가 반응이 좋아요. 필터로 걸러서 접근하면 성공률이 올라가요.",
  },
  {
    ico: "🏪", goal: "내 매장 노출과 순위를 키우고 싶을 때", when: "신규 고객·광고·재방문 중 무엇이 문제인지 보고, 순위 상승 계획까지 따라가고 싶을 때",
    accent: "#16856b",
    steps: [
      { tab: "플레이스 365 · 시작", title: "① 내 매장 등록·전환", desc: "상호명·지역·업종을 입력해요. 무료 1개·베이직 2개·프로 5개까지 등록하고, 위쪽 매장 버튼으로 순위와 진단 화면을 바꿀 수 있어요." },
      { tab: "지금 내 순위", title: "② 지역·업종 검색 순위 확인", desc: "고객이 검색하는 키워드로 내 매장이 몇 위인지 측정해요. 앱을 다시 열어도 최신 순위와 같은 검색어의 상승·하락 기록을 이어서 확인할 수 있어요." },
      { tab: "매장 진단", title: "③ 주변 업체와 비교 진단", desc: "방문자 리뷰·블로그 리뷰와 주변 업체 평균을 비교해 지금 먼저 보완할 일을 쉬운 말로 알려줘요." },
      { tab: "운영자료 진단", title: "④ 신규·재방문·광고 원인 구분", desc: "POS·예약 장부·광고 보고서의 최근 30일과 이전 30일 숫자를 직접 넣거나 CSV 양식을 내려받아 한 번에 불러오세요. 신규 고객, 재방문율, 광고 1건당 비용, 매출 흐름을 비교해요." },
      { tab: "오늘 할 일", title: "⑤ 성장 미션을 순서대로 실행", desc: "내 매장 수치에 맞춰 오늘 해야 할 일을 1·2·3 순서로 보여줘요. 운영자료 저장·순위 재측정·내 매장 고객 화면 확인·리뷰어 전달은 실행하는 순간 자동 완료되고, 다른 PC에서도 이어져요." },
      { tab: "고객 화면 보기", title: "⑥ 고객에게 보이는 매장 확인", desc: "공개 사진·주소·영업시간·전화·메뉴·가격·예약·주차 정보를 확인하고 완성도 점수와 먼저 고칠 순서를 봐요." },
      { tab: "업체·리뷰어 찾기", title: "⑦ 경쟁업체와 블로거 역추적", desc: "지역 업체를 모아 비교하고, 실제로 그 업체를 리뷰한 블로거를 중복 없이 찾아요." },
      { tab: "크롤링", title: "⑧ 협업 제안으로 연결", desc: "찾은 블로거를 크롤링으로 보내 연락처 확인·이메일·댓글 제안을 이어서 준비해요." },
    ],
    tip: "오늘 미션은 한국시간 자정에 새로 시작하고 리뷰어 전달 누적은 유지돼요. 순위는 위치·시간·기기에 따라 달라질 수 있으니 같은 키워드를 같은 조건으로 꾸준히 측정하세요.",
  },
  {
    ico: "📱", goal: "인스타로 고객을 모으고 싶을 때", when: "블로그 밖에서도 관심 고객에게 다가가고 싶을 때",
    accent: "#e5397f",
    steps: [
      { tab: "인스타 DM", title: "① 인스타 로그인", desc: "인스타 계정으로 로그인해요." },
      { tab: "인스타 DM", title: "② 대상 수집", desc: "키워드로 메시지 보낼 대상을 모아요." },
      { tab: "인스타 DM", title: "③ 천천히 발송", desc: "메시지를 적고 안전한 간격으로 보내요(계정 보호)." },
    ],
    tip: "한 번에 많이 보내면 계정이 막힐 수 있어요. 매일 조금씩 꾸준히가 가장 안전해요.",
  },
];

/* ── 알아두면 좋은 팁 ── */
const TIPS: { ico: string; title: string; desc: string }[] = [
  { ico: "⚙️", title: "자동 vs 수동, 둘 다 있어요", desc: "모든 기능은 봇이 알아서 하는 '자동'과 내가 버튼 누르는 '수동'이 함께 있어요. 상황에 맞게 골라 쓰세요." },
  { ico: "🏅", title: "등급별 하루 한도", desc: "서이추·공감·발굴 등은 등급에 따라 하루 사용량이 달라요. 컨트롤타워에서 오늘 남은 양을 확인!" },
  { ico: "🌐", title: "계정별 IP(프록시)", desc: "여러 계정을 안전하게 돌리려면 계정마다 다른 IP를 쓰는 게 좋아요(같은 IP 차단 회피)." },
  { ico: "🛟", title: "문제가 생기면", desc: "화면 아래 로그의 '📋 복사'를 눌러 그대로 보내주시면 원인을 빨리 찾을 수 있어요." },
  { ico: "🔐", title: "같은 네이버 계정은 한 작업씩", desc: "같은 계정으로 업체 찾기와 다른 자동화를 동시에 누르면 계정 보호를 위해 안내가 떠요. 다른 계정끼리는 동시에 사용할 수 있어요." },
  { ico: "🛡️", title: "무제한도 '안전 사용량'이 보여요", desc: "서이추·공감·품앗이는 무제한 등급이어도 네이버 안전 권장치(하루 100 정도)를 기준으로 오늘 몇 건 했는지 보여줘요. 막지는 않지만 넘으면 주황색으로 알려주니, 계정 보호를 위해 잠깐 쉬어가는 참고로 쓰세요." },
  { ico: "🔎", title: "이웃 관심 키워드 뽑기", desc: "서이추 탭의 '분석하기'를 누르면 내 이웃들이 요즘 자주 쓰는 주제 키워드를 뽑아줘요. 클릭하면 바로 키워드 칸에 추가돼요(글감·서이추 타겟팅에 활용)." },
];

export default function Daebaekseo({ theme = "light", onClose }: { theme?: "dark" | "light"; onClose: () => void }) {
  const dark = theme === "dark";
  const [openIdx, setOpenIdx] = useState<number>(0);   // 첫 레시피는 펼쳐서 보여줌
  const C = dark
    ? { overlay: "rgba(3,7,12,.72)", card: "#241f1b", panel: "#2e2823", line: "#463f37", head: "#fdf3ea", sub: "#b3a898" }
    : { overlay: "rgba(40,25,35,.42)", card: "#fffdfb", panel: "#fff7fb", line: "#f0dce7", head: "#241f1b", sub: "#7a7266" };
  const bodyColor = dark ? "#d8cdbd" : "#4a4540";
  const box: React.CSSProperties = { boxSizing: "border-box" };   // 전역 리셋/사파리 대비 명시

  return (
    <div onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}
      style={{ ...box, position: "fixed", inset: 0, zIndex: 10000, background: C.overlay, display: "flex", alignItems: "center", justifyContent: "center", padding: "clamp(8px,3vw,28px)", backdropFilter: "blur(3px)" }}>
      <section role="dialog" aria-modal="true" aria-label="퍼블리 대백서"
        style={{ ...box, width: "min(760px,100%)", maxHeight: "92vh", display: "flex", flexDirection: "column", background: C.card, border: `1px solid ${C.line}`, borderRadius: 20, boxShadow: "0 24px 60px rgba(0,0,0,.4)", overflow: "hidden" }}>
        {/* 헤더 — 실사 펄리 캐릭터 */}
        <div style={{ ...box, display: "flex", alignItems: "center", gap: 14, padding: "16px clamp(16px,3vw,24px)", borderBottom: `1px solid ${C.line}`, background: dark ? "#2a231e" : "#fff0f7" }}>
          <img src={pearlyImg} alt="펄리" width={62} height={62} style={{ width: 62, height: 62, objectFit: "contain", flexShrink: 0, filter: "drop-shadow(0 3px 6px rgba(255,126,182,.35))" }} />
          <div style={{ ...box, minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: "clamp(18px,4vw,22px)", fontWeight: 900, color: C.head, letterSpacing: "-.02em", lineHeight: 1.2 }}>📖 퍼블리 대백서</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: C.sub, marginTop: 4, lineHeight: 1.5 }}>펄리예요! 기능 설명이 아니라 <b>“이럴 때 이 순서로 쓰면 좋아요”</b>를 모았어요.</div>
          </div>
          <div role="button" tabIndex={0} onClick={onClose} onKeyDown={e => { if (e.key === "Enter" || e.key === " ") onClose(); }} aria-label="닫기"
            style={{ ...box, flexShrink: 0, width: 34, height: 34, borderRadius: "50%", border: `1px solid ${C.line}`, background: C.card, color: C.head, fontSize: 19, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", lineHeight: 1 }}>×</div>
        </div>

        {/* 본문 스크롤 */}
        <div style={{ ...box, overflowY: "auto", padding: "clamp(12px,3vw,20px)", display: "flex", flexDirection: "column", gap: 12 }}>
          {RECIPES.map((r, i) => {
            const open = openIdx === i;
            return (
              <div key={i} style={{ ...box, flexShrink: 0, border: `1px solid ${open ? r.accent + "88" : C.line}`, borderRadius: 15, background: C.panel, overflow: "hidden", transition: "border-color .15s" }}>
                {/* 접이 헤더 — Safari flex 버그 피하려고 button 대신 div role=button */}
                <div role="button" tabIndex={0}
                  onClick={() => setOpenIdx(open ? -1 : i)}
                  onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpenIdx(open ? -1 : i); } }}
                  style={{ ...box, width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "14px 15px", cursor: "pointer", userSelect: "none" }}>
                  <div style={{ ...box, flexShrink: 0, width: 44, height: 44, borderRadius: 12, background: r.accent + (dark ? "2e" : "1c"), display: "flex", alignItems: "center", justifyContent: "center", fontSize: 23 }}>{r.ico}</div>
                  <div style={{ ...box, minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: "clamp(15px,3.4vw,16.5px)", fontWeight: 900, color: C.head, letterSpacing: "-.01em", lineHeight: 1.3 }}>{r.goal}</div>
                    <div style={{ fontSize: 12.5, fontWeight: 600, color: C.sub, marginTop: 3, lineHeight: 1.45 }}>{r.when}</div>
                  </div>
                  <div style={{ ...box, flexShrink: 0, color: r.accent, fontSize: 15, fontWeight: 900, transform: open ? "rotate(90deg)" : "none", transition: "transform .18s" }}>▸</div>
                </div>
                {open && (
                  <div style={{ ...box, padding: "0 15px 15px", display: "flex", flexDirection: "column", gap: 9 }}>
                    {r.steps.map((s, j) => (
                      <div key={j} style={{ ...box, display: "flex", gap: 11, alignItems: "flex-start", background: C.card, borderRadius: 12, padding: "11px 12px", border: `1px solid ${C.line}` }}>
                        <div style={{ ...box, flexShrink: 0, width: 26, height: 26, borderRadius: "50%", background: r.accent, color: "#fff", fontWeight: 900, fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center" }}>{j + 1}</div>
                        <div style={{ ...box, minWidth: 0, flex: 1 }}>
                          <div style={{ lineHeight: 1.4 }}>
                            <span style={{ fontSize: 14.5, fontWeight: 800, color: C.head }}>{s.title}</span>
                            {s.tab && <span style={{ marginLeft: 7, fontSize: 11, fontWeight: 800, color: r.accent, background: r.accent + (dark ? "26" : "18"), padding: "2px 8px", borderRadius: 20, whiteSpace: "nowrap", display: "inline-block" }}>{s.tab}</span>}
                          </div>
                          <div style={{ fontSize: 13, fontWeight: 500, color: bodyColor, marginTop: 4, lineHeight: 1.55 }}>{s.desc}</div>
                        </div>
                      </div>
                    ))}
                    {r.tip && (
                      <div style={{ ...box, display: "flex", gap: 8, alignItems: "flex-start", marginTop: 2, padding: "10px 12px", borderRadius: 12, background: r.accent + (dark ? "1e" : "12"), border: `1px dashed ${r.accent}66` }}>
                        <span style={{ fontSize: 15, flexShrink: 0 }}>💡</span>
                        <span style={{ fontSize: 12.8, fontWeight: 700, color: dark ? "#f0e6da" : "#5a4636", lineHeight: 1.55 }}>{r.tip}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {/* 알아두면 좋은 팁 */}
          <div style={{ ...box, flexShrink: 0, marginTop: 6, padding: "14px 15px", borderRadius: 15, border: `1px solid ${C.line}`, background: C.panel }}>
            <div style={{ fontSize: 15, fontWeight: 900, color: C.head, marginBottom: 10 }}>🧭 알아두면 좋아요</div>
            <div style={{ ...box, display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,240px),1fr))", gap: 9 }}>
              {TIPS.map((t, i) => (
                <div key={i} style={{ ...box, display: "flex", gap: 10, alignItems: "flex-start", background: C.card, borderRadius: 12, padding: "11px 12px", border: `1px solid ${C.line}` }}>
                  <span style={{ fontSize: 19, flexShrink: 0 }}>{t.ico}</span>
                  <div style={{ ...box, minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 800, color: C.head }}>{t.title}</div>
                    <div style={{ fontSize: 12.5, fontWeight: 500, color: bodyColor, marginTop: 2, lineHeight: 1.5 }}>{t.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div style={{ textAlign: "center", fontSize: 12, fontWeight: 600, color: C.sub, marginTop: 2 }}>
            ✨ 새로운 기능이 생기면 대백서에 계속 업데이트돼요.
          </div>
        </div>

        {/* 푸터 */}
        <div style={{ ...box, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "12px clamp(16px,3vw,24px)", borderTop: `1px solid ${C.line}`, background: dark ? "#2a231e" : "#fff7fb" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12.5, fontWeight: 700, color: C.sub, cursor: "pointer" }}>
            <input type="checkbox" onChange={e => { try { localStorage.setItem("publy_daebaekseo_seen", e.target.checked ? String(DAEBAEKSEO_VERSION) : ""); } catch {} }} style={{ width: 16, height: 16, accentColor: "#ff7eb6", cursor: "pointer" }} />
            로그인할 때 다시 띄우지 않기
          </label>
          <div role="button" tabIndex={0} onClick={onClose} onKeyDown={e => { if (e.key === "Enter" || e.key === " ") onClose(); }}
            style={{ ...box, padding: "10px 22px", borderRadius: 12, background: "#ff7eb6", color: "#fff", fontSize: 14.5, fontWeight: 900, cursor: "pointer", boxShadow: "0 4px 14px rgba(255,126,182,.4)", whiteSpace: "nowrap" }}>
            시작하기 →
          </div>
        </div>
      </section>
    </div>
  );
}
