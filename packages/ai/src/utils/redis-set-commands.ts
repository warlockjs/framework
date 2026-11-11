/**
 * The Redis set commands a store uses to keep an id index as a native
 * Redis set (`SADD` / `SREM` / `SMEMBERS`), normalized across client
 * spellings.
 */
export type RedisSetCommands = {
  /** Add one member to the set at `key`. */
  add(key: string, member: string): Promise<void>;
  /** Add several members to the set at `key`. No-op for an empty list. */
  addMany(key: string, members: string[]): Promise<void>;
  /** Remove one member from the set at `key`. */
  remove(key: string, member: string): Promise<void>;
  /** Read every member of the set at `key` (an empty list when absent). */
  members(key: string): Promise<string[]>;
};

/** Loose callable view used to probe a client for a command method. */
type CommandFn = (...args: unknown[]) => Promise<unknown>;

/**
 * Return the client's own method named `name`, bound to the client, or
 * `undefined` when the client does not expose it.
 */
function method(client: object, name: string): CommandFn | undefined {
  const candidate = (client as Record<string, unknown>)[name];

  if (typeof candidate !== "function") {
    return undefined;
  }

  return (candidate as CommandFn).bind(client);
}

/**
 * Coerce a `SMEMBERS` reply into a list of strings. Clients return an
 * array of strings (or buffers); anything else is treated as empty.
 */
function toMembers(reply: unknown): string[] {
  if (!Array.isArray(reply)) {
    return [];
  }

  return reply.map((member) => String(member));
}

/**
 * Detect the set commands on a dev-supplied Redis client. Supports the
 * camel-case spelling (`sAdd(key, members)` / `sRem` / `sMembers`) and the
 * lower-case variadic spelling (`sadd(key, ...members)` / `srem` /
 * `smembers`). Returns `undefined` when the client has neither, so the
 * caller keeps its JSON-document index for minimal `get`/`set`/`del`
 * clients.
 */
export function redisSetCommands(client: object): RedisSetCommands | undefined {
  const camelAdd = method(client, "sAdd");
  const camelRemove = method(client, "sRem");
  const camelMembers = method(client, "sMembers");

  if (camelAdd && camelRemove && camelMembers) {
    return {
      add: async (key, member) => {
        await camelAdd(key, member);
      },
      addMany: async (key, members) => {
        if (members.length > 0) {
          await camelAdd(key, members);
        }
      },
      remove: async (key, member) => {
        await camelRemove(key, member);
      },
      members: async (key) => toMembers(await camelMembers(key)),
    };
  }

  const lowerAdd = method(client, "sadd");
  const lowerRemove = method(client, "srem");
  const lowerMembers = method(client, "smembers");

  if (lowerAdd && lowerRemove && lowerMembers) {
    return {
      add: async (key, member) => {
        await lowerAdd(key, member);
      },
      addMany: async (key, members) => {
        if (members.length > 0) {
          await lowerAdd(key, ...members);
        }
      },
      remove: async (key, member) => {
        await lowerRemove(key, member);
      },
      members: async (key) => toMembers(await lowerMembers(key)),
    };
  }

  return undefined;
}
