// ─────────────────────────────────────────────────────────────
// 백링크 어댑터 공통 타입
// 핵심 원칙(테리 지시):
//  · 로그엔 각 단계를 정확히 찍는다 → 문제 생기면 어디서 멈췄는지 바로 안다.
//    API형: apistart → post   /   봇형: proxy → botstart → post
//  · 로그/보고서엔 백링크 주소를 노출하지 않는다 → 신뢰지표(evidence)만.
// ─────────────────────────────────────────────────────────────

export type LogKind =
  | "apistart"   // API 시작
  | "proxy"      // 프록시 시작
  | "botstart"   // 봇 시작
  | "ai"         // AI 콘텐츠 생성
  | "post"       // 게시 성공
  | "index"      // 색인 요청
  | "done"       // 색인 완료
  | "wait"       // 대기
  | "warn"       // 주의
  | "fail";      // 실패

export interface LogEvent {
  kind: LogKind;
  msg: string;          // 신뢰지표 문구(주소 노출 금지)
  at: string;           // ISO
}

export interface PublishInput {
  targetDomain: string;         // 회원 도메인 (백링크 대상)
  targetUrl: string;            // https://도메인
  title: string;                // AI 생성 제목
  body: string;                 // AI 생성 본문(텍스트)
  anchor: string;               // 앵커 텍스트(다양화)
  proxy?: ProxyConf | null;     // 봇형이면 프록시(공용 풀 로테이션), API형이면 null
}

export interface ProxyConf {
  host: string;   // gw.dataimpulse.com
  port: number;   // 823
  username: string;
  password: string;
}

export interface PublishResult {
  ok: boolean;
  postUrl?: string;             // 내부용(회원 비노출)
  evidence: Record<string, any>;// 신뢰지표: http_code, posted_at, source, grade 등
  events: LogEvent[];           // 단계별 색상 로그
  error?: string;
}

export interface Adapter {
  key: string;                  // 소스 도메인 키 (telegra.ph 등)
  method: "api" | "bot";
  needsProxy: boolean;
  publish(input: PublishInput): Promise<PublishResult>;
}

export const nowISO = () => new Date().toISOString();
export const ev = (kind: LogKind, msg: string): LogEvent => ({ kind, msg, at: nowISO() });
