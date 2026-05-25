import { FileCode2 } from "lucide-react";
import type { AppCopy } from "../../i18n/copy";

interface EmptyThreadStateProps {
  copy: AppCopy;
}

export function EmptyThreadState({ copy }: EmptyThreadStateProps) {
  return (
    <div className="empty-state">
      <div className="empty-state-icon">
        <FileCode2 size={32} />
      </div>
      <h3>{copy.thread.emptyTitle}</h3>
      <p>{copy.thread.emptyDescription}</p>
      <div className="empty-state-steps">
        <div className="empty-step">
          <div className="empty-step-num">1</div>
          <span>{copy.thread.setupApiKey}</span>
        </div>
        <div className="empty-step">
          <div className="empty-step-num">2</div>
          <span>{copy.thread.pastePlan}</span>
        </div>
        <div className="empty-step">
          <div className="empty-step-num">3</div>
          <span>{copy.thread.startLoop}</span>
        </div>
      </div>
    </div>
  );
}
