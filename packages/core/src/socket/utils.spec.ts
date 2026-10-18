import { Server } from "socket.io";
import { afterEach, describe, expect, it, vi } from "vitest";
import { container } from "../container";
import { broadcastSocketEvent } from "./utils";

afterEach(() => vi.restoreAllMocks());

describe("broadcastSocketEvent", () => {
  it("returns false without a socket connector", () => {
    vi.spyOn(container, "tryGet").mockReturnValue(undefined);
    expect(broadcastSocketEvent("updated", { tags: ["products"] })).toBe(false);
  });

  it("uses the namespace adapter's broadcast path without a local-only flag", () => {
    // No attach/listen: this Server does not bind a port.
    const io = new Server();
    const broadcast = vi.spyOn(io.of("/").adapter, "broadcast");
    vi.spyOn(container, "tryGet").mockReturnValue(io);

    expect(broadcastSocketEvent("updated", { tags: ["products"] })).toBe(true);
    expect(broadcast).toHaveBeenCalledWith(
      expect.objectContaining({ data: ["updated", { tags: ["products"] }] }),
      expect.objectContaining({ flags: expect.not.objectContaining({ local: true }) }),
    );
  });
});
