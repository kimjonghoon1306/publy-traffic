import { useState, useEffect } from "react";
import { botFetch } from "./lib/botApi";

interface Props {
  botOnline: boolean;
  botUrl: string;
  userId: string;
}

export default function GoogleFlowCard({ botOnline, botUrl, userId }: Props) {
  const [loading, setLoading] = useState(false);
  const [sessionExists, setSessionExists] = useState(false);
  const [checking, setChecking] = useState(true);

  // 마운트 시 세션 존재 여부 확인
  useEffect(() => {
    if (!botOnline) { setChecking(false); return; }
    botFetch(`${botUrl}/api/session-status/${userId}`)
      .then(r => r.json())
      .then(d => setSessionExists(!!d.google))
      .catch(() => {})
      .finally(() => setChecking(false));
  }, [botOnline, botUrl, userId]);

  // 크롬 창을 열어 사용자가 직접 구글 로그인 → 로그인되면 세션 저장
  async function handleConnect() {
    if (!botOnline) { alert("Publy 앱을 먼저 실행해주세요"); return; }
    setLoading(true);
    try {
      const r = await botFetch(`${botUrl}/api/google/save-session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
        signal: AbortSignal.timeout(210000), // 봇이 로그인 최대 3분 대기 → 여유 있게
      });
      const d = await r.json();
      if (d.success) {
        setSessionExists(true);
        alert("✅ Google 연결 완료! 이제 글쓰기·이미지 생성 시 자동으로 사용돼요.");
      } else {
        alert("❌ 연결 실패: " + (d.error || "크롬 창에서 로그인을 완료했는지 확인해주세요"));
      }
    } catch (e: any) {
      alert("❌ 오류: " + e.message + "\n(크롬 창에서 로그인을 마쳤는지 확인해주세요)");
    } finally {
      setLoading(false);
    }
  }

  if (checking) return null;

  return (
    <div className="card" style={{
      padding: "16px 18px", marginTop: 4,
      background: "linear-gradient(135deg,rgba(124,58,237,.08),rgba(168,85,247,.08))",
      border: `1.5px solid ${sessionExists ? "rgba(0,214,143,.4)" : "rgba(168,85,247,.3)"}`
    }}>
      {/* 헤더 */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
        <span style={{ fontSize: 26 }}>🎨</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: "#c084fc" }}>Google Flow 이미지</div>
          <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 2 }}>무료 AI 이미지 자동 생성</div>
        </div>
        {sessionExists && (
          <span style={{ fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 99, background: "rgba(0,214,143,.15)", color: "var(--success)", border: "1px solid rgba(0,214,143,.3)" }}>
            ✅ 연결됨
          </span>
        )}
      </div>

      {/* 사용 방법 */}
      <div style={{ fontSize: 11, color: "var(--text)", lineHeight: 1.9, marginBottom: 12, padding: "10px 12px", borderRadius: 10, background: "rgba(168,85,247,.06)", border: "1px solid rgba(168,85,247,.15)" }}>
        <div style={{ fontWeight: 800, color: "#c084fc", marginBottom: 4 }}>📖 연결 방법</div>
        <div>① 아래 <b>[Google 연결하기]</b> 클릭</div>
        <div>② 크롬 창이 자동으로 열립니다</div>
        <div>③ <b>그 창에서 직접 구글 로그인</b> (한 번만)</div>
        <div>④ 로그인되면 자동 저장 → 여기서 매번 로그인 안 해도 됨</div>
        <div style={{ color: "var(--warn)", marginTop: 4 }}>⚠️ 크롬 창을 닫지 말고 로그인 완료까지 기다려주세요</div>
      </div>

      {/* 세션 없을 때: 연결 버튼 */}
      {!sessionExists && (
        <div style={{ display: "flex", gap: 8 }}>
          <a href="https://accounts.google.com/signup" target="_blank" rel="noreferrer"
            style={{ flex: "0 0 auto", padding: "9px 14px", borderRadius: 9, border: "1.5px solid rgba(168,85,247,.4)", background: "transparent", color: "#c084fc", cursor: "pointer", fontSize: 12, fontWeight: 700, fontFamily: "inherit", textDecoration: "none", display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}>
            🔑 구글 계정 만들기
          </a>
          <button onClick={handleConnect} disabled={loading}
            style={{ flex: 1, padding: "9px", borderRadius: 9, border: "none", background: "linear-gradient(135deg,#7c3aed,#a855f7)", color: "#fff", cursor: loading ? "default" : "pointer", fontSize: 12, fontWeight: 800, fontFamily: "inherit", opacity: loading ? 0.7 : 1 }}>
            {loading ? "🔄 크롬 창에서 로그인 대기 중..." : "🔗 Google 연결하기"}
          </button>
        </div>
      )}

      {/* 세션 있을 때: 재연결 버튼 */}
      {sessionExists && (
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => setSessionExists(false)}
            style={{ flex: 1, padding: "9px", borderRadius: 9, border: "1.5px solid rgba(168,85,247,.4)", background: "transparent", color: "#c084fc", cursor: "pointer", fontSize: 12, fontWeight: 700, fontFamily: "inherit" }}>
            ✏️ 계정 변경
          </button>
          <button onClick={handleConnect} disabled={loading}
            style={{ flex: 1, padding: "9px", borderRadius: 9, border: "none", background: "linear-gradient(135deg,#7c3aed,#a855f7)", color: "#fff", cursor: loading ? "default" : "pointer", fontSize: 12, fontWeight: 800, fontFamily: "inherit", opacity: loading ? 0.7 : 1 }}>
            {loading ? "🔄 로그인 대기 중..." : "🔗 재연결"}
          </button>
        </div>
      )}
    </div>
  );
}
