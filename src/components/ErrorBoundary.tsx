"use client";

import React from "react";

interface ErrorBoundaryProps {
    children: React.ReactNode;
    fallback?: React.ReactNode;
}

interface ErrorBoundaryState {
    hasError: boolean;
    error: Error | null;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
    private errorHeadingRef = React.createRef<HTMLHeadingElement>();

    constructor(props: ErrorBoundaryProps) {
        super(props);
        this.state = { hasError: false, error: null };
    }

    static getDerivedStateFromError(error: Error): ErrorBoundaryState {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
        console.error("ErrorBoundary caught an error:", error, errorInfo);
        this.errorHeadingRef.current?.focus();
    }

    render() {
        if (this.state.hasError) {
            if (this.props.fallback) {
                return this.props.fallback;
            }

            return (
                <main id="main-content" tabIndex={-1} className="min-h-screen flex items-center justify-center p-8 bg-[var(--color-bg-primary)] text-[var(--color-text-primary)]">
                    <div className="max-w-md text-center space-y-4">
                        <h1
                            ref={this.errorHeadingRef}
                            tabIndex={-1}
                            className="font-header text-2xl focus:outline-none"
                        >
                            Something went wrong
                        </h1>
                        <p className="text-sm opacity-70">
                            We couldn’t display this page. Please try again.
                        </p>
                        <button
                            onClick={() => {
                                this.setState({ hasError: false, error: null });
                                window.location.reload();
                            }}
                            className="min-h-[44px] px-6 py-2 border border-current text-sm uppercase tracking-widest hover:bg-[var(--color-accent)] hover:border-[var(--color-accent)] transition-colors focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus-ring)]"
                        >
                            Retry
                        </button>
                    </div>
                </main>
            );
        }

        return this.props.children;
    }
}
