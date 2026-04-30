declare module 'asciichart' {
  export const blue: string;
  export const green: string;
  export const cyan: string;
  export const magenta: string;
  export const red: string;
  export const yellow: string;
  export const darkgray: string;
  export const lightgray: string;
  export const white: string;
  export const black: string;
  export const reset: string;

  export interface PlotConfig {
    height?: number;
    min?: number;
    max?: number;
    offset?: number;
    padding?: string;
    format?: (x: number, i: number) => string;
    colors?: (string | undefined)[];
  }

  export function plot(series: number[] | number[][], config?: PlotConfig): string;
}
