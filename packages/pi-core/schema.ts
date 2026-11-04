// TypeBox helpers for tool parameter schemas.
//
// Pi 1.5.0 stopped re-exporting TypeBox from `@earendil-works/pi-ai` and types its
// own `StringEnum` against pi-schema, not TypeBox. Mixing that with the `typebox`
// package degrades composed schemas to `unknown`, so extensions build both here,
// from the single TypeBox copy the runtime hands them.
import { Type, type TUnsafe } from "typebox";

export { Type } from "typebox";
export type { Static, TSchema } from "typebox";

/**
 * String enum without `anyOf`/`const`, which some providers reject:
 * `{ type: "string", enum: [...] }`, typed for TypeBox's `Static`.
 */
export function StringEnum<T extends readonly string[]>(
  values: T,
  options?: { description?: string; default?: T[number] },
): TUnsafe<T[number]> {
  return Type.Unsafe<T[number]>({
    type: "string",
    enum: values as unknown as T[number][],
    ...(options?.description && { description: options.description }),
    ...(options?.default && { default: options.default }),
  });
}
