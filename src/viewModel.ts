import { calculateProjection, COLORS, SAMPLE_SCENARIOS, validateScenario } from './domain';
import type { ScenarioRepository } from './repository';
import type { FinanceScenario, PersistedWorkspace, ScenarioField, ScenarioProjection, ValidationErrors } from './types';

export type ViewStatus = 'loading' | 'ready' | 'editing' | 'error' | 'completed';
export type SaveStatus = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

/** Idle time before an edit is auto-persisted. Exported for tests. */
export const AUTOSAVE_DELAY_MS = 1000;

export interface MoneyScenarioState {
  status: ViewStatus;
  scenarios: FinanceScenario[];
  selectedId: string;
  errors: Record<string, ValidationErrors>;
  projections: ScenarioProjection[];
  message: string;
  saveStatus: SaveStatus;
  /** True when local edits have not yet been persisted. */
  dirty: boolean;
}

type Listener = (state: MoneyScenarioState) => void;

function initialState(): MoneyScenarioState {
  return { status: 'loading', scenarios: [], selectedId: '', errors: {}, projections: [], message: '正在恢复最近的情景…', saveStatus: 'idle', dirty: false };
}

export class MoneyScenarioViewModel {
  private state: MoneyScenarioState = initialState();
  private readonly listeners = new Set<Listener>();
  private initialized = false;
  private readonly repository: ScenarioRepository;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private saving: Promise<void> | null = null;
  /** Set while an in-flight save is running if newer edits landed on top of it. */
  private trailingSave = false;

  constructor(repository: ScenarioRepository) {
    this.repository = repository;
  }

  getSnapshot(): MoneyScenarioState { return this.state; }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    try {
      const saved = await this.repository.load();
      this.applyScenarios(saved?.scenarios?.length ? saved.scenarios : SAMPLE_SCENARIOS, saved?.selectedId ?? SAMPLE_SCENARIOS[0].id, saved ? '已恢复上次工作状态' : '已载入示例情景，可直接调整参数');
      this.markPersisted(saved ? 'saved' : 'idle');
    } catch {
      this.applyScenarios(SAMPLE_SCENARIOS, SAMPLE_SCENARIOS[0].id, '本地数据读取失败，已使用示例情景');
      this.setState({ status: 'error', saveStatus: 'error', message: '本地数据读取失败，当前使用临时示例；仍可继续推演' });
    }
  }

  updateField(id: string, field: ScenarioField, value: number): void {
    const scenarios = this.state.scenarios.map((scenario) => scenario.id === id ? { ...scenario, [field]: value } : scenario);
    this.applyScenarios(scenarios, id, '参数已更新，结果实时刷新');
    this.noteChange();
  }

  renameScenario(id: string, name: string): void {
    const trimmed = name.trim().slice(0, 18);
    if (!trimmed) return;
    this.applyScenarios(this.state.scenarios.map((scenario) => scenario.id === id ? { ...scenario, name: trimmed } : scenario), id, '情景名称已更新');
    this.noteChange();
  }

  addScenario(): void {
    if (this.state.scenarios.length >= 5) {
      this.setState({ message: '最多同时比较 5 个情景' });
      return;
    }
    const source = this.state.scenarios[this.state.scenarios.length - 1] ?? SAMPLE_SCENARIOS[0];
    const id = `scenario-${Date.now()}`;
    const scenario = { ...source, id, name: `情景 ${this.state.scenarios.length + 1}`, color: COLORS[this.state.scenarios.length % COLORS.length] };
    this.applyScenarios([...this.state.scenarios, scenario], id, '已新增情景');
    this.noteChange();
  }

  duplicateScenario(id: string): void {
    if (this.state.scenarios.length >= 5) {
      this.setState({ message: '最多同时比较 5 个情景' });
      return;
    }
    const source = this.state.scenarios.find((scenario) => scenario.id === id);
    if (!source) return;
    const copy = { ...source, id: `scenario-${Date.now()}`, name: `${source.name} · 复制`, color: COLORS[this.state.scenarios.length % COLORS.length] };
    this.applyScenarios([...this.state.scenarios, copy], copy.id, '已复制情景，可修改任意参数比较差异');
    this.noteChange();
  }

  removeScenario(id: string): void {
    if (this.state.scenarios.length <= 1) return;
    const scenarios = this.state.scenarios.filter((scenario) => scenario.id !== id);
    this.applyScenarios(scenarios, scenarios[0].id, '情景已移除');
    this.noteChange();
  }

  /**
   * The single save entry point shared by the button, the keyboard shortcut
   * and the autosave timer. Manual attempts surface validation/save errors;
   * autosave silently waits for valid input instead of nagging mid-typing.
   */
  save(manual = true): Promise<void> {
    if (Object.keys(this.state.errors).length > 0) {
      if (manual) this.setState({ saveStatus: 'error', message: '请先修正标红参数，再保存比较' });
      return Promise.resolve();
    }
    if (this.saving) {
      // Coalesce concurrent triggers; the trailing run picks up the newest state.
      this.trailingSave = true;
      return this.saving;
    }
    return this.executeSave();
  }

  /** Retry after a failed save, keeping the current (unsaved) content intact. */
  retrySave(): Promise<void> {
    this.cancelScheduledSave();
    return this.save(true);
  }

  /**
   * Synchronously persist pending valid edits when the page is being closed.
   * Returns true when unpersisted (and unflushable) changes still remain,
   * in which case the caller should ask the user to confirm leaving.
   */
  flushPending(): boolean {
    if (!this.state.dirty) return this.state.saveStatus === 'error';
    if (Object.keys(this.state.errors).length > 0) return true;
    if (!this.repository.flush) return true;
    try {
      this.repository.flush(this.currentWorkspace());
      this.markPersisted('saved');
      return false;
    } catch {
      return true;
    }
  }

  /** Tear down timers when the host component unmounts. */
  dispose(): void {
    this.cancelScheduledSave();
  }

  private executeSave(): Promise<void> {
    const workspace = this.currentWorkspace();
    this.setState({ saveStatus: 'saving', message: '正在保存…' });
    const run = this.repository.save(workspace)
      .then(() => {
        if (run === this.saving) this.saving = null;
        if (this.trailingSave) {
          this.trailingSave = false;
          // Edits may have arrived with invalid intermediate input; save() re-validates.
          void this.save(true);
          return;
        }
        this.markPersisted('saved');
      })
      .catch(() => {
        if (run === this.saving) this.saving = null;
        // Content stays in memory untouched; the user can retry from the banner.
        this.setState({ status: 'error', dirty: true, saveStatus: 'error', message: '保存失败，改动仍保留在当前页面，请重试' });
      });
    this.saving = run;
    return run;
  }

  private noteChange(): void {
    this.cancelScheduledSave();
    this.setState({ dirty: true, saveStatus: 'dirty', message: '有未保存的改动' });
    // Only schedule autosave for valid data; a new edit reschedules it anyway.
    if (Object.keys(this.state.errors).length === 0) {
      this.saveTimer = setTimeout(() => {
        this.saveTimer = null;
        void this.save(false);
      }, AUTOSAVE_DELAY_MS);
    }
  }

  private markPersisted(saveStatus: 'saved' | 'idle'): void {
    this.setState({ dirty: false, saveStatus, message: saveStatus === 'saved' ? '所有改动已保存' : this.state.message });
  }

  private cancelScheduledSave(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
  }

  private currentWorkspace(): PersistedWorkspace {
    return { version: 1, scenarios: this.state.scenarios, selectedId: this.state.selectedId };
  }

  private applyScenarios(scenarios: FinanceScenario[], selectedId: string, message: string): void {
    const errors: Record<string, ValidationErrors> = {};
    const projections: ScenarioProjection[] = [];
    scenarios.forEach((scenario) => {
      const scenarioErrors = validateScenario(scenario);
      if (Object.keys(scenarioErrors).length) errors[scenario.id] = scenarioErrors;
      else projections.push(calculateProjection(scenario));
    });
    this.setState({ scenarios, selectedId, errors, projections, status: Object.keys(errors).length ? 'editing' : 'ready', message });
  }

  private setState(patch: Partial<MoneyScenarioState>): void {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener(this.state));
  }
}
