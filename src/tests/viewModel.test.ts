import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SAMPLE_SCENARIOS } from '../domain';
import type { PersistedWorkspace } from '../types';
import { MoneyScenarioViewModel } from '../viewModel';
import type { ScenarioRepository } from '../repository';

class MemoryRepository implements ScenarioRepository {
  saved: PersistedWorkspace | null;
  failCount: number;
  saveCalls = 0;
  constructor(value: PersistedWorkspace | null = null, failSave = false) {
    this.saved = value;
    this.failCount = failSave ? Number.POSITIVE_INFINITY : 0;
  }
  async load() { return this.saved; }
  async save(workspace: PersistedWorkspace) {
    this.saveCalls += 1;
    if (this.saveCalls <= this.failCount) throw new Error('storage');
    this.saved = workspace;
  }
}

function createVm(options?: ConstructorParameters<typeof MoneyScenarioViewModel>[1]) {
  const repo = new MemoryRepository();
  const vm = new MoneyScenarioViewModel(repo, { autoSaveDelay: 1000, focusRecheckDelay: 50, blurSaveDelay: 50, ...options });
  return { repo, vm };
}

describe('MoneyScenarioViewModel', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('initializes sample scenarios and updates projections', async () => {
    const { vm } = createVm();
    await vm.init();
    expect(vm.getSnapshot().scenarios).toHaveLength(3);
    vm.updateField('steady', 'years', 30);
    expect(vm.getSnapshot().projections[0].points).toHaveLength(31);
  });

  it('restores saved state and surfaces invalid input', async () => {
    const saved = { version: 1 as const, scenarios: [{ ...SAMPLE_SCENARIOS[0], years: 12 }], selectedId: 'steady' };
    const vm = new MoneyScenarioViewModel(new MemoryRepository(saved));
    await vm.init();
    expect(vm.getSnapshot().scenarios[0].years).toBe(12);
    vm.updateField('steady', 'years', 99);
    expect(vm.getSnapshot().errors.steady.years).toBeTruthy();
    expect(vm.getSnapshot().projections).toHaveLength(0);
  });

  it('marks content dirty immediately and auto-saves after the debounce window', async () => {
    const { repo, vm } = createVm();
    await vm.init();

    vm.updateField('steady', 'years', 25);
    expect(vm.getSnapshot().dirty).toBe(true);
    expect(vm.getSnapshot().saveState).toBe('dirty');
    expect(vm.getSnapshot().dirtyScenarioIds).toContain('steady');

    await vi.advanceTimersByTimeAsync(1000);
    expect(repo.saveCalls).toBe(1);
    expect(vm.getSnapshot().dirty).toBe(false);
    expect(vm.getSnapshot().saveState).toBe('saved');
    expect(vm.getSnapshot().dirtyScenarioIds).toEqual([]);
    expect(repo.saved?.scenarios.find((s) => s.id === 'steady')?.years).toBe(25);
  });

  it('does not auto-save while a number field is focused, and saves shortly after blur', async () => {
    const { repo, vm } = createVm();
    await vm.init();

    vm.setNumberFieldActive(true);
    vm.updateField('steady', 'years', 15);
    await vi.advanceTimersByTimeAsync(5000);
    expect(repo.saveCalls).toBe(0);
    expect(vm.getSnapshot().saveState).toBe('dirty');

    vm.setNumberFieldActive(false);
    await vi.advanceTimersByTimeAsync(50);
    expect(repo.saveCalls).toBe(1);
    expect(vm.getSnapshot().saveState).toBe('saved');
  });

  it('keeps the current content after a save failure and retries on demand', async () => {
    const repo = new MemoryRepository(null, true);
    const vm = new MoneyScenarioViewModel(repo, { autoSaveDelay: 1000 });
    await vm.init();

    await vm.save(true);
    expect(vm.getSnapshot().saveState).toBe('error');
    expect(vm.getSnapshot().dirty).toBe(true);
    expect(vm.getSnapshot().scenarios).toHaveLength(3);

    repo.failCount = 0;
    await vm.save(true);
    expect(vm.getSnapshot().saveState).toBe('saved');
    expect(vm.getSnapshot().dirty).toBe(false);
    expect(repo.saved?.scenarios).toHaveLength(3);
  });

  it('coalesces changes made while a save is in flight', async () => {
    const repo = new MemoryRepository();
    let releaseFirst: () => void = () => {};
    let firstSaveBlocking = true;
    const originalSave = repo.save.bind(repo);
    repo.save = (workspace: PersistedWorkspace) => {
      if (firstSaveBlocking) {
        return new Promise<void>((resolve) => {
          releaseFirst = () => { void originalSave(workspace).then(resolve); };
        });
      }
      return originalSave(workspace);
    };
    const vm = new MoneyScenarioViewModel(repo, { autoSaveDelay: 1000 });
    await vm.init();

    const first = vm.save(true);
    expect(vm.getSnapshot().saveState).toBe('saving');
    vm.updateField('steady', 'years', 22);
    firstSaveBlocking = false;
    releaseFirst();
    await first;
    expect(vm.getSnapshot().dirty).toBe(true);

    await vi.advanceTimersByTimeAsync(1000);
    await vi.runAllTimersAsync();
    expect(repo.saved?.scenarios.find((s) => s.id === 'steady')?.years).toBe(22);
  });
});
