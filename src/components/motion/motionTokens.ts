export const EASINGS = {
  standard: [0.22, 1, 0.36, 1],
  smooth: [0.4, 0, 0.2, 1],
  gentle: [0.16, 1, 0.3, 1],
} as const;

export const TRANSITIONS = {
  micro: { duration: 0.15, ease: EASINGS.smooth },
  quick: { duration: 0.2, ease: EASINGS.smooth },
  base: { duration: 0.45, ease: EASINGS.standard },
  slow: { duration: 0.6, ease: EASINGS.standard },
} as const;

export const pageVariants = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: TRANSITIONS.slow },
  exit: { opacity: 0, y: -8, transition: TRANSITIONS.quick },
};

export const fadeUp = (distance = 16) => ({
  hidden: { opacity: 0, y: distance },
  show: { opacity: 1, y: 0 },
});

export const fadeDown = (distance = 12) => ({
  hidden: { opacity: 0, y: -distance },
  show: { opacity: 1, y: 0 },
});

export const fadeLeft = (distance = 12) => ({
  hidden: { opacity: 0, x: -distance },
  show: { opacity: 1, x: 0 },
});

export const fadeRight = (distance = 12) => ({
  hidden: { opacity: 0, x: distance },
  show: { opacity: 1, x: 0 },
});

export const cardIn = {
  hidden: { opacity: 0, y: 20, scale: 0.98 },
  show: { opacity: 1, y: 0, scale: 1 },
};

export const staggerContainer = (stagger = 0.08, delayChildren = 0.05) => ({
  hidden: {},
  show: {
    transition: {
      staggerChildren: stagger,
      delayChildren,
    },
  },
});
