import type { SectionId } from "@/src/types";

export interface MockSidebarProps {
  sections: { id: SectionId; label: string; count: number }[];
  activeSection: SectionId;
  onSelect: (id: SectionId) => void;
}

export const MOCK_SECTIONS: MockSidebarProps["sections"] = [
  { id: "Top", label: "Top Stories", count: 3 },
  { id: "News", label: "News", count: 8 },
  { id: "Sports", label: "Sports", count: 5 },
  { id: "Features", label: "Features", count: 4 },
  { id: "Opinion", label: "Opinion", count: 6 },
  { id: "Arts", label: "Arts", count: 3 },
  { id: "Campus Life", label: "Campus Life", count: 7 },
  { id: "Ads", label: "Ads", count: 21 },
];
