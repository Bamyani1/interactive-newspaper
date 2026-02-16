export interface SidebarDesign {
  id: string;
  name: string;
  description: string;
}

export const SIDEBAR_DESIGNS: SidebarDesign[] = [
  { id: "default",    name: "Fleuron Classic (Default)", description: "Double rules, fleuron ❧, middot leaders, endmark" },
  { id: "legacy",     name: "Legacy (Chevron)",          description: "Original sidebar — border-left, chevron" },
  { id: "broadsheet", name: "Broadsheet Compact",        description: "Numbered, small-caps, hairline separators" },
  { id: "dispatch",   name: "Dispatch Mono",             description: "Monospace teleprinter log, zero-padded" },
  { id: "specimen",   name: "Specimen Centered",         description: "Centered type catalog, ornamental dividers" },
  { id: "ledger",     name: "Ledger Ruled",              description: "Dense ruled register, section marks" },
];
