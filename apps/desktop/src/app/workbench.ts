/**
 * SelfImpulse — workbench.
 *
 * Placements are UUI's (src/app/shell, src/app/session), repainted with our tokens: a 36px titlebar
 * carrying the tab strip, a 240px sidebar that resizes 136–640, the Thread, a session panel docked at
 * 400px minimum, and a composer region pinned under the timeline. The approval bar docks above the
 * composer when a real signature is pending. Nothing here invents state; the only inputs are the
 * snapshot and the event stream.
 */
import { SIGNATURE } from '@si/voice';
import { THEMES, type Mode, type SerifId, type ThemeId } from '../renderer/theme.ts';
import type { Approval, Snapshot, ThreadEvent } from './api.ts';
import { glyph, icon, toneOf } from './glyphs.ts';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

export type SpaceSummary = { id: string; label: string; note: string; policyCeiling: string; dial: number };
export type Status = 'connecting' | 'live' | 'offline';

export interface WorkbenchHandlers {
  send(text: string): void;
  decide(space: string, id: string, decision: 'approve' | 'deny'): void;
  pickSpace(space: string): void;
  pickTheme(theme: string): void;
  pickMode(mode: string): void;
  pickSerif(serif: string): void;
  pickContrast(on: boolean): void;
}

const DOCK_TABS = ['plan', 'receipts', 'ledger', 'files', 'appearance'] as const;
type DockTab = (typeof DOCK_TABS)[number];

const RAIL_KEY = 'selfimpulse.rail';
const RAIL_MIN = 136;
const RAIL_MAX = 640;
const RAIL_DEFAULT = 240;

/** Sidebar width is a preference, not state: clamped on read, clamped again on write. */
const clampRail = (width: number): number =>
  Number.isFinite(width) ? Math.min(RAIL_MAX, Math.max(RAIL_MIN, Math.round(width))) : RAIL_DEFAULT;

const readRail = (): number => {
  try {
    const raw = localStorage.getItem(RAIL_KEY);
    return raw === null ? RAIL_DEFAULT : clampRail(Number(raw));
  } catch {
    return RAIL_DEFAULT;
  }
};

export class Workbench {
  private readonly railSpaces = el('div', 'rail-list');
  private readonly railSessions = el('div', 'rail-list');
  private readonly threadList = el('div', 'thread');
  private readonly approvalSlot = el('div', 'approval-slot');
  private readonly dockBody = el('div', 'dock-body');
  private readonly dockTabs = el('div', 'seg dock-tabs');
  private readonly tabDot = el('span', 'tab-dot');
  private readonly tabTitle = el('span', 'tab-title', 'Today');
  private readonly mainMeta = el('span', 'main-meta', '');
  private readonly tabState = el('span', 'chip', 'draft');
  private readonly ledgerChip = el('span', 'chip mono', 'ledger');
  private readonly sealChip = el('span', 'chip', 'unsealed');
  private readonly composerInput = document.createElement('textarea');
  private readonly sendButton = el('button', 'send');
  private readonly spaceChip = el('span', 'chip', 'Co-think');
  private readonly statusChip = el('span', 'chip', 'connecting');
  private readonly impulseLine = el('div', 'impulse-line');
  private dialControl: HTMLElement | null = null;
  private dockTab: DockTab = 'plan';
  private lastSeq = 0;
  private latest: Snapshot | null = null;
  private events: ThreadEvent[] = [];
  private busy = false;
  private railWidth = readRail();
  private theme: ThemeId = 'lunar-ash';
  private mode: Mode = 'dark';
  private serif: SerifId = 'source-serif';
  private contrast = false;

  constructor(
    private readonly root: HTMLElement,
    private readonly handlers: WorkbenchHandlers,
  ) {
    this.build();
  }

  private build(): void {
    this.root.replaceChildren();
    this.root.className = 'wb';
    this.root.dataset.rail = 'open';
    this.root.dataset.dock = 'open';
    this.applyRailWidth();

    const top = el('header', 'wb-top');
    const toggle = el('button', 'sb-toggle');
    toggle.type = 'button';
    toggle.setAttribute('aria-pressed', 'true');
    toggle.setAttribute('aria-label', 'Toggle sidebar');
    toggle.innerHTML = icon('sidebar');
    toggle.addEventListener('click', () => this.toggleRail());

    const tab = el('button', 'tab');
    tab.type = 'button';
    tab.setAttribute('aria-selected', 'true');
    tab.append(this.tabDot, this.tabTitle, this.tabState);

    const newTab = el('button', 'tab-new');
    newTab.type = 'button';
    newTab.disabled = true;
    newTab.title = 'One session per Space. Switch Spaces to open another.';
    newTab.setAttribute('aria-label', 'New session');
    newTab.innerHTML = icon('plus');

    const strip = el('div', 'tab-strip');
    strip.append(tab, newTab);
    top.append(toggle, strip, el('span', 'spacer'), this.ledgerChip, this.sealChip, this.statusChip);

    const body = el('div', 'wb-body');

    const rail = el('aside', 'wb-rail');
    const brand = el('div', 'rail-brand');
    brand.append(el('span', 'mark mono', SIGNATURE.mark), el('span', 'brand', SIGNATURE.product));
    const newSession = el('button', 'new-session');
    newSession.type = 'button';
    newSession.innerHTML = icon('plus');
    newSession.append(el('span', '', 'New session'), el('kbd', '', 'mod n'));
    newSession.addEventListener('click', () => this.composerInput.focus());

    const railHead = el('div', 'rail-head');
    railHead.append(brand, newSession);

    const railScroll = el('div', 'rail-scroll');
    const spaces = el('div', 'rail-section');
    spaces.append(el('div', 'rail-label', 'Spaces'), this.railSpaces);
    const sessions = el('div', 'rail-section');
    sessions.append(el('div', 'rail-label', 'Sessions'), this.railSessions);
    railScroll.append(spaces, sessions);

    const railFoot = el('div', 'rail-foot', SIGNATURE.tagline);
    const handle = el('div', 'rail-resize');
    rail.append(railHead, railScroll, railFoot, handle);
    this.mountRailResize(handle);

    const main = el('main', 'wb-main');
    const head = el('div', 'main-head');
    const dockToggle = el('button', 'icon-btn');
    dockToggle.type = 'button';
    dockToggle.setAttribute('aria-pressed', 'true');
    dockToggle.setAttribute('aria-label', 'Toggle session panel');
    dockToggle.innerHTML = icon('panel');
    dockToggle.addEventListener('click', () => this.toggleDock());
    head.append(el('span', 'main-title', 'Today'), this.mainMeta, el('span', 'spacer'), dockToggle);

    const timeline = el('div', 'timeline-wrap');
    timeline.append(this.impulseLine, this.threadList);

    const region = el('div', 'composer-region');
    this.approvalSlot.style.display = 'none';
    region.append(this.approvalSlot, this.composer());

    main.append(head, timeline, region);

    const dock = el('aside', 'wb-dock');
    const dockHead = el('div', 'dock-head');
    for (const tabId of DOCK_TABS) {
      const button = el('button', '', tabId);
      button.type = 'button';
      button.dataset.tab = tabId;
      button.setAttribute('aria-pressed', String(tabId === this.dockTab));
      button.addEventListener('click', () => {
        this.dockTab = tabId;
        this.renderDock();
      });
      this.dockTabs.append(button);
    }
    const dockClose = el('button', 'icon-btn');
    dockClose.type = 'button';
    dockClose.setAttribute('aria-label', 'Hide session panel');
    dockClose.innerHTML = icon('close');
    dockClose.addEventListener('click', () => this.toggleDock());
    dockHead.append(this.dockTabs, dockClose);
    dock.append(dockHead, this.dockBody);

    body.append(rail, main, dock);
    this.root.append(top, body);
    this.setTheme(this.theme, this.mode);
  }

  private applyRailWidth(): void {
    this.root.style.setProperty('--rail-w', `${this.railWidth}px`);
  }

  private toggleRail(): void {
    const open = this.root.dataset.rail !== 'closed';
    this.root.dataset.rail = open ? 'closed' : 'open';
    const toggle = this.root.querySelector<HTMLButtonElement>('.sb-toggle');
    toggle?.setAttribute('aria-pressed', String(!open));
  }

  private toggleDock(): void {
    const open = this.root.dataset.dock !== 'closed';
    this.root.dataset.dock = open ? 'closed' : 'open';
    for (const button of this.root.querySelectorAll<HTMLButtonElement>('[aria-label="Toggle session panel"]')) {
      button.setAttribute('aria-pressed', String(!open));
    }
  }

  /** Drag or arrow keys; clamped, persisted, announced as a separator. */
  private mountRailResize(handle: HTMLElement): void {
    handle.setAttribute('role', 'separator');
    handle.setAttribute('aria-orientation', 'vertical');
    handle.setAttribute('aria-label', 'Resize sidebar');
    handle.setAttribute('aria-valuemin', String(RAIL_MIN));
    handle.setAttribute('aria-valuemax', String(RAIL_MAX));
    handle.setAttribute('aria-valuenow', String(this.railWidth));
    handle.tabIndex = 0;

    const set = (width: number): void => {
      this.railWidth = clampRail(width);
      this.applyRailWidth();
      handle.setAttribute('aria-valuenow', String(this.railWidth));
    };
    const persist = (): void => {
      try {
        localStorage.setItem(RAIL_KEY, String(this.railWidth));
      } catch {
        // A blocked store only costs the preference across reloads; the layout already moved.
      }
    };

    let startX = 0;
    let startWidth = 0;
    let dragging = false;
    handle.addEventListener('pointerdown', (event: PointerEvent) => {
      dragging = true;
      startX = event.clientX;
      startWidth = this.railWidth;
      handle.setPointerCapture(event.pointerId);
      event.preventDefault();
    });
    handle.addEventListener('pointermove', (event: PointerEvent) => {
      if (!dragging) return;
      const rtl = getComputedStyle(document.documentElement).direction === 'rtl';
      set(startWidth + (event.clientX - startX) * (rtl ? -1 : 1));
    });
    handle.addEventListener('pointerup', (event: PointerEvent) => {
      if (!dragging) return;
      dragging = false;
      handle.releasePointerCapture(event.pointerId);
      persist();
    });
    handle.addEventListener('keydown', (event: KeyboardEvent) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      set(this.railWidth + (event.key === 'ArrowRight' ? 16 : -16));
      persist();
    });
  }

  private seg(
    values: readonly string[],
    active: string,
    attr: string,
    onPick: (value: string) => void,
  ): HTMLElement {
    const wrap = el('div', 'seg');
    for (const value of values) {
      const button = el('button', '', value);
      button.type = 'button';
      button.dataset[attr] = value;
      button.setAttribute('aria-pressed', String(value === active));
      button.addEventListener('click', () => onPick(value));
      wrap.append(button);
    }
    return wrap;
  }

  private composer(): HTMLElement {
    const card = el('div', 'composer-card');
    const wrap = el('div', 'composer');
    this.composerInput.placeholder = `Tell ${SIGNATURE.product} what to do. It rehearses first, then asks for your signature.`;
    this.composerInput.rows = 2;
    this.composerInput.setAttribute('aria-label', 'Message');
    this.composerInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        this.submit();
      }
    });
    this.sendButton.className = 'send';
    this.sendButton.type = 'button';
    this.sendButton.innerHTML = `${icon('send')}<span>Send</span>`;
    this.sendButton.addEventListener('click', () => this.submit());

    const controls = el('div', 'composer-controls');
    const attach = el('button', 'ctl');
    attach.type = 'button';
    attach.disabled = true;
    attach.title = 'Attachments arrive with the file worker, not before.';
    attach.innerHTML = icon('attach');
    attach.setAttribute('aria-label', 'Attach a file');

    const dial = el('button', 'ctl');
    dial.type = 'button';
    dial.disabled = true;
    dial.title = 'The dial is set by the Space ceiling; it is not a toggle.';
    dial.innerHTML = `${icon('dial')}<span>dial 3</span>`;
    this.dialControl = dial;

    controls.append(
      el('button', 'ctl', 'assistant: default'),
      this.spaceChip,
      el('span', 'ctl', 'model: local'),
      attach,
      dial,
      el('span', 'spacer'),
      this.sendButton,
    );
    wrap.append(this.composerInput, controls);
    card.append(wrap);
    return card;
  }

  private submit(): void {
    const text = this.composerInput.value.trim();
    if (!text || this.busy) return;
    this.composerInput.value = '';
    this.handlers.send(text);
  }

  setSpaces(spaces: readonly SpaceSummary[], active: string): void {
    this.railSpaces.replaceChildren();
    for (const space of spaces) {
      const button = el('button', 'space-btn');
      button.type = 'button';
      button.setAttribute('aria-pressed', String(space.id === active));
      const dot = el('span', `space-dot space-${space.id}`);
      const text = el('span', 'space-text');
      text.append(el('span', 'space-name', space.label), el('span', 'space-note', `${space.policyCeiling} · dial ${space.dial}`));
      button.append(dot, text);
      button.addEventListener('click', () => this.handlers.pickSpace(space.id));
      this.railSpaces.append(button);
    }
  }

  setStatus(status: Status): void {
    this.statusChip.textContent = status;
    this.statusChip.dataset.status = status;
  }

  setTheme(theme: string, mode: string): void {
    this.theme = (THEMES.find((entry) => entry.id === theme)?.id ?? 'lunar-ash') as ThemeId;
    this.mode = mode === 'light' ? 'light' : 'dark';
    if (this.dockTab === 'appearance') this.renderDock();
  }

  setAppearance(serif: string, contrast: boolean): void {
    this.serif = serif as SerifId;
    this.contrast = contrast;
    if (this.dockTab === 'appearance') this.renderDock();
  }

  private setSendLabel(busy: boolean): void {
    this.sendButton.innerHTML = `${icon('send')}<span>${busy ? 'Working' : 'Send'}</span>`;
    this.sendButton.disabled = busy;
  }

  /** Full render from a snapshot. The event list is the source of truth. */
  update(snapshot: Snapshot, space: string): void {
    this.latest = snapshot;
    this.events = [...snapshot.thread];
    this.lastSeq = snapshot.head;
    this.spaceChip.textContent = snapshot.label;
    this.mainMeta.textContent = `${snapshot.label.toLowerCase()} · dial ${snapshot.dial} · ${SIGNATURE.seal}`;
    if (this.dialControl) {
      this.dialControl.innerHTML = `${icon('dial')}<span>dial ${snapshot.dial}</span>`;
      this.dialControl.title = `${snapshot.policyCeiling} ceiling. The dial follows the Space, it is not a toggle.`;
    }
    this.ledgerChip.textContent = `ledger ${snapshot.ledger.seq}`;
    this.sealChip.textContent = snapshot.ledger.chainOk ? `${snapshot.ledger.heads} sealed` : 'chain broken';
    this.sealChip.dataset.ok = String(snapshot.ledger.chainOk);

    this.railSessions.replaceChildren();
    const session = el('button', 'session-row');
    session.type = 'button';
    session.setAttribute('aria-selected', 'true');
    session.append(el('span', 'session-dot'), el('span', 'session-name', 'Today'), el('span', 'session-count mono', String(snapshot.head)));
    this.railSessions.append(session);

    const lastState = latestState(snapshot.thread);
    this.tabState.textContent = lastState ?? 'draft';
    this.tabState.dataset.state = lastState ?? 'draft';
    this.busy = isActive(lastState);
    this.setSendLabel(this.busy);
    (this.sendButton as HTMLButtonElement).disabled = this.busy;

    this.threadList.replaceChildren();
    for (const event of this.events) this.renderEvent(event, false);

    this.renderApproval(snapshot.pending.at(-1) ?? null);
    this.renderDock();
    this.impulseLine.dataset.live = String(this.busy);
    this.scrollToEnd();
    void space;
  }

  /** Incremental append from the stream. Duplicates are ignored by sequence. */
  push(event: ThreadEvent, snapshot: Snapshot | null): void {
    if (event.seq <= this.lastSeq) return;
    this.lastSeq = event.seq;
    this.events.push(event);
    this.renderEvent(event, true);
    if (snapshot) this.latest = { ...snapshot, thread: this.events };
    if (event.type === 'state') {
      this.tabState.textContent = event.state;
      this.tabState.dataset.state = event.state;
      const active = isActive(event.state);
      if (active !== this.busy) {
        this.busy = active;
        this.setSendLabel(this.busy);
        (this.sendButton as HTMLButtonElement).disabled = this.busy;
      }
      this.impulseLine.dataset.live = String(this.busy);
    }
    if (event.type === 'approval' || event.type === 'receipt' || event.type === 'notice') this.refreshExtras();
    this.renderDock();
    this.scrollToEnd();
  }

  private refreshExtras(): void {
    if (!this.latest) return;
    const snapshot = this.latest;
    this.ledgerChip.textContent = `ledger ${snapshot.ledger.seq}`;
    this.sealChip.textContent = snapshot.ledger.chainOk ? `${snapshot.ledger.heads} sealed` : 'chain broken';
  }

  /** The docked approval bar only exists while a signature is genuinely pending. */
  renderApproval(approval: Approval | null): void {
    this.approvalSlot.replaceChildren();
    if (approval?.state !== 'pending') {
      this.approvalSlot.style.display = 'none';
      return;
    }
    this.approvalSlot.style.display = 'block';
    const bar = el('div', 'approval-bar');
    const head = el('div', 'approval-head');
    head.append(el('span', 'approval-dot'), el('span', 't-section', `Needs approval: write ${approval.paths.join(', ')}`));
    const facts = el('dl', 'approval-facts mono');
    const rows: Array<[string, string]> = [
      ['effect', approval.effect],
      ['data', approval.dataClass],
      ['recovery', approval.recoveryClass],
      ['risk', approval.risk],
      ['changeset', approval.changeSetHash.slice(0, 16)],
      ['expires', new Date(approval.expiresAt).toISOString().slice(11, 19)],
    ];
    for (const [key, value] of rows) {
      facts.append(el('dt', '', key), el('dd', '', value));
    }
    const actions = el('div', 'approval-actions');
    const approve = el('button', 'btn btn-primary', 'Approve with signature');
    approve.type = 'button';
    approve.addEventListener('click', () => this.handlers.decide(this.latest?.space ?? 'co-think', approval.id, 'approve'));
    const deny = el('button', 'btn btn-quiet', 'Deny');
    deny.type = 'button';
    deny.addEventListener('click', () => this.handlers.decide(this.latest?.space ?? 'co-think', approval.id, 'deny'));
    actions.append(approve, deny);
    bar.append(head, facts, actions);
    this.approvalSlot.append(bar);
  }

  private renderEvent(event: ThreadEvent, animate: boolean): void {
    const row = el('div', `event${animate ? ' enter-row' : ''}`);
    row.dataset.seq = String(event.seq);

    if (event.type === 'message') {
      row.className = `message message-${event.actor}${animate ? ' enter-row' : ''}`;
      row.append(el('div', 'message-meta mono', event.actor === 'user' ? 'you' : `${SIGNATURE.product} · ${event.integrity}`));
      const text = el('div', event.actor === 'user' ? 't-body' : 'prose');
      text.textContent = event.text;
      row.append(text);
    }

    if (event.type === 'state') {
      row.className = `state-row ${event.state}${animate ? ' enter-row' : ''}`;
      const mark = el('span', `glyph tone-${toneOf(event.state)}`);
      mark.innerHTML = glyph(event.state);
      row.append(mark, el('span', 'state-label', event.state), el('span', 'state-reason', event.reason));
    }

    if (event.type === 'plan') {
      row.className = 'plan-card';
      row.append(el('div', 'rail-label', 'Plan'));
      for (const step of event.steps) {
        const line = el('div', 'plan-step');
        line.append(el('span', 'mono plan-tool', step.tool), el('span', 't-body', step.title), el('span', 'chip', step.effectClass), el('span', 'chip', step.recoveryClass));
        row.append(line);
      }
      if (event.changeSetHash) row.append(el('div', 'hash', `changeset ${event.changeSetHash}`));
    }

    if (event.type === 'approval') {
      row.className = 'approval-row';
      row.append(
        el('span', 't-meta', `signature requested · ${event.approval.paths.join(', ')}`),
        el('span', 'hash', event.approval.changeSetHash.slice(0, 32)),
      );
    }

    if (event.type === 'receipt') {
      const r = event.receipt;
      row.className = 'receipt-row';
      row.append(
        el('span', 'mono receipt-seq', `#${r.seq}`),
        el('span', 't-body', `${r.effect} ${r.target}`),
        el('span', 'chip', r.recoveryClass),
        el('span', 'hash', r.hash.slice(0, 16)),
        el('span', 't-meta', `ledger ${r.ledgerSeq}`),
      );
    }

    if (event.type === 'check') {
      row.className = `check-row${event.pass ? '' : ' check-fail'}`;
      row.append(el('span', 'mono check-mark', event.pass ? 'pass' : 'fail'), el('span', 't-body', event.id), el('span', 't-meta', event.detail));
    }

    if (event.type === 'notice') {
      row.className = `notice notice-${event.tone}`;
      row.append(el('span', 't-meta', event.text));
    }

    this.threadList.append(row);
  }

  private renderDock(): void {
    for (const button of this.dockTabs.querySelectorAll<HTMLButtonElement>('button')) {
      button.setAttribute('aria-pressed', String(button.dataset.tab === this.dockTab));
    }
    this.dockBody.replaceChildren();
    const thread = this.events;
    if (this.dockTab === 'plan') {
      const plan = [...thread].reverse().find((e) => e.type === 'plan');
      if (plan?.type !== 'plan') {
        this.dockBody.append(el('div', 'dock-empty', 'No plan yet. A turn writes one before it touches anything.'));
        return;
      }
      for (const step of plan.steps) {
        const line = el('div', 'dock-line');
        line.append(el('span', 'mono', step.tool), el('span', 't-meta', step.title));
        this.dockBody.append(line);
      }
      this.dockBody.append(el('div', 'hash', `changeset ${plan.changeSetHash ?? '-'}`));
    }
    if (this.dockTab === 'receipts') {
      const receipts = thread.filter((e) => e.type === 'receipt');
      if (!receipts.length) {
        this.dockBody.append(el('div', 'dock-empty', 'No receipts yet. An effect without a receipt did not happen.'));
        return;
      }
      for (const event of receipts) {
        if (event.type !== 'receipt') continue;
        const line = el('div', 'dock-line');
        line.append(
          el('span', 'mono', `#${event.receipt.seq}`),
          el('span', 't-meta', `${event.receipt.effect} ${event.receipt.target}`),
          el('span', 'hash', event.receipt.hash.slice(0, 12)),
        );
        this.dockBody.append(line);
      }
    }
    if (this.dockTab === 'ledger') {
      const ledger = this.latest?.ledger;
      const facts = el('dl', 'dock-facts mono');
      const rows: Array<[string, string]> = [
        ['events', String(ledger?.seq ?? 0)],
        ['head', ledger?.head?.slice(0, 24) ?? 'genesis'],
        ['heads', String(ledger?.heads ?? 0)],
        ['chain', ledger?.chainOk ? 'verified' : 'broken'],
        ['seal', ledger?.chainOk ? SIGNATURE.seal : 'absent'],
      ];
      for (const [key, value] of rows) facts.append(el('dt', '', key), el('dd', '', value));
      this.dockBody.append(facts);
    }
    if (this.dockTab === 'appearance') {
      const panel = el('div', 'appearance');
      for (const theme of THEMES) {
        const row = el('button', 'theme-row');
        row.type = 'button';
        row.dataset.theme = theme.id;
        row.setAttribute('aria-pressed', String(theme.id === this.theme));
        const text = el('span', '');
        text.append(el('span', 'theme-label', theme.label), el('span', 'theme-blurb', theme.blurb));
        row.append(text);
        if (theme.id === this.theme) {
          const mark = el('span', 'mono');
          mark.innerHTML = icon('check');
          row.append(mark);
        }
        row.addEventListener('click', () => this.handlers.pickTheme(theme.id));
        panel.append(row);
      }
      panel.append(el('div', 'rail-label', 'Mode'));
      panel.append(this.seg(['dark', 'light'], this.mode, 'mode', (value) => this.handlers.pickMode(value)));
      panel.append(el('div', 'rail-label', 'Serif'));
      panel.append(this.seg(['source-serif', 'newsreader', 'instrument'], this.serif, 'serif', (value) => this.handlers.pickSerif(value)));
      panel.append(el('div', 'rail-label', 'Contrast'));
      panel.append(
        this.seg(['standard', 'high'], this.contrast ? 'high' : 'standard', 'contrast', (value) =>
          this.handlers.pickContrast(value === 'high'),
        ),
      );
      this.dockBody.append(panel);
    }
    if (this.dockTab === 'files') {
      const files = this.latest?.workspace.files ?? [];
      if (!files.length) {
        this.dockBody.append(el('div', 'dock-empty', 'Nothing written in this Space yet.'));
        return;
      }
      for (const file of files) this.dockBody.append(el('div', 'dock-line mono', file));
    }
  }

  private scrollToEnd(): void {
    const wrap = this.threadList.parentElement;
    if (wrap) wrap.scrollTop = wrap.scrollHeight;
  }
}

const latestState = (thread: readonly ThreadEvent[]): string | null => {
  for (let index = thread.length - 1; index >= 0; index -= 1) {
    const event = thread[index];
    if (event && event.type === 'state') return event.state;
  }
  return null;
};

const ACTIVE = new Set(['framed', 'rehearsing', 'needs-approval', 'ready-to-commit', 'running', 'verifying']);
const isActive = (state: string | null): boolean => state !== null && ACTIVE.has(state);
