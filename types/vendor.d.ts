/**
 * Ambient declarations for packages that ship a browser bundle without types.
 *
 * mammoth's browser build (`mammoth/mammoth.browser`) has no published .d.ts;
 * it converts .docx to a constrained, script-free HTML tag set in the browser.
 */

declare module "mammoth/mammoth.browser" {
  interface MammothHtmlResult {
    value: string;
    messages: Array<{ type: string; message: string }>;
  }

  export function convertToHtml(input: { arrayBuffer: ArrayBuffer }): Promise<MammothHtmlResult>;
}
