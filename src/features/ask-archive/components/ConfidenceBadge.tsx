import React from "react";

interface ConfidenceBadgeProps {
  confidence: "low" | "medium" | "high";
}

const LABELS: Record<string, string> = {
  high: "High confidence",
  medium: "Medium confidence",
  low: "Limited sources",
};

export const ConfidenceBadge: React.FC<ConfidenceBadgeProps> = ({ confidence }) => {
  return (
    <span className="ask-confidence-badge">
      <span className={`ask-confidence-dot ask-confidence-dot--${confidence}`} />
      {LABELS[confidence]}
    </span>
  );
};
