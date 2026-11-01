/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "0" skips fc.init so the canvas uses its fetch mock layer. */
  readonly VITE_FC_SDK?: string;
}
