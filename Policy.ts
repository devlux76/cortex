export type QueryScope = "broad" | "default" | "narrow";

export interface ProjectionHead {
  dimIn: number;      // D
  dimOut: number;     // e.g. 64, 128
  bits?: number;      // if you also want binary codes, e.g. 128
  offset: number;     // where P_m starts in WASM memory
}

export interface RoutingPolicy {
  broad:  ProjectionHead; // e.g. 64-d + 128-bit codes
  normal: ProjectionHead; // e.g. 128-d
  narrow: ProjectionHead; // e.g. 256-d or full D
}
