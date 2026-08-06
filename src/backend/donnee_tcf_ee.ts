// donnee_tcf_ee.ts
//
// Gère À LUI SEUL l'enregistrement et la récupération des données EE du
// TCF, dans le dossier "conserveur" (voir dossierConserveur, dans
// gardienRef.ts). Tout ce qui doit transporter une donnée EE déjà
// enregistrée (API IPC, affichage à l'accueil, etc.) doit passer par ce
// fichier — conserveurDonne.ts n'est pas impliqué pour l'EE du TCF.
// Exactement le même système que donnee_tcf_eo.ts,
// dupliqué pour l'EE.
//
// Une extraction TCF EE (clic sur le nom d'un lien dans zoneExtract,
// voir outi_exract.ts) donne un TABLEAU de "parties", chacune avec un
// texte tache2 (2 éléments : Tâche 1, Tâche 2) et un texte tache3
// (3 éléments : Thème, Document 1, Document 2) — voir
// recupDonnee_tcf_ee.ts. Contrairement à conserveurDonne.ts (une série
// = un numéro/slug), ici tout ce tableau est conservé dans UN SEUL
// dossier par lien extrait :
//   - une carte, à l'affichage, représente un seul dossier tcf_ee ;
//   - le nom du dossier est "tcf_ee_<nom du lien>_<id du lien>".
//
// Organisation disque :
//   conserveur/
//     tcf_ee_<nom_de_lien>_<id_de_lien>/
//       extrait_ee.json   -> le tableau de parties tel qu'extrait
//       trans_ee.json     -> la version modifiable (copie initiale de
//                            l'extrait, éditée ensuite depuis l'accueil)
//
// Références (gardienRef), un DictString par usage :
//   - racineChemin ("tcf_ee_chemin") : id de LIEN -> nom du dossier sur
//     disque (pour retrouver/mettre à jour le bon dossier lors d'une
//     nouvelle extraction du même lien) ;
//   - racineNom ("tcf_ee_nom") : id de lien -> nom affichable dans la
//     carte à l'accueil.

import * as path from 'path';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import { dossierConserveur, getRef, enregistreRef, creer_dossier, chargeRef } from './gardienRef.js';

// Une "partie" telle qu'extraite par recupDonnee_tcf_ee.ts.
export interface PartieEE {
    nomPartie: string;
    tache2: string[];
    tache3: string[];
}

// Une carte à afficher à l'accueil : un dossier tcf_ee = une carte.
export interface CarteTcfEe {
    id: string;
    nom: string;
    dossier: string;
}

const racineChemin = 'tcf_ee_chemin'; // id de lien -> nom de dossier
const racineNom = 'tcf_ee_nom';       // id de lien -> nom affichable

const NOM_FICHIER_EXTRAIT = 'extrait_ee.json';
const NOM_FICHIER_TRANS = 'trans_ee.json';

// Nom de dossier stable et lisible : accents retirés, minuscules,
// espaces/caractères spéciaux remplacés par "_".
function slugifier(nom: string): string {
    const brut = nom
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
    return brut || 'lien';
}

function nomDossierPourLien(nomLien: string, idLien: string): string {
    return `tcf_ee_${slugifier(nomLien)}_${idLien}`;
}

async function existeChemin(cible: string): Promise<boolean> {
    try {
        await fsp.access(cible, fs.constants.F_OK);
        return true;
    } catch {
        return false;
    }
}

// ---------------------------------------------------------------------
// Lecture (pour l'affichage à l'accueil)
// ---------------------------------------------------------------------

/** Liste toutes les cartes (une par dossier tcf_ee déjà enregistré). */
/** Vrai si CE lien précis possède déjà un dossier de donnée TCF EE. */
export function possedeDonneeTcfEe(idLien: string): boolean {
    chargeRef();
    return !!getRef(racineChemin)[idLien];
}

/**
 * Supprime définitivement une carte TCF EE : le dossier sur disque
 * (extrait, transformé) ET sa référence. Utilisé par le bouton de
 * suppression de la carte (zoneAccueilTcfEe.ts).
 */
export async function supprimerDonneeTcfEe(
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

export function listerCartesTcfEe(): CarteTcfEe[] {
    chargeRef();
    const dataChemin = getRef(racineChemin);
    const dataNom = getRef(racineNom);

    return Object.keys(dataChemin)
        .map((id) => ({ id, nom: dataNom[id] ?? dataChemin[id], dossier: dataChemin[id] }))
        .sort((a, b) => a.nom.localeCompare(b.nom, undefined, { numeric: true, sensitivity: 'base' }));
}

/** Lit l'extrait ET le transformé d'un dossier tcf_ee (identifié par l'id du lien). */
export async function lireDonneeTcfEe(
    idLien: string
): Promise<{ success: boolean; extrait?: PartieEE[]; transforme?: PartieEE[]; error?: string }> {
    chargeRef();
    const dossier = getRef(racineChemin)[idLien];
    if (!dossier) return { success: false, error: 'Donnée introuvable.' };

    try {
        const cheminDossier = path.join(dossierConserveur, dossier);
        const cheminExtrait = path.join(cheminDossier, NOM_FICHIER_EXTRAIT);
        const cheminTrans = path.join(cheminDossier, NOM_FICHIER_TRANS);

        const extrait: PartieEE[] = (await existeChemin(cheminExtrait))
            ? JSON.parse(await fsp.readFile(cheminExtrait, 'utf-8'))
            : [];
        const transforme: PartieEE[] = (await existeChemin(cheminTrans))
            ? JSON.parse(await fsp.readFile(cheminTrans, 'utf-8'))
            : extrait;

        return { success: true, extrait, transforme };
    } catch (err: any) {
        return { success: false, error: err?.message ?? String(err) };
    }
}

// ---------------------------------------------------------------------
// Écriture (extraction + édition depuis l'accueil)
// ---------------------------------------------------------------------

/**
 * Enregistre une extraction EE pour un lien précis (voir
 * traiterDonneeTcfEe, dans outi_exract.ts) :
 *  - le lien n'avait pas encore de dossier -> il est créé, avec son
 *    extrait ET son transformé (copie initiale de l'extrait, à éditer
 *    ensuite depuis l'accueil) ;
 *  - le lien avait déjà un dossier -> seul l'extrait est mis à
 *    jour ; le transformé existant (avec d'éventuelles modifications
 *    déjà faites par l'utilisateur) n'est JAMAIS écrasé.
 */
export async function enregistrerDonneeTcfEe(
    idLien: string,
    nomLien: string,
    parties: PartieEE[]
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

        const cheminDossier = path.join(dossierConserveur, dossier);
        creer_dossier(cheminDossier);

        await fsp.writeFile(
            path.join(cheminDossier, NOM_FICHIER_EXTRAIT),
            JSON.stringify(parties, null, 2),
            'utf-8'
        );

        if (cree) {
            await fsp.writeFile(
                path.join(cheminDossier, NOM_FICHIER_TRANS),
                JSON.stringify(parties, null, 2),
                'utf-8'
            );
        }

        return { success: true, cree, dossier };
    } catch (err: any) {
        return { success: false, cree: false, error: err?.message ?? String(err) };
    }
}

/** Enregistre la version modifiée (transformé) d'un dossier tcf_ee déjà existant. */
export async function sauvegarderTransformeTcfEe(
    idLien: string,
    parties: PartieEE[]
): Promise<{ success: boolean; error?: string }> {
    chargeRef();
    const dossier = getRef(racineChemin)[idLien];
    if (!dossier) return { success: false, error: 'Donnée introuvable.' };

    try {
        await fsp.writeFile(
            path.join(dossierConserveur, dossier, NOM_FICHIER_TRANS),
            JSON.stringify(parties, null, 2),
            'utf-8'
        );
        return { success: true };
    } catch (err: any) {
        return { success: false, error: err?.message ?? String(err) };
    }
}

// ---------------------------------------------------------------------
// Récupération transformé + cheminDossier à partir de l'id uniquement
// ---------------------------------------------------------------------

/**
 * Renvoie le transformé (trans_ee.json, tel quel) et le cheminDossier
 * absolu, uniquement à partir de l'idLien.
 */
export async function recupererTransformeEtCheminTcfEe(
    idLien: string
): Promise<{ success: boolean; cheminDossier?: string; transforme?: PartieEE[]; error?: string }> {
    chargeRef();
    const dossier = getRef(racineChemin)[idLien];
    if (!dossier) return { success: false, error: 'Donnée introuvable.' };

    try {
        const cheminDossier = path.join(dossierConserveur, dossier);
        const cheminTrans = path.join(cheminDossier, NOM_FICHIER_TRANS);

        const transforme: PartieEE[] = (await existeChemin(cheminTrans))
            ? JSON.parse(await fsp.readFile(cheminTrans, 'utf-8'))
            : [];

        return { success: true, cheminDossier, transforme };
    } catch (err: any) {
        return { success: false, error: err?.message ?? String(err) };
    }
}