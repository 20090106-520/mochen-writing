import type { RendererApi } from "@abyss/contracts";

declare global {
  interface Window {
    abyss: RendererApi;
  }
}

export {};
