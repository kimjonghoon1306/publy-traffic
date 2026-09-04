/* 🌱 새싹 비서 아이콘 — 퍼블리 AI 비서 마스코트(로봇 이모지 대신).
   온종일 브랜드(새싹) 통일 + 헤드셋 상담원 얼굴로 친근하게. currentColor라 색·크기 자유.
   사용: <SproutAssistant size={24} />  ·  버튼/헤더/칩 어디든. */
export default function SproutAssistant({ size = 24, stroke = 2.2, color }: { size?: number; stroke?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none"
      stroke={color || "currentColor"} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round"
      style={{ display: "inline-block", verticalAlign: "middle" }} aria-hidden="true">
      {/* 얼굴 */}
      <circle cx="24" cy="26" r="11" />
      {/* 헤드셋 밴드 + 이어컵 */}
      <path d="M13 26a11 11 0 0 1 22 0" />
      <path d="M11 26v3a3 3 0 0 0 3 3M37 26v3a3 3 0 0 1-3 3" />
      {/* 새싹 잎(머리 위) */}
      <path d="M24 15c0-3 2-5 5-5-.2 3-2 5-5 5Zm0 0c0-3-2-5-5-5 .2 3 2 5 5 5Z" fill={color || "currentColor"} stroke="none" />
      {/* 눈 + 미소 */}
      <circle cx="20" cy="26" r="1.3" fill={color || "currentColor"} stroke="none" />
      <circle cx="28" cy="26" r="1.3" fill={color || "currentColor"} stroke="none" />
      <path d="M20.5 30c1.5 1.5 5.5 1.5 7 0" />
    </svg>
  );
}
