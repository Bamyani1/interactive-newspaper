"use client";

import React from "react";
import { motion, useReducedMotion } from "framer-motion";
import { fadeUp, TRANSITIONS } from "./motionTokens";

interface RevealProps {
  children: React.ReactNode;
  className?: string;
  delay?: number;
  distance?: number;
  once?: boolean;
}

export const Reveal: React.FC<RevealProps> = ({
  children,
  className = "",
  delay = 0,
  distance = 16,
  once = true,
}) => {
  const shouldReduceMotion = useReducedMotion();
  const variants = fadeUp(distance);

  return (
    <motion.div
      className={className}
      variants={variants}
      initial={shouldReduceMotion ? false : "hidden"}
      whileInView={shouldReduceMotion ? undefined : "show"}
      viewport={{ once, amount: 0.35 }}
      transition={{ ...TRANSITIONS.base, delay }}
    >
      {children}
    </motion.div>
  );
};
