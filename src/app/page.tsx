"use client";

import React, { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useArchive } from "@/features/archive";

export default function Home() {
    const router = useRouter();
    const { setDate, editions, isLoading } = useArchive();

    // Automatically redirect to the latest edition
    useEffect(() => {
        if (!isLoading && editions.length > 0) {
            const latestEdition = editions[editions.length - 1];
            setDate(latestEdition);
            router.push(`/edition/${latestEdition}`);
        }
    }, [editions, isLoading, router, setDate]);

    // Show a simple loading state while redirecting
    return (
        <div className="flex items-center justify-center min-h-screen bg-[var(--color-bg-primary)]">
            <div className="flex flex-col items-center gap-4">
                <Loader2 size={48} className="animate-spin text-[var(--color-accent)]" />
                <p className="text-[var(--color-text-secondary)] font-mono text-sm uppercase tracking-wider">
                    Loading The Transcript...
                </p>
            </div>
        </div>
    );
}
