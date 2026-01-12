import * as React from "react"
import * as TabsPrimitive from "@radix-ui/react-tabs"
import { cn } from "@/utils/cn"

const Tabs = TabsPrimitive.Root

const TabsList = React.forwardRef<
    React.ElementRef<typeof TabsPrimitive.List>,
    React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
    <TabsPrimitive.List
        ref={ref}
        className={cn(
            "inline-flex h-14 items-center justify-center rounded-xl bg-gray-100 p-1.5 text-black border-[3px] border-black",
            className
        )}
        {...props}
    />
))
TabsList.displayName = TabsPrimitive.List.displayName

const TabsTrigger = React.forwardRef<
    React.ElementRef<typeof TabsPrimitive.Trigger>,
    React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
    <TabsPrimitive.Trigger
        ref={ref}
        className={cn(
            "inline-flex items-center justify-center whitespace-nowrap rounded-lg px-5 py-2.5 text-sm font-bold ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
            "data-[state=active]:bg-white data-[state=active]:text-black data-[state=active]:shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] data-[state=active]:border-[2px] data-[state=active]:border-black",
            "data-[state=inactive]:text-gray-600 data-[state=inactive]:hover:text-black data-[state=inactive]:hover:bg-gray-50",
            className
        )}
        {...props}
    />
))
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName

const TabsContent = React.forwardRef<
    React.ElementRef<typeof TabsPrimitive.Content>,
    React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
    <TabsPrimitive.Content
        ref={ref}
        className={cn(
            "mt-4 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
            className
        )}
        {...props}
    />
))
TabsContent.displayName = TabsPrimitive.Content.displayName

export { Tabs, TabsList, TabsTrigger, TabsContent }
