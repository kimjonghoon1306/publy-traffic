/* 👣 모든 탭 공용 "이렇게 쓰세요" 사용법 안내 — 마스코트 캐릭터 '펄리' + 큰 번호 3~4단계.
   ★어르신 배려: 큰 글씨·번호·쉬운 말. ★다크/라이트 양쪽에서 글자 잘 보이게 색상 명시(테마별 고대비). */
import React from "react";

export type GuideStep = { ico?: string; title: string; desc: string };
type Props = {
  theme?: "dark" | "light";
  title?: string;             // 기본 "이렇게 쓰세요"
  subtitle?: string;          // 마스코트 말풍선 한 줄(탭별로 다르게)
  steps: GuideStep[];
  accent?: string;            // 포인트색(탭 테마에 맞게). 기본 퍼블리 핑크.
};

// 🐤 마스코트 '펄리' — 블로그를 대신 써주는 친근한 펜촉 새. 작아도 또렷하게, 테마 무관 자기 색 유지.
export function Pearly({ size = 60, accent = "#ff7eb6" }: { size?: number; accent?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden style={{ flexShrink: 0 }}>
      {/* 몸통 */}
      <ellipse cx="32" cy="38" rx="20" ry="19" fill={accent} />
      <ellipse cx="32" cy="41" rx="13" ry="12" fill="#fff" opacity=".9" />
      {/* 배 위 연필(퍼블리=글쓰기) */}
      <rect x="29.2" y="34" width="5.6" height="15" rx="2.6" fill="#f7c948" transform="rotate(12 32 41)" />
      <path d="M30 47.5 l4.4 1 -1.2 3.6 z" fill="#3a332a" transform="rotate(12 32 41)" />
      {/* 볼터치 */}
      <circle cx="21.5" cy="34" r="3.1" fill={accent} opacity=".45" />
      <circle cx="42.5" cy="34" r="3.1" fill={accent} opacity=".45" />
      {/* 눈 */}
      <circle cx="25.5" cy="29" r="3.1" fill="#2b2620" />
      <circle cx="38.5" cy="29" r="3.1" fill="#2b2620" />
      <circle cx="26.5" cy="28" r="1" fill="#fff" />
      <circle cx="39.5" cy="28" r="1" fill="#fff" />
      {/* 머리 위 펜촉(왕관처럼) */}
      <path d="M32 6 L37 17 L27 17 Z" fill={accent} />
      <path d="M32 11 L32 17" stroke="#fff" strokeWidth="1.4" strokeLinecap="round" />
      {/* 작은 날개 */}
      <ellipse cx="13.5" cy="39" rx="4.5" ry="7" fill={accent} transform="rotate(-18 13.5 39)" />
      <ellipse cx="50.5" cy="39" rx="4.5" ry="7" fill={accent} transform="rotate(18 50.5 39)" />
    </svg>
  );
}

export default function UsageGuide({ theme = "light", title = "이렇게 쓰세요", subtitle, steps, accent = "#ff7eb6" }: Props) {
  const dark = theme === "dark";
  // 테마별 고대비 색 — var() 반투명 대신 명시색으로 두 테마 모두 또렷하게
  const C = dark
    ? { bg: "#2a2622", panel: "#332e28", line: "#4a443c", head: "#fdf3ea", body: "#d8cdbd", num: "#20140f", chip: accent }
    : { bg: "#fff6fb", panel: "#ffffff", line: "#f0d9e6", head: "#2b2620", body: "#6b6357", num: "#ffffff", chip: accent };
  return (
    <div style={{ background: C.bg, border: `1px solid ${dark ? C.line : accent + "44"}`, borderRadius: 16, padding: "16px clamp(14px,3vw,22px)", marginBottom: 16 }}>
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 13 }}>
        <Pearly size={58} accent={accent} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 15.5, fontWeight: 900, color: C.head, letterSpacing: "-.01em" }}>👣 {title}</div>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: C.body, marginTop: 3, lineHeight: 1.5 }}>{subtitle || "펄리가 순서대로 알려줄게요. 이대로만 따라 하면 돼요!"}</div>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,220px),1fr))", gap: 10 }}>
        {steps.map((s, i) => (
          <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start", background: C.panel, borderRadius: 13, padding: "12px 13px", border: `1px solid ${C.line}` }}>
            <div style={{ flexShrink: 0, width: 28, height: 28, borderRadius: "50%", background: accent, color: C.num, fontWeight: 900, fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center" }}>{i + 1}</div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 900, color: C.head, marginBottom: 3 }}>{s.ico ? `${s.ico} ` : ""}{s.title}</div>
              <div style={{ fontSize: 12, color: C.body, lineHeight: 1.55 }}>{s.desc}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
