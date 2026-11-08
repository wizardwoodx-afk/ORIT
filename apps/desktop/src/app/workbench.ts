/**
 * SelfImpulse — workbench.
 *
 * The layout is fixed: 264px rail, the Thread, a 360px dock, the composer pinned at the bottom, and
 * the approval bar docked above it when a real signature is pending. Nothing here invents state; the
 * only inputs are the snapshot and the event stream.
 */
import { SIGNATURE } from '@si/voice';
import type { Approval, Snapshot, ThreadEvent } from './api.ts';
import { glyph, toneOf } from './glyphs.ts';

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
}

const DOCK_TABS = ['plan', 'receipts', 'ledger', 'files'] as const;
type DockTab = (typeof DOCK_TABS)[number];

export class Workbench {
  private readonly railSpaces = el('div', 'rail-list');
  private readonly railSessions = el('div', 'rail-list');
  private readonly threadList = el('div', 'thread');
  private readonly approvalSlot = el('div', 'approval-slot');
  private readonly dockBody = el('div', 'dock-body');
  private readonly dockTabs = el('div', 'seg dock-tabs');
  private readonly tabTitle = el('span', 't-body tab-title', 'Today');
  private readonly tabState = el('span', 'chip', 'draft');
  private readonly ledgerChip = el('span', 'chip mono', 'ledger');
  private readonly sealChip = el('span', 'chip', 'unsealed');
  private readonly composerInput = document.createElement('textarea');
  private readonly sendButton = el('button', 'btn btn-primary', 'Send');
  private readonly spaceChip = el('span', 'chip', 'Co-think');
  private readonly dialChip = el('span', 'chip', 'dial 3');
  private readonly statusChip = el('span', 'chip', 'connecting');
  private readonly impulseLine = el('div', 'impulse-line');
  private dockTab: DockTab = 'plan';
  private lastSeq = 0;
  private latest: Snapshot | null = null;
  private events: ThreadEvent[] = [];
  private busy = false;

  constructor(
    private readonly root: HTMLElement,
    private readonly handlers: WorkbenchHandlers,
  ) {
    this.build();
  }

  private build(): void {
    this.root.replaceChildren();
    this.root.className = 'wb';

    const top = el('header', 'wb-top');
    const brand = el('span', 'brand', SIGNATURE.product);
    const mark = el('span', 'mono mark', SIGNATURE.mark);
    top.append(brand, mark, this.ledgerChip, this.sealChip, el('span', 'spacer'), this.modeSwitch(), this.themeSwitch(), this.statusChip);

    const body = el('div', 'wb-body');

    const rail = el('aside', 'wb-rail');
    const railHead = el('div', 'rail-head');
    railHead.append(el('div', 'rail-label', 'Spaces'), this.railSpaces, el('div', 'rail-label', 'Today'), this.railSessions);
    rail.append(railHead, el('div', 'spacer'), el('div', 'rail-foot', SIGNATURE.tagline));

    const main = el('main', 'wb-main');
    const tabs = el('div', 'toolbar tabs');
    tabs.append(el('span', 'tab-dot'), this.tabTitle, this.tabState, el('span', 'spacer'), this.spaceChip, this.dialChip);

    const threadWrap = el('div', 'thread-wrap');
    threadWrap.append(this.impulseLine, this.threadList, this.approvalSlot);
    this.approvalSlot.style.display = 'none';

    main.append(tabs, threadWrap, this.composer());

    const dock = el('aside', 'wb-dock');
    for (const tab of DOCK_TABS) {
      const button = el('button', '', tab);
      button.type = 'button';
      button.dataset.tab = tab;
      button.setAttribute('aria-pressed', String(tab === this.dockTab));
      button.addEventListener('click', () => {
        this.dockTab = tab;
        this.renderDock();
      });
      this.dockTabs.append(button);
    }
    dock.append(this.dockTabs, this.dockBody);

    body.append(rail, main, dock);
    this.root.append(top, body);
  }

  private modeSwitch(): HTMLElement {
    const wrap = el('div', 'seg');
    for (const mode of ['dark', 'light']) {
      const button = el('button', '', mode);
      button.type = 'button';
      button.dataset.mode = mode;
      button.addEventListener('click', () => this.handlers.pickMode(mode));
      wrap.append(button);
    }
    return wrap;
  }

  private themeSwitch(): HTMLElement {
    const wrap = el('div', 'seg');
    for (const theme of ['anvil', 'moon']) {
      const button = el('button', '', theme);
      button.type = 'button';
      button.dataset.theme = theme;
      button.addEventListener('click', () => this.handlers.pickTheme(theme));
      wrap.append(button);
    }
    return wrap;
  }

  private composer(): HTMLElement {
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
    this.sendButton.addEventListener('click', () => this.submit());

    const chips = el('div', 'composer-chips');
    chips.append(el('span', 'chip', 'assistant: default'), this.spaceChip, el('span', 'chip', 'model: Local'), el('span', 'chip', 'thinking: medium'), this.dialChip, el('span', 'spacer'), this.sendButton);
    wrap.append(this.composerInput, chips);
    return wrap;
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
    for (const button of this.root.querySelectorAll<HTMLButtonElement>('[data-theme]')) {
      button.setAttribute('aria-pressed', String(button.dataset.theme === theme));
    }
    for (const button of this.root.querySelectorAll<HTMLButtonElement>('[data-mode]')) {
      button.setAttribute('aria-pressed', String(button.dataset.mode === mode));
    }
  }

  /** Full render from a snapshot. The event list is the source of truth. */
  update(snapshot: Snapshot, space: string): void {
    this.latest = snapshot;
    this.events = [...snapshot.thread];
    this.lastSeq = snapshot.head;
    this.spaceChip.textContent = snapshot.label;
    this.dialChip.textContent = `dial ${snapshot.dial}`;
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
    this.sendButton.textContent = this.busy ? 'Working' : 'Send';
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
        this.sendButton!.textContent = this.busy ? 'Working' : 'Send';
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
    if (!approval || approval.state !== 'pending') {
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
      if (!plan || plan.type !== 'plan') {
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
