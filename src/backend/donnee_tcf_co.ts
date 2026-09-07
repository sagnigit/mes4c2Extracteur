// donnee_tcf_co.ts
//
// Enregistrement / lecture des données TCF Compréhension Orale.
// Inspiré du flux TEF (traite_extrait_tef + conserveurDonne) :
//   - téléchargement http(s) avec redirections, skip si fichier présent
//   - images → img/ , audios → audio/ (extrait)
//   - copies → trans_img/ , trans_audio/ (transformé à la création)
//
// Organisation disque :
//   conserveur/
//     tcf_co_<slug>_<idLien>/
//       img/ , audio/
//       trans_img/ , trans_audio/
//       extrait_co.json
//       trans_co.json
//
// Refs gardienRef :
//   tcf_co_chemin : id lien → nom dossier
//   tcf_co_nom    : id lien → nom affichable

import * as path from 'path';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as https from 'https';
import * as http from 'http';
import {
  dossierConserveur,
  getRef,
  enregistreRef,
  creer_dossier,
  chargeRef,
} from './gardienRef.js';
// Réutilisés tels quels : ce sont des utilitaires génériques (ne
// dépendent pas du système de dossiers TEF) — resoudreSlotMedia gère
// l'upload d'un nouveau média (base64) ou la suppression explicite
// d'un média existant ; melangerLettres fait le même mélange
// A/B/C/D que pour le TEF, pour un affichage/comportement identique.
import { resoudreSlotMedia, melangerLettres, type SlotMedia } from './conserveurDonne.js';
import type { SlimQuestionCo } from './paser_comp_tcf.js';

/** Question CO stockée (chemins locaux). */
export interface QuestionCO {
  points: number;
  /** Chemin relatif local, ex. "audio/xxx.mp3" */
  audioUrl: string;
  /** Chemin relatif local, ex. "img/xxx.png" */
  imageUrl: string;
  /** Texte de la question / prompt (ex. extrait de q.prompt) */
  question: string;
  options: string[];
  correctAnswerIndex: number;
}

export interface CarteTcfCo {
  id: string;
  nom: string;
  dossier: string;
}

export interface PropositionsCO {
  A: string;
  B: string;
  C: string;
  D: string;
}

// ---------------------------------------------------------------------
// Format d'AFFICHAGE (zoneAff.ts / zonesCO) : exactement les mêmes noms
// de champs que pour le TEF, pour un rendu (blocs extrait / transformé,
// navigation, badges...) carrément identique. C'est la seule raison
// d'être de ces deux types : la donnée BRUTE reste QuestionCO
// (extrait_co.json) — voir lireCoupleAffichageTcfCo /
// lireTransformeAffichageTcfCo plus bas, qui font la conversion.
// ---------------------------------------------------------------------

/** Élément "extrait" tel qu'attendu par zonesCO() dans zoneAff.ts. */
export interface ElementAffichageTcfCo {
  points?: number;
  consigne: string;
  reponseCorrecte: string;
  distracteurs: string;
  _localImagePath: string;
  _localAudioPath: string;
}

/** Item "transformé" tel qu'attendu par zonesCO() dans zoneAff.ts. */
export interface ItemTransformTcfCo {
  index: number;
  image: string;
  audio: string;
  consigne: string;
  propositions: PropositionsCO;
  bonneReponse: 'A' | 'B' | 'C' | 'D' | '';
  points?: number;
}

const racineChemin = 'tcf_co_chemin';
const racineNom = 'tcf_co_nom';

const NOM_FICHIER_EXTRAIT = 'extrait_co.json';
const NOM_FICHIER_TRANS = 'trans_co.json';
const SOUS_DOSSIER_IMG = 'img';
const SOUS_DOSSIER_AUDIO = 'audio';
const SOUS_DOSSIER_TRANS_IMG = 'trans_img';
const SOUS_DOSSIER_TRANS_AUDIO = 'trans_audio';

function slugifier(nom: string): string {
  const brut = nom
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return brut || 'lien';
}

function nomDossierPourLien(nomLien: string, idLien: string): string {
  return `tcf_co_${slugifier(nomLien)}_${idLien}`;
}

async function existeChemin(cible: string): Promise<boolean> {
  try {
    await fsp.access(cible, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/** Téléchargement style TEF : http(s), redirections, skip si déjà présent. */
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
        downloadFile(response.headers.location, destPath)
          .then(resolve)
          .catch(reject);
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

async function downloadSafe(
  url: string,
  destPath: string,
  label: string
): Promise<boolean> {
  try {
    await downloadFile(url, destPath);
    return true;
  } catch (e: any) {
    return false;
  }
}

function nomFichierDepuisUrl(
  url: string,
  fallbackBase: string,
  fallbackExt: string
): string {
  try {
    const base = path.basename(new URL(url).pathname);
    if (base && base !== '/' && base.includes('.')) return base;
  } catch {
    /* ignore */
  }
  return `${fallbackBase}${fallbackExt}`;
}

/**
 * Télécharge images + audios et produit les QuestionCO
 * (chemins relatifs locaux).
 */
async function materialiserQuestions(
  cheminDossier: string,
  questions: SlimQuestionCo[],
  onProgress?: (msg: string, detail?: string) => void
): Promise<QuestionCO[]> {
  const imgDir = path.join(cheminDossier, SOUS_DOSSIER_IMG);
  const audioDir = path.join(cheminDossier, SOUS_DOSSIER_AUDIO);
  creer_dossier(imgDir);
  creer_dossier(audioDir);

  const downloaded = new Set<string>();
  const resultat: QuestionCO[] = [];

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    const index = i + 1;
    let imageUrl = '';
    let audioUrl = '';

    const imgRemote = (q.imageUrl || '').trim();
    if (imgRemote) {
      const localName = nomFichierDepuisUrl(imgRemote, String(index), '.png');
      const dest = path.join(imgDir, localName);
      const rel = path.join(SOUS_DOSSIER_IMG, localName).replace(/\\/g, '/');

      if (!downloaded.has(dest)) {
        onProgress?.(
          `Téléchargement image CO ${index}/${questions.length}…`,
          localName
        );
        const ok = await downloadSafe(imgRemote, dest, `CO image ${localName}`);
        downloaded.add(dest);
        if (ok) imageUrl = rel;
      } else if (fs.existsSync(dest)) {
        imageUrl = rel;
      }
    }

    const audioRemote = (q.audioUrl || '').trim();
    if (audioRemote) {
      const localName = nomFichierDepuisUrl(audioRemote, String(index), '.mp3');
      const dest = path.join(audioDir, localName);
      const rel = path.join(SOUS_DOSSIER_AUDIO, localName).replace(/\\/g, '/');

      if (!downloaded.has(dest)) {
        onProgress?.(
          `Téléchargement audio CO ${index}/${questions.length}…`,
          localName
        );
        const ok = await downloadSafe(
          audioRemote,
          dest,
          `CO audio ${localName}`
        );
        downloaded.add(dest);
        if (ok) audioUrl = rel;
      } else if (fs.existsSync(dest)) {
        audioUrl = rel;
      }
    }

    resultat.push({
      points: q.points,
      audioUrl,
      imageUrl,
      question: q.question != null ? String(q.question) : '',
      options: q.options,
      correctAnswerIndex: q.correctAnswerIndex,
    });
  }

  return resultat;
}

/**
 * Copie médias extrait → trans_img / trans_audio, et construit le
 * transformé dans le format d'AFFICHAGE commun avec le TEF (image,
 * audio, consigne éditable, propositions A-D + bonneReponse) plutôt
 * que de recopier tel quel le format brut QuestionCO — c'est ce format
 * que zonesCO() (zoneAff.ts) sait afficher/éditer, exactement comme
 * pour une série TEF-CO. Les lettres A-D sont mélangées comme pour le
 * TEF (voir melangerLettres, conserveurDonne.ts), pour un comportement
 * identique.
 */
async function genererTransformDepuisExtrait(
  cheminDossier: string,
  questions: QuestionCO[]
): Promise<ItemTransformTcfCo[]> {
  const transImgDir = path.join(cheminDossier, SOUS_DOSSIER_TRANS_IMG);
  const transAudioDir = path.join(cheminDossier, SOUS_DOSSIER_TRANS_AUDIO);
  creer_dossier(transImgDir);
  creer_dossier(transAudioDir);

  const out: ItemTransformTcfCo[] = [];

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    let imageUrl = '';
    let audioUrl = '';

    if (q.imageUrl) {
      const src = path.join(cheminDossier, q.imageUrl.replace(/\\/g, '/'));
      if (await existeChemin(src)) {
        const base = path.basename(src);
        const destName = `co_${i}_${base}`;
        await fsp.copyFile(src, path.join(transImgDir, destName));
        imageUrl = path
          .join(SOUS_DOSSIER_TRANS_IMG, destName)
          .replace(/\\/g, '/');
      }
    }

    if (q.audioUrl) {
      const src = path.join(cheminDossier, q.audioUrl.replace(/\\/g, '/'));
      if (await existeChemin(src)) {
        const base = path.basename(src);
        const destName = `co_${i}_${base}`;
        await fsp.copyFile(src, path.join(transAudioDir, destName));
        audioUrl = path
          .join(SOUS_DOSSIER_TRANS_AUDIO, destName)
          .replace(/\\/g, '/');
      }
    }

    const textes = (q.options ?? []).slice(0, 4).map((t) => (t != null ? String(t) : ''));
    while (textes.length < 4) textes.push('');

    // Extrait sans propositions : A→D dans l'ordre avec "Proposition A"…"D".
    const aucunTexte = textes.every((t) => t.trim() === '');
    let propositions: PropositionsCO;
    let bonneReponse: 'A' | 'B' | 'C' | 'D' | '' = '';
    if (aucunTexte) {
      propositions = {
        A: 'Proposition A',
        B: 'Proposition B',
        C: 'Proposition C',
        D: 'Proposition D',
      };
    } else {
      const lettres = melangerLettres(['A', 'B', 'C', 'D']) as Array<keyof PropositionsCO>;
      propositions = { A: '', B: '', C: '', D: '' };
      textes.forEach((texte, idx) => {
        const lettre = lettres[idx];
        propositions[lettre] = texte;
        if (idx === q.correctAnswerIndex) bonneReponse = lettre;
      });
    }

    out.push({
      index: i,
      image: imageUrl,
      audio: audioUrl,
      // consigne = texte de la question (prompt), comme pour le CE
      consigne: q.question != null ? String(q.question) : '',
      propositions,
      bonneReponse,
      points: q.points,
    });
  }

  return out;
}

// ---------------------------------------------------------------------
// Lecture
// ---------------------------------------------------------------------

/** Vrai si CE lien précis possède déjà un dossier de donnée TCF CO. */
export function possedeDonneeTcfCo(idLien: string): boolean {
  chargeRef();
  return !!getRef(racineChemin)[idLien];
}

/**
 * Supprime définitivement une carte TCF CO : le dossier sur disque
 * (extrait, transformé, médias) ET sa référence. Utilisé par le bouton
 * de suppression de la carte, via conserveur:delete-series (main.ts),
 * réutilisant le même système de cartes que le TEF (zoneAccueilTef.ts).
 */
export async function supprimerDonneeTcfCo(
  idLien: string
): Promise<{ success: boolean; error?: string }> {
  try {
    chargeRef();
    const dataChemin = getRef(racineChemin);
    const dataNom = getRef(racineNom);
    const dossier = dataChemin[idLien];
    if (!dossier) return { success: false, error: 'Donnée introuvable' };

    const cheminDossier = path.join(dossierConserveur, dossier);
    if (await existeChemin(cheminDossier)) {
      await fsp.rm(cheminDossier, { recursive: true, force: true });
    }

    delete dataChemin[idLien];
    delete dataNom[idLien];
    enregistreRef();

    return { success: true };
  } catch (err: any) {
    return { success: false, error: err?.message ?? String(err) };
  }
}

export function listerCartesTcfCo(): CarteTcfCo[] {
  chargeRef();
  const dataChemin = getRef(racineChemin);
  const dataNom = getRef(racineNom);

  return Object.keys(dataChemin)
    .map((id) => ({
      id,
      nom: dataNom[id] ?? dataChemin[id],
      dossier: dataChemin[id],
    }))
    .sort((a, b) =>
      a.nom.localeCompare(b.nom, undefined, {
        numeric: true,
        sensitivity: 'base',
      })
    );
}

export async function lireDonneeTcfCo(
  idLien: string
): Promise<{
  success: boolean;
  extrait?: QuestionCO[];
  transforme?: QuestionCO[];
  error?: string;
}> {
  chargeRef();
  const dossier = getRef(racineChemin)[idLien];
  if (!dossier) return { success: false, error: 'Donnée introuvable.' };

  try {
    const cheminDossier = path.join(dossierConserveur, dossier);
    const cheminExtrait = path.join(cheminDossier, NOM_FICHIER_EXTRAIT);
    const cheminTrans = path.join(cheminDossier, NOM_FICHIER_TRANS);

    const extrait: QuestionCO[] = (await existeChemin(cheminExtrait))
      ? JSON.parse(await fsp.readFile(cheminExtrait, 'utf-8'))
      : [];
    const transforme: QuestionCO[] = (await existeChemin(cheminTrans))
      ? JSON.parse(await fsp.readFile(cheminTrans, 'utf-8'))
      : extrait;

    return { success: true, extrait, transforme };
  } catch (err: any) {
    return { success: false, error: err?.message ?? String(err) };
  }
}

// ---------------------------------------------------------------------
// Écriture
// ---------------------------------------------------------------------

export type OptionsEnregistrementCo = {
  onProgress?: (msg: string, detail?: string) => void;
};

/**
 * Enregistre une extraction CO :
 *  - télécharge images (img/) et audios (audio/)
 *  - écrit extrait_co.json (chemins locaux)
 *  - si nouveau dossier : copies trans_img/trans_audio + trans_co.json
 *  - si dossier existant : extrait mis à jour, transformé CONSERVÉ
 */
export async function enregistrerDonneeTcfCo(
  idLien: string,
  nomLien: string,
  questions: SlimQuestionCo[],
  options?: OptionsEnregistrementCo
): Promise<{ success: boolean; cree: boolean; dossier?: string; error?: string }> {
  try {
    chargeRef();
    const dataChemin = getRef(racineChemin);
    const dataNom = getRef(racineNom);

    let dossier = dataChemin[idLien];
    const cree = !dossier;
    if (cree) {
      dossier = nomDossierPourLien(nomLien, idLien);
      dataChemin[idLien] = dossier;
    }
    dataNom[idLien] = nomLien;
    enregistreRef();

    const cheminDossier = path.join(dossierConserveur, dossier!);
    creer_dossier(cheminDossier);
    creer_dossier(path.join(cheminDossier, SOUS_DOSSIER_IMG));
    creer_dossier(path.join(cheminDossier, SOUS_DOSSIER_AUDIO));

    options?.onProgress?.(
      'Téléchargement des médias (images / audios)…',
      nomLien
    );

    const questionsLocales = await materialiserQuestions(
      cheminDossier,
      questions,
      options?.onProgress
    );

    await fsp.writeFile(
      path.join(cheminDossier, NOM_FICHIER_EXTRAIT),
      JSON.stringify(questionsLocales, null, 2),
      'utf-8'
    );

    if (cree) {
      options?.onProgress?.('Génération du transformé CO…', nomLien);
      const transforme = await genererTransformDepuisExtrait(
        cheminDossier,
        questionsLocales
      );
      await fsp.writeFile(
        path.join(cheminDossier, NOM_FICHIER_TRANS),
        JSON.stringify(transforme, null, 2),
        'utf-8'
      );
    }

    return { success: true, cree, dossier };
  } catch (err: any) {
    return { success: false, cree: false, error: err?.message ?? String(err) };
  }
}

// ---------------------------------------------------------------------
// Affichage (zoneAff.ts, via le pont dans main.ts — voir les canaux
// 'conserveur:*' branchés sur ces fonctions pour examen 'tcf' + type
// 'co') : même format que le TEF, pour un rendu (nav + blocs extrait /
// transformé) carrément identique. La donnée brute reste QuestionCO
// (extrait_co.json / lireDonneeTcfCo ci-dessus) — ces fonctions ne
// font que la conversion, jamais utilisées pour l'enregistrement de
// l'extraction elle-même (voir enregistrerDonneeTcfCo plus haut).
// ---------------------------------------------------------------------

const versFileUrl = (cheminDossier: string, relatif: string | undefined): string => {
  if (!relatif) return '';
  return `file://${path.join(cheminDossier, relatif).replace(/\\/g, '/')}`;
};

/** Lit l'extrait ET le transformé, tous deux au format d'affichage commun. */
export async function lireCoupleAffichageTcfCo(idLien: string): Promise<{
  success: boolean;
  extrait?: ElementAffichageTcfCo[];
  transforme?: Array<ItemTransformTcfCo & { _localImage: string; _localAudio: string }>;
  /** ss manuel éventuel (champ séparé, pas propriété du tableau). */
  ss?: string;
  error?: string;
}> {
  chargeRef();
  const dossier = getRef(racineChemin)[idLien];
  if (!dossier) return { success: false, error: 'Donnée introuvable.' };

  try {
    const cheminDossier = path.join(dossierConserveur, dossier);
    const cheminExtrait = path.join(cheminDossier, NOM_FICHIER_EXTRAIT);
    const cheminTrans = path.join(cheminDossier, NOM_FICHIER_TRANS);

    const brut: QuestionCO[] = (await existeChemin(cheminExtrait))
      ? JSON.parse(await fsp.readFile(cheminExtrait, 'utf-8'))
      : [];

    const extrait: ElementAffichageTcfCo[] = brut.map((q) => {
      const options = q.options ?? [];
      const reponseCorrecte = options[q.correctAnswerIndex] ?? '';
      const distracteurs = options
        .filter((_, idx) => idx !== q.correctAnswerIndex)
        .join('|');
      return {
        points: q.points,
        // rétrocompat : anciennes extrait_co.json sans champ question → ''
        consigne: q.question != null ? String(q.question) : '',
        reponseCorrecte,
        distracteurs,
        _localImagePath: versFileUrl(cheminDossier, q.imageUrl),
        _localAudioPath: versFileUrl(cheminDossier, q.audioUrl),
      };
    });

    let parseTrans: any = (await existeChemin(cheminTrans))
      ? JSON.parse(await fsp.readFile(cheminTrans, 'utf-8'))
      : [];
    const transformeBrut: ItemTransformTcfCo[] = Array.isArray(parseTrans)
      ? parseTrans
      : Array.isArray(parseTrans?.items)
        ? parseTrans.items
        : [];
    const ssTrans = !Array.isArray(parseTrans) && typeof parseTrans?.ss === 'string'
      ? parseTrans.ss.trim()
      : '';

    const transforme = transformeBrut.map((item) => ({
      ...item,
      _localImage: versFileUrl(cheminDossier, item.image),
      _localAudio: versFileUrl(cheminDossier, item.audio),
    }));

    return { success: true, extrait, transforme, ss: ssTrans };
  } catch (err: any) {
    return { success: false, error: err?.message ?? String(err) };
  }
}

/** Lit uniquement le transformé (format d'affichage) — préchargement à l'ouverture d'une carte. */
export async function lireTransformeAffichageTcfCo(
  idLien: string
): Promise<{ success: boolean; transforme?: Array<ItemTransformTcfCo & { _localImage: string; _localAudio: string }>; ss?: string; error?: string }> {
  const resultat = await lireCoupleAffichageTcfCo(idLien);
  if (!resultat.success) return { success: false, error: resultat.error };
  return { success: true, transforme: resultat.transforme, ss: (resultat as any).ss ?? '' };
}

/**
 * Enregistre (fusion avec l'existant, par index) des champs partiels du
 * transformé — exactement le même principe que
 * sauvegarderTransformCeOuCo dans conserveurDonne.ts, réutilisé ici via
 * resoudreSlotMedia pour l'upload/suppression d'un média.
 */
export async function sauvegarderTransformePartielTcfCo(
  idLien: string,
  items: Array<{
    index: number;
    image?: string | SlotMedia;
    audio?: string | SlotMedia;
    consigne?: string;
    propositions?: Partial<PropositionsCO>;
    bonneReponse?: 'A' | 'B' | 'C' | 'D' | '';
    points?: number;
  }>
): Promise<{ success: boolean; error?: string }> {
  chargeRef();
  const dossier = getRef(racineChemin)[idLien];
  if (!dossier) return { success: false, error: 'Donnée introuvable.' };

  try {
    const cheminDossier = path.join(dossierConserveur, dossier);
    const fichierJson = path.join(cheminDossier, NOM_FICHIER_TRANS);

    let existant: ItemTransformTcfCo[] = [];
    let ssExistant = '';
    if (await existeChemin(fichierJson)) {
      try {
        const parse = JSON.parse(await fsp.readFile(fichierJson, 'utf-8'));
        if (Array.isArray(parse)) {
          existant = parse;
        } else if (parse && typeof parse === 'object') {
          existant = Array.isArray(parse.items) ? parse.items : [];
          ssExistant = typeof parse.ss === 'string' ? parse.ss.trim() : '';
        }
      } catch {
        existant = [];
      }
    }

    const parIndex = new Map<number, ItemTransformTcfCo>();
    for (const it of existant) parIndex.set(it.index, it);

    for (const envoye of items) {
      const precedent = parIndex.get(envoye.index) ?? {
        index: envoye.index,
        image: '',
        audio: '',
        consigne: '',
        propositions: { A: '', B: '', C: '', D: '' },
        bonneReponse: '' as const,
      };

      const image = await resoudreSlotMedia(
        cheminDossier,
        SOUS_DOSSIER_TRANS_IMG,
        `co_${envoye.index}`,
        precedent.image,
        envoye.image
      );
      const audio = await resoudreSlotMedia(
        cheminDossier,
        SOUS_DOSSIER_TRANS_AUDIO,
        `co_${envoye.index}`,
        precedent.audio,
        envoye.audio
      );

      const fusionne: ItemTransformTcfCo = {
        index: envoye.index,
        image,
        audio,
        consigne: envoye.consigne ?? precedent.consigne,
        propositions: { ...precedent.propositions, ...(envoye.propositions ?? {}) },
        bonneReponse: (envoye.bonneReponse ?? precedent.bonneReponse) as ItemTransformTcfCo['bonneReponse'],
        points: envoye.points ?? precedent.points,
      };

      parIndex.set(envoye.index, fusionne);
    }

    const resultatFinal = Array.from(parIndex.values()).sort((a, b) => a.index - b.index);
    const aEcrire = ssExistant ? { ss: ssExistant, items: resultatFinal } : resultatFinal;
    await fsp.writeFile(fichierJson, JSON.stringify(aEcrire, null, 2), 'utf-8');
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err?.message ?? String(err) };
  }
}

// ---------------------------------------------------------------------
// Récupération transformé + cheminDossier à partir de l'id uniquement
// ---------------------------------------------------------------------

/**
 * Renvoie le transformé BRUT (trans_co.json, tel quel — pas de
 * résolution _localImage/_localAudio) et le cheminDossier absolu,
 * uniquement à partir de l'idLien.
 */
export async function recupererTransformeEtCheminTcfCo(
  idLien: string
): Promise<{ success: boolean; cheminDossier?: string; transforme?: ItemTransformTcfCo[]; error?: string }> {
  chargeRef();
  const dossier = getRef(racineChemin)[idLien];
  if (!dossier) return { success: false, error: 'Donnée introuvable.' };

  try {
    const cheminDossier = path.join(dossierConserveur, dossier);
    const cheminTrans = path.join(cheminDossier, NOM_FICHIER_TRANS);

    let brut: any = (await existeChemin(cheminTrans))
      ? JSON.parse(await fsp.readFile(cheminTrans, 'utf-8'))
      : [];
    let transforme: ItemTransformTcfCo[] = Array.isArray(brut)
      ? brut
      : Array.isArray(brut?.items)
        ? brut.items
        : [];
    const ss = !Array.isArray(brut) && typeof brut?.ss === 'string' ? brut.ss.trim() : '';
    if (ss) (transforme as any).ss = ss;

    return { success: true, cheminDossier, transforme };
  } catch (err: any) {
    return { success: false, error: err?.message ?? String(err) };
  }
}

/** Enregistre uniquement le ss manuel dans trans_co.json (préserve les items). */
export async function sauvegarderSsTcfCo(
  idLien: string,
  ss: string
): Promise<{ success: boolean; error?: string }> {
  chargeRef();
  const dossier = getRef(racineChemin)[idLien];
  if (!dossier) return { success: false, error: 'Donnée introuvable.' };
  try {
    const cheminTrans = path.join(dossierConserveur, dossier, NOM_FICHIER_TRANS);
    let brut: any = (await existeChemin(cheminTrans))
      ? JSON.parse(await fsp.readFile(cheminTrans, 'utf-8'))
      : [];
    const items: ItemTransformTcfCo[] = Array.isArray(brut)
      ? brut
      : Array.isArray(brut?.items)
        ? brut.items
        : [];
    const ssNettoye = (ss ?? '').trim();
    const aEcrire = ssNettoye ? { ss: ssNettoye, items } : items;
    await fsp.writeFile(cheminTrans, JSON.stringify(aEcrire, null, 2), 'utf-8');
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err?.message ?? String(err) };
  }
}