import React from "react";

/**
 * PC앱 설치파일 다운로드 링크 — 단일 소스.
 * 릴리스 태그 `latest`에 버전 없는 고정 이름으로 올려두어 매 버전마다 링크가 안 깨지게 함.
 * (CI가 매 릴리스에 아래 고정 이름들로도 함께 업로드)
 */
const REL = "https://github.com/kimjonghoon1306/publy-BAP/releases/latest/download";
export const EXE_DOWNLOAD_URL = `${REL}/Publy-Setup.exe`;
export const MAC_ARM_URL = `${REL}/Publy-Mac-AppleSilicon.dmg`;
export const MAC_INTEL_URL = `${REL}/Publy-Mac-Intel.dmg`;

/** Electron(설치된 앱)이 아니라 웹 브라우저로 접속한 경우에만 true */
export const isWebPreview = () =>
  typeof window !== "undefined" && !(window as any).electron;

/**
 * 웹 접속자에게 "앱 설치"를 안내하는 상단 경고 배너.
 * 윈도우/맥 설치 버튼을 항상 모두 노출(OS 감지로 숨기지 않음 — 어느 기기든 원하는 걸 받게).
 * Electron 앱 안에서는 렌더 안 함. 라이트/다크 어디서나 잘 보이는 앰버 컬러 고정.
 */
export default function WebInstallNotice(_: { theme?: "dark" | "light" }) {
  if (!isWebPreview()) return null;

  const showWin = true;
  const showMac = true;

  return (
    <div className="web-install-notice" role="alert">
      <div className="win-text">
        <span className="win-badge">⚠️ 필독</span>
        <span className="win-msg">
          이 화면은 <b>미리보기</b>예요. 실제 사용은 <b>PC에 앱을 설치</b>해야 합니다.
          <span className="win-sub">윈도우 · 맥 모두 지원 · 본인 PC에 설치해 사용하세요.</span>
        </span>
      </div>
      <div className="win-actions">
        {showWin && (
          <a href={EXE_DOWNLOAD_URL} className="win-dl" download>
            <span className="win-dl-ico">⬇️</span>윈도우용 PC앱 설치
          </a>
        )}
        {showMac && (
          <a href={MAC_ARM_URL} className="win-dl win-dl-mac" download>
            <span className="win-dl-ico">🍎</span>맥용 설치 (Apple 칩)
          </a>
        )}
        {showMac && (
          <a href={MAC_INTEL_URL} className="win-mac-alt" download>
            인텔 맥용
          </a>
        )}
      </div>

      <style>{`
        .web-install-notice{
          flex-shrink:0; box-sizing:border-box; width:100%;
          display:flex; align-items:center; justify-content:center;
          gap:14px; flex-wrap:wrap;
          padding:10px 16px;
          background:linear-gradient(135deg,#ffd54a 0%,#ffb300 100%);
          border-bottom:2px solid rgba(120,72,0,.55);
          box-shadow:0 4px 18px rgba(0,0,0,.22);
          font-family:'Noto Sans KR',sans-serif;
          position:relative; z-index:200;
        }
        .web-install-notice .win-text{
          display:flex; align-items:center; gap:10px; min-width:0; flex:1 1 320px;
        }
        .web-install-notice .win-badge{
          flex-shrink:0; display:inline-flex; align-items:center;
          padding:4px 11px; border-radius:99px;
          background:#1a1200; color:#ffd54a;
          font-size:12px; font-weight:900; letter-spacing:.02em; white-space:nowrap;
        }
        .web-install-notice .win-msg{
          color:#241700; font-size:13.5px; font-weight:700; line-height:1.5; min-width:0;
        }
        .web-install-notice .win-msg b{ color:#000; font-weight:900; }
        .web-install-notice .win-sub{
          display:inline-block; margin-left:6px;
          color:#5a3d00; font-size:12.5px; font-weight:700;
        }
        .web-install-notice .win-actions{
          display:flex; align-items:center; gap:8px; flex-shrink:0; flex-wrap:wrap; justify-content:center;
        }
        .web-install-notice .win-dl{
          display:inline-flex; align-items:center; gap:6px;
          padding:9px 17px; border-radius:99px; border:none;
          background:linear-gradient(135deg,#00ff9d,#00c870); color:#00160c;
          font-size:13px; font-weight:900; text-decoration:none; white-space:nowrap;
          box-shadow:0 3px 12px rgba(0,120,70,.35); cursor:pointer;
          transition:transform .15s ease, box-shadow .15s ease;
        }
        .web-install-notice .win-dl:hover{ transform:translateY(-1px); box-shadow:0 6px 18px rgba(0,120,70,.45); }
        .web-install-notice .win-dl:active{ transform:translateY(0); }
        .web-install-notice .win-dl-ico{ font-size:14px; }
        .web-install-notice .win-dl-mac{
          background:linear-gradient(135deg,#2b2b30,#111114); color:#fff;
          box-shadow:0 3px 12px rgba(0,0,0,.3);
        }
        .web-install-notice .win-dl-mac:hover{ box-shadow:0 6px 18px rgba(0,0,0,.4); }
        .web-install-notice .win-mac-alt{
          display:inline-flex; align-items:center;
          padding:8px 13px; border-radius:99px;
          border:2px solid rgba(26,18,0,.5); background:rgba(255,255,255,.3); color:#1a1200;
          font-size:12px; font-weight:800; text-decoration:none; white-space:nowrap; cursor:pointer;
          transition:background .15s ease;
        }
        .web-install-notice .win-mac-alt:hover{ background:rgba(255,255,255,.55); }
        @media (max-width:640px){
          .web-install-notice{ padding:9px 12px; gap:9px; }
          .web-install-notice .win-msg{ font-size:12.5px; }
          .web-install-notice .win-sub{ display:block; margin-left:0; margin-top:2px; }
          .web-install-notice .win-actions{ width:100%; }
          .web-install-notice .win-dl{ flex:1; justify-content:center; }
        }
        @media (prefers-reduced-motion: reduce){
          .web-install-notice .win-dl, .web-install-notice .win-mac-alt{ transition:none; }
        }
      `}</style>
    </div>
  );
}
