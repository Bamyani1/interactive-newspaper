"use client";

import React, { useEffect } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { usePathname } from "next/navigation";
import { crossfadeVariants } from "./motionTokens";

interface PageTransitionProps {
  children: React.ReactNode;
}

export const PageTransition: React.FC<PageTransitionProps> = ({ children }) => {
  const pathname = usePathname();
  const shouldReduceMotion = useReducedMotion();

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [pathname]);

  const routeKey = pathname?.startsWith("/edition") ? "/edition" : pathname;

  if (shouldReduceMotion) {
    return <div style={{ minHeight: "100vh" }}>{children}</div>;
  }

  return (
    <div style={{ display: "grid", minHeight: "100vh", background: "#fff" }}>
      <AnimatePresence mode="sync">
        <motion.div
          key={routeKey}
          variants={crossfadeVariants}
          initial="hidden"
          animate="show"
          exit="exit"
          style={{ gridArea: "1 / 1", minHeight: "100vh", overflow: "hidden" }}
        >
          {children}
        </motion.div>
      </AnimatePresence>
    </div>
  );
};
