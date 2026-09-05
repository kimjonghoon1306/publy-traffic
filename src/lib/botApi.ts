let tokenPromise: Promise<string> | null = null;

async function getBotToken(): Promise<string> {
  if (!window.electron?.getBotSecret) return "";
  tokenPromise ||= window.electron.getBotSecret().catch(() => "");
  const t = await tokenPromise;
  // 빈 토큰은 캐시하지 않는다 — 새로고침·프리로드 타이밍으로 한 번 "" 나면 그 세션 내내 401 나던 버그 방어(다음 호출 때 재시도).
  if (!t) tokenPromise = null;
  return t;
}

export async function botFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const token = await getBotToken();
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return fetch(input, { ...init, headers });
}

// Native EventSource cannot attach Authorization headers, so local-bot SSE uses fetch streaming.
export class BotEventStream {
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onerror: ((detail?: string) => void) | null = null;   // 실패 이유(HTTP 401/403 + 봇 메시지)를 전달 → UI가 정확히 안내
  onclose: (() => void) | null = null;   // 스트림이 어떤 식으로든 끝나면 호출(버튼 잠금 해제용)
  lastError = "";                        // 마지막 실패 상세(디버깅용)
  private controller = new AbortController();

  constructor(url: string, init?: RequestInit) {
    void this.connect(url, init);
  }

  private async connect(url: string, init?: RequestInit) {
    try {
      const response = await botFetch(url, {
        signal: this.controller.signal,
        method: init?.method,
        body: init?.body,
        headers: { Accept: "text/event-stream", ...(init?.headers as Record<string,string> || {}) },
      });
      if (!response.ok || !response.body) {
        // 봇이 401(토큰)·403(라이선스/미승인) 등에서 JSON {error}를 준다 → 실제 상태와 메시지를 잡아 UI에 정확히 알린다.
        let msg = "";
        try { const j = await response.clone().json(); msg = j?.error || ""; } catch {}
        const reason = response.status === 401 ? "봇 인증 실패(앱을 완전히 껐다 켜주세요)"
          : response.status === 403 ? (msg || "승인/만료 문제")
          : `HTTP ${response.status}${msg ? " · " + msg : ""}`;
        this.lastError = `HTTP ${response.status}${msg ? " · " + msg : ""}`;
        throw new Error(reason);
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (!this.controller.signal.aborted) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split(/\r?\n\r?\n/);
        buffer = chunks.pop() || "";
        for (const chunk of chunks) {
          const data = chunk.split(/\r?\n/).filter(line => line.startsWith("data:"))
            .map(line => line.slice(5).trimStart()).join("\n");
          if (data) this.onmessage?.(new MessageEvent("message", { data }));
        }
      }
    } catch (error) {
      const detail = this.lastError || (error instanceof Error ? error.message : "");
      if (!this.controller.signal.aborted) this.onerror?.(detail);
    } finally {
      if (!this.controller.signal.aborted) this.onclose?.();
    }
  }

  close() { this.controller.abort(); }
}
