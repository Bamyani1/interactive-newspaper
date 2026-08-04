"use client";

import { useRef } from "react";
import { useServerInsertedHTML } from "next/navigation";
import { THEME_INITIALIZER_SCRIPT } from "../lib/theme";

/**
 * Insert the saved-mode initializer into the server document head without
 * making a script element part of the client-rendered React tree.
 *
 * `nonce` comes from the per-request CSP nonce (set in middleware.ts). It must
 * be applied so this inline script runs under the nonce-based script-src, which
 * no longer allows 'unsafe-inline'.
 */
export function ThemePrepaintScript({ nonce }: { nonce?: string }) {
  const insertedForThisDocument = useRef(false);

  useServerInsertedHTML(() => {
    if (insertedForThisDocument.current) return null;
    insertedForThisDocument.current = true;

    return (
      <script
        id="theme-mode-initializer"
        nonce={nonce}
        dangerouslySetInnerHTML={{ __html: THEME_INITIALIZER_SCRIPT }}
      />
    );
  });

  return null;
}
