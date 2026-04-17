"use client";

import React from "react";
import { AlertTriangle } from "lucide-react";

interface LowConfidenceCaveatProps {
  confidence: "low" | "medium" | "high";
}

export const LowConfidenceCaveat: React.FC<LowConfidenceCaveatProps> = ({ confidence }) => {
  if (confidence !== "low") return null;

  return (
    <aside className="ask-caveat" role="note">
      <div className="ask-caveat-header">
        <AlertTriangle size={14} aria-hidden="true" />
        <span className="ask-caveat-label">Heads up</span>
      </div>
      <p className="ask-caveat-body">
        Limited sources found for this question. The answer below may be incomplete or imprecise — verify against the source articles.
      </p>
    </aside>
  );
};
