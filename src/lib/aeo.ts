// AEO(AI Engine Optimization) — 네이버 AI 브리핑/Cue:, 구글 AI Overview, 챗GPT·퍼플렉시티 같은
//   "답변형 AI"가 내 글을 답변에 인용하도록 글을 쓰게 만드는 규칙. 외부 연결이 아니라 '글 본문 형식'을 바꾸는 것.
//   회원(DashboardPage)·원터치·관리자(AdminPage) 글 생성 프롬프트에 공통으로 끼워 넣는다.

// 본문 규칙에 추가하는 블록 — 도입부 핵심요약 + 구조화(목록/표)로 AI가 발췌하기 쉽게.
export const AEO_RULES = `=== AI 검색 최적화(AEO) — 네이버 AI 브리핑·Cue: 등 AI 답변에 인용되게(반드시 지킬 것) ===
✅ 글 맨 처음(제목 다음 첫 문단)에 "핵심 요약"을 2~3문장으로 먼저 제시 — 서론·인사말 없이 바로 질문의 답부터. 예: "OO은 △△입니다. 핵심은 3가지인데요, ① ~ ② ~ ③ ~ 순서로 정리했어요." (AI가 이 요약을 그대로 답변에 뽑아 씀)
✅ 정보를 나열할 때는 서로 다른 줄에 번호 목록을 최소 3개(1. 2. 3. 또는 ① ② ③) 작성 — AI가 파싱하기 쉽게 (긴 줄글 덩어리로 뭉치지 말 것)
✅ 비교·수치·조건이 있으면 "항목: 값" 형태로 또렷하게 (예: "가격: 1만원 / 소요시간: 30분")
✅ ★번호 목록이나 "항목: 값" 실용정보 블록을 FAQ 직전·글 끝에 몰아넣지 말고 반드시 본문 중간(전체의 30~70% 지점)에 최소 1개 배치. 후기·경험 문단 사이에 가격·위치·시간·이용법·장단점 중 주제에 맞는 정보를 끼워 본문 자체를 탄탄하게 만들 것
✅ ★매 글마다 실용정보 위치를 ①앞쪽 경험 다음 ②정중앙 ③후반 경험 전 중 하나로 바꿔 같은 목차·같은 순서를 반복하지 말 것. FAQ의 Q&A는 이 중간 정보 블록을 대신할 수 없음
✅ 체험단·감성·후기 글은 확인되지 않은 가격·효과를 지어내지 말고, 제공된 정보가 없으면 실제로 확인할 선택 기준·이용 팁을 경험 문장 사이에 자연스럽게 정리
✅ 각 소제목 아래 첫 문장은 그 구간의 결론부터 (두괄식) — AI가 문단 첫 문장을 근거로 자주 인용함
✅ 다른 곳을 베끼는 요약이 아니라 작성자의 직접 관찰·비교·사용 기준처럼 이 글만의 근거를 최소 1개 포함
✅ 정책·가격·일정처럼 바뀔 수 있는 정보는 확인 기준일과 공식 출처명을 자연스럽게 밝혀 독자가 검증할 수 있게 하기(출처가 없으면 지어내지 말 것)
✅ 제목의 질문에 대한 답, 근거, 조건·예외가 각각 구분되게 작성해 AI 브리핑이 문맥 없이 인용해도 뜻이 바뀌지 않게 하기
✅ 홈판·추천 피드용 첫 화면은 최근 관심사와 연결하되, 관련 없는 유행어를 억지로 넣지 말고 대표 장면·핵심 효용이 분명하게 쓰기
✅ ★현재 년도는 ${new Date().getFullYear()}년. 년도를 쓸 땐 올해(${new Date().getFullYear()}년) 기준으로. 2024·2025 등 지난 년도를 최신처럼 쓰지 말 것`;

// 제목 생성 프롬프트에 붙이는 AEO 규칙 — AI가 "이 질문엔 이 글이 답"이라고 뽑게.
//  ★현재 년도를 명시(AI가 학습 시점 기준 옛 년도 2024 등을 박는 것 방지). getFullYear로 매년 자동.
export const AEO_TITLE_RULE = `- ★AI 검색 최적화: 제목에 '검색 의도(질문/니즈)'를 담기 — 사람들이 AI·검색창에 실제로 묻는 형태(무엇/어떻게/추천/가격/비교/방법/후기)로. AI가 이 제목을 보고 "이 질문의 답은 이 글"이라고 뽑아 씀. (단, 낚시 감탄사 말고 담백한 실제 검색어 형태로)
- ★★년도(연도)를 제목에 넣는다면 반드시 올해 '${new Date().getFullYear()}년'만 사용. 2024·2025 같은 지난 년도 절대 금지(지금은 ${new Date().getFullYear()}년이다).`;

// 본문 프롬프트에 붙이는 현재 년도 규칙 — 본문에도 옛 년도 박지 않게.
export const AEO_YEAR_RULE = `\n★현재 년도는 ${new Date().getFullYear()}년이다. 년도를 언급할 때는 올해(${new Date().getFullYear()}년) 기준으로 쓰고, 2024·2025 같은 지난 년도를 최신인 것처럼 쓰지 말 것.`;

// 출력 형식 안내에 붙이는 FAQ 강화(4~5개) — AI가 Q&A를 통째로 발췌하기 좋은 형태.
export const AEO_FAQ_FORMAT = `[FAQ시작]
자주 묻는 질문
Q1: (사람들이 실제로 검색창에 칠 법한 질문)
A1: (핵심부터 1~2문장으로 또렷하게)
Q2: (질문)
A2: (답변)
Q3: (질문)
A3: (답변)
Q4: (질문)
A4: (답변)
[FAQ끝]`;

// 🩺 AEO 형식 진단 — 글 본문(텍스트)을 읽어 AI 인용에 유리한 3요소를 갖췄는지 로컬 판정(AI 호출 0, 무료·즉시).
//   블로그지수(NeighborPage)에서 내 글이 AEO형인지 체크리스트로 보여줄 때 씀. 단일 소스.
export interface AeoCheck { key: string; label: string; ok: boolean; hint: string }

// 짧은 소제목을 첫 문단으로 오인하지 않고, 실제 도입 내용 2~3문단까지 살펴본다.
// AI가 지침을 놓친 경우에는 발행 전에 사실을 지어내지 않는 안전한 요약을 보충한다.
function hasAeoIntroSummary(body: string): boolean {
  const paras = (body || "").trim().split(/\n\s*\n/).map(v => v.trim()).filter(Boolean);
  const meaningful = paras.filter(v => !/^\[(FAQ|관련글|참고자료)/.test(v) && !(v.length <= 32 && !/[.!?。！？]/.test(v))).slice(0, 3);
  const intro = meaningful.join(" ").slice(0, 650);
  const sentences = intro.match(/[^.!?。！？]+[.!?。！？]+/g) || [];
  const summarySignal = /(핵심|정리|요약|결론부터|한마디로|간단히|먼저 알아둘|포인트|기준|세\s*가지|가지는|가지로|순서로|첫째|①|1\.\s)/.test(intro);
  const answerFirst = /(입니다|이에요|예요|해요|돼요|있어요|없어요|좋아요|필요해요|추천해요)[.!?。！？]/.test(intro);
  return intro.length >= 55 && sentences.length >= 2 && (summarySignal || answerFirst)
    && !/^(안녕|반갑|오늘은|여러분|이번에|요즘|날씨)/.test(intro);
}

export function ensureAeoIntroSummary(body: string, topic: string): string {
  const clean = (body || "").trim();
  if (!clean || hasAeoIntroSummary(clean)) return clean;
  const safeTopic = String(topic || "이 주제").replace(/[\r\n]+/g, " ").trim().slice(0, 55) || "이 주제";
  const summary = `${safeTopic}에서 먼저 알아둘 핵심을 간단히 정리했어요. 선택 기준과 확인할 점, 실제로 활용하는 순서를 중심으로 아래 내용을 보면 필요한 정보를 빠르게 찾을 수 있어요.`;
  return `${summary}\n\n${clean}`;
}

export function diagnoseAeo(body: string): { checks: AeoCheck[]; score: number; passed: number } {
  const text = (body || "").trim();
  // ① 도입부 핵심 요약: 짧은 소제목은 건너뛰고 실제 도입 문단이 답부터 말하는지 확인한다.
  const introSummary = hasAeoIntroSummary(text);
  // ② FAQ / Q&A: 자주 묻는 질문 블록이 있나
  // 최신 글은 줄바꿈을 보존해서 읽지만, 예전에 평탄화해 저장한 본문도 Q1/A1 표기를 인식한다.
  const faqQuestions = text.match(/(?:^|\n|\s)Q\s*\d+\s*[:：.]/gi) || [];
  const faqAnswers = text.match(/(?:^|\n|\s)A\s*\d+\s*[:：.]/gi) || [];
  // 체험단·감성 후기 패턴은 별도 FAQ를 끝에 붙이지 않고, 본문 중간에
  // "왜 좋았을까요?" 같은 질문형 소제목과 바로 다음 답변 문단을 배치한다.
  const lines = text.split(/\n+/).map(line => line.trim()).filter(Boolean);
  const embeddedQuestionAnswers = lines.filter((line, index) =>
    line.length >= 5 && line.length <= 80 && /[?？]$/.test(line)
    && !!lines[index + 1] && !/[?？]$/.test(lines[index + 1])
  ).length;
  const hasFaq = /\[FAQ시작\]|자주\s*묻는\s*질문|Q\s*&\s*A|큐앤에이/i.test(text)
    || (faqQuestions.length >= 2 && faqAnswers.length >= 2)
    || embeddedQuestionAnswers >= 2;
  // ③ 구조화: 번호/기호 목록이나 "항목: 값" 형태가 충분히 있나
  const numberedHits = (text.match(/(?:^|\n|\s)(?:\d+[.)]|[①②③④⑤⑥⑦⑧⑨]|[-•▶]|첫째|둘째|셋째)/g) || []).length;
  // Q1:/A1:은 FAQ 점수에만 반영한다. 이를 항목 목록으로 중복 계산하면 FAQ만 있는 글이 구조화까지 통과한다.
  const fieldHits = text.split(/\n+/).filter(line =>
    !/^\s*[QA]\s*\d+\s*[:：.]/i.test(line) && /[^\n]{1,14}\s*[:：]\s*\S/.test(line)
  ).length;
  const listHits = numberedHits + fieldHits;
  const structured = listHits >= 3;
  const checks: AeoCheck[] = [
    { key: "intro", label: "도입부 핵심 요약", ok: introSummary, hint: "글 첫 문단을 인사말 대신 '핵심 요약'으로 시작하면 AI가 그 문장을 답변에 뽑아 써요." },
    { key: "faq", label: "자주 묻는 질문(Q&A)", ok: hasFaq, hint: "글 아래 Q&A 또는 본문 중간의 질문형 소제목+답변 문단을 넣으면 AI가 인용하기 좋아요." },
    { key: "structure", label: "목록·구조화", ok: structured, hint: "정보를 번호 목록이나 '항목: 값'으로 정리하면 AI가 파싱하기 쉬워요." },
  ];
  const passed = checks.filter(c => c.ok).length;
  return { checks, score: Math.round((passed / checks.length) * 100), passed };
}
