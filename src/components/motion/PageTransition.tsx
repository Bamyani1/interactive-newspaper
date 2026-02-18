"use client";

import React from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { usePathname } from "next/navigation";
import { crossfadeVariants } from "./motionTokens";

interface PageTransitionProps {
  children: React.ReactNode;
}

export const PageTransition: React.FC<PageTransitionProps> = ({ children }) => {
  const pathname = usePathname();
  const shouldReduceMotion = useReducedMotion();

  const routeKey = pathname?.startsWith("/edition") ? "/edition" : pathname;

  if (shouldReduceMotion) {
    return <div style={{ minHeight: "100vh" }}>{children}</div>;
  }

  return (
    <div style={{ display: "grid", minHeight: "100vh", overflow: "clip" }}>
      <AnimatePresence mode="sync">
        <motion.div
          key={routeKey}
          variants={crossfadeVariants}
          initial="hidden"
          animate="show"
          exit="exit"
          style={{ gridArea: "1 / 1", minHeight: "100vh" }}
        >
          {children}
        </motion.div>
      </AnimatePresence>
    </div>
  );
};
