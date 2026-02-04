"use client";

import React from "react";
import { LazyMotion, MotionConfig, domAnimation } from "framer-motion";
import { TRANSITIONS } from "./motionTokens";

interface MotionProviderProps {
  children: React.ReactNode;
}

export const MotionProvider: React.FC<MotionProviderProps> = ({ children }) => {
  return (
    <LazyMotion features={domAnimation}>
      <MotionConfig reducedMotion="user" transition={TRANSITIONS.base}>
        {children}
      </MotionConfig>
    </LazyMotion>
  );
};
