import { useState, useCallback } from "react";
import type { Article } from "@/src/types";

interface ScanViewerState {
    open: boolean;
    pageIndex: number;
}

interface UseScanViewerReturn {
    viewerState: ScanViewerState;
    openScanViewer: (article: Article) => void;
    closeScanViewer: () => void;
    selectPage: (index: number) => void;
}

export function useScanViewer(scannedPages: string[]): UseScanViewerReturn {
    const [viewerState, setViewerState] = useState<ScanViewerState>({ open: false, pageIndex: 0 });

    const openScanViewer = useCallback((article: Article) => {
        if (scannedPages.length === 0) return;
        const page = article.page || 1;
        const clampedIndex = Math.max(0, Math.min(scannedPages.length - 1, (page ?? 1) - 1));
        setViewerState({ open: true, pageIndex: clampedIndex });
    }, [scannedPages]);

    const closeScanViewer = useCallback(() => {
        setViewerState(prev => ({ ...prev, open: false }));
    }, []);

    const selectPage = useCallback((index: number) => {
        setViewerState({ open: true, pageIndex: index });
    }, []);

    return { viewerState, openScanViewer, closeScanViewer, selectPage };
}
