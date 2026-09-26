import type { CSSProperties } from 'react';
import { fieldLabel } from '../domain';
import type { FinanceScenario, ScenarioField, ValidationErrors } from '../types';

const fields: Array<{ key: ScenarioField; suffix: string; step: string }> = [
  { key: 'principal', suffix: '元', step: '1000' },
  { key: 'recurring', suffix: '元 / 月', step: '100' },
  { key: 'years', suffix: '年', step: '1' },
  { key: 'annualRate', suffix: '% / 年', step: '0.1' },
  { key: 'inflationRate', suffix: '% / 年', step: '0.1' },
  { key: 'feeRate', suffix: '% / 年', step: '0.1' },
];

interface Props {
  scenario: FinanceScenario;
  errors: ValidationErrors;
  onUpdate: (field: ScenarioField, value: number) => void;
  onRename: (name: string) => void;
  onDuplicate: () => void;
  onRemove: () => void;
}

export function ScenarioForm({ scenario, errors, onUpdate, onRename, onDuplicate, onRemove }: Props) {
  return (
    <section className="scenario-card" style={{ '--accent': scenario.color } as CSSProperties}>
      <div className="scenario-card__head">
        <span className="scenario-dot" />
        <input className="scenario-name" aria-label="情景名称" value={scenario.name} onChange={(event) => onRename(event.target.value)} />
        <button className="icon-button" type="button" onClick={onDuplicate} title="复制情景" aria-label="复制情景">＋</button>
        <button className="icon-button muted" type="button" onClick={onRemove} title="删除情景" aria-label="删除情景">×</button>
      </div>
      <div className="field-grid">
        {fields.map(({ key, suffix, step }) => (
          <label className="field" key={key}>
            <span>{fieldLabel(key)}</span>
            <div className={`input-wrap ${errors[key] ? 'has-error' : ''}`}>
              <input
                aria-label={`${scenario.name} ${fieldLabel(key)}`}
                type="number"
                min={key === 'years' ? 1 : undefined}
                max={key === 'years' ? 60 : undefined}
                step={step}
                value={Number.isNaN(scenario[key]) ? '' : scenario[key]}
                onChange={(event) => onUpdate(key, event.target.value === '' ? Number.NaN : Number(event.target.value))}
              />
              <em>{suffix}</em>
            </div>
            {errors[key] && <small className="error-text">{errors[key]}</small>}
          </label>
        ))}
      </div>
    </section>
  );
}
