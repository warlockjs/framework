import type { Usage } from "@warlock.js/ai";
import type {
  RealtimeConnectConfig,
  RealtimeConnection,
  RealtimeEvent,
  RealtimeTransport,
} from "../contracts/realtime.contract";
import type {
  GeneratedVideo,
  VideoGenerationResponse,
  VideoModelContract,
  VideoModelPricing,
  VideoOptions,
} from "../contracts/video.contract";

/** One scripted response for a {@link MockVideoModel}. */
export type MockVideoResponse = {
  video?: GeneratedVideo;
  usage?: Usage;
  durationSeconds?: number;
  error?: Error;
};

/** Deterministic {@link VideoModelContract} double for tests — no HTTP, no polling. */
export class MockVideoModel implements VideoModelContract {
  public readonly provider = "mock";
  public readonly calls: { prompt: string; options: VideoOptions | undefined }[] = [];

  private callIndex = 0;

  public constructor(
    public readonly name: string,
    private readonly responses: MockVideoResponse[],
    public readonly pricing?: VideoModelPricing,
  ) {}

  public async generate(
    prompt: string,
    options?: VideoOptions,
  ): Promise<VideoGenerationResponse> {
    this.calls.push({ prompt, options });

    const response = this.responses[Math.min(this.callIndex, this.responses.length - 1)] ?? {};
    this.callIndex += 1;

    if (response.error) {
      throw response.error;
    }

    return {
      video: response.video ?? { type: "url", url: "https://mock/video.mp4", mediaType: "video/mp4" },
      usage: response.usage ?? { input: 0, output: 0, total: 0 },
      durationSeconds: response.durationSeconds ?? options?.durationSeconds ?? 5,
    };
  }
}

/** A recording {@link RealtimeConnection} the mock transport hands back. */
export class MockRealtimeConnection implements RealtimeConnection {
  public readonly sentAudio: { base64: string; mediaType: string }[] = [];
  public readonly sentText: string[] = [];
  public closed = false;

  public constructor(private readonly scripted: RealtimeEvent[]) {}

  public sendAudio(base64: string, mediaType: string): void {
    this.sentAudio.push({ base64, mediaType });
  }

  public sendText(text: string): void {
    this.sentText.push(text);
  }

  public async *events(): AsyncIterable<RealtimeEvent> {
    for (const event of this.scripted) {
      yield event;
    }
  }

  public async close(): Promise<void> {
    this.closed = true;
  }
}

/** Deterministic {@link RealtimeTransport} double — scripts the event stream, records sends. */
export class MockRealtimeTransport implements RealtimeTransport {
  public readonly connectConfigs: RealtimeConnectConfig[] = [];
  public lastConnection?: MockRealtimeConnection;

  public constructor(private readonly scriptedEvents: RealtimeEvent[] = []) {}

  public async connect(config: RealtimeConnectConfig): Promise<RealtimeConnection> {
    this.connectConfigs.push(config);
    this.lastConnection = new MockRealtimeConnection(this.scriptedEvents);
    return this.lastConnection;
  }
}
