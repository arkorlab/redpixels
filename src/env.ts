import type { Tracker } from "./store.ts";
import type { Settings } from "./types.ts";

export interface Env extends Settings {
  TRACKER: DurableObjectNamespace<Tracker>;
}
