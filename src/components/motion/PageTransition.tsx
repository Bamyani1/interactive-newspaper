"use client";

import React from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { usePathname } from "next/navigation";
import { pageVariants } from "./motionTokens";

interface PageTransitionProps {
  children: React.ReactNode;
}

export const PageTransition: React.FC<PageTransitionProps> = ({ children }) => {
  const pathname = usePathname();
  const shouldReduceMotion = useReducedMotion();

  // Only trigger exit/enter when the route structure changes (e.g. "/" ↔ "/edition")
  // Date-to-date navigation within /edition/ uses the page's internal AnimatePresence
  const routeKey = pathname?.startsWith("/edition") ? "/edition" : pathname;

  if (shouldReduceMotion) {
    return <div>{children}</div>;
  }

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={routeKey}
        variants={pageVariants}
        initial="hidden"
        animate="show"
        exit="exit"
        style={{ minHeight: "100vh" }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
};
