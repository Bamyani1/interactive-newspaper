"use client";

import React from "react";
import { Layers } from "lucide-react";
import type { AskResponse } from "@/src/types";

type Coverage = NonNullable<AskResponse["meta"]["coverage"]>;

interface CoverageNoteProps {
  coverage?: Coverage;
}

const YEAR = /^(\d{4})-/;

/** "1960–1969" for a requested period, or one year when it spans only one. */
function describePeriod(startDate: string, endDate: string): string {
  const from = startDate.slice(0, 4);
  const to = endDate.slice(0, 4);
  return from === to ? from : `${from}–${to}`;
}

/** "1960–1989", or a single year when the scope doesn't span one. */
function describeSpan(coverage: Coverage): string | null {
  const from = coverage.earliestEditionDate?.match(YEAR)?.[1];
  const to = coverage.latestEditionDate?.match(YEAR)?.[1];
  if (!from || !to) return null;
  return from === to ? from : `${from}–${to}`;
}

/**
 * What was actually searchable for this question, shown before the reader
 * judges the answer.
 *
 * The archive holds roughly one issue in eight of a paper that ran weekly
 * for 57 years, and coverage is lopsided — the 1980s alone are 46% of it.
 * A thin answer over a thin slice is honest; a thin answer with no stated
 * scope reads as a broken product. This turns the second into the first.
 *
 * Only present on questions whose wording depends on scope (absence,
 * count, exhaustive) and on comparisons across separate periods — the
 * pipeline computes coverage for those alone, and they are the questions
 * where the number changes how the answer should be read. A comparison
 * gets one count per period: a single "1960–1999" span counted every issue
 * from the decades nobody asked about.
 */
export const CoverageNote: React.FC<CoverageNoteProps> = ({ coverage }) => {
  if (!coverage || coverage.editionCount === 0) return null;

  const periods = coverage.periods ?? [];
  if (periods.length >= 2) {
    return (
      <aside className="ask-coverage" role="note">
        <Layers size={13} aria-hidden="true" className="ask-coverage-icon" />
        <p className="ask-coverage-body">
          <span className="ask-coverage-label">Searched</span>{" "}
          {periods
            .map(
              (period) =>
                `${describePeriod(period.startDate, period.endDate)}: ${period.editionCount.toLocaleString("en-US")} ${period.editionCount === 1 ? "issue" : "issues"}`
            )
            .join(" · ")}
          {coverage.category ? ` in ${coverage.category}` : ""}. That is the indexed scope, not
          everything the paper printed.
        </p>
      </aside>
    );
  }

  const span = describeSpan(coverage);
  const editions = coverage.editionCount.toLocaleString("en-US");
  const articles = coverage.articleCount.toLocaleString("en-US");

  return (
    <aside className="ask-coverage" role="note">
      <Layers size={13} aria-hidden="true" className="ask-coverage-icon" />
      <p className="ask-coverage-body">
        <span className="ask-coverage-label">Searched</span> {editions}{" "}
        {coverage.editionCount === 1 ? "issue" : "issues"}
        {span ? ` from ${span}` : ""} · {articles}{" "}
        {coverage.articleCount === 1 ? "article" : "articles"}
        {coverage.category ? ` in ${coverage.category}` : ""}. That is the indexed scope, not
        everything the paper printed.
      </p>
    </aside>
  );
};
