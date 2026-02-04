"use client";

import React from "react";
import { motion } from "framer-motion";

const shimmerAnimation = {
  initial: { x: "-100%" },
  animate: { x: "100%" },
  transition: {
    repeat: Infinity,
    duration: 1.5,
    ease: "linear" as const,
  },
};

interface SkeletonBaseProps {
  className?: string;
}

export const SkeletonText: React.FC<SkeletonBaseProps & { lines?: number }> = ({
  className = "",
  lines = 1,
}) => {
  return (
    <div className={`space-y-2 ${className}`}>
      {Array.from({ length: lines }).map((_, i) => (
        <div
          key={i}
          className="relative overflow-hidden rounded bg-[var(--color-text-primary)]/10"
          style={{ height: "1em", width: i === lines - 1 && lines > 1 ? "60%" : "100%" }}
        >
          <motion.div
            className="absolute inset-0 bg-gradient-to-r from-transparent via-[var(--color-text-primary)]/5 to-transparent"
            {...shimmerAnimation}
          />
        </div>
      ))}
    </div>
  );
};

export const SkeletonImage: React.FC<SkeletonBaseProps> = ({ className = "" }) => {
  return (
    <div
      className={`relative overflow-hidden rounded bg-[var(--color-text-primary)]/10 ${className}`}
    >
      <motion.div
        className="absolute inset-0 bg-gradient-to-r from-transparent via-[var(--color-text-primary)]/5 to-transparent"
        {...shimmerAnimation}
      />
    </div>
  );
};

export const SkeletonCard: React.FC<SkeletonBaseProps> = ({ className = "" }) => {
  return (
    <div
      className={`article-card px-5 md:px-6 py-6 md:py-8 ${className}`}
    >
      <div className="flex gap-6 items-start">
        {/* Content area */}
        <div className="flex-1 space-y-3 pl-2 md:pl-3">
          {/* Meta line */}
          <div className="flex items-center gap-2">
            <SkeletonText className="w-16" />
            <span className="opacity-20">•</span>
            <SkeletonText className="w-24" />
          </div>

          {/* Headline */}
          <SkeletonText className="w-3/4" />
          <SkeletonText className="w-1/2" />

          {/* Author */}
          <SkeletonText className="w-32" />

          {/* Summary */}
          <div className="mt-2">
            <SkeletonText lines={2} />
          </div>
        </div>

        {/* Thumbnail */}
        <SkeletonImage className="w-[120px] aspect-square shrink-0" />
      </div>
    </div>
  );
};

interface SkeletonFeedProps {
  count?: number;
}

export const SkeletonFeed: React.FC<SkeletonFeedProps> = ({ count = 4 }) => {
  return (
    <div className="flex flex-col gap-6 max-w-5xl mx-auto w-full px-4 md:px-6 py-8">
      {Array.from({ length: count }).map((_, i) => (
        <motion.div
          key={i}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.1, duration: 0.3 }}
        >
          <SkeletonCard />
        </motion.div>
      ))}
    </div>
  );
};
