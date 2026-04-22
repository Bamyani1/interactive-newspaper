import * as React from "react";

type ButtonVariant = "primary" | "secondary" | "accent" | "ghost" | "icon" | "link";
type ButtonSize = "sm" | "md";

type CommonProps = {
    variant?: ButtonVariant;
    size?: ButtonSize;
    className?: string;
    children: React.ReactNode;
};

type ButtonAsButton = CommonProps &
    Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, keyof CommonProps> & {
        as?: "button";
    };

type ButtonAsAnchor = CommonProps &
    Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, keyof CommonProps> & {
        as: "a";
        href: string;
    };

export type ButtonProps = ButtonAsButton | ButtonAsAnchor;

const base =
    "inline-flex items-center justify-center gap-2 font-mono uppercase " +
    "transition-colors duration-fast ease-default cursor-pointer " +
    "focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 " +
    "disabled:opacity-50 disabled:cursor-not-allowed";

const sizes: Record<ButtonSize, string> = {
    sm: "px-3 py-1 text-[0.6875rem] tracking-label-sm",
    md: "px-4 py-2 text-xs tracking-label-md",
};

const variants: Record<ButtonVariant, string> = {
    primary:
        "bg-[var(--color-text-body)] text-[var(--color-text-inverse)] " +
        "border border-[var(--color-text-body)] font-semibold " +
        "hover:bg-[var(--color-accent)] hover:border-[var(--color-accent)] " +
        "focus-visible:outline-[var(--color-focus-ring)]",
    secondary:
        "bg-transparent text-[var(--color-text-body)] " +
        "border border-[var(--color-text-body)] font-semibold " +
        "hover:bg-[var(--color-text-body)] hover:text-[var(--color-text-inverse)] " +
        "focus-visible:outline-[var(--color-focus-ring)]",
    accent:
        "bg-[var(--color-accent)] text-[var(--color-text-inverse)] " +
        "border border-[var(--color-accent)] font-semibold " +
        "hover:bg-[var(--color-accent-deep)] hover:border-[var(--color-accent-deep)] " +
        "focus-visible:outline-[var(--color-focus-ring)]",
    ghost:
        "bg-transparent text-[var(--color-text-body)] " +
        "border border-[var(--color-rule)] " +
        "hover:border-[var(--color-text-body)] " +
        "focus-visible:outline-[var(--color-focus-ring)]",
    icon:
        "bg-transparent text-[var(--color-text-muted)] border-0 " +
        "p-2 rounded-sm " +
        "hover:text-[var(--color-accent)] hover:bg-[var(--color-accent-wash)] " +
        "focus-visible:outline-[var(--color-focus-ring)]",
    link:
        "bg-transparent border-0 p-0 " +
        "text-[var(--color-accent)] underline decoration-[0.05em] underline-offset-[0.12em] " +
        "decoration-[color-mix(in_srgb,var(--color-accent)_40%,transparent)] " +
        "hover:text-[var(--color-accent-deep)] hover:decoration-[var(--color-accent-deep)] " +
        "uppercase tracking-label-sm font-semibold " +
        "focus-visible:outline-[var(--color-focus-ring)]",
};

export const Button = React.forwardRef<
    HTMLButtonElement | HTMLAnchorElement,
    ButtonProps
>((props, ref) => {
    const {
        variant = "primary",
        size = "md",
        className = "",
        children,
        ...rest
    } = props;

    const classes = `${base} ${sizes[size]} ${variants[variant]} ${className}`.trim();

    if (props.as === "a") {
        const { as: _as, ...anchorProps } = rest as ButtonAsAnchor;
        void _as;
        return (
            <a
                ref={ref as React.Ref<HTMLAnchorElement>}
                className={classes}
                {...anchorProps}
            >
                {children}
            </a>
        );
    }

    const { as: _as, type, ...buttonProps } = rest as ButtonAsButton;
    void _as;
    return (
        <button
            ref={ref as React.Ref<HTMLButtonElement>}
            type={type ?? "button"}
            className={classes}
            {...buttonProps}
        >
            {children}
        </button>
    );
});

Button.displayName = "Button";
