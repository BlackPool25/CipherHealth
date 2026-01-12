import * as React from "react"
import { cn } from "@/utils/cn"

const Card = React.forwardRef<
    HTMLDivElement,
    React.HTMLAttributes<HTMLDivElement> & {
        variant?: "default" | "coral" | "blue" | "yellow" | "teal" | "purple"
        hoverable?: boolean
    }
>(({ className, variant = "default", hoverable = true, ...props }, ref) => {
    const variantClasses = {
        default: "bg-white",
        coral: "bg-[#FF6B7A] text-white",
        blue: "bg-[#2F81F7] text-white",
        yellow: "bg-[#FFC224] text-black",
        teal: "bg-[#14B8A6] text-white",
        purple: "bg-[#8B5CF6] text-white",
    }

    return (
        <div
            ref={ref}
            className={cn(
                "rounded-2xl border-[3px] border-black shadow-[6px_6px_0px_0px_rgba(0,0,0,1)]",
                variantClasses[variant],
                hoverable && "transition-all duration-300 hover:-translate-y-1 hover:shadow-[8px_8px_0px_0px_rgba(0,0,0,1)]",
                className
            )}
            {...props}
        />
    )
})
Card.displayName = "Card"

const CardHeader = React.forwardRef<
    HTMLDivElement,
    React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
    <div
        ref={ref}
        className={cn("flex flex-col space-y-1.5 p-6", className)}
        {...props}
    />
))
CardHeader.displayName = "CardHeader"

const CardTitle = React.forwardRef<
    HTMLHeadingElement,
    React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
    <h3
        ref={ref}
        className={cn("text-2xl font-bold leading-none tracking-tight", className)}
        {...props}
    />
))
CardTitle.displayName = "CardTitle"

const CardDescription = React.forwardRef<
    HTMLParagraphElement,
    React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
    <p
        ref={ref}
        className={cn("text-base text-muted-foreground font-medium", className)}
        {...props}
    />
))
CardDescription.displayName = "CardDescription"

const CardContent = React.forwardRef<
    HTMLDivElement,
    React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
    <div ref={ref} className={cn("p-6 pt-0", className)} {...props} />
))
CardContent.displayName = "CardContent"

const CardFooter = React.forwardRef<
    HTMLDivElement,
    React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
    <div
        ref={ref}
        className={cn("flex items-center p-6 pt-0", className)}
        {...props}
    />
))
CardFooter.displayName = "CardFooter"

export { Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent }
