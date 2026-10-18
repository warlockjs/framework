import { MemorySecretBackend } from "../../secrets/memory-backend";
import { replaceSecretsBackend, secrets } from "../../secrets/secrets";
import { FakeAssertionError } from "./fake-assertion-error";

let backend: MemorySecretBackend | undefined;
let restore: (() => void) | undefined;

function installed(): MemorySecretBackend {
  if (!backend) throw new FakeAssertionError("secretsFake is not installed.");
  return backend;
}

/** The default test-kit secret backend. Assertion failures never reveal stored values. */
export const secretsFake = {
  install(): void {
    if (backend) {
      backend.clear();
      return;
    }
    backend = new MemorySecretBackend();
    restore = replaceSecretsBackend(backend);
  },
  restore(): void {
    restore?.();
    restore = undefined;
    backend?.clear();
    backend = undefined;
  },
  isInstalled(): boolean {
    return backend !== undefined;
  },
  clear(): void {
    installed().clear();
  },
  async assertHas(name: string): Promise<void> {
    installed();
    if (!(await secrets.has(name))) {
      throw new FakeAssertionError("Expected the secret to be present.");
    }
  },
  async assertMissing(name: string): Promise<void> {
    installed();
    if (await secrets.has(name)) {
      throw new FakeAssertionError("Expected the secret to be absent.");
    }
  },
  async assertStored(name: string, value: string): Promise<void> {
    installed();
    if ((await secrets.get(name)) !== value) {
      throw new FakeAssertionError("The stored secret does not match the expected value.");
    }
  },
};
