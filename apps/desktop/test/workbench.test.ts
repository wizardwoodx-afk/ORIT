// @vitest-environment happy-dom
/**
 * Shell contract, exercised against a real DOM.
 *
 * These assertions exist because the placements are ported from UUI and a port drifts silently: the
 * titlebar height, the sidebar floor, the panel minimum and the composer region are either in the DOM
 * or they are not. Every test drives the workbench the way a person does — a click, a key — and checks
 * what the shell actually did, not what a stylesheet claims.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Workbench, type WorkbenchHandlers } from '../src/app/workbench.ts';
import { THEMES } from '../src/renderer/theme.ts';

const handlers = (): WorkbenchHandlers => ({
  send: vi.fn(),
  decide: vi.fn(),
  pickSpace: vi.fn(),
  pickTheme: vi.fn(),
  pickMode: vi.fn(),
  pickSerif: vi.fn(),
  pickContrast: vi.fn(),
});

const mountWorkbench = (): { wb: Workbench; root: HTMLElement; spies: WorkbenchHandlers } => {
  const root = document.createElement('div');
  document.body.append(root);
  const spies = handlers();
  return { wb: new Workbench(root, spies), root, spies };
};

const q = <T extends Element>(root: ParentNode, selector: string): T => {
  const node = root.querySelector<T>(selector);
  if (!node) throw new Error(`missing ${selector}`);
  return node;
};

beforeEach(() => {
  localStorage.clear();
  document.body.replaceChildren();
});

describe('workbench shell — UUI placements', () => {
  it('carries a titlebar with a sidebar toggle and a selected tab', () => {
    const { root } = mountWorkbench();
    const top = q<HTMLElement>(root, '.wb-top');
    expect(top.parentElement).toBe(root);
    expect(q(top, '.sb-toggle').getAttribute('aria-pressed')).toBe('true');
    const tab = q(top, '.tab');
    expect(tab.getAttribute('aria-selected')).toBe('true');
    expect(q(top, '.tab .tab-title').textContent).toBe('Today');
    expect(root.querySelector('.tab-close')).toBeNull();
  });

  it('starts the sidebar at 240px and exposes it as a labelled separator', () => {
    const { root } = mountWorkbench();
    expect(root.classList.contains('wb')).toBe(true);
    expect(root.style.getPropertyValue('--rail-w')).toBe('240px');
    const handle = q(root, '.rail-resize');
    expect(handle.getAttribute('role')).toBe('separator');
    expect(handle.getAttribute('aria-orientation')).toBe('vertical');
    expect(handle.getAttribute('aria-valuemin')).toBe('136');
    expect(handle.getAttribute('aria-valuemax')).toBe('640');
    expect(handle.getAttribute('aria-valuenow')).toBe('240');
  });

  it('resizes with arrow keys, clamps at 640, and remembers the width', () => {
    const { root } = mountWorkbench();
    const wb = root;
    const handle = q<HTMLElement>(root, '.rail-resize');
    handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(wb.style.getPropertyValue('--rail-w')).toBe('256px');
    for (let step = 0; step < 40; step += 1) {
      handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    }
    expect(wb.style.getPropertyValue('--rail-w')).toBe('640px');
    expect(handle.getAttribute('aria-valuenow')).toBe('640');
    expect(localStorage.getItem('selfimpulse.rail')).toBe('640');
  });

  it('collapses the sidebar from the titlebar toggle and says so', () => {
    const { root } = mountWorkbench();
    const wb = root;
    const toggle = q<HTMLButtonElement>(root, '.sb-toggle');
    toggle.click();
    expect(wb.dataset.rail).toBe('closed');
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    toggle.click();
    expect(wb.dataset.rail).toBe('open');
  });

  it('docks the session panel with five panes and hides it from the session header', () => {
    const { root } = mountWorkbench();
    const dock = q<HTMLElement>(root, '.wb-dock');
    const tabs = [...dock.querySelectorAll<HTMLButtonElement>('.dock-tabs button')].map((b) => b.dataset.tab);
    expect(tabs).toEqual(['plan', 'receipts', 'ledger', 'files', 'appearance']);
    const toggle = q<HTMLButtonElement>(root, '.main-head [aria-label="Toggle session panel"]');
    toggle.click();
    expect(root.dataset.dock).toBe('closed');
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
  });

  it('pins the composer under the timeline, with the approval bar above it', () => {
    const { root } = mountWorkbench();
    const main = q<HTMLElement>(root, '.wb-main');
    const children = [...main.children].map((child) => child.className);
    expect(children).toEqual(['main-head', 'timeline-wrap', 'composer-region']);
    const region = q<HTMLElement>(root, '.composer-region');
    expect(region.firstElementChild?.className).toBe('approval-slot');
    expect(q(region, '.composer textarea').getAttribute('aria-label')).toBe('Message');
    const controls = [...q(region, '.composer-controls').children].map((child) => child.className);
    expect(controls).toContain('ctl');
    expect(controls.at(-1)).toBe('send');
  });

  it('sends on Enter and keeps Shift+Enter for a new line', () => {
    const { root, spies } = mountWorkbench();
    const input = q<HTMLTextAreaElement>(root, '.composer textarea');
    input.value = 'restore the palette';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true }));
    expect(spies.send).not.toHaveBeenCalled();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(spies.send).toHaveBeenCalledWith('restore the palette');
    expect(input.value).toBe('');
  });

  it('offers every theme in the appearance pane and reports the pick', () => {
    const { root, spies } = mountWorkbench();
    const appearance = [...root.querySelectorAll<HTMLButtonElement>('.dock-tabs button')].find(
      (button) => button.dataset.tab === 'appearance',
    );
    if (!appearance) throw new Error('no appearance tab');
    appearance.click();
    const rows = [...root.querySelectorAll<HTMLButtonElement>('.theme-row')];
    expect(rows.map((row) => row.dataset.theme)).toEqual(THEMES.map((theme) => theme.id));
    expect(rows).toHaveLength(8);
    const mars = rows.find((row) => row.dataset.theme === 'mars');
    if (!mars) throw new Error('no mars row');
    mars.click();
    expect(spies.pickTheme).toHaveBeenCalledWith('mars');
    expect(q<HTMLElement>(root, '.appearance').querySelectorAll('.seg')).toHaveLength(3);
  });

  it('marks the applied theme, not the default, when the theme changes', () => {
    const { root, wb } = mountWorkbench();
    const appearance = [...root.querySelectorAll<HTMLButtonElement>('.dock-tabs button')].find(
      (button) => button.dataset.tab === 'appearance',
    );
    if (!appearance) throw new Error('no appearance tab');
    appearance.click();
    wb.setTheme('uranus', 'light');
    const pressed = [...root.querySelectorAll<HTMLButtonElement>('.theme-row[aria-pressed="true"]')].map(
      (row) => row.dataset.theme,
    );
    expect(pressed).toEqual(['uranus']);
    const light = [...root.querySelectorAll<HTMLButtonElement>('[data-mode]')].find((b) => b.dataset.mode === 'light');
    expect(light?.getAttribute('aria-pressed')).toBe('true');
  });

  it('keeps the dial honest: it displays the Space ceiling and is not a toggle', () => {
    const { root } = mountWorkbench();
    const controls = q<HTMLElement>(root, '.composer-controls');
    const disabled = [...controls.querySelectorAll<HTMLButtonElement>('button[disabled]')].map((button) =>
      button.getAttribute('aria-label'),
    );
    expect(disabled).toContain('Attach a file');
    const dial = [...controls.querySelectorAll<HTMLButtonElement>('.ctl')].find((button) =>
      button.textContent?.startsWith('dial'),
    );
    expect(dial?.disabled).toBe(true);
  });
});
