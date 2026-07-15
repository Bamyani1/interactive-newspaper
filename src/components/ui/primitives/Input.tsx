import * as React from "react";

export type InputProps = React.InputHTMLAttributes<HTMLInputElement> & {
    /** Add an aria-invalid red border when true (form validation). */
    invalid?: boolean;
};

const base =
    "block min-h-11 w-full font-body bg-[var(--color-bg-paper-soft)] " +
    "text-[var(--color-text-body)] " +
    "border border-[var(--color-text-body)] rounded-sm " +
    "px-4 py-3 text-base " +
    "placeholder:text-[var(--color-text-faint)] " +
    "transition-colors duration-fast ease-default " +
    "focus-visible:border-[var(--color-focus-ring)] " +
    "focus-visible:outline-2 focus-visible:outline-offset-2 " +
    "focus-visible:outline-[var(--color-focus-ring)] " +
    "disabled:opacity-50 disabled:cursor-not-allowed motion-reduce:transition-none";

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
    ({ invalid = false, className = "", ...rest }, ref) => {
        const invalidClass = invalid
            ? " border-[var(--color-warning)] outline-2 outline-offset-2 outline-[var(--color-warning)]"
            : "";
        return (
            <input
                ref={ref}
                aria-invalid={invalid || undefined}
                className={`${base}${invalidClass} ${className}`.trim()}
                {...rest}
            />
        );
    },
);

Input.displayName = "Input";
