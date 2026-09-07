// donnee_tcf_eo.ts
//
// Gère À LUI SEUL l'enregistrement et la récupération des données EO du
// TCF, dans le dossier "conserveur" (voir dossierConserveur, dans
// gardienRef.ts). Tout ce qui doit transporter une donnée EO déjà
// enregistrée (API IPC, affichage à l'accueil, etc.) doit passer par ce
// fichier — conserveurDonne.ts n'est pas impliqué pour l'EO du TCF.
//
// Une extraction TCF EO (clic sur le nom d'un lien dans zoneExtract,
// voir outi_exract.ts) donne un TABLEAU de "parties", chacune avec un
// texte tache2 et un texte tache3 (eux-mêmes des tableaux de
// paragraphes — voir recupDonnee_tcf_eo.ts). Contrairement à
// conserveurDonne.ts (une série = un numéro/slug), ici tout ce tableau
// est conservé dans UN SEUL dossier par lien extrait :
//   - une carte, à l'affichage, représente un seul dossier tcf_eo ;
//   - le nom du dossier est "tcf_eo_<nom du lien>_<id du lien>".
//
// Organisation disque :
//   conserveur/
//     tcf_eo_<nom_de_lien>_<id_de_lien>/
//       extrait_eo.json   -> le tableau de parties tel qu'extrait
//       trans_eo.json     -> la version modifiable (copie initiale de
//                            l'extrait, éditée ensuite depuis l'accueil)
//
// Références (gardienRef), un DictString par usage :
//   - racineChemin ("tcf_eo_chemin") : id de LIEN -> nom du dossier sur
//     disque (pour retrouver/mettre à jour le bon dossier lors d'une
//     nouvelle extraction du même lien) ;
//   - racineNom ("tcf_eo_nom") : id de lien -> nom affichable dans la
//     carte à l'accueil.

import * as path from 'path';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import { dossierConserveur, getRef, enregistreRef, creer_dossier, chargeRef } from './gardienRef.js';

// Une "partie" telle qu'extraite par recupDonnee_tcf_eo.ts.
export interface PartieEO {
    nomPartie: string;
    tache2: string[];
    tache3: string[];
}

// Une carte à afficher à l'accueil : un dossier tcf_eo = une carte.
export interface CarteTcfEo {
    id: string;
    nom: string;
    dossier: string;
}

const racineChemin = 'tcf_eo_chemin'; // id de lien -> nom de dossier
const racineNom = 'tcf_eo_nom';       // id de lien -> nom affichable

const NOM_FICHIER_EXTRAIT = 'extrait_eo.json';
const NOM_FICHIER_TRANS = 'trans_eo.json';

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
    return `tcf_eo_${slugifier(nomLien)}_${idLien}`;
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

/** Liste toutes les cartes (une par dossier tcf_eo déjà enregistré). */
/** Vrai si CE lien précis possède déjà un dossier de donnée TCF EO. */
export function possedeDonneeTcfEo(idLien: string): boolean {
    chargeRef();
    return !!getRef(racineChemin)[idLien];
}

/**
 * Supprime définitivement une carte TCF EO : le dossier sur disque
 * (extrait, transformé, images) ET sa référence. Utilisé par le bouton
 * de suppression de la carte (zoneAccueilTcfEo.ts).
 */
export async function supprimerDonneeTcfEo(
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

export function listerCartesTcfEo(): CarteTcfEo[] {
    chargeRef();
    const dataChemin = getRef(racineChemin);
    const dataNom = getRef(racineNom);

    return Object.keys(dataChemin)
        .map((id) => ({ id, nom: dataNom[id] ?? dataChemin[id], dossier: dataChemin[id] }))
        .sort((a, b) => a.nom.localeCompare(b.nom, undefined, { numeric: true, sensitivity: 'base' }));
}

/** Lit l'extrait ET le transformé d'un dossier tcf_eo (identifié par l'id du lien). */
export async function lireDonneeTcfEo(
    idLien: string
): Promise<{ success: boolean; extrait?: PartieEO[]; transforme?: PartieEO[]; ss?: string; error?: string }> {
    chargeRef();
    const dossier = getRef(racineChemin)[idLien];
    if (!dossier) return { success: false, error: 'Donnée introuvable.' };

    try {
        const cheminDossier = path.join(dossierConserveur, dossier);
        const cheminExtrait = path.join(cheminDossier, NOM_FICHIER_EXTRAIT);
        const cheminTrans = path.join(cheminDossier, NOM_FICHIER_TRANS);

        const extrait: PartieEO[] = (await existeChemin(cheminExtrait))
            ? JSON.parse(await fsp.readFile(cheminExtrait, 'utf-8'))
            : [];
        let parseTrans: any = (await existeChemin(cheminTrans))
            ? JSON.parse(await fsp.readFile(cheminTrans, 'utf-8'))
            : extrait;
        const transforme: PartieEO[] = Array.isArray(parseTrans)
            ? parseTrans
            : Array.isArray(parseTrans?.items)
                ? parseTrans.items
                : Array.isArray(extrait)
                    ? extrait
                    : [];
        const ss = !Array.isArray(parseTrans) && typeof parseTrans?.ss === 'string'
            ? parseTrans.ss.trim()
            : '';

        return { success: true, extrait, transforme, ss };
    } catch (err: any) {
        return { success: false, error: err?.message ?? String(err) };
    }
}

// ---------------------------------------------------------------------
// Écriture (extraction + édition depuis l'accueil)
// ---------------------------------------------------------------------

/**
 * Fusionne un nouvel extrait avec le transformé déjà édité (même logique
 * que TCF EE) : conserve les éditions (même nomPartie), ajoute les
 * nouvelles parties de l'extrait.
 */
function fusionnerTransformeAvecExtraitEo(
    partiesExtrait: PartieEO[],
    partiesTrans: PartieEO[]
): PartieEO[] {
    const parNom = new Map<string, PartieEO>();
    for (const p of partiesTrans) {
        const cle = (p.nomPartie ?? '').trim();
        if (cle) parNom.set(cle, p);
    }

    return partiesExtrait.map((partie, index) => {
        const cle = (partie.nomPartie ?? '').trim();
        const existante = (cle ? parNom.get(cle) : undefined) ?? partiesTrans[index];
        if (!existante) {
            return {
                nomPartie: partie.nomPartie,
                tache2: [...(partie.tache2 ?? [])],
                tache3: [...(partie.tache3 ?? [])],
            };
        }
        return {
            nomPartie: partie.nomPartie ?? existante.nomPartie,
            tache2: Array.isArray(existante.tache2) ? [...existante.tache2] : [...(partie.tache2 ?? [])],
            tache3: Array.isArray(existante.tache3) ? [...existante.tache3] : [...(partie.tache3 ?? [])],
        };
    });
}

/**
 * Enregistre une extraction EO pour un lien précis (voir
 * creerGestionnaireDonneeEO, dans outi_exract.ts) :
 *  - le lien n'avait pas encore de dossier -> il est créé, avec son
 *    extrait ET son transformé (copie initiale de l'extrait, à éditer
 *    ensuite depuis l'accueil) ;
 *  - le lien avait déjà un dossier -> l'extrait est mis à jour, et le
 *    transformé est fusionné : parties déjà éditées conservées (même
 *    nomPartie), nouvelles combinaisons de l'extrait ajoutées.
 */
export async function enregistrerDonneeTcfEo(
    idLien: string,
    nomLien: string,
    parties: PartieEO[]
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

        const cheminTrans = path.join(cheminDossier, NOM_FICHIER_TRANS);
        if (cree) {
            await fsp.writeFile(cheminTrans, JSON.stringify(parties, null, 2), 'utf-8');
        } else {
            let partiesTransExistantes: PartieEO[] = [];
            let ssExistant = '';
            if (await existeChemin(cheminTrans)) {
                try {
                    const lu = JSON.parse(await fsp.readFile(cheminTrans, 'utf-8'));
                    if (Array.isArray(lu)) {
                        partiesTransExistantes = lu;
                    } else if (lu && typeof lu === 'object') {
                        partiesTransExistantes = Array.isArray(lu.items) ? lu.items : [];
                        ssExistant = typeof lu.ss === 'string' ? lu.ss.trim() : '';
                    }
                } catch {
                    partiesTransExistantes = [];
                }
            }
            const fusion = fusionnerTransformeAvecExtraitEo(parties, partiesTransExistantes);
            const aEcrire = ssExistant ? { ss: ssExistant, items: fusion } : fusion;
            await fsp.writeFile(cheminTrans, JSON.stringify(aEcrire, null, 2), 'utf-8');
        }

        return { success: true, cree, dossier };
    } catch (err: any) {
        return { success: false, cree: false, error: err?.message ?? String(err) };
    }
}

/** Enregistre la version modifiée (transformé) d'un dossier tcf_eo déjà existant. */
export async function sauvegarderTransformeTcfEo(
    idLien: string,
    parties: PartieEO[]
): Promise<{ success: boolean; error?: string }> {
    chargeRef();
    const dossier = getRef(racineChemin)[idLien];
    if (!dossier) return { success: false, error: 'Donnée introuvable.' };

    try {
        const cheminTrans = path.join(dossierConserveur, dossier, NOM_FICHIER_TRANS);
        let ssExistant = '';
        if (await existeChemin(cheminTrans)) {
            try {
                const parse = JSON.parse(await fsp.readFile(cheminTrans, 'utf-8'));
                if (!Array.isArray(parse) && typeof parse?.ss === 'string') ssExistant = parse.ss.trim();
            } catch { /* */ }
        }
        const aEcrire = ssExistant ? { ss: ssExistant, items: parties } : parties;
        await fsp.writeFile(cheminTrans, JSON.stringify(aEcrire, null, 2), 'utf-8');
        return { success: true };
    } catch (err: any) {
        return { success: false, error: err?.message ?? String(err) };
    }
}

/** Enregistre uniquement le ss manuel dans trans_eo.json. */
export async function sauvegarderSsTcfEo(
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
        const items: PartieEO[] = Array.isArray(brut)
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

// ---------------------------------------------------------------------
// Récupération transformé + cheminDossier à partir de l'id uniquement
// ---------------------------------------------------------------------

/**
 * Renvoie le transformé (trans_eo.json, tel quel) et le cheminDossier
 * absolu, uniquement à partir de l'idLien.
 */
export async function recupererTransformeEtCheminTcfEo(
    idLien: string
): Promise<{ success: boolean; cheminDossier?: string; transforme?: PartieEO[]; error?: string }> {
    chargeRef();
    const dossier = getRef(racineChemin)[idLien];
    if (!dossier) return { success: false, error: 'Donnée introuvable.' };

    try {
        const cheminDossier = path.join(dossierConserveur, dossier);
        const cheminTrans = path.join(cheminDossier, NOM_FICHIER_TRANS);

        let brut: any = (await existeChemin(cheminTrans))
            ? JSON.parse(await fsp.readFile(cheminTrans, 'utf-8'))
            : [];
        let transforme: PartieEO[] = Array.isArray(brut)
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