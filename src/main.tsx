import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
// React 마운트되면 초기 로딩 스피너 제거(검은 화면 방지용 부트 화면)
setTimeout(() => { document.getElementById("boot")?.remove(); }, 0);
