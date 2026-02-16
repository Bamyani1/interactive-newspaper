"use client";

import React, { useState } from "react";
import type { SectionId } from "@/src/types";
import { MOCK_SECTIONS } from "./mockData";
import { BroadsheetCompact } from "./BroadsheetCompact";
import { EditorialIndex } from "./EditorialIndex";
import { DispatchMono } from "./DispatchMono";
import { SpecimenCentered } from "./SpecimenCentered";
import { LedgerRuled } from "./LedgerRuled";
import "./mocks.css";

const VARIANTS = [
  {
    label: "Broadsheet Compact",
    desc: "Numbered, tight, small-caps with hairline separators",
    Component: BroadsheetCompact,
  },
  {
    label: "Fleuron Classic",
    desc: "Double rules, fleuron, middot leaders, endmark",
    Component: EditorialIndex,
  },
  {
    label: "Dispatch Mono",
    desc: "Monospace teleprinter log with zero-padded entries",
    Component: DispatchMono,
  },
  {
    label: "Specimen Centered",
    desc: "Type catalog with ornamental dividers and generous whitespace",
    Component: SpecimenCentered,
  },
  {
    label: "Ledger Ruled",
    desc: "Dense ruled register with section marks",
    Component: LedgerRuled,
  },
] as const;

export default function MocksPage() {
  const [active1, setActive1] = useState<SectionId>("Top");
  const [active2, setActive2] = useState<SectionId>("Top");
  const [active3, setActive3] = useState<SectionId>("Top");
  const [active4, setActive4] = useState<SectionId>("Top");
  const [active5, setActive5] = useState<SectionId>("Top");

  const states = [
    { active: active1, set: setActive1 },
    { active: active2, set: setActive2 },
    { active: active3, set: setActive3 },
    { active: active4, set: setActive4 },
    { active: active5, set: setActive5 },
  ];

  return (
    <div
      className="min-h-screen p-8"
      style={{ background: "var(--color-bg-primary)" }}
    >
      <header className="mb-10 text-center">
        <h1
          className="font-header text-3xl font-bold mb-2"
          style={{ color: "var(--color-text-primary)" }}
        >
          Sidebar Navigation — Typography-First Family
        </h1>
        <p
          className="font-body text-base"
          style={{ color: "var(--color-text-secondary)" }}
        >
          Five editorial index variations. Same data, different typographic personalities.
        </p>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-8 max-w-[1400px] mx-auto">
        {VARIANTS.map((variant, i) => {
          const { active, set } = states[i];
          return (
            <div key={variant.label} className="flex flex-col items-center">
              <div className="mb-3 text-center">
                <span
                  className="font-mono text-xs font-bold mr-2"
                  style={{ color: "var(--color-accent)" }}
                >
                  {i + 1}.
                </span>
                <span
                  className="font-header text-sm font-semibold"
                  style={{ color: "var(--color-text-primary)" }}
                >
                  {variant.label}
                </span>
                <p
                  className="font-body text-xs mt-1"
                  style={{ color: "var(--color-text-secondary)" }}
                >
                  {variant.desc}
                </p>
              </div>
              <div
                className="w-[var(--sidebar-nav-width)] min-h-[500px] rounded overflow-hidden"
                style={{ boxShadow: "var(--shadow-lg)" }}
              >
                <variant.Component
                  sections={MOCK_SECTIONS}
                  activeSection={active}
                  onSelect={set}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
