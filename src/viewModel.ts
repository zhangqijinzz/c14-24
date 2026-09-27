import { calculateProjection, COLORS, SAMPLE_SCENARIOS, validateScenario } from './domain';
import type { ScenarioRepository } from './repository';
import { writeLocalWorkspaceSync } from './storage';
import type { FinanceScenario, PersistedWorkspace, ScenarioField, ScenarioProjection, ValidationErrors } from './types';

export type ViewStatus = 'loading' | 'ready' | 'editing' | 'error' | 'completed';
export type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

export interface ViewModelOptions {
  /** 停手多久后自动落盘 */
  autoSaveDelay?: number;
  /** 数字输入框仍聚焦时，多久后重新评估一次自动保存 */
  focusRecheckDelay?: number;
  /** 数字输入框失焦后多久触发自动保存 */
  blurSaveDelay?: number;
}

export interface MoneyScenarioState {
  status: ViewStatus;
  scenarios: FinanceScenario[];
  selectedId: string;
  errors: Record<string, ValidationErrors>;
  projections: ScenarioProjection[];
  message: string;
  saveState: SaveState;
  dirty: boolean;
  /** 有改动但尚未保存的情景卡片 id（含已被删除情景的占位标记） */
  dirtyScenarioIds: string[];
  lastSavedAt: number | null;
}

type Listener = (state: MoneyScenarioState) => void;

const DEFAULT_AUTO_SAVE_DELAY = 1200;
const DEFAULT_FOCUS_RECHECK_DELAY = 400;
const DEFAULT_BLUR_SAVE_DELAY = 300;

function initialState(): MoneyScenarioState {
  return {
    status: 'loading',
    scenarios: [],
    selectedId: '',
    errors: {},
    projections: [],
    message: '正在恢复最近的情景…',
    saveState: 'idle',
    dirty: false,
    dirtyScenarioIds: [],
    lastSavedAt: null,
  };
}

export class MoneyScenarioViewModel {
  private state: MoneyScenarioState = initialState();
  private readonly listeners = new Set<Listener>();
  private initialized = false;
  private readonly repository: ScenarioRepository;
  private readonly options: Required<ViewModelOptions>;
  private autoSaveTimer: ReturnType<typeof setTimeout> | null = null;
  private saveInFlight = false;
  private queuedSave = false;
  private activeNumberFields = 0;
  private baseline = '';
  private lastSavedAt: number | null = null;
  private dirtyIds = new Set<string>();

  constructor(repository: ScenarioRepository, options: ViewModelOptions = {}) {
    this.repository = repository;
    this.options = {
      autoSaveDelay: options.autoSaveDelay ?? DEFAULT_AUTO_SAVE_DELAY,
      focusRecheckDelay: options.focusRecheckDelay ?? DEFAULT_FOCUS_RECHECK_DELAY,
      blurSaveDelay: options.blurSaveDelay ?? DEFAULT_BLUR_SAVE_DELAY,
    };
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
      if (saved?.scenarios?.length) {
        this.applyScenarios(saved.scenarios, saved.selectedId, '已恢复上次工作状态');
      } else {
        this.applyScenarios(SAMPLE_SCENARIOS, SAMPLE_SCENARIOS[0].id, '已载入示例情景，可直接调整参数');
      }
    } catch {
      this.applyScenarios(SAMPLE_SCENARIOS, SAMPLE_SCENARIOS[0].id, '本地数据读取失败，已使用示例情景');
      this.setState({ status: 'error', message: '本地数据读取失败，当前使用临时示例；仍可继续推演' });
    }
    this.baseline = this.currentSignature();
    this.dirtyIds.clear();
    this.setState({ dirty: false, dirtyScenarioIds: [], saveState: 'idle' });
  }

  updateField(id: string, field: ScenarioField, value: number): void {
    const scenarios = this.state.scenarios.map((scenario) => scenario.id === id ? { ...scenario, [field]: value } : scenario);
    this.applyScenarios(scenarios, id, '参数已更新，结果实时刷新', id);
  }

  renameScenario(id: string, name: string): void {
    const trimmed = name.trim().slice(0, 18);
    if (!trimmed) return;
    this.applyScenarios(this.state.scenarios.map((scenario) => scenario.id === id ? { ...scenario, name: trimmed } : scenario), id, '情景名称已更新', id);
  }

  addScenario(): void {
    if (this.state.scenarios.length >= 5) {
      this.setState({ message: '最多同时比较 5 个情景' });
      return;
    }
    const source = this.state.scenarios[this.state.scenarios.length - 1] ?? SAMPLE_SCENARIOS[0];
    const id = `scenario-${Date.now()}`;
    const scenario = { ...source, id, name: `情景 ${this.state.scenarios.length + 1}`, color: COLORS[this.state.scenarios.length % COLORS.length] };
    this.applyScenarios([...this.state.scenarios, scenario], id, '已新增情景', id);
  }

  duplicateScenario(id: string): void {
    if (this.state.scenarios.length >= 5) {
      this.setState({ message: '最多同时比较 5 个情景' });
      return;
    }
    const source = this.state.scenarios.find((scenario) => scenario.id === id);
    if (!source) return;
    const copy = { ...source, id: `scenario-${Date.now()}`, name: `${source.name} · 复制`, color: COLORS[this.state.scenarios.length % COLORS.length] };
    this.applyScenarios([...this.state.scenarios, copy], copy.id, '已复制情景，可修改任意参数比较差异', copy.id);
  }

  removeScenario(id: string): void {
    if (this.state.scenarios.length <= 1) return;
    const scenarios = this.state.scenarios.filter((scenario) => scenario.id !== id);
    this.applyScenarios(scenarios, scenarios[0].id, '情景已移除', id);
  }

  /** 数字输入框聚焦/失焦时登记；输入未结束（仍聚焦）前不自动落盘 */
  setNumberFieldActive(active: boolean): void {
    this.activeNumberFields += active ? 1 : -1;
    if (this.activeNumberFields < 0) this.activeNumberFields = 0;
    if (!active && this.state.dirty && this.state.saveState !== 'saving' && !this.hasErrors()) {
      this.scheduleAutoSave(this.options.blurSaveDelay);
    }
  }

  /** 手动保存（按钮 / ⌘S·Ctrl+S 共用）与自动保存的唯一入口 */
  async save(manual = false): Promise<void> {
    if (this.state.status === 'loading') return;
    if (this.hasErrors()) {
      if (manual) this.setState({ saveState: 'error', dirty: true, message: '请先修正标红参数，再保存比较' });
      return;
    }
    if (this.saveInFlight) {
      this.queuedSave = true;
      return;
    }

    const payload = this.buildWorkspace();
    this.saveInFlight = true;
    this.clearAutoSaveTimer();
    this.setState({ saveState: 'saving', message: '正在保存…' });

    try {
      await this.repository.save(payload);
      this.baseline = JSON.stringify({ scenarios: payload.scenarios, selectedId: payload.selectedId });
      this.saveInFlight = false;
      if (this.baseline !== this.currentSignature()) {
        // 保存期间又产生了新改动，下一轮防抖继续落盘
        this.setState({ saveState: 'dirty', dirty: true, message: '检测到新的改动，稍后自动保存' });
        this.scheduleAutoSave();
      } else {
        this.lastSavedAt = Date.now();
        this.dirtyIds.clear();
        this.setState({ saveState: 'saved', dirty: false, dirtyScenarioIds: [], lastSavedAt: this.lastSavedAt, message: manual ? '比较已保存，本地刷新后仍可继续编辑' : '已自动保存' });
      }
    } catch {
      this.saveInFlight = false;
      // 保留当前页面内容，等待用户重试或下一次改动后再自动保存
      this.setState({ saveState: 'error', dirty: true, message: '保存失败，改动仍保留在本页，可点击重试' });
    } finally {
      if (this.queuedSave) {
        this.queuedSave = false;
        void this.save(false);
      }
    }
  }

  /** 关闭/刷新标签页前的尽力同步落盘（localStorage） */
  flushPendingToLocalStorage(): void {
    if (!this.state.dirty || this.hasErrors() || this.state.status === 'loading') return;
    writeLocalWorkspaceSync(this.buildWorkspace());
  }

  dispose(): void {
    this.clearAutoSaveTimer();
    this.listeners.clear();
  }

  private autoSaveTick(): void {
    if (!this.state.dirty || this.state.status === 'loading') return;
    if (this.hasErrors()) return; // 等参数修正后，下一次改动会重新排期
    if (this.activeNumberFields > 0) {
      this.scheduleAutoSave(this.options.focusRecheckDelay);
      return;
    }
    void this.save(false);
  }

  private scheduleAutoSave(delay = this.options.autoSaveDelay): void {
    this.clearAutoSaveTimer();
    this.autoSaveTimer = setTimeout(() => {
      this.autoSaveTimer = null;
      this.autoSaveTick();
    }, delay);
  }

  private clearAutoSaveTimer(): void {
    if (this.autoSaveTimer !== null) {
      clearTimeout(this.autoSaveTimer);
      this.autoSaveTimer = null;
    }
  }

  private hasErrors(): boolean {
    return Object.keys(this.state.errors).length > 0;
  }

  private buildWorkspace(): PersistedWorkspace {
    return { version: 1, scenarios: this.state.scenarios, selectedId: this.state.selectedId };
  }

  private currentSignature(): string {
    return JSON.stringify({ scenarios: this.state.scenarios, selectedId: this.state.selectedId });
  }

  private applyScenarios(scenarios: FinanceScenario[], selectedId: string, message: string, dirtyId?: string): void {
    const errors: Record<string, ValidationErrors> = {};
    const projections: ScenarioProjection[] = [];
    scenarios.forEach((scenario) => {
      const scenarioErrors = validateScenario(scenario);
      if (Object.keys(scenarioErrors).length) errors[scenario.id] = scenarioErrors;
      else projections.push(calculateProjection(scenario));
    });
    if (dirtyId) this.dirtyIds.add(dirtyId);
    this.setState({
      scenarios,
      selectedId,
      errors,
      projections,
      status: Object.keys(errors).length ? 'editing' : 'ready',
      message,
      ...(dirtyId ? { dirty: true, saveState: 'dirty' as SaveState, dirtyScenarioIds: [...this.dirtyIds] } : {}),
    });
    if (dirtyId) this.scheduleAutoSave();
  }

  private setState(patch: Partial<MoneyScenarioState>): void {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener(this.state));
  }
}
