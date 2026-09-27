import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SAMPLE_SCENARIOS } from '../domain';
import type { PersistedWorkspace } from '../types';
import { AUTOSAVE_DELAY_MS, MoneyScenarioViewModel } from '../viewModel';
import type { ScenarioRepository } from '../repository';

class MemoryRepository implements ScenarioRepository {
  flushCount = 0;
  failSave: boolean;
  value: PersistedWorkspace | null;
  constructor(value: PersistedWorkspace | null = null, failSave = false) { this.value = value; this.failSave = failSave; }
  async load() { return this.value; }
  async save(workspace: PersistedWorkspace) { if (this.failSave) throw new Error('storage'); this.value = workspace; }
  flush(workspace: PersistedWorkspace) { if (this.failSave) throw new Error('storage'); this.flushCount += 1; this.value = workspace; }
}

describe('MoneyScenarioViewModel', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('initializes sample scenarios and updates projections', async () => {
    const vm = new MoneyScenarioViewModel(new MemoryRepository());
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

  it('handles persistence failure without losing the editing state', async () => {
    const vm = new MoneyScenarioViewModel(new MemoryRepository(null, true));
    await vm.init();
    await vm.save();
    expect(vm.getSnapshot().status).toBe('error');
    expect(vm.getSnapshot().scenarios).toHaveLength(3);
  });

  it('marks edits as dirty immediately and autosaves after the debounce window', async () => {
    const repo = new MemoryRepository();
    const vm = new MoneyScenarioViewModel(repo);
    await vm.init();

    vm.updateField('steady', 'years', 25);
    expect(vm.getSnapshot().dirty).toBe(true);
    expect(vm.getSnapshot().saveStatus).toBe('dirty');
    expect(repo.value).toBeNull();

    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    expect(vm.getSnapshot().dirty).toBe(false);
    expect(vm.getSnapshot().saveStatus).toBe('saved');
    expect(repo.value?.scenarios.find((s) => s.id === 'steady')?.years).toBe(25);
  });

  it('does not autosave half-entered invalid values and stays dirty', async () => {
    const repo = new MemoryRepository();
    const vm = new MoneyScenarioViewModel(repo);
    await vm.init();

    vm.updateField('steady', 'years', Number.NaN);
    expect(vm.getSnapshot().dirty).toBe(true);
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS * 3);
    expect(vm.getSnapshot().saveStatus).toBe('dirty');
    // The previously persisted (sample) workspace is never overwritten with invalid data.
    expect(repo.value).toBeNull();

    vm.updateField('steady', 'years', 25);
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    expect(vm.getSnapshot().saveStatus).toBe('saved');
  });

  it('keeps the current content on save failure and retries successfully', async () => {
    const repo = new MemoryRepository(null, true);
    const vm = new MoneyScenarioViewModel(repo);
    await vm.init();

    vm.updateField('steady', 'principal', 80000);
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    expect(vm.getSnapshot().saveStatus).toBe('error');
    expect(vm.getSnapshot().dirty).toBe(true);
    expect(vm.getSnapshot().scenarios.find((s) => s.id === 'steady')?.principal).toBe(80000);

    repo.failSave = false;
    await vm.retrySave();
    expect(vm.getSnapshot().saveStatus).toBe('saved');
    expect(vm.getSnapshot().dirty).toBe(false);
    expect(repo.value?.scenarios.find((s) => s.id === 'steady')?.principal).toBe(80000);
  });

  it('coalesces manual saves that happen while one is in flight', async () => {
    const repo = new MemoryRepository();
    const vm = new MoneyScenarioViewModel(repo);
    await vm.init();

    vm.updateField('steady', 'years', 10);
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    vm.updateField('steady', 'years', 11);
    const first = vm.save(true);
    const second = vm.save(true);
    expect(second).toBe(first);
    await first;
    expect(vm.getSnapshot().saveStatus).toBe('saved');
    expect(repo.value?.scenarios.find((s) => s.id === 'steady')?.years).toBe(11);
  });

  it('flushPending synchronously persists dirty edits for page unload', async () => {
    const repo = new MemoryRepository();
    const vm = new MoneyScenarioViewModel(repo);
    await vm.init();

    vm.updateField('steady', 'years', 40);
    expect(vm.flushPending()).toBe(false);
    expect(repo.flushCount).toBe(1);
    expect(repo.value?.scenarios.find((s) => s.id === 'steady')?.years).toBe(40);
    expect(vm.getSnapshot().dirty).toBe(false);
  });

  it('flushPending reports still-pending changes when input is invalid', async () => {
    const repo = new MemoryRepository();
    const vm = new MoneyScenarioViewModel(repo);
    await vm.init();

    vm.updateField('steady', 'years', Number.NaN);
    expect(vm.flushPending()).toBe(true);
    expect(repo.flushCount).toBe(0);
  });
});
