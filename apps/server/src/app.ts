/**
 * SelfImpulse — harness.
 *
 * The one place the app's runtime state is assembled: two governed Spaces, their threads, their
 * approval desks, and a read model the UI can render without inferring anything.
 */
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { ApprovalDesk } from './approvals.ts';
import { bootSpace, type GovernedSpace } from './boot.ts';
import { SPACE_IDS, SPACES, type SpaceConfig, type SpaceId } from './spaces.ts';
import { Thread } from './thread.ts';
import { TurnRunner } from './turns.ts';

export interface HarnessOptions {
  readonly dataRoot: string;
  readonly now?: () => number;
}

export type SpaceSnapshot = {
  readonly space: SpaceId;
  readonly label: string;
  readonly note: string;
  readonly policyCeiling: SpaceConfig['policyCeiling'];
  readonly dial: number;
  readonly thread: ReturnType<Thread['list']>;
  readonly head: number;
  readonly pending: ReturnType<ApprovalDesk['pending']>;
  readonly ledger: {
    readonly seq: number;
    readonly head: string | null;
    readonly chainOk: boolean;
    readonly heads: number;
  };
  readonly workspace: { readonly files: readonly string[] };
};

export class Harness {
  private constructor(
    readonly spaces: Readonly<Record<SpaceId, GovernedSpace>>,
    readonly threads: Readonly<Record<SpaceId, Thread>>,
    readonly runners: Readonly<Record<SpaceId, TurnRunner>>,
  ) {}

  static async boot(opts: HarnessOptions): Promise<Harness> {
    const spaces = {} as Record<SpaceId, GovernedSpace>;
    const threads = {} as Record<SpaceId, Thread>;
    const runners = {} as Record<SpaceId, TurnRunner>;
    for (const id of SPACE_IDS) {
      const space = await bootSpace(id, opts);
      const thread = new Thread(join(opts.dataRoot, id, 'thread.jsonl'), opts.now);
      spaces[id] = space;
      threads[id] = thread;
      runners[id] = new TurnRunner(space, thread, new ApprovalDesk(), opts.now);
    }
    return new Harness(spaces, threads, runners);
  }

  thread(space: SpaceId): Thread {
    return this.threads[space];
  }

  runner(space: SpaceId): TurnRunner {
    return this.runners[space];
  }

  /** Real workspace listing for the Files dock. Relative paths, bounded, no recursion into dotfiles. */
  async files(space: SpaceId): Promise<string[]> {
    const root = this.spaces[space].liveRoot;
    try {
      const entries = await readdir(root, { recursive: true, withFileTypes: true });
      return entries
        .filter((entry) => entry.isFile())
        .map((entry) => join(entry.parentPath ?? '', entry.name).replace(`${root}/`, ''))
        .filter((path) => !path.split('/').some((part) => part.startsWith('.')))
        .sort()
        .slice(0, 200);
    } catch {
      return [];
    }
  }

  async snapshot(space: SpaceId, since = 0): Promise<SpaceSnapshot> {
    const governed = this.spaces[space];
    const thread = this.threads[space];
    const last = governed.ledger.events().at(-1);
    const chain = governed.ledger.verifyChain();
    return {
      space,
      label: governed.config.label,
      note: governed.config.note,
      policyCeiling: governed.config.policyCeiling,
      dial: governed.config.dial,
      thread: thread.list(since),
      head: thread.head,
      pending: this.runners[space].approvals.pending(),
      ledger: {
        seq: last?.seq ?? 0,
        head: last?.hash ?? null,
        chainOk: chain.ok,
        heads: governed.ledger.heads().length,
      },
      workspace: { files: await this.files(space) },
    };
  }

  close(): void {
    for (const id of SPACE_IDS) this.spaces[id].ledger.close();
  }
}

export { SPACES, SPACE_IDS };
export type { SpaceId };
