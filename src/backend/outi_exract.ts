import { rechargeLien, getNomLien, NomLienExtrait, LienBrute } from './conserveLien.js';
import { enregistrerDonneeTcfEo, PartieEO } from './donnee_tcf_eo.js';
import { enregistrerDonneeTcfEe, PartieEE } from './donnee_tcf_ee.js';
import { enregistrerDonneeTcfCe } from './donnee_tcf_ce.js';
import { enregistrerDonneeTcfCo } from './donnee_tcf_co.js';
import { processSerieTef, type TefRefs } from './traite_extract_tef.js';
import {
    cheminDossierSerie,
    genererTransformCeOuCo,
    genererTransformEE,
    genererTransformEO,
    TYPES_EPREUVE,
    type TypeEpreuve,
    getBaseDir,
} from './conserveurDonne.js';
import { creer_dossier } from './gardienRef.js';
// Référencement : SEULE source des noms de dossier TEF (préfixés
// "tef_") et de leur mapping id (lien) ↔ dossier ↔ nom affichable.
import { getCheminEnsDossierTef } from './gestion_ref_tef.js';
import {
    questionsCeFromRawLight,
    questionsCoFromRawLight,
    type SlimQuestionCE,
    type SlimQuestionCo,
} from './paser_comp_tcf.js';

import * as path from 'path';
import * as fsp from 'fs/promises';

// Code JS à injecter pour RÉCUPÉRER LES LIENS (une page "tableau de
// bord" -> tableau de liens {url, nom}) et pour RÉCUPÉRER LA DONNÉE
// d'un lien précis. Chaque fichier exporte `strCode` (un template
// literal, à remplir directement là-bas) — c'est le seul endroit à
// modifier pour écrire le code de récupération de chaque idActu.
import { strCode as strCodeLienTcfCe } from '../codeRecup/recupLien_tcf_ce.js';
import { strCode as strCodeLienTcfCo } from '../codeRecup/recupLien_tcf_co.js';
import { strCode as strCodeLienTcfEe } from '../codeRecup/recupLien_tcf_ee.js';
import { strCode as strCodeLienTcfEo } from '../codeRecup/recupLien_tcf_eo.js';
import { strCode as strCodeLienTefSession } from '../codeRecup/recupLien_tef_session.js';

import { strCode as strCodeDonneeTcfCe } from '../codeRecup/recupDonnee_tcf_ce.js';
import { strCode as strCodeDonneeTcfCo } from '../codeRecup/recupDonnee_tcf_co.js';
import { strCode as strCodeDonneeTcfEe } from '../codeRecup/recupDonnee_tcf_ee.js';
import { strCode as strCodeDonneeTcfEo } from '../codeRecup/recupDonnee_tcf_eo.js';
import { strCode as strCodeDonneeTefSession } from '../codeRecup/recupDonnee_tef_session.js';

import {saveTestJson} from '../saveTestJson.js';

// Persistance locale (JSON) + téléchargement distant (Gist) des 3
// dictionnaires ci-dessous — voir gardienOutilExtract.ts pour le
// détail (lecture/écriture/validation), ce fichier-ci ne fait que
// décider QUAND les utiliser (initOutil, mettreAJourCodesExtraction).
import {
    chargerDonneesSauvegardees,
    enregistrerDonnees,
    telechargerDonneesDistantes,
} from './gardienOutilExtract.js';


interface DictExtract {
    [key: string]: string;
}

interface DictManipStr {
    [key: string]: (valeur: any) => void | Promise<void>;
}

// Comme DictManipStr, mais pour le traitement d'une DONNÉE (pas d'une
// liste de liens) : le gestionnaire reçoit aussi le lien concerné (pour
// pouvoir nommer la série à partir de son nom — voir
// creerGestionnaireDonneeExpression ci-dessous).
interface DictManipDonneeStr {
    [key: string]: (valeur: any, idActu: string, idLien: string) => void | Promise<void>;
}

// le dictionnaire des lien centrale ou on extrait d'autre lien
export let dataLienPincipale: DictExtract;
export let dataCodeRecupLien: DictExtract;
export let dataCodeRecupDonnee: DictExtract;

// data pour les fonctions de maipulation des donneer çu lors des extraction de lien
export let dataManipLien: DictManipStr;

// ---------------------------------------------------------------------------
// Notifications vers le renderer (branchées depuis extractionDirecte.ts)
// ---------------------------------------------------------------------------

// Bilan transmis au renderer (zoneExtract.ts / zoneAccueil.ts) une fois
// l'enregistrement d'une donnée terminé — succès ou échec.
export interface InfoDonneeTraitee {
    success: boolean;
    nbSeries?: number;
    nbCreees?: number;
    error?: string;
}

let notifierDonneeTraitee: ((idActu: string, info: InfoDonneeTraitee) => void) | null = null;
export function definirNotifieurDonneeTraitee(
    fn: (idActu: string, info: InfoDonneeTraitee) => void
): void {
    notifierDonneeTraitee = fn;
}

/** Progression pendant le traitement post-extraction (téléchargements, etc.). */
export interface InfoProgressionDonnee {
    /** Étape courte, ex. "extraction", "telechargement", "transform", "termine" */
    etape: string;
    /** Message affichable pour l'utilisateur */
    message: string;
    /** Détail optionnel (nom de fichier, type d'épreuve, …) */
    detail?: string;
}

let notifierProgressionDonnee:
    | ((idActu: string, info: InfoProgressionDonnee) => void)
    | null = null;
export function definirNotifieurProgressionDonnee(
    fn: (idActu: string, info: InfoProgressionDonnee) => void
): void {
    notifierProgressionDonnee = fn;
}

function progresser(idActu: string, etape: string, message: string, detail?: string): void {
    notifierProgressionDonnee?.(idActu, { etape, message, detail });
}

// ---------------------------------------------------------------------------
// Gestionnaires de données TCF
// ---------------------------------------------------------------------------

/**
 * Gestionnaire (onDonnee) pour un lien Compréhension Écrite TCF.
 * Pipeline : questionsCEFromRaw → enregistrerDonneeTcfCe
 * (extrait_ce.json + trans_ce.json à la première création).
 */
async function traiterDonneeTcfCe(
    valeur: any,
    idActu: string,
    idLien: string
): Promise<void> {
    if (valeur === null || valeur === undefined) {
        notifierDonneeTraitee?.(idActu, {
            success: false,
            error: "Le code injecté n'a retourné aucune donnée.",
        });
        return;
    }

    const raw = typeof valeur === 'string' ? valeur : String(valeur);
    if (!raw.trim()) {
        notifierDonneeTraitee?.(idActu, {
            success: false,
            error: 'Donnée CE vide.',
        });
        return;
    }

    let questions: SlimQuestionCE[];
    try {
        questions = questionsCeFromRawLight(raw);
    } catch (err: any) {
        notifierDonneeTraitee?.(idActu, {
            success: false,
            error: err?.message ?? 'Échec du parsing de la donnée CE.',
        });
        return;
    }

    if (!questions.length) {
        notifierDonneeTraitee?.(idActu, {
            success: false,
            error: 'Aucune question exploitable trouvée sur cette page.',
        });
        return;
    }

    const nomLien =
        getNomLien(idActu).find((l) => l.id === idLien)?.nom ?? idLien;

    const resultat = await enregistrerDonneeTcfCe(idLien, nomLien, questions);

    if (!resultat.success) {
        notifierDonneeTraitee?.(idActu, {
            success: false,
            error: resultat.error ?? "Échec de l'enregistrement.",
        });
        return;
    }
    notifierDonneeTraitee?.(idActu, {
        success: true,
        nbSeries: 1,
        nbCreees: resultat.cree ? 1 : 0,
    });
}

/**
 * Gestionnaire (onDonnee) pour un lien Compréhension Orale TCF.
 * Pipeline : questionsCoFromRaw → enregistrerDonneeTcfCo
 * (extrait_co.json + trans_co.json à la première création).
 *
 * Les questions CO comportent des médias (images / audios) à
 * télécharger, exactement comme une session TEF : on suit donc le même
 * déroulé que traiterDonneeTefSession ci-dessous (progresser() à chaque
 * étape), pour que zoneExtractionDirecte.ts affiche la même chose dans
 * les deux cas au lieu de laisser l'utilisateur sans retour pendant le
 * téléchargement.
 */
async function traiterDonneeTcfCo(
    valeur: any,
    idActu: string,
    idLien: string
): Promise<void> {
    if (valeur === null || valeur === undefined) {
        notifierDonneeTraitee?.(idActu, {
            success: false,
            error: "Le code injecté n'a retourné aucune donnée.",
        });
        return;
    }

    const raw = typeof valeur === 'string' ? valeur : String(valeur);
    if (!raw.trim()) {
        notifierDonneeTraitee?.(idActu, {
            success: false,
            error: 'Donnée CO vide.',
        });
        return;
    }

    let questions: SlimQuestionCo[];
    try {
        questions = questionsCoFromRawLight(raw);
    } catch (err: any) {
        notifierDonneeTraitee?.(idActu, {
            success: false,
            error: err?.message ?? 'Échec du parsing de la donnée CO.',
        });
        return;
    }

    if (!questions.length) {
        notifierDonneeTraitee?.(idActu, {
            success: false,
            error: 'Aucune question exploitable trouvée sur cette page.',
        });
        return;
    }

    const nomLien =
        getNomLien(idActu).find((l) => l.id === idLien)?.nom ?? idLien;

    // Même déroulé que traiterDonneeTefSession : les questions CO
    // embarquent des médias (images / audios) à télécharger, ce qui peut
    // prendre du temps — on informe donc le renderer de chaque étape
    // (voir progresser / ecouteProgressionDonnee dans
    // zoneExtractionDirecte.ts) au lieu de le laisser sans retour visuel
    // pendant tout le téléchargement.
    try {
        progresser(idActu, 'preparation', 'Préparation de l’enregistrement…', nomLien);
        progresser(
            idActu,
            'extraction',
            'Téléchargement des médias (images / audios)…',
            nomLien
        );

        const resultat = await enregistrerDonneeTcfCo(idLien, nomLien, questions, {
            onProgress: (msg, detail) => {
                progresser(idActu, 'telechargement', msg, detail);
            },
        });

        if (!resultat.success) {
            progresser(idActu, 'termine', 'Échec de l’enregistrement.');
            notifierDonneeTraitee?.(idActu, {
                success: false,
                error: resultat.error ?? "Échec de l'enregistrement.",
            });
            return;
        }

        progresser(idActu, 'termine', 'Donnée CO enregistrée.');
        notifierDonneeTraitee?.(idActu, {
            success: true,
            nbSeries: 1,
            nbCreees: resultat.cree ? 1 : 0,
        });
    } catch (err: any) {
        progresser(idActu, 'termine', 'Échec de l’enregistrement.');
        notifierDonneeTraitee?.(idActu, {
            success: false,
            error: err?.message ?? String(err),
        });
    }
}

// Gestionnaire (onDonnee) pour la récupération du contenu d'un lien
// Expression Orale TCF (voir recupDonnee_tcf_eo.ts) : la valeur reçue
// est soit `null`, soit une chaîne JSON (ou déjà un tableau) de
// { nomPartie, tache2, tache3 }. TOUT le tableau est confié tel quel à
// donnee_tcf_eo.ts — seul point de passage pour l'enregistrement et la
// récupération des données EO du TCF — qui le conserve dans un seul
// dossier (un dossier = une carte à l'affichage).
async function traiterDonneeTcfEo(
    valeur: any,
    idActu: string,
    idLien: string
): Promise<void> {
    if (valeur === null || valeur === undefined) {
        notifierDonneeTraitee?.(idActu, {
            success: false,
            error: "Le code injecté n'a retourné aucune donnée.",
        });
        return;
    }

    let parties: unknown;
    try {
        parties = typeof valeur === 'string' ? JSON.parse(valeur) : valeur;
    } catch {
        notifierDonneeTraitee?.(idActu, {
            success: false,
            error: 'Réponse illisible (JSON invalide).',
        });
        return;
    }
    if (!Array.isArray(parties) || parties.length === 0) {
        notifierDonneeTraitee?.(idActu, {
            success: false,
            error: 'Aucune donnée exploitable trouvée sur cette page.',
        });
        return;
    }

    const nomLien = getNomLien(idActu).find((l) => l.id === idLien)?.nom ?? idLien;
    const resultat = await enregistrerDonneeTcfEo(idLien, nomLien, parties as PartieEO[]);

    if (!resultat.success) {
        notifierDonneeTraitee?.(idActu, {
            success: false,
            error: resultat.error ?? "Échec de l'enregistrement.",
        });
        return;
    }
    notifierDonneeTraitee?.(idActu, {
        success: true,
        nbSeries: 1,
        nbCreees: resultat.cree ? 1 : 0,
    });
}

// Gestionnaire (onDonnee) pour la récupération du contenu d'un lien
// Expression Écrite TCF (voir recupDonnee_tcf_ee.ts) : exactement le
// même principe que traiterDonneeTcfEo.
async function traiterDonneeTcfEe(
    valeur: any,
    idActu: string,
    idLien: string
): Promise<void> {
    if (valeur === null || valeur === undefined) {
        notifierDonneeTraitee?.(idActu, {
            success: false,
            error: "Le code injecté n'a retourné aucune donnée.",
        });
        return;
    }

    let parties: unknown;
    try {
        parties = typeof valeur === 'string' ? JSON.parse(valeur) : valeur;
    } catch {
        notifierDonneeTraitee?.(idActu, {
            success: false,
            error: 'Réponse illisible (JSON invalide).',
        });
        return;
    }
    if (!Array.isArray(parties) || parties.length === 0) {
        notifierDonneeTraitee?.(idActu, {
            success: false,
            error: 'Aucune donnée exploitable trouvée sur cette page.',
        });
        return;
    }

    const nomLien = getNomLien(idActu).find((l) => l.id === idLien)?.nom ?? idLien;
    const resultat = await enregistrerDonneeTcfEe(idLien, nomLien, parties as PartieEE[]);

    if (!resultat.success) {
        notifierDonneeTraitee?.(idActu, {
            success: false,
            error: resultat.error ?? "Échec de l'enregistrement.",
        });
        return;
    }
    notifierDonneeTraitee?.(idActu, {
        success: true,
        nbSeries: 1,
        nbCreees: resultat.cree ? 1 : 0,
    });
}

// ---------------------------------------------------------------------------
// Gestionnaire TEF session
// ---------------------------------------------------------------------------

/**
 * Prépare les 4 dossiers série (ce/co/ee/eo) pour un lien TEF donné, et
 * retourne leurs chemins ABSOLUS pour processSerieTef.
 *
 * Les noms de dossier et leur référencement (id du lien -> dossier ->
 * nom affichable) viennent exclusivement de getCheminEnsDossierTef
 * (gestion_ref_tef.ts) — c'est le seul endroit qui décide comment un
 * dossier TEF est nommé, ce qui garantit le préfixe "tef_" partout.
 */
async function preparerDossiersTef(
    idLien: string,
    nomAffichable: string
): Promise<TefRefs> {
    creer_dossier(getBaseDir());

    const dossiers = getCheminEnsDossierTef(idLien, nomAffichable);

    const refs: TefRefs = { ce: '', co: '', ee: '', eo: '' };
    for (const type of TYPES_EPREUVE) {
        const serieDir = cheminDossierSerie(dossiers[type]);
        await fsp.mkdir(serieDir, { recursive: true });
        await fsp.mkdir(path.join(serieDir, 'img'), { recursive: true });
        await fsp.mkdir(path.join(serieDir, 'audio'), { recursive: true });
        refs[type] = serieDir;
    }

    return refs;
}

/**
 * Après processSerieTef : génère (ou régénère) les transformés pour les 4 types.
 */
async function genererTransformsTef(refs: TefRefs): Promise<void> {
    await genererTransformCeOuCo(refs.ce, 'ce');
    await genererTransformCeOuCo(refs.co, 'co');
    await genererTransformEE(refs.ee);
    await genererTransformEO(refs.eo);
}

/**
 * Gestionnaire (onDonnee) pour une session TEF.
 * `valeur` = chaîne brute renvoyée par recupDonnee_tef_session (flight data).
 */
async function traiterDonneeTefSession(
    valeur: any,
    idActu: string,
    idLien: string
): Promise<void> {
    if (valeur === null || valeur === undefined) {
        notifierDonneeTraitee?.(idActu, {
            success: false,
            error: "Le code injecté n'a retourné aucune donnée.",
        });
        return;
    }

    // La capture renvoie en général une grande chaîne (flight / RSC payload).
    const raw = typeof valeur === 'string' ? valeur : String(valeur);
    if (!raw.trim()) {
        notifierDonneeTraitee?.(idActu, {
            success: false,
            error: 'Donnée TEF vide.',
        });
        return;
    }

    const nomLien = getNomLien(idActu).find((l) => l.id === idLien)?.nom ?? idLien;

    try {
        progresser(idActu, 'preparation', 'Préparation des dossiers de la session TEF…', nomLien);

        // getCheminEnsDossierTef(idLien, nomLien) (gestion_ref_tef.ts)
        // référence/nomme les 4 dossiers ("tef_ce_<slug>_<idLien>", …).
        const refs = await preparerDossiersTef(idLien, nomLien);

        progresser(
            idActu,
            'extraction',
            'Extraction de la série et téléchargement des médias…',
            nomLien
        );

        const resultat = await processSerieTef(raw, refs, {
            onProgress: (msg, detail) => {
                progresser(idActu, 'telechargement', msg, detail);
            },
        });

        if (!resultat.success) {
            progresser(idActu, 'termine', 'Échec du traitement de la session TEF.');
            notifierDonneeTraitee?.(idActu, {
                success: false,
                error: resultat.error ?? "Échec du traitement de la série TEF.",
            });
            return;
        }

        progresser(idActu, 'transform', 'Génération des données transformées…');

        await genererTransformsTef(refs);

        progresser(idActu, 'termine', 'Session TEF enregistrée.');

        notifierDonneeTraitee?.(idActu, {
            success: true,
            nbSeries: 4,
            nbCreees: 4,
        });
    } catch (err: any) {
        // Même en cas d'échec, il faut signaler la fin de la progression
        // : sans ça, plus rien ne referme jamais l'overlay de
        // zoneExtractionDirecte.ts (voir ecouteProgressionDonnee), qui
        // resterait bloqué ouvert.
        progresser(idActu, 'termine', 'Échec du traitement de la session TEF.');
        notifierDonneeTraitee?.(idActu, {
            success: false,
            error: err?.message ?? String(err),
        });
    }
}

// data pour les fonctions de maipulation des donneer çu lors des extraction de donnée
export let dataManipDonne: DictManipDonneeStr = {
    ['tcf-ce']: traiterDonneeTcfCe,
    ['tcf-co']: traiterDonneeTcfCo,
    ['tcf-ee']: traiterDonneeTcfEe,
    ['tcf-eo']: traiterDonneeTcfEo,
    ['tef-session']: traiterDonneeTefSession,
};

// Prévient le renderer (voir zoneExtract.ts) qu'une liste de liens
// vient d'être mise à jour, pour qu'il rafraîchisse son affichage.
// Branché depuis extractionDirecte.ts (seul endroit qui a accès à la
// fenêtre pour envoyer un message au renderer).
let notifierMajLiens: ((idActu: string, liens: NomLienExtrait[]) => void) | null = null;
export function definirNotifieurMajLiens(
    fn: (idActu: string, liens: NomLienExtrait[]) => void
): void {
    notifierMajLiens = fn;
}

// Construit le gestionnaire (onDonnee) pour la récupération des liens
// d'un idActu donné : la valeur reçue du code injecté (voir
// dataCodeRecupLien plus bas) est soit `null` (le code a signalé une
// erreur), soit un tableau — éventuellement sérialisé en JSON par le
// code injecté lui-même — d'objets { url, nom }.
function creerGestionnaireLien(idActu: string): (valeur: any) => Promise<void> {
    return async (valeur: any): Promise<void> => {
        if (valeur === null || valeur === undefined) {
            console.warn(
                `extraction (${idActu}) : le code injecté a signalé une erreur (aucune donnée).`
            );
            return;
        }

        let nouveaux: unknown;
        try {
            nouveaux = typeof valeur === 'string' ? JSON.parse(valeur) : valeur;
        } catch (err) {
            console.warn(
                `extraction (${idActu}) : réponse illisible (JSON invalide).`,
                err
            );
            return;
        }
        if (!Array.isArray(nouveaux)) {
            console.warn(
                `extraction (${idActu}) : réponse inattendue (un tableau était attendu).`
            );
            return;
        }

        const fusion = rechargeLien(idActu, nouveaux as LienBrute[]);
        notifierMajLiens?.(idActu, fusion);
    };
}

// initialise codes et lien utile pour la recuperation
export const initOutil = () => {
    dataLienPincipale = {
        ['tcf-ce']:
            'https://www.formation-tcfcanada.com/epreuve/comprehension-ecrite/tableau-de-bord',
        ['tcf-co']:
            'https://www.formation-tcfcanada.com/epreuve/comprehension-orale/tableau-de-bord',
        ['tcf-ee']:
            'https://www.formation-tcfcanada.com/epreuve/expression-ecrite/sujets-actualites',
        ['tcf-eo']:
            'https://www.formation-tcfcanada.com/epreuve/expression-orale/sujets-actualites',
        ['tef-session']: 'https://objectifcanada-tcf.com/fr/examen/tef',
    };

    dataCodeRecupLien = {
        ['tcf-ce']: strCodeLienTcfCe,
        ['tcf-co']: strCodeLienTcfCo,
        ['tcf-ee']: strCodeLienTcfEe,
        ['tcf-eo']: strCodeLienTcfEo,
        ['tef-session']: strCodeLienTefSession,
    };

    dataCodeRecupDonnee = {
        ['tcf-ce']: strCodeDonneeTcfCe,
        ['tcf-co']: strCodeDonneeTcfCo,
        ['tcf-ee']: strCodeDonneeTcfEe,
        ['tcf-eo']: strCodeDonneeTcfEo,
        ['tef-session']: strCodeDonneeTefSession,
    };

    dataManipLien = {
        ['tcf-ce']: creerGestionnaireLien('tcf-ce'),
        ['tcf-co']: creerGestionnaireLien('tcf-co'),
        ['tcf-ee']: creerGestionnaireLien('tcf-ee'),
        ['tcf-eo']: creerGestionnaireLien('tcf-eo'),
        ['tef-session']: creerGestionnaireLien('tef-session'),
    };

    // On vérifie d'abord si un fichier local sauvegardé existe ET
    // contient bien les 3 dictionnaires attendus (voir
    // estDonneesOutilValides dans gardienOutilExtract.ts).
    // - Si c'est le cas, ces 3 variables sont chargées à partir de ce JSON.
    // - Sinon, on garde les valeurs par défaut définies ci-dessus, ET on
    //   les enregistre dans le fichier (le fichier n'existait pas encore,
    //   ou était incomplet/corrompu) — pour que le fichier local existe
    //   bien dès le premier lancement, avec ce qui est "déjà là" dans le code.
    const sauvegarde = chargerDonneesSauvegardees();
    if (sauvegarde) {
        dataLienPincipale = sauvegarde.dataLienPincipale;
        dataCodeRecupLien = sauvegarde.dataCodeRecupLien;
        dataCodeRecupDonnee = sauvegarde.dataCodeRecupDonnee;
    } else {
        enregistrerDonnees({
            dataLienPincipale,
            dataCodeRecupLien,
            dataCodeRecupDonnee,
        });
    }
};

// ---------------------------------------------------------------------------
// Mise à jour des codes d'extraction depuis le Gist GitHub
// ---------------------------------------------------------------------------

/**
 * Déclenchée depuis zoneParam.ts (bouton "Codes d'injection" ->
 * majCodesEcoute.ts -> IPC 'outil-extract:maj', câblé dans
 * extractionDirecte.ts). Télécharge le JSON distant, remplace les 3
 * dictionnaires en mémoire, puis enregistre la nouvelle valeur sur
 * disque pour que le prochain démarrage (initOutil) la reprenne.
 */
export async function mettreAJourCodesExtraction(): Promise<{ success: boolean; error?: string }> {
    try {
        const nouvellesDonnees = await telechargerDonneesDistantes();

        dataLienPincipale = nouvellesDonnees.dataLienPincipale;
        dataCodeRecupLien = nouvellesDonnees.dataCodeRecupLien;
        dataCodeRecupDonnee = nouvellesDonnees.dataCodeRecupDonnee;

        enregistrerDonnees(nouvellesDonnees);

        return { success: true };
    } catch (err: any) {
        console.error('mettreAJourCodesExtraction : échec.', err);
        return { success: false, error: err?.message ?? String(err) };
    }
}