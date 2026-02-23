"use client";

import { useState, useRef, useCallback } from "react";
import type { AskResponse } from "@/src/types";

interface UseAskArchiveReturn {
  answer: AskResponse | null;
  isLoading: boolean;
  error: string | null;
  submit: (question: string) => void;
  reset: () => void;
}

export function useAskArchive(): UseAskArchiveReturn {
  const [answer, setAnswer] = useState<AskResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const submit = useCallback((question: string) => {
    const trimmed = question.trim();
    if (!trimmed) return;

    // Abort any in-flight request
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setIsLoading(true);
    setError(null);
    setAnswer(null);

    fetch("/api/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: trimmed }),
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error(body?.error || `Request failed: ${res.status}`);
        }
        return res.json();
      })
      .then((data: AskResponse) => {
        if (!controller.signal.aborted) {
          setAnswer(data);
        }
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        if (!controller.signal.aborted) {
          setError(err instanceof Error ? err.message : "Something went wrong");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      });
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setAnswer(null);
    setError(null);
    setIsLoading(false);
  }, []);

  return { answer, isLoading, error, submit, reset };
}
