import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ArchiveProvider, useArchive } from "@/features/archive";

const ArchiveConsumer = () => {
    const { editions, hasEditions } = useArchive();
    return (
        <output>
            {hasEditions ? editions.join(",") : "empty"}
        </output>
    );
};

describe("ArchiveProvider", () => {
    it("exposes only sorted edition date strings", () => {
        render(
            <ArchiveProvider initialEditions={["2006-04-20", "1960-01-13", "1994-01-19"]}>
                <ArchiveConsumer />
            </ArchiveProvider>,
        );

        expect(screen.getByText("1960-01-13,1994-01-19,2006-04-20")).toBeInTheDocument();
    });

    it("reports an empty archive without client initialization", () => {
        render(
            <ArchiveProvider initialEditions={[]}>
                <ArchiveConsumer />
            </ArchiveProvider>,
        );

        expect(screen.getByText("empty")).toBeInTheDocument();
    });
});
