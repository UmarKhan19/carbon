declare module "humanize-duration" {
  export type Unit = "y" | "mo" | "w" | "d" | "h" | "m" | "s" | "ms";

  interface Options {
    language?: string;
    fallbacks?: string[];
    delimiter?: string;
    spacer?: string;
    largest?: number;
    units?: Unit[];
    round?: boolean;
    decimal?: string;
    conjunction?: string;
    serialComma?: boolean;
    maxDecimalPoints?: number;
    digitReplacements?: string[];
    unitMeasures?: Partial<Record<Unit, number>>;
  }

  function humanizeDuration(ms: number, options?: Options): string;

  export default humanizeDuration;
}
