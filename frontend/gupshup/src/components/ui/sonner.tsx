"use client"

import { useTheme } from "next-themes"
import { Toaster as Sonner } from "sonner"

type ToasterProps = React.ComponentProps<typeof Sonner>

export function Toaster(props: ToasterProps) {
  const { theme = "system" } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      richColors
      toastOptions={{
        classNames: {
          toast:
            'group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg',
          description: 'group-[.toast]:text-muted-foreground',
          actionButton:
            'group-[.toast]:bg-primary group-[.toast]:text-primary-foreground',
          cancelButton:
            'group-[.toast]:bg-muted group-[.toast]:text-muted-foreground',
        },
        format: (toast) => {
          if (typeof toast === 'object' && toast !== null) {
            if (toast.title) {
              return {
                message: String(toast.title),
                description: toast.description ? String(toast.description) : undefined,
                ...toast
              };
            }
            
            return {
              ...toast,
              description: toast.description ? String(toast.description) : undefined
            };
          }
          return { description: String(toast) };
        }
      }}
      {...props}
    />
  )
}
