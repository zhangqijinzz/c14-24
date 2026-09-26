import { useEffect, useState } from 'react';
import { LocalScenarioRepository } from './repository';
import { MoneyScenarioViewModel } from './viewModel';

export function useMoneyScenario(): MoneyScenarioViewModel {
  const [viewModel] = useState(() => new MoneyScenarioViewModel(new LocalScenarioRepository()));
  const [, refresh] = useState(0);
  useEffect(() => {
    const unsubscribe = viewModel.subscribe(() => refresh((value) => value + 1));
    void viewModel.init();
    return () => { unsubscribe(); };
  }, [viewModel]);
  return viewModel;
}
