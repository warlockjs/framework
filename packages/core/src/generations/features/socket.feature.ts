import { socketConfigStub } from "../stubs";
import { FeatureDefinition } from "./types";

export const socketFeature: FeatureDefinition = {
  description: "Installs socket.io for the realtime socket server (Socket Connector)",
  dependencies: {
    "socket.io": "^4.8.3",
  },
  ejectConfig: {
    content: socketConfigStub,
    name: "socket",
  },
};
