# Publy — 자동발행 앱

네이버/티스토리 자동발행 + Google Flow 이미지 생성

## 설치 및 실행

```bash
# 1. 패키지 설치
npm install

# 2. 개발 모드 실행 (브라우저)
npm run dev

# 3. Electron 앱으로 실행
npm run electron:dev

# 4. 배포용 빌드 (exe/dmg)
npm run electron:build
```

## 폴더 구조

```
publy/
├── src/
│   ├── pages/
│   │   ├── LoginPage.tsx     ← 로그인/회원가입
│   │   └── DashboardPage.tsx ← 메인 대시보드
│   ├── lib/
│   │   └── supabase.ts       ← DB 연동
│   ├── App.tsx
│   └── main.tsx
├── electron/
│   └── main.ts               ← Electron 메인 프로세스
├── index.html
├── package.json
└── vite.config.ts
```

## 기능

- 로그인 / 회원가입 (Supabase)
- 네이버/티스토리 자동발행 (Playwright)
- Google Flow 이미지 자동 생성
- AI 글 생성 (Claude API)
- 발행 쿼터 관리
- 발행 히스토리
- 모바일 최적화

## 환경변수

Supabase URL/KEY는 `src/lib/supabase.ts`에 설정되어 있습니다.
