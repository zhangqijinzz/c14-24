import { useEffect, useState } from 'react';
import { LocalScenarioRepository } from './repository';
import { MoneyScenarioViewModel } from './viewModel';

/**
 * While a number field (年限/收益率/…) is mid-entry its value may be empty or
 * otherwise invalid — pressing the shortcut then must only suppress the
 * browser's "save webpage" dialog, not fire a save against half-typed input.
 */
function focusIsIncompleteNumberInput(): boolean {
  const active = document.activeElement;
  if (!(active instanceof HTMLInputElement) || active.type !== 'number') return false;
  return active.value === '' || !active.validity.valid;
}

function isSaveShortcut(event: KeyboardEvent): boolean {
  return (event.metaKey || event.ctrlKey) && !event.altKey && (event.key === 's' || event.key === 'S');
}

export function useMoneyScenario(): MoneyScenarioViewModel {
  const [viewModel] = useState(() => new MoneyScenarioViewModel(new LocalScenarioRepository()));
  const [, refresh] = useState(0);
  useEffect(() => {
    const unsubscribe = viewModel.subscribe(() => refresh((value) => value + 1));
    void viewModel.init();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isSaveShortcut(event)) return;
      // Always claim the shortcut, including inside the name input, so the
      // browser never opens its own save-webpage dialog.
      event.preventDefault();
      if (focusIsIncompleteNumberInput()) return;
      void viewModel.save(true);
    };

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      const stillPending = viewModel.flushPending();
      if (stillPending) {
        event.preventDefault();
        // Legacy browsers require the prompt string to be set.
        event.returnValue = '';
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      unsubscribe();
      window.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('beforeunload', handleBeforeUnload);
      viewModel.dispose();
    };
  }, [viewModel]);
  return viewModel;
}
