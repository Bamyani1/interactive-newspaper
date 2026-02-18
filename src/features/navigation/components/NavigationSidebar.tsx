"use client";

import React from "react";
import type { SectionId } from "@/src/types";
import { FleuronClassic } from "./variants/FleuronClassic";
import "./variants/variants.css";

export interface NavigationSidebarProps {
    sections: {
        id: SectionId;
        label: string;
        count?: number;
    }[];
    activeSection: SectionId;
    onSelect: (section: SectionId) => void;
}

export const NavigationSidebar: React.FC<NavigationSidebarProps> = (props) => {
    return <FleuronClassic {...props} />;
};
