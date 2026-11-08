/**
 * SelfImpulse — app entry.
 *
 * Wires the workbench to the channel: one snapshot to paint, one stream to stay true, and a theme
 * preference that lives in the renderer. If the channel drops, the UI says so and retries; it never
 * fills the gap with guesses.
 */
import { SIGNATURE } from '@si/voice';
import {
  applyTheme,
  readChoice,
  writeChoice,
  type Mode,
  type SerifId,
  type ThemeId,
} from '../renderer/theme.ts';
import { api, type Snapshot, type ThreadEvent } from './api.ts';
import { Workbench, type SpaceSummary } from './workbench.ts';

const mount = document.getElementById('app');
if (!mount) throw new Error('workbench mount missing');

let choice = readChoice(localStorage);
applyTheme(document.documentElement, choice);

let space = 'co-think';
let disposeStream: (() => void) | null = null;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;
let spaces: SpaceSummary[] = [];
const SETTLED = new Set(['needs-approval', 'completed', 'partially-completed', 'failed', 'drifted', 'cancelled', 'expired']);

const workbench = new Workbench(mount, {
  send: (text) => void send(text),
  decide: (target, id, decision) => void decide(target, id, decision),
  pickSpace: (next) => void load(next),
  pickTheme: (theme) => {
    choice = { ...choice, theme: theme as ThemeId };
    applyTheme(document.documentElement, choice);
    writeChoice(localStorage, choice);
    workbench.setTheme(choice.theme, choice.mode);
  },
  pickSerif: (serif) => {
    choice = { ...choice, serif: serif as SerifId };
    applyTheme(document.documentElement, choice);
    writeChoice(localStorage, choice);
    workbench.setAppearance(choice.serif, choice.highContrast);
  },
  pickContrast: (on) => {
    choice = { ...choice, highContrast: on };
    applyTheme(document.documentElement, choice);
    writeChoice(localStorage, choice);
    workbench.setAppearance(choice.serif, choice.highContrast);
  },
  pickMode: (mode) => {
    choice = { ...choice, mode: mode as Mode };
    applyTheme(document.documentElement, choice);
    writeChoice(localStorage, choice);
    workbench.setTheme(choice.theme, choice.mode);
  },
});

workbench.setTheme(choice.theme, choice.mode);
workbench.setAppearance(choice.serif, choice.highContrast);
workbench.setStatus('connecting');

const scheduleRefresh = (): void => {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => void refresh(), 150);
};

const refresh = async (): Promise<void> => {
  try {
    const snapshot = await api.snapshot(space);
    workbench.update(snapshot, space);
    workbench.setStatus('live');
  } catch {
    workbench.setStatus('offline');
  }
};

const load = async (next: string): Promise<void> => {
  space = next;
  disposeStream?.();
  disposeStream = null;
  workbench.setStatus('connecting');
  let snapshot: Snapshot;
  try {
    snapshot = await api.snapshot(next);
  } catch {
    workbench.setStatus('offline');
    return;
  }
  workbench.setSpaces(spaces, next);
  workbench.update(snapshot, next);
  workbench.setStatus('live');
  disposeStream = api.stream(
    next,
    snapshot.head,
    (event: ThreadEvent) => {
      workbench.push(event, null);
      if (event.type === 'approval' || event.type === 'notice') scheduleRefresh();
      if (event.type === 'state' && SETTLED.has(event.state)) scheduleRefresh();
    },
    () => scheduleRefresh(),
  );
};

const send = async (text: string): Promise<void> => {
  try {
    await api.message(space, text);
  } catch {
    workbench.setStatus('offline');
  }
};

const decide = async (target: string, id: string, decision: 'approve' | 'deny'): Promise<void> => {
  try {
    await api.decide(target, id, decision);
  } finally {
    await refresh();
  }
};

const boot = async (): Promise<void> => {
  try {
    const response = await fetch('/api/spaces');
    spaces = (await response.json()) as SpaceSummary[];
  } catch {
    spaces = [{ id: 'co-think', label: 'Co-think', note: '', policyCeiling: 'confidential', dial: 3 }];
  }
  await load(space);
  console.log(`${SIGNATURE.mark} ${SIGNATURE.tagline}`);
};

void boot();

window.addEventListener('beforeunload', () => {
  disposeStream?.();
});
