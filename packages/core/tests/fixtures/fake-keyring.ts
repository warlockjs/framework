/** Matches @napi-rs/keyring 2.1.1 without loading a native addon or touching the OS. */
export function fakeKeyring() {
  const state = {
    values: new Map<string, string>(),
    options: [] as { linux: { store: "secret-service" } }[],
    calls: [] as string[],
    unavailable: false,
    writeFailure: false,
    deleteFailure: false,
  };
  const key = (service: string, username: string) => JSON.stringify([service, username]);
  class AsyncEntry {
    public constructor(
      private readonly service: string,
      private readonly username: string,
      options: { linux: { store: "secret-service" } },
    ) {
      state.options.push(options);
    }
    public async getPassword(): Promise<string | null> {
      state.calls.push("get");
      if (state.unavailable) throw new Error("vendor failure with sensitive details");
      return state.values.get(key(this.service, this.username)) ?? null;
    }
    public async setPassword(value: string): Promise<void> {
      state.calls.push("set");
      if (state.writeFailure) throw new Error(`vendor rejected ${value}`);
      state.values.set(key(this.service, this.username), value);
    }
    public async deletePassword(): Promise<boolean> {
      state.calls.push("remove");
      if (state.deleteFailure) throw new Error("vendor deletion rejected");
      return state.values.delete(key(this.service, this.username));
    }
  }
  return { state, module: { AsyncEntry }, key };
}
