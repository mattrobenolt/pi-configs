declare module "hysnappy" {
  export function snappyUncompress(
    input: Uint8Array,
    uncompressedLength: number,
  ): Uint8Array;
}
