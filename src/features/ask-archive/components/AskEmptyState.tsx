import React from "react";

export const AskEmptyState: React.FC = () => {
  return (
    <div className="ask-empty-state">
      <p className="ask-empty-label">Ask the Research Desk</p>
      <p className="ask-empty-description">
        Ask questions about Ohio Wesleyan history spanning 1950 to 2006.
        Answers are grounded in articles from The Transcript Archive, with
        sources you can verify.
      </p>
      <p className="ask-empty-stats">Powered by The Transcript Archive</p>
    </div>
  );
};
