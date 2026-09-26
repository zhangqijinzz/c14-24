import { formatMoney } from '../domain';
import type { FinanceScenario, ScenarioProjection } from '../types';

interface Props { scenarios: FinanceScenario[]; projections: ScenarioProjection[] }

export function ScenarioTable({ scenarios, projections }: Props) {
  return (
    <div className="table-wrap">
      <table>
        <thead><tr><th>情景</th><th>累计投入</th><th>名义终值</th><th>扣除通胀后</th><th>增值倍数</th></tr></thead>
        <tbody>
          {scenarios.map((scenario) => {
            const projection = projections.find((item) => item.scenarioId === scenario.id);
            if (!projection) return <tr key={scenario.id}><td><span className="table-dot" style={{ background: scenario.color }} />{scenario.name}</td><td colSpan={4} className="invalid-cell">参数待修正</td></tr>;
            return <tr key={scenario.id}><td><span className="table-dot" style={{ background: scenario.color }} />{scenario.name}</td><td>¥ {formatMoney(projection.totalInvested)}</td><td className="strong">¥ {formatMoney(projection.finalValue)}</td><td>¥ {formatMoney(projection.finalRealValue)}</td><td>{(projection.finalValue / projection.totalInvested).toFixed(1)}x</td></tr>;
          })}
        </tbody>
      </table>
    </div>
  );
}
