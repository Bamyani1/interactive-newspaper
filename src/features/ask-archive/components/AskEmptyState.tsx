import React from "react";

export const AskEmptyState: React.FC = () => {
  return (
    <div className="ask-empty-state">
      <p className="ask-empty-label">Ask the Research Desk</p>
      <p className="ask-empty-description">
        Ask questions about Ohio Wesleyan history from the 1960s. Answers are
        grounded in articles from The Transcript Archive, with sources you can
        verify.
      </p>
      <p className="ask-empty-stats">Powered by The Transcript Archive</p>
    </div>
  );
};
