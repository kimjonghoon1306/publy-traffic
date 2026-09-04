import React, { useState, useEffect } from "react";
import LoginPage from "./pages/LoginPage";
import AdminLoginPage from "./pages/AdminLoginPage";
import AdminPageRaw from "./pages/AdminPage";
const AdminPage = AdminPageRaw as React.ComponentType<any>;
import DashboardPage from "./pages/DashboardPage";
import TrafficApp from "./TrafficApp";
import { PublyUser, refreshUserById, touchLastSeen, logoutServerSession, verifyAdminSession, clearAdminSession, getMemberSessionToken, isThisDeviceActive } from "./lib/supabase";

type View = "login" | "admin-login" | "admin" | "dashboard";

declare global {
  interface Window {
    electron?: {
      getBotStatus: () => Promise<string>;
      getBotSecret: () => Promise<string>;
      registerUser: (userId: string) => Promise<boolean>;
      unregisterUser: (userId: string) => Promise<boolean>;
      openPreview: (html: string) => Promise<void>;
      saveReportPdf: (html: string, filename: string) => Promise<{ ok: boolean; canceled?: boolean; path?: string; error?: string }>;
      flowLaunchChrome: () => Promise<{ ok: boolean; already?: boolean; launched?: boolean; error?: string }>;
      flowStatus: () => Promise<{ ready: boolean }>;
      checkAppUpdate: () => Promise<{ available: boolean; currentVersion?: string; latestVersion?: string; url?: string }>;
      openAppUpdate: (url: string) => Promise<boolean>;
      openLogFolder: () => Promise<boolean>;
      readBotLog: () => Promise<string>;
      getAppVersion: () => Promise<string>;
      keepAwake: (on: boolean) => Promise<{ ok: boolean; active?: boolean; error?: string }>;
    };
  }
}

// 앱 내 업데이트 배너 제거 — 다운로드는 웹사이트(publy.blogautopro.com)에서만.

export default function App() {
  const [view, setView]   = useState<View>("login");
  const [user, setUser]   = useState<PublyUser | null>(null);
  const [theme, setTheme] = useState<"dark"|"light">(() =>
    (localStorage.getItem("publy_theme") as any) || "dark"
  );
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    const restore = async () => {
      let nextView: View = "login";
      let nextUser: PublyUser | null = null;
      const saved = localStorage.getItem("publy_user");
      if (saved) {
        try {
          const cached = JSON.parse(saved) as PublyUser;
          const hasServerSession = !!getMemberSessionToken();
          const fresh = await refreshUserById(cached.id);
          nextUser = fresh || (hasServerSession ? null : cached);
          if (nextUser) {
            nextView = "dashboard";
            localStorage.setItem("publy_user", JSON.stringify(nextUser));
            window.electron?.registerUser(nextUser.id);
          } else {
            localStorage.removeItem("publy_user");
          }
        } catch { localStorage.removeItem("publy_user"); }
      }
      if (await verifyAdminSession()) nextView = "admin";
      else sessionStorage.removeItem("publy_admin_auth");
      if (!alive) return;
      setUser(nextUser); setView(nextView); setLoading(false);
    };
    void restore();
    return () => { alive = false; };
  }, []);

  // ★회원 등급/활성 실시간 반영(테리 요청): 관리자가 등급을 바꾸면(무제한 등) 회원 앱이
  //   로그아웃 없이도 최신 등급을 반영한다. ①로그인 상태면 즉시 1회 최신화 ②20초마다 갱신.
  //   등급이 실제로 바뀐 경우에만 setUser(리렌더 최소화). localStorage도 함께 갱신해 새로고침에도 유지.
  useEffect(() => {
    if (!user?.id) return;
    let alive = true;
    const sync = async () => {
      try {
        void touchLastSeen(user.id);   // 마지막 접속 시각 갱신(관리자 확인용)
        const fresh = await refreshUserById(user.id);
        if (!alive) return;
        if (!fresh) { if (getMemberSessionToken()) handleLogout(); return; }
        // 비활성 처리되면 로그아웃
        if ((fresh as any).is_active === false) { handleLogout(); return; }
        // 🔒 다른 컴퓨터에서 로그인되면 이 기기는 자동 로그아웃(관리자·멀티허용 회원 제외)
        const deviceOk = await isThisDeviceActive(user.id, (fresh as any).email || (user as any).email);
        if (!alive) return;
        if (!deviceOk) { alert("다른 컴퓨터에서 로그인되어 이 기기는 로그아웃됩니다."); handleLogout(); return; }
        // ★관리자가 바꾼 회원 값(등급·활성·크롤링 권한 등)이 회원 앱에 반영되게 — crawl_enabled도 확인해야 잠금해제가 실제로 풀린다.
        //   (예전엔 plan/is_active만 봐서, 관리자가 크롤링 풀어줘도 회원 앱은 캐시된 잠김 상태 그대로였음)
        const changed = fresh.plan !== user.plan
          || (fresh as any).is_active !== (user as any).is_active
          || (fresh as any).crawl_enabled !== (user as any).crawl_enabled;
        if (changed) {
          localStorage.setItem("publy_user", JSON.stringify(fresh));
          setUser(fresh);
        }
      } catch {}
    };
    void sync();
    const iv = window.setInterval(sync, 20000);
    return () => { alive = false; window.clearInterval(iv); };
  }, [user?.id, user?.plan]);

  useEffect(() => { localStorage.setItem("publy_theme", theme); }, [theme]);

  function toggleTheme() { setTheme(t => t === "dark" ? "light" : "dark"); }

  function handleLogin(u: PublyUser) {
    // ★같은 PC에서 '다른 회원'이 로그인하면 이전 회원의 개인 작업 흔적을 싹 비운다(캐시 잔재로 남 데이터 보이는 버그 방지).
    //   지우는 대상 = 키워드·제목·원터치 로그/설정·예약·인사말·링크 등 '작업 데이터'. (계정 연결/API키 등 기기 공용 설정은 유지)
    try {
      const lastUid = localStorage.getItem("publy_last_uid") || "";
      if (lastUid && lastUid !== u.id) {
        const prefixes = ["publy_kws","publy_titles","publy_ot_","publy_greeting","publy_onpartner","publy_mylinks","publy_republish","publy_sa_","publy_calendar","publy_content_calendar"];
        const toRemove: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && prefixes.some(p => k.startsWith(p))) toRemove.push(k);
        }
        toRemove.forEach(k => localStorage.removeItem(k));
      }
      localStorage.setItem("publy_last_uid", u.id);
    } catch {}
    localStorage.setItem("publy_user", JSON.stringify(u));
    setUser(u);
    setView("dashboard");
    // 로그인 시 봇 서버에 유저 등록 → Supabase 폴링 시작
    window.electron?.registerUser(u.id);
  }

  function handleLogout() {
    if (user?.id) void window.electron?.unregisterUser(user.id);
    void logoutServerSession();
    localStorage.removeItem("publy_user");
    setUser(null);
    setView("login");
  }

  function handleAdminAuth() {
    sessionStorage.setItem("publy_admin_auth", "true");
    setView("admin");
  }

  function handleAdminLogout() {
    sessionStorage.removeItem("publy_admin_auth");
    clearAdminSession();
    setView("login");
  }

  if (loading) return (
    <div style={{
      width:"100vw", height:"100vh",
      background: theme==="dark" ? "#0d0a14" : "#f1eef9",
      display:"flex", alignItems:"center", justifyContent:"center",
    }}>
      <div style={{
        width:44, height:44, borderRadius:"50%",
        border:"3px solid rgba(109,40,217,.2)",
        borderTopColor:"#6d28d9",
        animation:"spin 1s linear infinite",
      }}/>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );

  // 트래픽 앱 — 퍼블리 인트로 영상 제거(첫 화면부터 트래픽 로그인). showIntro 미사용.

  if (view==="login") return (
    <LoginPage
      onLogin={handleLogin}
      onAdminLogin={() => setView("admin-login")}
      theme={theme}
      onThemeToggle={toggleTheme}
    />
  );

  if (view==="admin-login") return (
    <AdminLoginPage
      onAdminAuth={handleAdminAuth}
      onBack={() => setView("login")}
      theme={theme}
      onThemeToggle={toggleTheme}
    />
  );

  if (view==="admin") return (
    <AdminPage
      onBack={handleAdminLogout}
      onDashboard={() => { if(user) setView("dashboard"); else setView("login"); }}
      theme={theme}
      onThemeToggle={toggleTheme}
    />
  );

  // 트래픽 앱 = 로그인 후 퍼블리 대시보드 대신 컴팩트 트래픽 화면(TrafficApp)만 렌더.
  //   (DashboardPage는 코드로만 남겨두고 트래픽에선 사용 안 함 — import 유지로 타입 안전)
  if (view==="dashboard" && user) return (
    <TrafficApp
      user={user}
      onLogout={handleLogout}
      onAdminLogin={() => setView("admin-login")}
      theme={theme}
      onThemeToggle={toggleTheme}
    />
  );

  return null;
}
