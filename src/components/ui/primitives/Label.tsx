import * as React from "react";

export type LabelSize = "xs" | "sm" | "md";
export type LabelTone = "muted" | "accent" | "body";

export type LabelProps = Omit<
    React.HTMLAttributes<HTMLSpanElement>,
    "children"
> & {
    size?: LabelSize;
    tone?: LabelTone;
    /** Override the wrapping element. Defaults to <span>. */
    as?: "span" | "p" | "div" | "small";
    children: React.ReactNode;
};

const sizes: Record<LabelSize, string> = {
    xs: "text-xs tracking-label-sm",
    sm: "text-xs tracking-label-md",
    md: "text-xs tracking-label-md",
};

const tones: Record<LabelTone, string> = {
    muted:  "text-[var(--color-text-muted)]",
    accent: "text-[var(--color-accent-text)]",
    body:   "text-[var(--color-text-body)]",
};

const base = "font-mono uppercase";

export const Label = React.forwardRef<HTMLElement, LabelProps>(
    ({ size = "sm", tone = "muted", as = "span", className = "", children, ...rest }, ref) => {
        const Tag = as as React.ElementType;
        return (
            <Tag
                ref={ref}
                className={`${base} ${sizes[size]} ${tones[tone]} ${className}`.trim()}
                {...rest}
            >
                {children}
            </Tag>
        );
    },
);

Label.displayName = "Label";
