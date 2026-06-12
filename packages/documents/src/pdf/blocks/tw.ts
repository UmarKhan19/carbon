import { createTw } from "react-pdf-tailwind";

/**
 * Shared Tailwind instance for sales-document blocks. Kept identical to the
 * theme previously inlined in SalesInvoicePDF so block output is unchanged.
 */
export const tw = createTw({
  theme: {
    fontFamily: {
      sans: ["Inter", "Helvetica", "Arial", "sans-serif"]
    },
    extend: {
      colors: {
        gray: {
          50: "#f9fafb",
          200: "#e5e7eb",
          400: "#9ca3af",
          600: "#4b5563",
          800: "#1f2937"
        }
      }
    }
  }
});
