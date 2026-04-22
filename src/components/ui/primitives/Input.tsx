import * as React from "react";

export type InputProps = Omit<
    React.InputHTMLAttributes<HTMLInputElement>,
    "size"
> & {
    /** Visual size — md = default form input, sm = compact / inline. */
    size?: "sm" | "md";
    /** Add an aria-invalid red border when true (form validation). */
    invalid?: boolean;
};

const base =
    "block w-full font-body bg-[var(--color-bg-paper-soft)] " +
    "text-[var(--color-text-body)] " +
    "border border-[var(--color-text-body)] rounded-sm " +
    "placeholder:text-[var(--color-text-faint)] " +
    "transition-colors duration-fast ease-default " +
    "focus:outline-none " +
    "focus-visible:border-[var(--color-accent)] " +
    "focus-visible:outline-2 focus-visible:outline-offset-2 " +
    "focus-visible:outline-[var(--color-focus-ring)] " +
    "disabled:opacity-50 disabled:cursor-not-allowed";

const sizes = {
    sm: "px-3 py-2 text-sm",
    md: "px-4 py-3 text-base",
};

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
    ({ size = "md", invalid = false, className = "", ...rest }, ref) => {
        const invalidClass = invalid
            ? " border-[var(--color-accent)] outline-2 outline-offset-2 outline-[var(--color-accent)]"
            : "";
        return (
            <input
                ref={ref}
                aria-invalid={invalid || undefined}
                className={`${base} ${sizes[size]}${invalidClass} ${className}`.trim()}
                {...rest}
            />
        );
    },
);

Input.displayName = "Input";
