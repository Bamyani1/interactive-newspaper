"use client";

import React from "react";
import type { TurnImage } from "../lib/dedup-source-images";

export interface AnswerImageContextValue {
  /** URL → metadata lookup; keyed by raw and %20-encoded forms. */
  metaByUrl: Map<string, TurnImage & { index: number }>;
  /** Open the turn's Lightbox gallery, anchored on the clicked URL. */
  openLightbox: (url: string) => void;
}

export const AnswerImageContext =
  React.createContext<AnswerImageContextValue | null>(null);

export function useAnswerImages(): AnswerImageContextValue | null {
  return React.useContext(AnswerImageContext);
}
