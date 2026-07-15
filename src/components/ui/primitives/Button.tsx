import * as React from "react";

type ButtonVariant = "primary" | "secondary" | "accent" | "ghost" | "icon" | "link";

type CommonProps = {
    variant?: ButtonVariant;
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
    "inline-flex items-center justify-center gap-2 rounded-sm font-mono text-xs " +
    "font-semibold uppercase tracking-label-md " +
    "transition-colors duration-fast ease-default cursor-pointer " +
    "focus-visible:outline-2 focus-visible:outline-offset-2 " +
    "focus-visible:outline-[var(--color-focus-ring)] " +
    "disabled:opacity-50 disabled:cursor-not-allowed motion-reduce:transition-none";

const variants: Record<ButtonVariant, string> = {
    primary:
        "bg-[var(--color-text-body)] text-[var(--color-text-inverse)] " +
        "border border-[var(--color-text-body)] " +
        "hover:bg-[var(--color-accent)] hover:border-[var(--color-accent)] " +
        "hover:text-[var(--color-text-on-accent)] active:bg-[var(--color-accent-deep)] " +
        "disabled:hover:bg-[var(--color-text-body)] disabled:hover:border-[var(--color-text-body)] " +
        "disabled:hover:text-[var(--color-text-inverse)]",
    secondary:
        "bg-transparent text-[var(--color-text-body)] " +
        "border border-[var(--color-text-body)] " +
        "hover:bg-[var(--color-text-body)] hover:text-[var(--color-text-inverse)] " +
        "active:bg-[var(--color-accent-wash)] active:text-[var(--color-text-body)] " +
        "disabled:hover:bg-transparent disabled:hover:text-[var(--color-text-body)]",
    accent:
        "bg-[var(--color-accent)] text-[var(--color-text-on-accent)] " +
        "border border-[var(--color-accent)] " +
        "hover:bg-[var(--color-accent-deep)] hover:border-[var(--color-accent-deep)] " +
        "active:opacity-90 disabled:hover:bg-[var(--color-accent)] " +
        "disabled:hover:border-[var(--color-accent)]",
    ghost:
        "bg-transparent text-[var(--color-text-body)] " +
        "border border-[var(--color-rule)] " +
        "hover:border-[var(--color-text-body)] active:bg-[var(--color-bg-inset)] " +
        "disabled:hover:border-[var(--color-rule)]",
    icon:
        "bg-transparent text-[var(--color-text-muted)] border-0 " +
        "hover:text-[var(--color-accent-text)] hover:bg-[var(--color-accent-wash)] " +
        "active:text-[var(--color-accent-text-hover)] " +
        "disabled:hover:text-[var(--color-text-muted)] disabled:hover:bg-transparent",
    link:
        "rounded-none bg-transparent border-0 " +
        "text-[var(--color-accent-text)] underline decoration-[0.05em] underline-offset-[0.12em] " +
        "decoration-[color-mix(in_srgb,var(--color-accent-text)_40%,transparent)] " +
        "hover:text-[var(--color-accent-text-hover)] hover:decoration-[var(--color-accent-text-hover)] " +
        "active:opacity-80 " +
        "disabled:hover:text-[var(--color-accent-text)]",
};

export const Button = React.forwardRef<
    HTMLButtonElement | HTMLAnchorElement,
    ButtonProps
>((props, ref) => {
    const {
        variant = "primary",
        className = "",
        children,
        ...rest
    } = props;

    const dimensions =
        variant === "link"
            ? "p-0"
            : variant === "icon"
              ? "size-11 shrink-0 p-2"
              : "min-h-11 px-4 py-2";
    const classes = `${base} ${dimensions} ${variants[variant]} ${className}`.trim();

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
