import { appSingleton } from "../app-singleton";

let created = 0;

export const moduleCopyId = Math.random();

export function getFixtureRuntime() {
  return appSingleton("spec.fixture.runtime.v1", () => ({ id: ++created, owner: moduleCopyId }));
}

export const fixtureCreations = () => created;
