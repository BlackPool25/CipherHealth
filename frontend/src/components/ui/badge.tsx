import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/utils/cn"

const badgeVariants = cva(
    "inline-flex items-center gap-1.5 rounded-lg border-2 px-3 py-1 text-sm font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
    {
        variants: {
            variant: {
                default: "border-black bg-black text-white",
                secondary: "border-black bg-gray-100 text-black",
                success: "border-[#10B981] bg-[#ECFDF5] text-[#059669]",
                warning: "border-[#F59E0B] bg-[#FFFBEB] text-[#D97706]",
                destructive: "border-[#EF4444] bg-[#FEF2F2] text-[#DC2626]",
                info: "border-[#3B82F6] bg-[#EFF6FF] text-[#2563EB]",
                teal: "border-[#14B8A6] bg-[#14B8A6] text-white",
                coral: "border-[#FF6B7A] bg-[#FF6B7A] text-white",
                blue: "border-[#2F81F7] bg-[#2F81F7] text-white",
                outline: "border-black bg-transparent text-black",
            },
        },
        defaultVariants: {
            variant: "default",
        },
    }
)

export interface BadgeProps
    extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> { }

function Badge({ className, variant, ...props }: BadgeProps) {
    return (
        <div className={cn(badgeVariants({ variant }), className)} {...props} />
    )
}

export { Badge, badgeVariants }
