/** Wire shapes verified against the official protocol viewer and its source JSON:
 * https://chromedevtools.github.io/devtools-protocol/
 * https://github.com/ChromeDevTools/devtools-protocol/tree/master/json
 * Only the fields consumed by this harness are modeled here.
 */
type RemoteObject = { value?: unknown; description?: string };
type ExceptionDetails = { text: string; exception?: RemoteObject };
export type CdpMethods = {
  // https://chromedevtools.github.io/devtools-protocol/tot/Runtime/#method-enable
  "Runtime.enable": { params: Record<string, never>; result: Record<string, never> };
  // https://chromedevtools.github.io/devtools-protocol/tot/Runtime/#method-evaluate
  "Runtime.evaluate": {
    params: { expression: string; returnByValue: boolean; awaitPromise: boolean; silent: boolean };
    result: { result: RemoteObject; exceptionDetails?: ExceptionDetails };
  };
  // https://chromedevtools.github.io/devtools-protocol/tot/Page/#method-enable
  "Page.enable": { params: Record<string, never>; result: Record<string, never> };
  // https://chromedevtools.github.io/devtools-protocol/tot/Page/#method-navigate
  "Page.navigate": {
    params: { url: string };
    result: { frameId: string; loaderId?: string; errorText?: string };
  };
  // https://chromedevtools.github.io/devtools-protocol/tot/Page/#method-captureScreenshot
  "Page.captureScreenshot": { params: { format: "png" }; result: { data: string } };
  // https://chromedevtools.github.io/devtools-protocol/tot/Emulation/#method-setDeviceMetricsOverride
  "Emulation.setDeviceMetricsOverride": {
    params: { width: number; height: number; deviceScaleFactor: number; mobile: boolean };
    result: Record<string, never>;
  };
  // https://chromedevtools.github.io/devtools-protocol/tot/Input/#method-dispatchMouseEvent
  "Input.dispatchMouseEvent": {
    params: {
      type: "mouseMoved" | "mousePressed" | "mouseReleased";
      x: number;
      y: number;
      button?: "left";
      buttons?: number;
      clickCount?: number;
    };
    result: Record<string, never>;
  };
  // https://chromedevtools.github.io/devtools-protocol/tot/Input/#method-insertText
  "Input.insertText": { params: { text: string }; result: Record<string, never> };
  // https://chromedevtools.github.io/devtools-protocol/tot/Input/#method-dispatchKeyEvent
  "Input.dispatchKeyEvent": {
    params: { type: "keyDown" | "keyUp"; key: string; code: string; windowsVirtualKeyCode: number };
    result: Record<string, never>;
  };
  // https://chromedevtools.github.io/devtools-protocol/tot/Network/#method-enable
  "Network.enable": { params: Record<string, never>; result: Record<string, never> };
  // https://chromedevtools.github.io/devtools-protocol/tot/Log/#method-enable
  "Log.enable": { params: Record<string, never>; result: Record<string, never> };
};
export type CdpEvents = {
  // https://chromedevtools.github.io/devtools-protocol/tot/Page/#event-loadEventFired
  "Page.loadEventFired": { timestamp: number };
  // https://chromedevtools.github.io/devtools-protocol/tot/Runtime/#event-consoleAPICalled
  "Runtime.consoleAPICalled": { type: string; args: RemoteObject[] };
  // https://chromedevtools.github.io/devtools-protocol/tot/Runtime/#event-exceptionThrown
  "Runtime.exceptionThrown": { exceptionDetails: ExceptionDetails };
  // https://chromedevtools.github.io/devtools-protocol/tot/Log/#event-entryAdded
  "Log.entryAdded": { entry: { level: string; text: string } };
  // https://chromedevtools.github.io/devtools-protocol/tot/Network/#event-requestWillBeSent
  "Network.requestWillBeSent": { requestId: string; request: { url: string } };
  // https://chromedevtools.github.io/devtools-protocol/tot/Network/#event-responseReceived
  "Network.responseReceived": { requestId: string; response: { url: string; status: number } };
  // https://chromedevtools.github.io/devtools-protocol/tot/Network/#event-loadingFailed
  "Network.loadingFailed": { requestId: string; errorText: string; canceled?: boolean };
  // https://chromedevtools.github.io/devtools-protocol/tot/Network/#event-loadingFinished
  "Network.loadingFinished": { requestId: string };
};
type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

/** A command got no reply within its budget. Retry loops that shrink their budget use this type to tell a timeout apart from a reply that failed. */
export class CdpTimeoutError extends Error {
  constructor(timeoutMs: number, method: string) {
    super(`CDP timeout after ${timeoutMs}ms: ${method}`);
    this.name = "CdpTimeoutError";
  }
}

export class CdpConnection {
  private sequence = 0;
  private pending = new Map<number, Pending>();
  private listeners = new Map<string, Set<(params: unknown) => void>>();
  private closed = false;

  private constructor(private socket: WebSocket) {
    socket.addEventListener("message", ({ data }) => {
      try {
        const message = JSON.parse(String(data)) as {
          id?: number;
          method?: string;
          params?: unknown;
          result?: unknown;
          error?: { message: string };
        };
        if (typeof message.id === "number") {
          const pending = this.pending.get(message.id);
          if (!pending) return;
          clearTimeout(pending.timer);
          this.pending.delete(message.id);
          if (message.error) pending.reject(new Error(`CDP: ${message.error.message}`));
          else pending.resolve(message.result);
        } else if (message.method) {
          for (const listener of this.listeners.get(message.method) ?? []) listener(message.params);
        }
      } catch (error) {
        this.fail(new Error(`Invalid CDP message: ${String(error)}`));
      }
    });
    socket.addEventListener("close", () => this.fail(new Error("CDP connection closed")));
    socket.addEventListener("error", () => this.fail(new Error("CDP WebSocket error")));
  }

  static async connect(url: string, timeoutMs = 10_000): Promise<CdpConnection> {
    // Stable since Node 22.4, present in the minimum supported Node 22.15.
    // https://nodejs.org/download/release/v22.15.0/docs/api/globals.html#websocket
    if (typeof WebSocket !== "function")
      throw new Error(
        "Browser e2e requires Node's global WebSocket (Node >=22.15, without --no-experimental-websocket)",
      );
    const socket = new WebSocket(url);
    const connection = new CdpConnection(socket);
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        socket.removeEventListener("open", opened);
        socket.removeEventListener("error", failed);
        socket.removeEventListener("close", failed);
      };
      const opened = () => {
        cleanup();
        resolve();
      };
      const failed = () => {
        cleanup();
        socket.close();
        reject(new Error(`Cannot connect to owned browser CDP endpoint ${url}`));
      };
      const timer = setTimeout(failed, timeoutMs);
      socket.addEventListener("open", opened, { once: true });
      socket.addEventListener("error", failed, { once: true });
      socket.addEventListener("close", failed, { once: true });
    });
    return connection;
  }

  command<K extends keyof CdpMethods>(
    method: K,
    params: CdpMethods[K]["params"],
    timeoutMs = 10_000,
  ): Promise<CdpMethods[K]["result"]> {
    if (this.closed) return Promise.reject(new Error(`CDP closed before ${method}`));
    return new Promise<CdpMethods[K]["result"]>((resolve, reject) => {
      const id = ++this.sequence;
      const timer = setTimeout(
        () => {
          this.pending.delete(id);
          reject(new CdpTimeoutError(timeoutMs, method));
        },
        Math.max(1, timeoutMs),
      );
      this.pending.set(id, {
        resolve: (value) => resolve(value as CdpMethods[K]["result"]),
        reject,
        timer,
      });
      try {
        this.socket.send(JSON.stringify({ id, method, params }));
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  on<K extends keyof CdpEvents>(method: K, listener: (params: CdpEvents[K]) => void): () => void {
    const wrapped = (params: unknown) => listener(params as CdpEvents[K]);
    const listeners = this.listeners.get(method) ?? new Set();
    listeners.add(wrapped);
    this.listeners.set(method, listeners);
    return () => {
      listeners.delete(wrapped);
    };
  }

  private fail(error: Error): void {
    this.closed = true;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  close(): void {
    this.fail(new Error("CDP connection closed by harness"));
    this.listeners.clear();
    this.socket.close();
  }
}
