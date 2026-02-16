"use client";

import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { TRANSITIONS } from "@/shared/motion/motionTokens";
import { ArticleCard } from "../ArticleCard";
import type { Article } from "@/src/types";

interface ExpandedArticleSlotProps {
  article: Article | null;
  expandedRef: React.RefObject<HTMLDivElement | null>;
  onToggle: () => void;
  onViewOriginal: (article: Article) => void;
}

export const ExpandedArticleSlot: React.FC<ExpandedArticleSlotProps> = ({
  article,
  expandedRef,
  onToggle,
  onViewOriginal,
}) => (
  <AnimatePresence mode="wait">
    {article && (
      <motion.div
        key={article.id}
        ref={expandedRef}
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 18 }}
        transition={TRANSITIONS.base}
      >
        <ArticleCard
          article={article}
          isExpanded
          onToggle={onToggle}
          onViewOriginal={onViewOriginal}
        />
      </motion.div>
    )}
  </AnimatePresence>
);
