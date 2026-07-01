import { describe, expect, it } from "vitest";
import type { RealtimeEvent } from "../contracts/realtime.contract";
import { MockRealtimeTransport } from "../mock";
import { realtime } from "./realtime";

describe("ai.realtime", () => {
  it("connects through the transport with the session config", async () => {
    const transport = new MockRealtimeTransport();
    await realtime({ transport, model: "gpt-realtime", voice: "alloy", instructions: "Be brief." });

    expect(transport.connectConfigs[0]).toEqual({
      model: "gpt-realtime",
      voice: "alloy",
      instructions: "Be brief.",
    });
  });

  it("forwards audio + text sends to the connection", async () => {
    const transport = new MockRealtimeTransport();
    const session = await realtime({ transport, model: "gpt-realtime" });

    session.sendAudio("QUJD", "audio/pcm");
    session.sendText("hello");

    expect(transport.lastConnection?.sentAudio).toEqual([{ base64: "QUJD", mediaType: "audio/pcm" }]);
    expect(transport.lastConnection?.sentText).toEqual(["hello"]);
  });

  it("streams the duplex events back", async () => {
    const events: RealtimeEvent[] = [
      { type: "transcript", role: "assistant", text: "hi there", final: true },
      { type: "audio", base64: "QUJD", mediaType: "audio/pcm" },
      { type: "done" },
    ];
    const transport = new MockRealtimeTransport(events);
    const session = await realtime({ transport, model: "gpt-realtime" });

    const received: string[] = [];
    for await (const event of session.events()) received.push(event.type);

    expect(received).toEqual(["transcript", "audio", "done"]);
  });

  it("closes the connection and returns a realtime report", async () => {
    const transport = new MockRealtimeTransport();
    const session = await realtime({ transport, model: "gpt-realtime", sessionId: "call-1" });

    const report = await session.close();

    expect(transport.lastConnection?.closed).toBe(true);
    expect(report.type).toBe("realtime");
    expect(report.status).toBe("completed");
    expect(report.runId.startsWith("realtime_")).toBe(true);
    expect(report.sessionId).toBe("call-1");
  });

  it("close() is idempotent", async () => {
    const transport = new MockRealtimeTransport();
    const session = await realtime({ transport, model: "gpt-realtime" });

    const first = await session.close();
    const second = await session.close();

    expect(second).toBe(first);
  });
});
