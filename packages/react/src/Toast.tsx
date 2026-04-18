"use client";

import { Toaster as Sonner, toast } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      className="toaster group"
      closeButton
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
          description: "group-[.toast]:text-muted-foreground",
          actionButton:
            "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton:
            "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
          closeButton:
            "group-[.toast]:!bg-background group-[.toast]:!text-foreground group-[.toast]:!border-border group-[.toast]:!rounded-full group-[.toast]:!size-5 group-[.toast]:!left-auto group-[.toast]:!right-0 group-[.toast]:!top-0 group-[.toast]:!-translate-y-1/2 group-[.toast]:!translate-x-1/2 group-[.toast]:hover:!bg-muted group-[.toast]:transition-colors group-[.toast]:shadow-sm",
          success:
            "group-[.toaster]:bg-blue-700 group-[.toaster]:text-white group-[.toaster]:border-blue-700 ",
          error:
            "group-[.toaster]:bg-red-600 group-[.toaster]:text-white group-[.toaster]:border-red-600 "
        }
      }}
      {...props}
    />
  );
};

export { toast, Toaster };
