import type { RendererApi } from "@mochen/contracts";

declare global {
  interface Window {
    mochen: RendererApi;
  }
}

export {};
