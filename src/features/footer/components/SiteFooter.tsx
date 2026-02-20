"use client";

import React from "react";
import Link from "next/link";

export interface SiteFooterProps {
    primaryAction?: React.ReactNode;
    className?: string;
}

export const SiteFooter: React.FC<SiteFooterProps> = ({
    primaryAction,
    className = "",
}) => {
    const footerClassName = ["site-footer", className].filter(Boolean).join(" ");

    return (
        <footer className={footerClassName}>
            {primaryAction ? (
                <div className="site-footer__primary">
                    {primaryAction}
                </div>
            ) : null}
            <div className="site-footer__inner">
                <div className="site-footer__links">
                    <Link
                        href="/"
                        className="site-footer__link"
                    >
                        Home
                    </Link>
                    <span className="site-footer__separator" aria-hidden="true">•</span>
                    <Link
                        href="/about"
                        className="site-footer__link"
                    >
                        About
                    </Link>
                    <span className="site-footer__separator" aria-hidden="true">•</span>
                    <Link
                        href="/contact"
                        className="site-footer__link"
                    >
                        Contact
                    </Link>
                </div>
            </div>
        </footer>
    );
};
