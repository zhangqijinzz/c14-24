import type { SaveState } from '../viewModel';

interface Props {
  saveState: SaveState;
  message: string;
  lastSavedAt: number | null;
  onRetry: () => void;
}

function formatTime(value: number): string {
  return new Date(value).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

export function SaveStatus({ saveState, message, lastSavedAt, onRetry }: Props) {
  if (saveState === 'saving') {
    return (
      <span className="save-status saving" role="status" aria-live="polite">
        <span className="save-spinner" aria-hidden="true" />
        保存中…
      </span>
    );
  }

  if (saveState === 'dirty') {
    return (
      <span className="save-status dirty" role="status" aria-live="polite" title="停手后会自动保存，也可按 ⌘S / Ctrl+S 立即保存">
        <span className="save-indicator" aria-hidden="true" />
        有未保存的改动
      </span>
    );
  }

  if (saveState === 'idle') {
    return (
      <span className="save-status idle" role="status">
        <span className="save-indicator" aria-hidden="true" />
        {message}
      </span>
    );
  }

  if (saveState === 'error') {
    return (
      <span className="save-status error" role="alert">
        <span className="save-indicator" aria-hidden="true" />
        {message}
        <button className="retry-button" type="button" onClick={onRetry}>重试</button>
      </span>
    );
  }

  return (
    <span className="save-status saved" role="status" aria-live="polite">
      <span className="save-indicator" aria-hidden="true" />
      {lastSavedAt ? `已保存 ${formatTime(lastSavedAt)}` : message}
    </span>
  );
}
