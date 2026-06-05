/* Global type declarations for Web TOC Assistant */

// Window globals for reinjection guard and cleanup
interface Window {
  __TOC_ASSISTANT_LOADED__?: boolean;
  __TOC_ASSISTANT_CLEANUP__?: (opts: { reason: string }) => void;
}

// Custom cleanup property on TOC-owned DOM elements
interface HTMLElement {
  __TOC_CLEANUP__?: () => void;
}
