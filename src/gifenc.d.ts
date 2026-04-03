declare module 'gifenc' {
  interface GIFEncoderInstance {
    writeFrame(index: Uint8Array, width: number, height: number, opts?: {
      palette?: number[][];
      delay?: number;
      transparent?: boolean;
      transparentIndex?: number;
      dispose?: number;
    }): void;
    finish(): void;
    bytes(): Uint8Array;
    bytesView(): Uint8Array;
  }

  export function GIFEncoder(opts?: Record<string, unknown>): GIFEncoderInstance;
  export function quantize(rgba: Uint8ClampedArray, maxColors: number, opts?: Record<string, unknown>): number[][];
  export function applyPalette(rgba: Uint8ClampedArray, palette: number[][], format?: string): Uint8Array;
  export function nearestColorIndex(palette: number[][], pixel: number[]): number;
  export function nearestColorIndexWithDistance(palette: number[][], pixel: number[]): [number, number];
  export function snapColorsToPalette(palette: number[][], knownColors: number[][], threshold?: number): void;
}
