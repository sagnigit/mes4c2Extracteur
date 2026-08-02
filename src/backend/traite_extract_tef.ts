/**
 * traite_extrait_tef.ts
 * ----------------
 * Prend la chaîne brute renvoyée par captureScript, extrait la série TEF,
 * télécharge images / audios dans les dossiers fournis via TefRefs,
 * et écrit ce.json / co.json / ee.json / eo.json avec des chemins relatifs
 * compatibles avec conserveurDonne (img/, audio/).
 *
 * Les dossiers cibles sont créés via creer_dossier (gardienRef).
 */

import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import * as http from 'http';
import { creer_dossier } from './gardienRef.js';

// ---------------------------------------------------------------------------
// Types publics
// ---------------------------------------------------------------------------

/** Chemins absolus (ou relatifs) des 4 dossiers série déjà prévus par conserveurDonne. */
export interface TefRefs {
    ce: string;
    co: string;
    ee: string;
    eo: string;
}

export interface ProcessSerieOptions {
    /** Base URL des fichiers médias (ex. CloudFront). */
    filesBaseUrl?: string;
    /** Callback de progression (téléchargements, étapes). */
    onProgress?: (message: string, detail?: string) => void;
}

export interface ProcessSerieResult {
    success: boolean;
    ceCount: number;
    coCount: number;
    eeCount: number;
    eoCount: number;
    error?: string;
}

export interface CeRow {
    epreuve: 'CE';
    numeroExercice: number;
    niveau: string;
    points: number;
    dureeExerciceSec: number;
    numeroQuestion: number;
    consigne: string;
    reponseCorrecte: string;
    distracteurs: string;
    image: string;
    imageUrl: string;
    texteLecture: string;
    imagePath: string;
}

export interface CoRow {
    epreuve: 'CO';
    numeroExercice: number;
    niveau: string;
    points: number;
    dureeExerciceSec: number;
    numeroQuestion: number;
    consigne: string;
    reponseCorrecte: string;
    distracteurs: string;
    audio: string;
    audioUrl: string;
    image: string;
    imageUrl: string;
    texteLecture: string;
    imagePath: string;
    audioPath: string;
}

export interface EeRow {
    epreuve: 'EE';
    numero: number;
    section: string;
    consigne: string;
    minMots?: number;
    maxMots?: number;
}

export interface EoRow {
    epreuve: 'EO';
    numero: number;
    section: string;
    consigne: string;
    dureeSec?: number;
    images: string;
    imagesUrls: string;
    imagePath: string;
}

// ---------------------------------------------------------------------------
// Flight parser
// ---------------------------------------------------------------------------

interface RawChunk {
    id: string;
    kind: 'json' | 'text' | 'import' | 'hint' | 'unknown';
    payload: string;
}

function splitChunks(raw: string): Map<string, RawChunk> {
    const chunks = new Map<string, RawChunk>();
    let i = 0;
    const n = raw.length;

    while (i < n) {
        while (i < n && (raw[i] === '\n' || raw[i] === '\r')) i++;
        if (i >= n) break;

        const colonIdx = raw.indexOf(':', i);
        if (colonIdx === -1) break;
        const id = raw.slice(i, colonIdx);
        i = colonIdx + 1;

        if (raw[i] === 'T') {
            const commaIdx = raw.indexOf(',', i);
            const hexLen = raw.slice(i + 1, commaIdx);
            const byteLen = parseInt(hexLen, 16);
            const start = commaIdx + 1;

            const encoder = new TextEncoder();
            let end = start;
            let bytes = 0;
            while (bytes < byteLen && end < n) {
                bytes += encoder.encode(raw[end]).length;
                end++;
            }
            chunks.set(id, { id, kind: 'text', payload: raw.slice(start, end) });
            i = end;
        } else if (raw[i] === 'I' || raw.startsWith('HL', i)) {
            const nextNewline = raw.indexOf('\n', i);
            const end = nextNewline === -1 ? n : nextNewline;
            chunks.set(id, {
                id,
                kind: raw[i] === 'I' ? 'import' : 'hint',
                payload: raw.slice(i, end),
            });
            i = end;
        } else {
            const nextNewline = raw.indexOf('\n', i);
            const end = nextNewline === -1 ? n : nextNewline;
            chunks.set(id, { id, kind: 'json', payload: raw.slice(i, end) });
            i = end;
        }
    }

    return chunks;
}

function resolveValue(
    value: any,
    chunks: Map<string, RawChunk>,
    cache: Map<string, any>,
    parsing: Set<string>
): any {
    if (typeof value === 'string') {
        const m = /^\$(L)?([0-9a-fA-F]+)$/.exec(value);
        if (m) return resolveChunk(m[2], chunks, cache, parsing);
        if (value === '$undefined') return undefined;
        return value;
    }
    if (Array.isArray(value)) {
        return value.map((v) => resolveValue(v, chunks, cache, parsing));
    }
    if (value && typeof value === 'object') {
        const out: Record<string, any> = {};
        for (const k of Object.keys(value)) {
            out[k] = resolveValue(value[k], chunks, cache, parsing);
        }
        return out;
    }
    return value;
}

function resolveChunk(
    id: string,
    chunks: Map<string, RawChunk>,
    cache: Map<string, any>,
    parsing: Set<string>
): any {
    if (cache.has(id)) return cache.get(id);
    if (parsing.has(id)) return undefined;
    const chunk = chunks.get(id);
    if (!chunk) return undefined;

    parsing.add(id);
    let result: any;

    if (chunk.kind === 'text') {
        result = chunk.payload;
    } else if (chunk.kind === 'json') {
        try {
            result = resolveValue(JSON.parse(chunk.payload), chunks, cache, parsing);
        } catch {
            result = chunk.payload;
        }
    } else {
        result = undefined;
    }

    parsing.delete(id);
    cache.set(id, result);
    return result;
}

export function extractSerie(raw: string): any {
    const chunks = splitChunks(raw);
    const cache = new Map<string, any>();
    const parsing = new Set<string>();

    for (const [id, chunk] of chunks) {
        if (chunk.kind !== 'json') continue;
        if (!/coQuestions|ceQuestions|eeQuestions|eoQuestions/.test(chunk.payload)) continue;
        const resolved = resolveChunk(id, chunks, cache, parsing);
        if (
            resolved &&
            typeof resolved === 'object' &&
            'coQuestions' in resolved &&
            'ceQuestions' in resolved
        ) {
            return resolved;
        }
    }
    return null;
}

// ---------------------------------------------------------------------------
// HTML / entités
// ---------------------------------------------------------------------------

const NAMED_ENTITIES: Record<string, string> = {
    nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
    eacute: 'é', egrave: 'è', ecirc: 'ê', euml: 'ë',
    agrave: 'à', acirc: 'â', auml: 'ä',
    ccedil: 'ç', ocirc: 'ô', ouml: 'ö',
    ucirc: 'û', ugrave: 'ù', uuml: 'ü',
    icirc: 'î', iuml: 'ï',
    oelig: 'œ', aelig: 'æ',
    euro: '€', laquo: '«', raquo: '»',
    hellip: '…', rsquo: '’', lsquo: '‘',
    ldquo: '“', rdquo: '”', mdash: '—', ndash: '–',
};

function decodeHtmlEntities(str: string | undefined | null): string {
    if (!str) return '';
    return str
        .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
        .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
        .replace(/&([a-zA-Z]+);/g, (m, name) => NAMED_ENTITIES[name.toLowerCase()] ?? m)
        .replace(/\s+/g, ' ')
        .trim();
}

function htmlToReadableText(str: string | undefined | null): string {
    if (!str) return '';

    let out = str
        .replace(/<\/p\s*>/gi, '\n')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/li\s*>/gi, '\n')
        .replace(/<p[^>]*>/gi, '\n')
        .replace(/<[^>]+>/g, '');

    out = out
        .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
        .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
        .replace(/&([a-zA-Z]+);/g, (m, name) => NAMED_ENTITIES[name.toLowerCase()] ?? m);

    return out
        .split('\n')
        .map((line) => line.replace(/[ \t]+/g, ' ').trim())
        .filter((line, idx, arr) => !(line === '' && arr[idx - 1] === ''))
        .join('\n')
        .trim();
}

// ---------------------------------------------------------------------------
// Téléchargement
// ---------------------------------------------------------------------------

function buildFileUrl(filename: string, filesBaseUrl?: string): string {
    if (!filename) return '';
    if (!filesBaseUrl) return filename;
    return `${filesBaseUrl.replace(/\/$/, '')}/${filename}`;
}

function downloadFile(url: string, destPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
        if (!url || !url.startsWith('http')) {
            resolve();
            return;
        }

        creer_dossier(path.dirname(destPath));

        if (fs.existsSync(destPath)) {
            resolve();
            return;
        }

        const protocol = url.startsWith('https') ? https : http;
        const file = fs.createWriteStream(destPath);

        const request = protocol.get(url, (response) => {
            if (
                response.statusCode &&
                response.statusCode >= 300 &&
                response.statusCode < 400 &&
                response.headers.location
            ) {
                file.close();
                if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
                downloadFile(response.headers.location, destPath).then(resolve).catch(reject);
                return;
            }

            if (response.statusCode !== 200) {
                file.close();
                if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
                reject(new Error(`HTTP ${response.statusCode} pour ${url}`));
                return;
            }

            response.pipe(file);
            file.on('finish', () => {
                file.close();
                resolve();
            });
        });

        request.on('error', (err) => {
            file.close();
            if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
            reject(err);
        });
    });
}

async function downloadSafe(url: string, destPath: string, label: string): Promise<boolean> {
    try {
        await downloadFile(url, destPath);
        console.log(`  ✓ ${label}`);
        return true;
    } catch (e: any) {
        console.warn(`  ✗ ${label} : ${e.message}`);
        return false;
    }
}

// ---------------------------------------------------------------------------
// Préparation d'un dossier série (img / audio)
// ---------------------------------------------------------------------------

function preparerDossierSerie(serieDir: string): { imgDir: string; audioDir: string } {
    creer_dossier(serieDir);
    const imgDir = path.join(serieDir, 'img');
    const audioDir = path.join(serieDir, 'audio');
    creer_dossier(imgDir);
    creer_dossier(audioDir);
    return { imgDir, audioDir };
}

// ---------------------------------------------------------------------------
// Processus par type
// ---------------------------------------------------------------------------

async function processCe(
    block: any,
    serieDir: string,
    filesBaseUrl?: string,
    progress: (message: string, detail?: string) => void = () => {}
): Promise<CeRow[]> {
    const { imgDir } = preparerDossierSerie(serieDir);
    const rows: CeRow[] = [];
    if (!block?.questions) return rows;

    for (const q of block.questions) {
        const libelles = q.libelles || [];
        const image = libelles.find((l: any) => l?.typeLibelle === 'image')?.libelle ?? '';
        const imageUrl = buildFileUrl(image, filesBaseUrl);
        const texteBrut = libelles.find((l: any) => l?.typeLibelle === 'texte')?.libelle ?? '';
        const texteLecture = htmlToReadableText(texteBrut);

        let imagePath = '';
        if (image && imageUrl) {
            const localName = path.basename(image);
            const dest = path.join(imgDir, localName);
            progress(`Téléchargement image CE…`, localName);
            const ok = await downloadSafe(imageUrl, dest, `CE image ${localName}`);
            if (ok) imagePath = path.join('img', localName).replace(/\\/g, '/');
        }

        for (const c of q.consignes || []) {
            const correct = c.suggestions?.find((s: any) => s.isCorrect)?.text ?? '';
            const distracteurs = (c.suggestions || [])
                .filter((s: any) => !s.isCorrect)
                .map((s: any) => decodeHtmlEntities(s.text))
                .join(' | ');

            rows.push({
                epreuve: 'CE',
                numeroExercice: q.numero,
                niveau: q.categorie?.libelle ?? '',
                points: q.categorie?.point ?? 0,
                dureeExerciceSec: q.discipline?.duree ?? 0,
                numeroQuestion: c.numero,
                consigne: decodeHtmlEntities(c.consigne),
                reponseCorrecte: decodeHtmlEntities(correct),
                distracteurs,
                image,
                imageUrl,
                texteLecture,
                imagePath,
            });
        }
    }

    return rows;
}

async function processCo(
    block: any,
    serieDir: string,
    filesBaseUrl?: string,
    progress: (message: string, detail?: string) => void = () => {}
): Promise<CoRow[]> {
    const { imgDir, audioDir } = preparerDossierSerie(serieDir);
    const rows: CoRow[] = [];
    if (!block?.questions) return rows;

    const downloaded = new Set<string>();

    for (const q of block.questions) {
        const libelles = q.libelles || [];
        const audio = libelles.find((l: any) => l?.typeLibelle === 'audio')?.libelle ?? '';
        const image = libelles.find((l: any) => l?.typeLibelle === 'image')?.libelle ?? '';
        const audioUrl = buildFileUrl(audio, filesBaseUrl);
        const imageUrl = buildFileUrl(image, filesBaseUrl);
        const texteBrut = libelles.find((l: any) => l?.typeLibelle === 'texte')?.libelle ?? '';
        const texteLecture = htmlToReadableText(texteBrut);

        let imagePath = '';
        let audioPath = '';

        if (image && imageUrl) {
            const localName = path.basename(image);
            const dest = path.join(imgDir, localName);
            if (!downloaded.has(dest)) {
                progress(`Téléchargement image CO…`, localName);
                const ok = await downloadSafe(imageUrl, dest, `CO image ${localName}`);
                downloaded.add(dest);
                if (ok) imagePath = path.join('img', localName).replace(/\\/g, '/');
            } else if (fs.existsSync(dest)) {
                imagePath = path.join('img', localName).replace(/\\/g, '/');
            }
        }

        if (audio && audioUrl) {
            const localName = path.basename(audio);
            const dest = path.join(audioDir, localName);
            if (!downloaded.has(dest)) {
                progress(`Téléchargement audio CO…`, localName);
                const ok = await downloadSafe(audioUrl, dest, `CO audio ${localName}`);
                downloaded.add(dest);
                if (ok) audioPath = path.join('audio', localName).replace(/\\/g, '/');
            } else if (fs.existsSync(dest)) {
                audioPath = path.join('audio', localName).replace(/\\/g, '/');
            }
        }

        for (const c of q.consignes || []) {
            const correct = c.suggestions?.find((s: any) => s.isCorrect)?.text ?? '';
            const distracteurs = (c.suggestions || [])
                .filter((s: any) => !s.isCorrect)
                .map((s: any) => decodeHtmlEntities(s.text))
                .join(' | ');

            rows.push({
                epreuve: 'CO',
                numeroExercice: q.numero,
                niveau: q.categorie?.libelle ?? '',
                points: q.categorie?.point ?? 0,
                dureeExerciceSec: q.discipline?.duree ?? 0,
                numeroQuestion: c.numero,
                consigne: decodeHtmlEntities(c.consigne),
                reponseCorrecte: decodeHtmlEntities(correct),
                distracteurs,
                audio,
                audioUrl,
                image,
                imageUrl,
                texteLecture,
                imagePath,
                audioPath,
            });
        }
    }

    return rows;
}

async function processEe(blocks: any[]): Promise<EeRow[]> {
    const rows: EeRow[] = [];
    for (const block of blocks || []) {
        for (const s of block.sections || []) {
            rows.push({
                epreuve: 'EE',
                numero: s.numero,
                section: s.libelle,
                consigne: s.consigne ?? '',
                minMots: s.minWord,
                maxMots: s.maxWord,
            });
        }
    }
    return rows;
}

async function processEo(
    blocks: any[],
    serieDir: string,
    filesBaseUrl?: string,
    progress: (message: string, detail?: string) => void = () => {}
): Promise<EoRow[]> {
    const { imgDir } = preparerDossierSerie(serieDir);
    const rows: EoRow[] = [];
    const downloaded = new Set<string>();

    for (const block of blocks || []) {
        for (const s of block.sections || []) {
            const images: string[] = s.images || [];
            const imagePaths: string[] = [];

            for (const img of images) {
                if (!img) continue;
                const imageUrl = buildFileUrl(img, filesBaseUrl);
                const localName = path.basename(img);
                const dest = path.join(imgDir, localName);

                if (!downloaded.has(dest)) {
                    progress(`Téléchargement image EO…`, localName);
                    const ok = await downloadSafe(imageUrl, dest, `EO image ${localName}`);
                    downloaded.add(dest);
                    if (ok) imagePaths.push(path.join('img', localName).replace(/\\/g, '/'));
                } else if (fs.existsSync(dest)) {
                    imagePaths.push(path.join('img', localName).replace(/\\/g, '/'));
                }
            }

            rows.push({
                epreuve: 'EO',
                numero: s.numero,
                section: s.libelle,
                consigne: s.consigne ?? '',
                dureeSec: s.duree,
                images: images.join(' | '),
                imagesUrls: images.map((f) => buildFileUrl(f, filesBaseUrl)).join(' | '),
                imagePath: imagePaths.join(' | '),
            });
        }
    }

    return rows;
}

// ---------------------------------------------------------------------------
// API principale exportable
// ---------------------------------------------------------------------------

/**
 * Traite une série TEF brute et écrit les 4 types dans les dossiers fournis.
 *
 * @param raw        Chaîne renvoyée par captureScript
 * @param refs       Chemins des 4 dossiers série (créés par l'appelant
 *                   via conserveurDonne, ou laissés à créer ici)
 * @param options    filesBaseUrl optionnel
 */
export async function processSerieTef(
    raw: string,
    refs: TefRefs,
    options: ProcessSerieOptions = {}
): Promise<ProcessSerieResult> {
    const filesBaseUrl =
        options.filesBaseUrl ?? 'https://d3jg6daagmqdy0.cloudfront.net';
    const progress = options.onProgress ?? (() => {});

    try {
        progress('Extraction de la série TEF…');
        console.log('Extraction de la série TEF...');
        const serie = extractSerie(raw);
        if (!serie) {
            return {
                success: false,
                ceCount: 0,
                coCount: 0,
                eeCount: 0,
                eoCount: 0,
                error: "Impossible d'extraire la série depuis les données brutes.",
            };
        }

        // S'assurer que les 4 dossiers (et img/audio) existent
        for (const dir of [refs.ce, refs.co, refs.ee, refs.eo]) {
            preparerDossierSerie(dir);
        }

        progress('Traitement CE — téléchargement des images…', 'CE');
        console.log('\n--- CE ---');
        const ceRows = await processCe(serie.ceQuestions, refs.ce, filesBaseUrl, progress);
        fs.writeFileSync(
            path.join(refs.ce, 'ce.json'),
            JSON.stringify(ceRows, null, 2),
            'utf-8'
        );
        console.log(`  → ${ceRows.length} question(s) → ${path.join(refs.ce, 'ce.json')}`);
        progress(`CE terminé : ${ceRows.length} question(s)`, 'CE');

        progress('Traitement CO — téléchargement images / audios…', 'CO');
        console.log('\n--- CO ---');
        const coRows = await processCo(serie.coQuestions, refs.co, filesBaseUrl, progress);
        fs.writeFileSync(
            path.join(refs.co, 'co.json'),
            JSON.stringify(coRows, null, 2),
            'utf-8'
        );
        console.log(`  → ${coRows.length} question(s) → ${path.join(refs.co, 'co.json')}`);
        progress(`CO terminé : ${coRows.length} question(s)`, 'CO');

        progress('Traitement EE…', 'EE');
        console.log('\n--- EE ---');
        const eeRows = await processEe(serie.eeQuestions);
        fs.writeFileSync(
            path.join(refs.ee, 'ee.json'),
            JSON.stringify(eeRows, null, 2),
            'utf-8'
        );
        console.log(`  → ${eeRows.length} section(s) → ${path.join(refs.ee, 'ee.json')}`);
        progress(`EE terminé : ${eeRows.length} section(s)`, 'EE');

        progress('Traitement EO — téléchargement des images…', 'EO');
        console.log('\n--- EO ---');
        const eoRows = await processEo(serie.eoQuestions, refs.eo, filesBaseUrl, progress);
        fs.writeFileSync(
            path.join(refs.eo, 'eo.json'),
            JSON.stringify(eoRows, null, 2),
            'utf-8'
        );
        console.log(`  → ${eoRows.length} section(s) → ${path.join(refs.eo, 'eo.json')}`);
        progress(`EO terminé : ${eoRows.length} section(s)`, 'EO');

        return {
            success: true,
            ceCount: ceRows.length,
            coCount: coRows.length,
            eeCount: eeRows.length,
            eoCount: eoRows.length,
        };
    } catch (err: any) {
        return {
            success: false,
            ceCount: 0,
            coCount: 0,
            eeCount: 0,
            eoCount: 0,
            error: err?.message ?? String(err),
        };
    }
}
