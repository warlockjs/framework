interface FakeKeyringEntry {
  getPassword(): Promise<string | null>;
  setPassword(value: string): Promise<void>;
  deletePassword(): Promise<boolean>;
}

type KeyringOptions = { linux: { store: "secret-service" } };

/** Matches @napi-rs/keyring 2.1.1 without loading a native addon or touching the OS. */
export function fakeKeyring() {
  const state = {
    values: new Map<string, string>(),
    options: [] as KeyringOptions[],
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
      options: KeyringOptions,
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
  const module: {
    AsyncEntry: new (
      service: string,
      username: string,
      options: KeyringOptions,
    ) => FakeKeyringEntry;
  } = { AsyncEntry };
  return { state, module, key };
}
