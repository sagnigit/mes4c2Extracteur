// arrangeDonne.ts

/**
 * Prend une chaîne HTML contenant des balises 
 * et les enléve
 */
import { JSDOM } from "jsdom";

export function arrangeEnnonceTcfCe(input: string): string {
  const dom = new JSDOM(input);
  return dom.window.document.body.textContent || "";
}

