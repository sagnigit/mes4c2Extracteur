/**
 * saveTestJson.ts — écrit un objet dans test.json (même dossier que ce fichier)
 * Usage :
 *   import { saveTestJson } from './saveTestJson.js';
 *   saveTestJson({ series, questions });
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEST_JSON_PATH = join(__dirname, 'test.json');

/**
 * Écrit `data` dans test.json de façon synchrone (écrase le fichier à chaque appel).
 */
export function saveTestJson(data: unknown): void {
    writeFileSync(TEST_JSON_PATH, JSON.stringify(data, null, 2), 'utf8');
}

/**
 * Chemin absolu du fichier test.json (utile pour debug).
 */
export function getTestJsonPath(): string {
    return TEST_JSON_PATH;
}
