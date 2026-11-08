/** OS-level isolation for workers. Implementations: Seatbelt (macOS), bubblewrap (Linux), restricted user + WFP (Windows). */
export interface IsolationBackend {
  readonly name: string;
  /** Must throw if isolation cannot be established. Never silently degrade. */
  assertAvailable(): Promise<void>;
}

/** Default: refuses to run effectful exec workers. A failed sandbox must never fall back to the host. */
export class RefusingBackend implements IsolationBackend {
  readonly name = 'none';
  async assertAvailable(): Promise<void> {
    throw new Error('isolation: no sandbox backend configured; refusing to run (no silent fallback)');
  }
}
