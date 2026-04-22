import * as React from "react";

export type CardVariant = "default" | "inset";

export type CardProps = Omit<
    React.HTMLAttributes<HTMLElement>,
    "children"
> & {
    variant?: CardVariant;
    /** Override the wrapping element. Defaults to `<article>`. */
    as?: "article" | "section" | "div" | "aside";
    children: React.ReactNode;
};

const base = "p-6";

const variants: Record<CardVariant, string> = {
    default:
        "bg-[var(--color-bg-paper-soft)] border border-[var(--color-rule-hairline)]",
    inset:
        "bg-[var(--color-bg-inset)]",
};

export const Card = React.forwardRef<HTMLElement, CardProps>(
    ({ as = "article", variant = "default", className = "", children, ...rest }, ref) => {
        const Tag = as as React.ElementType;
        const classes = `${base} ${variants[variant]} ${className}`.trim();
        return (
            <Tag ref={ref} className={classes} {...rest}>
                {children}
            </Tag>
        );
    },
);

Card.displayName = "Card";
