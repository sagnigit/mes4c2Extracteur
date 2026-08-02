/**
 * parseFlightPayload.ts — Main process (Electron / Node.js)
 *
 * Extrait DIRECTEMENT les SlimQuestionCo / SlimQuestionCE depuis un payload
 * React Flight (Next.js RSC) brut, sans jamais construire ni résoudre le
 * JSON complet des questions (pas de id/orderIndex/aiReasoning/
 * generateSettings/explanation/imageUrlOriginal/level… — ces champs ne
 * sont ni parsés ni résolus).
 *
 * Points clés du parsing Flight :
 *  1. IDs Flight en hexadécimal (2a, 1a, f, …).
 *  2. Longueur des rows "T" en OCTETS UTF-8 (Buffer), pas en code units JS.
 *  3. Tolérance au bruit avant/après le payload (logs Electron, null, …).
 *  4. Normalisation CRLF → LF.
 *  5. extractedText peut être un objet OU une string JSON → double parse.
 *  6. Fallback si le comptage d'octets dérape (payload mal encodé).
 *
 * Pour la compréhension écrite (CE), le contenu de l'énoncé est dans
 * extractedText.content (pas extractedText.enonce, qui n'existe pas dans
 * les payloads réels observés). extractedText.question reste bien le
 * libellé de la question.
 *
 * --- Correctifs appliqués (voir historique) ---
 *  A. L'avance en octets UTF-8 dans splitFlightRows était O(n²) : à chaque
 *     octet lu, on re-slicait la string depuis le début de la row et on
 *     recalculait Buffer.byteLength sur toute la portion déjà lue. Pour une
 *     row T volumineuse (ex : audio en data-URI base64, HTML long), ça
 *     pouvait geler ou planter le process principal Electron (event loop
 *     bloqué de façon synchrone). Remplacé par une version O(n) : on borne
 *     le slice à `byteLen` caractères (un octet UTF-8 encode toujours en
 *     au moins 1 code unit JS), on mesure une seule fois avec Buffer, puis
 *     on ajuste au plus par petits pas si besoin.
 *  B. audioUrl / imageUrl (CO) ne sont conservés que s'ils sont de vrais
 *     liens http(s)://. Si le payload contient un data-URI (audio/image
 *     encodé en base64 directement dans le champ), on le rejette plutôt
 *     que de le transporter tel quel jusqu'à l'UI (évite de traîner des
 *     blobs de plusieurs Mo dans le résultat final / via IPC).
 */

/** Forme allégée — compréhension orale (URLs encore distantes) */
import {arrangeEnnonceTcfCe} from "./arrangeDonne.js";
export type SlimQuestionCo = {
  points: number;
  audioUrl: string;
  imageUrl: string;
  question: string;
  options: string[];
  correctAnswerIndex: number;
};

/**
 * Forme allégée — compréhension écrite.
 * question = extractedText.question
 * enonce   = extractedText.content (texte HTML, pas une image)
 * Pas d'imageUrl : l'image d'énoncé est générée côté graphique
 * à partir du texte enonce, puis enregistrée dans trans_img.
 */
export type SlimQuestionCE = {
  points: number;
  options: string[];
  correctAnswerIndex: number;
  question: string;
  enonce: string;
};

type FlightRow = {
  id: string;
  tag: 'T' | 'I' | 'J';
  raw: string;
};

/** Nettoie le brut : enlève le bruit console, normalise les fins de ligne. */
function sanitizeRaw(input: string): string {
  let s = input.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // Couper le préambule type "> tcf-composer@… / electron ."
  const flightStart = s.search(/(?:^|\n)(?:[0-9a-f]+):/i);
  if (flightStart > 0) {
    s = s.slice(flightStart);
    if (s.startsWith('\n')) s = s.slice(1);
  }

  // Couper un éventuel suffixe "null\nnull" ou logs après la dernière row utile
  const lastUseful = Math.max(
    s.lastIndexOf('"mode":'),
    s.lastIndexOf('"questions":'),
    s.lastIndexOf('"series":')
  );
  if (lastUseful > 0) {
    const after = s.indexOf('\n', lastUseful);
    // garder jusqu'à 2–3 lignes après pour ne pas tronquer la row
    if (after > 0) {
      let end = after;
      for (let k = 0; k < 3; k++) {
        const n = s.indexOf('\n', end + 1);
        if (n < 0) break;
        end = n;
      }
      // ne tronquer que si on voit clairement du bruit
      const tail = s.slice(end);
      if (/\nnull\s*\nnull/.test(tail) || /electron/i.test(tail)) {
        s = s.slice(0, end + 1);
      }
    }
  }

  return s;
}

/**
 * Avance de `byteLen` octets UTF-8 à partir de `contentStart`, en O(n).
 *
 * Principe : en UTF-8, chaque code unit JS (UTF-16) correspond à AU MOINS
 * 1 octet (souvent plus pour les caractères non-ASCII, jamais moins). Donc
 * `byteLen` octets tiennent toujours dans `byteLen` caractères JS maximum.
 * On peut donc :
 *   1. Prendre un slice candidat de `byteLen` caractères (borne haute sûre).
 *   2. Mesurer sa taille réelle en octets UNE SEULE FOIS avec Buffer.
 *   3. Si trop d'octets (accents, emoji…) : tronquer le buffer au bon
 *      nombre d'octets puis reconvertir en string.
 *   4. Si pas assez d'octets (rare, fin de string proche) : élargir par
 *      petits pas bornés (max 4 octets par codepoint) jusqu'à atteindre
 *      byteLen ou la fin de l'input.
 *
 * Coût total : O(longueur de la row), pas O(longueur²).
 */
function advanceUtf8Bytes(
  input: string,
  contentStart: number,
  byteLen: number,
  len: number
): { raw: string; end: number } {
  const upperBound = Math.min(len, contentStart + byteLen);
  let candidate = input.slice(contentStart, upperBound);
  let buf = Buffer.from(candidate, 'utf8');

  if (buf.length === byteLen) {
    return { raw: candidate, end: upperBound };
  }

  if (buf.length > byteLen) {
    // On a pris trop d'octets (caractères multi-bytes) -> on tronque
    // proprement au niveau octet puis on reconvertit en string.
    const raw = buf.subarray(0, byteLen).toString('utf8');
    return { raw, end: contentStart + raw.length };
  }

  // buf.length < byteLen : pas assez de caractères pris dans la borne
  // initiale (arrive seulement si beaucoup de multi-bytes juste après).
  // On élargit par petits pas bornés, toujours O(n) au total.
  let extra = 4; // max 4 octets par codepoint Unicode
  while (buf.length < byteLen && upperBound + extra <= len) {
    candidate = input.slice(contentStart, upperBound + extra);
    buf = Buffer.from(candidate, 'utf8');
    extra += 4;
  }

  const raw =
    buf.length >= byteLen
      ? buf.subarray(0, byteLen).toString('utf8')
      : buf.toString('utf8'); // fin de l'input atteinte avant byteLen

  return { raw, end: contentStart + raw.length };
}

/**
 * Découpe le flux Flight en rows.
 * IDs = hex (0-9a-f), tags T / I / JSON.
 */
function splitFlightRows(input: string): FlightRow[] {
  const rows: FlightRow[] = [];
  const len = input.length;
  let i = 0;
  // IMPORTANT : [0-9a-f]+ et non \d+ — les IDs RSC sont hexadécimaux
  const idRe = /([0-9a-f]+):/iy;

  while (i < len) {
    // sauter les newlines / espaces en tête de position
    if (input[i] === '\n' || input[i] === ' ' || input[i] === '\t') {
      i++;
      continue;
    }

    idRe.lastIndex = i;
    const m = idRe.exec(input);
    if (!m || m.index !== i) {
      const nl = input.indexOf('\n', i);
      if (nl === -1) break;
      i = nl + 1;
      continue;
    }

    const id = m[1];
    let pos = idRe.lastIndex;
    if (pos >= len) break;
    const tagChar = input[pos];

    // Row typée : T<hexLen>,<payload en OCTETS UTF-8>
    // (on accepte toute majuscule + hex pour rester tolérant)
    if (
      /[A-Z]/.test(tagChar) &&
      /^[0-9a-f]+,/i.test(input.slice(pos + 1, pos + 16))
    ) {
      const commaIdx = input.indexOf(',', pos);
      if (commaIdx === -1) {
        i = pos + 1;
        continue;
      }
      const hexLen = input.slice(pos + 1, commaIdx);
      const byteLen = parseInt(hexLen, 16);
      const contentStart = commaIdx + 1;

      if (!Number.isFinite(byteLen) || byteLen < 0) {
        i = contentStart;
        continue;
      }

      // 1) Avance en octets UTF-8 — version O(n) (voir advanceUtf8Bytes)
      let { raw, end } = advanceUtf8Bytes(input, contentStart, byteLen, len);

      // 2) Si le contenu ressemble à du JSON et ne parse pas (mojibake,
      //    extraction navigateur qui a altéré les octets, etc.), on
      //    rééquilibre sur les accolades / crochets.
      if (
        tagChar === 'T' &&
        raw.length > 0 &&
        (raw[0] === '{' || raw[0] === '[')
      ) {
        let needsRepair = false;
        try {
          JSON.parse(raw);
        } catch {
          needsRepair = true;
        }
        if (needsRepair) {
          const repaired = tryBalanceJson(input, contentStart, len);
          if (repaired) {
            raw = repaired;
            end = contentStart + repaired.length;
          }
        }
      }

      rows.push({
        id,
        tag: tagChar === 'T' ? 'T' : 'J',
        raw,
      });

      i = end < len && input[end] === '\n' ? end + 1 : end;
      continue;
    }

    // Import module client
    if (tagChar === 'I') {
      const nl = input.indexOf('\n', pos);
      rows.push({
        id,
        tag: 'I',
        raw: nl === -1 ? input.slice(pos) : input.slice(pos, nl),
      });
      i = nl === -1 ? len : nl + 1;
      continue;
    }

    // Row JSON classique : {...} | [...] | "$..." | null | true | ...
    const nl = input.indexOf('\n', pos);
    const raw = nl === -1 ? input.slice(pos) : input.slice(pos, nl);
    rows.push({ id, tag: 'J', raw });
    i = nl === -1 ? len : nl + 1;
  }

  return rows;
}

/**
 * Équilibre un objet/tableau JSON à partir de `start` (qui doit pointer
 * sur `{` ou `[`). Ignore le contenu des chaînes (échappements inclus).
 * Retourne le slice valide ou null.
 */
function tryBalanceJson(
  input: string,
  start: number,
  len: number
): string | null {
  const open = input[start];
  if (open !== '{' && open !== '[') return null;
  const close = open === '{' ? '}' : ']';

  // Limite de sécurité : 64 Ko de contenu T max
  const max = Math.min(len, start + 65536);
  let depth = 0;
  let inString = false;
  let escape = false;

  for (let p = start; p < max; p++) {
    const ch = input[p];
    if (inString) {
      if (escape) {
        escape = false;
      } else if (ch === '\\') {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) {
        const candidate = input.slice(start, p + 1);
        try {
          JSON.parse(candidate);
          return candidate;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/** Regex de référence Flight : "$28" | "$L28" (IDs hex). */
const REF_RE = /^\$L?([0-9a-f]+)$/i;

/** Construit le store brut (non résolu) à partir du texte nettoyé. */
function buildFlightStore(cleaned: string): Map<string, any> {
  const rows = splitFlightRows(cleaned);
  const store = new Map<string, any>();

  for (const row of rows) {
    if (row.tag === 'T') {
      store.set(row.id, row.raw); // string brute
    } else if (row.tag === 'I') {
      store.set(row.id, undefined);
    } else {
      const t = row.raw.trim();
      if (t === '' || t === 'null') {
        store.set(row.id, null);
      } else {
        try {
          store.set(row.id, JSON.parse(t));
        } catch {
          store.set(row.id, row.raw);
        }
      }
    }
  }

  return store;
}

/**
 * Résolution PROFONDE d'UN SEUL champ (options, extractedText, prompt…) :
 * suit toutes les refs $xx, y compris dans les clés/éléments imbriqués de
 * ce champ précis. On ne l'appelle jamais sur la question entière, donc
 * les champs non utilisés (aiReasoning, generateSettings, explanation…)
 * ne sont jamais résolus ni même regardés.
 */
function resolveRefDeep(
  store: Map<string, any>,
  value: any,
  seen = new Set<string>()
): any {
  if (typeof value === 'string') {
    if (value === '$undefined') return undefined;
    const m = REF_RE.exec(value);
    if (m) {
      const key = m[1].toLowerCase();
      const k = store.has(m[1]) ? m[1] : store.has(key) ? key : null;
      if (k !== null && !seen.has(k)) {
        const next = new Set(seen);
        next.add(k);
        return resolveRefDeep(store, store.get(k), next);
      }
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((v) => resolveRefDeep(store, v, seen));
  }
  if (value && typeof value === 'object') {
    const out: Record<string, any> = {};
    for (const k of Object.keys(value)) {
      out[k] = resolveRefDeep(store, value[k], seen);
    }
    return out;
  }
  return value;
}

/**
 * Résolution SUPERFICIELLE : suit la chaîne de refs ($xx → $yy → valeur)
 * pour obtenir la valeur pointée, mais NE DESCEND PAS dans les propriétés
 * imbriquées. Sert uniquement à retrouver la "forme" d'un nœud (le
 * conteneur {questions:[...]}, ou une question) sans payer le coût de
 * résoudre tout son contenu.
 */
function resolveRefShallow(
  store: Map<string, any>,
  value: any,
  seen = new Set<string>()
): any {
  if (typeof value === 'string') {
    if (value === '$undefined') return undefined;
    const m = REF_RE.exec(value);
    if (m) {
      const key = m[1].toLowerCase();
      const k = store.has(m[1]) ? m[1] : store.has(key) ? key : null;
      if (k !== null && !seen.has(k)) {
        const next = new Set(seen);
        next.add(k);
        return resolveRefShallow(store, store.get(k), next);
      }
    }
  }
  return value;
}

/** Résout un nœud (candidat) sans descendre dedans ; renvoie un objet/array ou null. */
function shallowObject(store: Map<string, any>, value: any): any {
  const v = resolveRefShallow(store, value);
  return v && typeof v === 'object' ? v : null;
}

/**
 * Cherche dans le store (non résolu en profondeur) le nœud qui contient
 * un tableau `questions` et renvoie ce tableau SOUS FORME BRUTE (chaque
 * élément peut encore être une ref $xx). Aucune résolution profonde
 * n'est faite ici.
 */
function findQuestionsArray(store: Map<string, any>): any[] | null {
  const visited = new Set<any>();

  const tryNode = (val: any): any[] | null => {
    const node = shallowObject(store, val);
    if (!node || visited.has(node)) return null;
    visited.add(node);

    if (!Array.isArray(node) && Array.isArray(node.questions)) {
      return node.questions;
    }

    const children = Array.isArray(node) ? node : Object.values(node);
    for (const c of children) {
      const r = tryNode(c);
      if (r) return r;
    }
    return null;
  };

  for (const val of store.values()) {
    const r = tryNode(val);
    if (r) return r;
  }
  return null;
}

/** Résout UN SEUL champ d'une question, en profondeur (refs internes incluses). */
function pickField(store: Map<string, any>, qRaw: any, key: string): any {
  if (!qRaw || typeof qRaw !== 'object') return undefined;
  return resolveRefDeep(store, qRaw[key]);
}

/**
 * Ne garde une valeur que si c'est un vrai lien http(s)://.
 * Rejette les data-URI (audio/image encodés en base64), blob:, etc.,
 * pour éviter de transporter des payloads volumineux jusqu'à l'UI.
 */
function asLinkOnly(value: unknown): string {
  if (typeof value !== 'string') return '';
  const v = value.trim();
  return /^https?:\/\//i.test(v) ? v : '';
}

/**
 * Normalise extractedText (objet, string JSON, ou absent) → { question, enonce }.
 * enonce vient de extractedText.content (le HTML de l'énoncé). Si jamais
 * un payload plus ancien expose encore un champ `enonce`, on le garde en
 * repli, mais `content` est prioritaire.
 */
function normalizeExtractedText(value: unknown): {
  question: string;
  enonce: string;
} {
  let obj: any = value;

  if (typeof obj === 'string') {
    const t = obj.trim();
    if (
      (t.startsWith('{') && t.endsWith('}')) ||
      (t.startsWith('[') && t.endsWith(']'))
    ) {
      try {
        obj = JSON.parse(t);
      } catch {
        return { question: '', enonce: '' };
      }
    } else {
      return { question: '', enonce: '' };
    }
  }

  if (obj && typeof obj === 'object') {
    const enonceSource = obj.content != null ? obj.content : obj.enonce;
    return {
      question: obj.question != null ? String(obj.question) : '',
      enonce: enonceSource != null ? String(enonceSource) : '',
    };
  }

  return { question: '', enonce: '' };
}

/**
 * Pipeline direct — Compréhension orale : raw Flight → SlimQuestionCo[].
 * Ne résout que points / prompt / audioUrl / imageUrl / options /
 * correctAnswerIndex pour chaque question. null/undefined/vide → [].
 * audioUrl / imageUrl : seuls les vrais liens http(s) sont conservés
 * (un data-URI base64 est rejeté → chaîne vide).
 */
export function questionsCoFromRawLight(raw: string): SlimQuestionCo[] {
  if (!raw || typeof raw !== 'string') return [];

  const cleaned = sanitizeRaw(raw);
  const store = buildFlightStore(cleaned);
  const questionsRaw = findQuestionsArray(store);
  if (!questionsRaw) return [];

  return questionsRaw.map((qRef) => {
    const qRaw = shallowObject(store, qRef);
    const prompt = pickField(store, qRaw, 'prompt');
    const audioUrl = asLinkOnly(pickField(store, qRaw, 'audioUrl'));
    const imageUrl = asLinkOnly(pickField(store, qRaw, 'imageUrl'));
    const options = pickField(store, qRaw, 'options');
    return {
      points: pickField(store, qRaw, 'points'),
      question: prompt != null ? String(prompt) : '',
      audioUrl,
      imageUrl,
      options: Array.isArray(options) ? options : [],
      correctAnswerIndex: pickField(store, qRaw, 'correctAnswerIndex'),
    };
  });
}

/**
 * Pipeline direct — Compréhension écrite : raw Flight → SlimQuestionCE[].
 * Ne résout que points / options / correctAnswerIndex / extractedText
 * pour chaque question. null/undefined/vide → [].
 */
export function questionsCeFromRawLight(raw: string): SlimQuestionCE[] {
  if (!raw || typeof raw !== 'string') return [];

  const cleaned = sanitizeRaw(raw);
  const store = buildFlightStore(cleaned);
  const questionsRaw = findQuestionsArray(store);
  if (!questionsRaw) return [];

  return questionsRaw.map((qRef) => {
    const qRaw = shallowObject(store, qRef);
    const options = pickField(store, qRaw, 'options');
    const extractedTextRaw = pickField(store, qRaw, 'extractedText');
    const et = normalizeExtractedText(extractedTextRaw);
    return {
      points: pickField(store, qRaw, 'points'),
      options: Array.isArray(options) ? options : [],
      correctAnswerIndex: pickField(store, qRaw, 'correctAnswerIndex'),
      question: et.question,
      enonce: arrangeEnnonceTcfCe(et.enonce),
    };
  });
}

// ---------------------------------------------------------------------------
// CLI de debug (ESM) — exécuter avec :
//   npx tsx parseFlightPayload.ts <fichier-brut.txt> co|ce
// ---------------------------------------------------------------------------
async function runCli() {
  const filePath = process.argv[2];
  const mode = process.argv[3];
  if (!filePath || (mode !== 'co' && mode !== 'ce')) {
    console.error('Usage: npx tsx parseFlightPayload.ts <fichier-brut.txt> co|ce');
    process.exit(1);
  }
  const { readFileSync } = await import('node:fs');
  const raw = readFileSync(filePath, 'utf8');
  const result =
    mode === 'co' ? questionsCoFromRawLight(raw) : questionsCeFromRawLight(raw);
}

const isDirectRun =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  !!process.argv[1] &&
  /parseFlightPayload\.(ts|js|mjs|cjs)$/.test(
    process.argv[1].replace(/\\/g, '/')
  );

if (isDirectRun) {
  runCli().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}