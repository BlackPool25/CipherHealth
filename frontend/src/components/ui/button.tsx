import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/utils/cn"

const buttonVariants = cva(
    "inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-semibold transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
    {
        variants: {
            variant: {
                default:
                    "bg-black text-white border-[3px] border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] hover:-translate-y-0.5 active:shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] active:translate-y-0.5",
                coral:
                    "bg-[#FF6B7A] text-white border-[3px] border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] hover:-translate-y-0.5 active:shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] active:translate-y-0.5",
                blue:
                    "bg-[#2F81F7] text-white border-[3px] border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] hover:-translate-y-0.5 active:shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] active:translate-y-0.5",
                yellow:
                    "bg-[#FFC224] text-black border-[3px] border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] hover:-translate-y-0.5 active:shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] active:translate-y-0.5",
                teal:
                    "bg-[#14B8A6] text-white border-[3px] border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] hover:-translate-y-0.5 active:shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] active:translate-y-0.5",
                green:
                    "bg-[#10B981] text-white border-[3px] border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] hover:-translate-y-0.5 active:shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] active:translate-y-0.5",
                destructive:
                    "bg-[#E7000B] text-white border-[3px] border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] hover:-translate-y-0.5 active:shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] active:translate-y-0.5",
                outline:
                    "bg-white text-black border-[3px] border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:bg-gray-50 hover:shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] hover:-translate-y-0.5 active:shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] active:translate-y-0.5",
                ghost:
                    "text-black hover:bg-gray-100 border-2 border-transparent",
                link:
                    "text-black underline-offset-4 hover:underline",
            },
            size: {
                default: "h-12 px-6 py-3 rounded-xl",
                sm: "h-9 px-4 py-2 rounded-lg text-xs",
                lg: "h-14 px-8 py-4 rounded-xl text-base",
                xl: "h-16 px-12 py-5 rounded-xl text-lg",
                icon: "h-10 w-10 rounded-lg",
            },
        },
        defaultVariants: {
            variant: "default",
            size: "default",
        },
    }
)

export interface ButtonProps
    extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
    asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
    ({ className, variant, size, asChild = false, ...props }, ref) => {
        const Comp = asChild ? Slot : "button"
        return (
            <Comp
                className={cn(buttonVariants({ variant, size, className }))}
                ref={ref}
                {...props}
            />
        )
    }
)
Button.displayName = "Button"

export { Button, buttonVariants }
