import { useEffect, useState } from 'react';
import { LocalScenarioRepository } from './repository';
import { MoneyScenarioViewModel } from './viewModel';

function isSaveShortcut(event: KeyboardEvent): boolean {
  return (event.metaKey || event.ctrlKey) && !event.altKey && (event.key.toLowerCase() === 's' || event.code === 'KeyS');
}

export function useMoneyScenario(): MoneyScenarioViewModel {
  const [viewModel] = useState(() => new MoneyScenarioViewModel(new LocalScenarioRepository()));
  const [, refresh] = useState(0);

  useEffect(() => {
    const unsubscribe = viewModel.subscribe(() => refresh((value) => value + 1));
    void viewModel.init();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isSaveShortcut(event)) return;
      // 必须拦截，否则浏览器弹出“保存网页”对话框
      event.preventDefault();
      void viewModel.save(true);
    };
    const handleUnload = () => viewModel.flushPendingToLocalStorage();

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('pagehide', handleUnload);
    window.addEventListener('beforeunload', handleUnload);
    return () => {
      unsubscribe();
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('pagehide', handleUnload);
      window.removeEventListener('beforeunload', handleUnload);
    };
  }, [viewModel]);

  return viewModel;
}
