"use client";

import { useRef } from "react";
import { useServerInsertedHTML } from "next/navigation";
import { THEME_INITIALIZER_SCRIPT } from "../lib/theme";

/**
 * Insert the saved-mode initializer into the server document head without
 * making a script element part of the client-rendered React tree.
 */
export function ThemePrepaintScript() {
  const insertedForThisDocument = useRef(false);

  useServerInsertedHTML(() => {
    if (insertedForThisDocument.current) return null;
    insertedForThisDocument.current = true;

    return (
      <script
        id="theme-mode-initializer"
        dangerouslySetInnerHTML={{ __html: THEME_INITIALIZER_SCRIPT }}
      />
    );
  });

  return null;
}
