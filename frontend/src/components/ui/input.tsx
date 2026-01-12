import * as React from "react"
import { cn } from "@/utils/cn"

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
    error?: boolean
    success?: boolean
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
    ({ className, type, error, success, ...props }, ref) => {
        return (
            <input
                type={type}
                className={cn(
                    "flex h-12 w-full rounded-xl border-[3px] border-black bg-white px-4 py-3 text-base font-medium placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
                    "focus:ring-black focus:shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]",
                    error && "border-[#E7000B] focus:ring-[#E7000B]",
                    success && "border-[#10B981] focus:ring-[#10B981]",
                    className
                )}
                ref={ref}
                {...props}
            />
        )
    }
)
Input.displayName = "Input"

export { Input }
