import { formatMoney } from '../domain';
import type { FinanceScenario, ScenarioProjection } from '../types';

interface Props { scenarios: FinanceScenario[]; projections: ScenarioProjection[] }

export function ComparisonChart({ scenarios, projections }: Props) {
  const width = 760;
  const height = 300;
  const pad = { top: 24, right: 24, bottom: 36, left: 62 };
  const maxYears = Math.max(...projections.map((projection) => projection.points[projection.points.length - 1]?.year ?? 1), 1);
  const maxValue = Math.max(...projections.flatMap((projection) => projection.points.map((point) => point.nominal)), 1);
  const x = (year: number) => pad.left + (year / maxYears) * (width - pad.left - pad.right);
  const y = (value: number) => height - pad.bottom - (value / maxValue) * (height - pad.top - pad.bottom);
  const ticks = [0, 0.25, 0.5, 0.75, 1];

  return (
    <div className="chart-shell">
      <div className="chart-legend">
        {scenarios.map((scenario) => <span key={scenario.id}><i style={{ background: scenario.color }} />{scenario.name}</span>)}
        <span className="legend-note">名义终值 · 情景模拟</span>
      </div>
      <svg className="chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="情景终值趋势比较图">
        {ticks.map((tick) => {
          const value = maxValue * tick;
          return <g key={tick}><line x1={pad.left} x2={width - pad.right} y1={y(value)} y2={y(value)} className="grid-line" /><text x={pad.left - 10} y={y(value) + 4} textAnchor="end" className="axis-label">{formatMoney(value)}</text></g>;
        })}
        <text x={pad.left} y={height - 10} className="axis-label">第 0 年</text>
        <text x={width - pad.right} y={height - 10} textAnchor="end" className="axis-label">第 {maxYears} 年</text>
        {projections.map((projection) => {
          const scenario = scenarios.find((item) => item.id === projection.scenarioId);
          if (!scenario) return null;
          const path = projection.points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${x(point.year)} ${y(point.nominal)}`).join(' ');
          return <path key={projection.scenarioId} d={path} className="chart-line" stroke={scenario.color} />;
        })}
      </svg>
    </div>
  );
}
