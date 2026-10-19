import { createHash } from "node:crypto";
import { createServer } from "node:http";
import type { Duplex } from "node:stream";

export type FakeCommand = { id: number; method: string; params: Record<string, unknown> };
type Reply = { result?: unknown; error?: { message: string } };

/** A dependency-free WebSocket endpoint for exercising the native Node client.
 * This is test scaffolding, not the harness transport.
 */
export async function fakeCdp(
  handler: (command: FakeCommand) => Reply | undefined | Promise<Reply | undefined> = () => ({
    result: {},
  }),
) {
  const sockets = new Set<Duplex>();
  const commands: FakeCommand[] = [];
  const send = (socket: Duplex, value: unknown) => {
    const payload = Buffer.from(JSON.stringify(value));
    const header = Buffer.alloc(payload.length < 126 ? 2 : 4);
    header[0] = 0x81;
    header[1] = payload.length < 126 ? payload.length : 126;
    if (payload.length >= 126) header.writeUInt16BE(payload.length, 2);
    socket.write(Buffer.concat([header, payload]));
  };
  const server = createServer((_request, response) => {
    response.writeHead(404);
    response.end();
  });
  server.on("upgrade", (request, socket) => {
    const key = request.headers["sec-websocket-key"];
    if (typeof key !== "string") {
      socket.destroy();
      return;
    }
    const accept = createHash("sha1")
      .update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
      .digest("base64");
    socket.write(
      `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    let buffered = Buffer.alloc(0);
    socket.on("data", (chunk: Buffer) => {
      buffered = Buffer.concat([buffered, chunk]);
      while (buffered.length >= 2) {
        const opcode = buffered[0] & 0x0f;
        const masked = Boolean(buffered[1] & 0x80);
        let length = buffered[1] & 0x7f;
        let offset = 2;
        if (length === 126) {
          if (buffered.length < 4) return;
          length = buffered.readUInt16BE(2);
          offset = 4;
        }
        if (length === 127) {
          if (buffered.length < 10) return;
          length = Number(buffered.readBigUInt64BE(2));
          offset = 10;
        }
        const maskSize = masked ? 4 : 0;
        if (buffered.length < offset + maskSize + length) return;
        const mask = buffered.subarray(offset, offset + maskSize);
        offset += maskSize;
        const payload = Buffer.from(buffered.subarray(offset, offset + length));
        if (masked)
          for (let index = 0; index < payload.length; index++) payload[index] ^= mask[index % 4];
        buffered = buffered.subarray(offset + length);
        if (opcode === 8) {
          socket.end(Buffer.from([0x88, 0]));
          return;
        }
        if (opcode !== 1) continue;
        const command = JSON.parse(payload.toString()) as FakeCommand;
        commands.push(command);
        void Promise.resolve(handler(command)).then((reply) => {
          if (reply && !socket.destroyed) send(socket, { id: command.id, ...reply });
        });
      }
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Fake CDP did not bind a TCP port");
  return {
    url: `ws://127.0.0.1:${address.port}/devtools/page/fake`,
    commands,
    event: (method: string, params: unknown) => {
      for (const socket of sockets) send(socket, { method, params });
    },
    disconnect: () => {
      for (const socket of sockets) socket.destroy();
    },
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}
