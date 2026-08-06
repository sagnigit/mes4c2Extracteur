// donnee_tcf_ce.ts
//
// Enregistrement / lecture des données TCF Compréhension Écrite.
//
// L'extrait ne contient AUCUNE image :
//   - enonce  = texte de l'énoncé (extrait de extractedText.enonce)
//   - question = texte de la question (extractedText.question)
//   - pas de dossier img/, pas de téléchargement
//
// Côté graphique : le texte enonce sert à générer une image qui sera
// enregistrée dans trans_img/ ; le chemin d'accès est alors écrit dans
// le JSON du transformé (champ enonce du transformé = chemin local).
//
// Organisation disque :
//   conserveur/
//     tcf_ce_<slug>_<idLien>/
//       trans_img/      → images générées côté graphique (transformé)
//       extrait_ce.json
//       trans_ce.json
//
// Refs gardienRef :
//   tcf_ce_chemin : id lien → nom dossier
//   tcf_ce_nom    : id lien → nom affichable

import * as path from 'path';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import {
  dossierConserveur,
  getRef,
  enregistreRef,
  creer_dossier,
  chargeRef,
} from './gardienRef.js';
import type { SlimQuestionCE } from './paser_comp_tcf.js';

/**
 * Question CE stockée.
 * - Dans extrait_ce.json  : enonce = texte de l'énoncé
 * - Dans trans_ce.json    : enonce = chemin relatif image (ex. "trans_img/…")
 *   une fois l'image générée côté graphique ; sinon texte tant que non générée.
 */
export interface QuestionCE {
  points: number;
  options: string[];
  correctAnswerIndex: number;
  /** Texte d'énoncé (extrait) ou chemin image (transformé après génération) */
  enonce: string;
  question: string;
}

export interface CarteTcfCe {
  id: string;
  nom: string;
  dossier: string;
}

const racineChemin = 'tcf_ce_chemin';
const racineNom = 'tcf_ce_nom';

const NOM_FICHIER_EXTRAIT = 'extrait_ce.json';
const NOM_FICHIER_TRANS = 'trans_ce.json';
const SOUS_DOSSIER_TRANS_IMG = 'trans_img';

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
  return `tcf_ce_${slugifier(nomLien)}_${idLien}`;
}

async function existeChemin(cible: string): Promise<boolean> {
  try {
    await fsp.access(cible, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Matérialise les questions CE sans aucun téléchargement d'image.
 * enonce reste le texte provenant de SlimQuestionCE.
 */
function materialiserQuestions(questions: SlimQuestionCE[]): QuestionCE[] {
  return questions.map((q) => ({
    points: q.points,
    options: Array.isArray(q.options) ? [...q.options] : [],
    correctAnswerIndex: q.correctAnswerIndex,
    enonce: q.enonce != null ? String(q.enonce) : '',
    question: q.question != null ? String(q.question) : '',
  }));
}

/**
 * Transformé initial = copie de l'extrait (enonce encore en texte).
 * Le côté graphique générera l'image dans trans_img/ et mettra à jour
 * le champ enonce du transformé avec le chemin local.
 */
function genererTransformDepuisExtrait(questions: QuestionCE[]): QuestionCE[] {
  return questions.map((q) => ({
    points: q.points,
    options: [...q.options],
    correctAnswerIndex: q.correctAnswerIndex,
    enonce: q.enonce,
    question: q.question,
  }));
}

// ---------------------------------------------------------------------
// Lecture
// ---------------------------------------------------------------------

/** Vrai si CE lien précis possède déjà un dossier de donnée TCF CE. */
export function possedeDonneeTcfCe(idLien: string): boolean {
  chargeRef();
  return !!getRef(racineChemin)[idLien];
}

/**
 * Supprime définitivement une carte TCF CE : le dossier sur disque
 * (extrait, transformé, images) ET sa référence. Utilisé par le bouton
 * de suppression de la carte (zoneAccueilTcfCe.ts).
 */
export async function supprimerDonneeTcfCe(
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

export function listerCartesTcfCe(): CarteTcfCe[] {
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

// Extension reconnue comme "image" dans le champ enonce du transformé
// (sinon enonce est traité comme du texte pas encore transformé).
const REGEX_EXTENSION_IMAGE = /\.(png|jpe?g|gif|webp)$/i;

/**
 * Résout, pour une question transformée, le chemin absolu affichable
 * (file://…) de son image d'énoncé si enonce pointe vers un fichier
 * image dans trans_img/ — sinon renvoie la question telle quelle
 * (enonce reste alors le texte, tant que l'image n'a pas été composée).
 */
function resoudreImageEnonce(
  cheminDossier: string,
  question: QuestionCE
): QuestionCE & { _localEnonceImage?: string } {
  if (question.enonce && REGEX_EXTENSION_IMAGE.test(question.enonce)) {
    const cheminAbsolu = path.join(cheminDossier, question.enonce);
    return { ...question, _localEnonceImage: `file://${cheminAbsolu.replace(/\\/g, '/')}` };
  }
  return question;
}

export async function lireDonneeTcfCe(
  idLien: string
): Promise<{
  success: boolean;
  extrait?: QuestionCE[];
  transforme?: (QuestionCE & { _localEnonceImage?: string })[];
  error?: string;
}> {
  chargeRef();
  const dossier = getRef(racineChemin)[idLien];
  if (!dossier) return { success: false, error: 'Donnée introuvable.' };

  try {
    const cheminDossier = path.join(dossierConserveur, dossier);
    const cheminExtrait = path.join(cheminDossier, NOM_FICHIER_EXTRAIT);
    const cheminTrans = path.join(cheminDossier, NOM_FICHIER_TRANS);

    const extrait: QuestionCE[] = (await existeChemin(cheminExtrait))
      ? JSON.parse(await fsp.readFile(cheminExtrait, 'utf-8'))
      : [];
    const transformeBrut: QuestionCE[] = (await existeChemin(cheminTrans))
      ? JSON.parse(await fsp.readFile(cheminTrans, 'utf-8'))
      : extrait;
    const transforme = transformeBrut.map((q) => resoudreImageEnonce(cheminDossier, q));

    return { success: true, extrait, transforme };
  } catch (err: any) {
    return { success: false, error: err?.message ?? String(err) };
  }
}

// ---------------------------------------------------------------------
// Écriture
// ---------------------------------------------------------------------

export type OptionsEnregistrementCe = {
  onProgress?: (msg: string, detail?: string) => void;
};

/**
 * Enregistre une extraction CE :
 *  - écrit extrait_ce.json (enonce = texte, pas d'image)
 *  - pas de dossier img/, pas de téléchargement
 *  - si nouveau dossier : trans_img/ (vide, pour la génération graphique)
 *    + trans_ce.json (copie initiale de l'extrait)
 *  - si dossier existant : extrait mis à jour, transformé CONSERVÉ
 */
export async function enregistrerDonneeTcfCe(
  idLien: string,
  nomLien: string,
  questions: SlimQuestionCE[],
  options?: OptionsEnregistrementCe
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
    // Pas de dossier img/ : l'extrait n'embarque aucune image.

    options?.onProgress?.('Enregistrement de l’extrait CE…', nomLien);

    const questionsLocales = materialiserQuestions(questions);

    await fsp.writeFile(
      path.join(cheminDossier, NOM_FICHIER_EXTRAIT),
      JSON.stringify(questionsLocales, null, 2),
      'utf-8'
    );

    if (cree) {
      // Dossier prêt pour les images générées côté graphique
      creer_dossier(path.join(cheminDossier, SOUS_DOSSIER_TRANS_IMG));
      options?.onProgress?.('Génération du transformé CE…', nomLien);
      const transforme = genererTransformDepuisExtrait(questionsLocales);
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

export async function sauvegarderTransformeTcfCe(
  idLien: string,
  questions: QuestionCE[]
): Promise<{ success: boolean; error?: string }> {
  chargeRef();
  const dossier = getRef(racineChemin)[idLien];
  if (!dossier) return { success: false, error: 'Donnée introuvable.' };

  try {
    const cheminDossier = path.join(dossierConserveur, dossier);
    creer_dossier(path.join(cheminDossier, SOUS_DOSSIER_TRANS_IMG));
    await fsp.writeFile(
      path.join(cheminDossier, NOM_FICHIER_TRANS),
      JSON.stringify(questions, null, 2),
      'utf-8'
    );
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err?.message ?? String(err) };
  }
}

/**
 * Enregistre l'image composée (voir EditableImagePopup.ts côté renderer)
 * pour l'énoncé d'UNE question précise :
 *  - écrit le fichier dans trans_img/ (nom fixe "enonce_<index>.<ext>",
 *    remplacé à chaque nouvelle composition) ;
 *  - met à jour uniquement le champ enonce de cette question (chemin
 *    relatif, ex. "trans_img/enonce_2.png") dans trans_ce.json, en
 *    conservant tel quel le reste du transformé déjà enregistré ;
 *  - renvoie ce chemin relatif ET le chemin absolu (file://…) pour un
 *    affichage immédiat côté renderer, sans relecture.
 */
export async function enregistrerImageEnonceTcfCe(
  idLien: string,
  indexQuestion: number,
  donneeBase64: string,
  extension: string
): Promise<{ success: boolean; cheminRelatif?: string; cheminAbsolu?: string; error?: string }> {
  chargeRef();
  const dossier = getRef(racineChemin)[idLien];
  if (!dossier) return { success: false, error: 'Donnée introuvable.' };

  try {
    const cheminDossier = path.join(dossierConserveur, dossier);
    const cheminTransImg = path.join(cheminDossier, SOUS_DOSSIER_TRANS_IMG);
    creer_dossier(cheminTransImg);

    const ext = (extension || 'png').replace(/[^a-z0-9]/gi, '').toLowerCase() || 'png';
    const nomFichier = `enonce_${indexQuestion}.${ext}`;
    const cheminFichier = path.join(cheminTransImg, nomFichier);
    await fsp.writeFile(cheminFichier, Buffer.from(donneeBase64, 'base64'));

    const cheminTrans = path.join(cheminDossier, NOM_FICHIER_TRANS);
    const transforme: QuestionCE[] = (await existeChemin(cheminTrans))
      ? JSON.parse(await fsp.readFile(cheminTrans, 'utf-8'))
      : [];

    while (transforme.length <= indexQuestion) {
      transforme.push({ points: 0, options: [], correctAnswerIndex: -1, enonce: '', question: '' });
    }

    const cheminRelatif = `${SOUS_DOSSIER_TRANS_IMG}/${nomFichier}`;
    transforme[indexQuestion] = { ...transforme[indexQuestion], enonce: cheminRelatif };

    await fsp.writeFile(cheminTrans, JSON.stringify(transforme, null, 2), 'utf-8');

    const cheminAbsolu = `file://${cheminFichier.replace(/\\/g, '/')}`;
    return { success: true, cheminRelatif, cheminAbsolu };
  } catch (err: any) {
    return { success: false, error: err?.message ?? String(err) };
  }
}

// ---------------------------------------------------------------------
// Récupération transformé + cheminDossier à partir de l'id uniquement
// ---------------------------------------------------------------------

/**
 * Renvoie le transformé BRUT (trans_ce.json, tel quel — pas de
 * résolution _localEnonceImage) et le cheminDossier absolu, uniquement
 * à partir de l'idLien.
 */
export async function recupererTransformeEtCheminTcfCe(
  idLien: string
): Promise<{ success: boolean; cheminDossier?: string; transforme?: QuestionCE[]; error?: string }> {
  chargeRef();
  const dossier = getRef(racineChemin)[idLien];
  if (!dossier) return { success: false, error: 'Donnée introuvable.' };

  try {
    const cheminDossier = path.join(dossierConserveur, dossier);
    const cheminTrans = path.join(cheminDossier, NOM_FICHIER_TRANS);

    const transforme: QuestionCE[] = (await existeChemin(cheminTrans))
      ? JSON.parse(await fsp.readFile(cheminTrans, 'utf-8'))
      : [];

    return { success: true, cheminDossier, transforme };
  } catch (err: any) {
    return { success: false, error: err?.message ?? String(err) };
  }
}