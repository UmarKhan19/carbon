import type { MessageDescriptor } from "@lingui/core";
import { TaggedError } from "better-result";

/**
 * Interpolation values for an error's message. Kept to JSON-serializable
 * primitives so an error survives logging and the descriptor resolves cleanly
 * at the boundary.
 */
export type ErrorValues = Record<
  string,
  string | number | boolean | null | undefined
>;

/** Fields every Carbon error accepts on top of its own domain props. */
type CarbonErrorMeta = {
  /** Optional call-site override of the class-level default message. */
  descriptor?: MessageDescriptor;
  /** The underlying error (e.g. a raw PostgrestError) preserved for logging. */
  cause?: unknown;
};

export type CarbonErrorArgs<Props> = Props & CarbonErrorMeta;

/**
 * The contract the boundary translator depends on: a tag for exhaustive
 * matching, a Lingui descriptor to resolve in the requester's locale, the
 * interpolation values, and an optional underlying cause to log. Every core and
 * domain error structurally satisfies this.
 */
export interface TranslatableError {
  readonly _tag: string;
  readonly messageDescriptor: MessageDescriptor;
  readonly values: ErrorValues;
  readonly cause?: unknown;
}

/** A constructed Carbon error: a tagged, translatable Error carrying its props. */
export type CarbonErrorInstance<Tag extends string, Props> = Error &
  Readonly<Props> &
  TranslatableError & {
    readonly _tag: Tag;
    /** The class-level default message; exposed for tests and tooling. */
    readonly defaultMessage: MessageDescriptor;
    readonly values: Readonly<Props>;
  };

/** The class produced by {@link createCarbonError}. */
export interface CarbonErrorClass<Tag extends string, Props> {
  new (args: CarbonErrorArgs<Props>): CarbonErrorInstance<Tag, Props>;
  /** Type guard for instances of this error's tag. */
  is(value: unknown): value is CarbonErrorInstance<Tag, Props>;
}

/**
 * Builds a translatable tagged-error base class. Each error carries a Lingui
 * `MessageDescriptor` — a class-level default, overridable per call site — plus
 * serializable interpolation values, layered on better-result's tagged error so
 * instances are discriminable by `_tag` and yieldable in `Result.gen`.
 *
 * Domain modules use this to define their own errors next to the service that
 * raises them; the six core errors are built with it in `./errors`.
 */
export function createCarbonError<
  Tag extends string,
  Props extends ErrorValues = {}
>(tag: Tag, defaultMessage: MessageDescriptor): CarbonErrorClass<Tag, Props> {
  // better-result's TaggedError instance type is a generic intersection, which
  // TypeScript cannot extend directly (TS2509). Extend the runtime class as
  // `any` and re-attach a precise type via the declared return type.
  const Base = TaggedError(tag)() as new (args?: unknown) => object;

  class CarbonError extends (Base as new (args?: unknown) => {}) {
    readonly defaultMessage: MessageDescriptor = defaultMessage;
    readonly values: Record<string, unknown>;
    private readonly descriptorOverride?: MessageDescriptor;

    constructor(args: CarbonErrorArgs<Props>) {
      super(args);
      // `descriptor` and `cause` are meta, not message interpolation values.
      // `cause` stays reachable via the underlying Error's own `cause`.
      const {
        descriptor,
        cause: _cause,
        ...rest
      } = (args ?? {}) as Record<string, unknown>;
      this.descriptorOverride = descriptor as MessageDescriptor | undefined;
      this.values = rest;
    }

    /** Descriptor to translate at the boundary: call-site override or default. */
    get messageDescriptor(): MessageDescriptor {
      return this.descriptorOverride ?? this.defaultMessage;
    }
  }

  return CarbonError as unknown as CarbonErrorClass<Tag, Props>;
}
