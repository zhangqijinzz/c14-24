import type { SaveStatus } from '../viewModel';

interface Props {
  saveStatus: SaveStatus;
  dirty: boolean;
  message: string;
  onRetry: () => void;
}

const STATUS_TEXT: Partial<Record<SaveStatus, string>> = {
  dirty: '有未保存的改动',
  saving: '正在保存…',
  saved: '已保存',
  error: '保存失败，改动仍保留',
};

export function SaveIndicator({ saveStatus, dirty, message, onRetry }: Props) {
  const text = STATUS_TEXT[saveStatus] ?? message;
  return (
    <div className={`save-status save-status--${saveStatus}`} role="status" aria-live="polite">
      <span className="save-status__dot" />
      <span className="save-status__text">{text}</span>
      {saveStatus === 'error' && dirty && (
        <button className="retry-button" type="button" onClick={onRetry}>重试</button>
      )}
    </div>
  );
}
