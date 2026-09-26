export type ScenarioField =
  | 'principal'
  | 'recurring'
  | 'years'
  | 'annualRate'
  | 'inflationRate'
  | 'feeRate';

export interface FinanceScenario {
  id: string;
  name: string;
  color: string;
  principal: number;
  recurring: number;
  years: number;
  annualRate: number;
  inflationRate: number;
  feeRate: number;
}

export interface ProjectionPoint {
  year: number;
  nominal: number;
  real: number;
  invested: number;
}

export interface ScenarioProjection {
  scenarioId: string;
  points: ProjectionPoint[];
  finalValue: number;
  finalRealValue: number;
  totalInvested: number;
}

export type ValidationErrors = Partial<Record<ScenarioField, string>>;

export interface PersistedWorkspace {
  version: 1;
  scenarios: FinanceScenario[];
  selectedId: string;
}
