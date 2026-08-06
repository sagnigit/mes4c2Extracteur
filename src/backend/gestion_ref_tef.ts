// gestion_ref_tef.ts
//
// SEULE source de vérité pour le référencement des dossiers TEF
// (ce/co/ee/eo) : quel id correspond à quel dossier sur disque et à
// quel nom affichable. conserveurDonne.ts ne maintient plus son propre
// système de référencement (compteurs/ids générés) — il délègue tout
// ça ici (voir getDossierParId / getRefType / supprimerRef, utilisés
// depuis conserveurDonne.ts).
//
// Deux façons d'alimenter ces références :
//  - getCheminEnsDossierTef(idLien, nomLien) : cas normal, un lien TEF
//    extrait -> les 4 dossiers ("tef_ce_<slug>_<idLien>", etc.), l'id
//    de référence est directement l'id du lien (stable, déjà unique) ;
//  - enregistrerDossierOrphelin(...) : filet de sécurité pour
//    conserveurDonne.synchroniserRefsDepuisDisque, quand un dossier
//    existe sur disque sans référence connue (ex. gardienReference.json
//    perdu/effacé) — l'id de référence est alors le nom du dossier
//    lui-même (déjà unique par construction).
import { getRef, enregistreRef } from './gardienRef.js';

export type TypeTef = 'ce' | 'co' | 'ee' | 'eo';

// Interface qui définit la structure des chemins TEF retournés
export interface TefRefs {
    ce: string;
    co: string;
    ee: string;
    eo: string;
}

// Clés utilisées pour stocker les chemins et noms dans les références.
// Le préfixe "tef_" est également celui utilisé dans les noms de
// dossier générés ci-dessous (getCheminEnsDossierTef) : c'est ce qui
// garantit que TOUT dossier créé pour du TEF porte bien ce préfixe.
const cheminKeys: Record<TypeTef, string> = {
    ce: 'tef_ce_chemin',
    co: 'tef_co_chemin',
    ee: 'tef_ee_chemin',
    eo: 'tef_eo_chemin',
};

const nomKeys: Record<TypeTef, string> = {
    ce: 'tef_ce_nom',
    co: 'tef_co_nom',
    ee: 'tef_ee_nom',
    eo: 'tef_eo_nom',
};

// Nom de dossier stable et lisible : accents retirés, minuscules,
// espaces/caractères spéciaux remplacés par "_" (même principe que
// donnee_tcf_ee.ts / donnee_tcf_eo.ts) — indispensable ici puisque
// nomLien vient directement du site source et peut contenir à peu
// près n'importe quoi (espaces, accents, ponctuation...).
function slugifier(nom: string): string {
    const brut = nom
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
    return brut || 'lien';
}

/**
 * Crée ou récupère les chemins (noms de dossier, PAS des chemins
 * absolus) pour les 4 types TEF (ce, co, ee, eo), pour un lien donné.
 * Toujours préfixés "tef_<type>_" : c'est le SEUL endroit où un nom de
 * dossier TEF est fabriqué.
 *
 * @param idLien - Identifiant unique du lien (sert aussi d'id de référence)
 * @param nomLien - Nom affichable du lien
 * @returns { ce, co, ee, eo } — noms de dossier, ex. "tef_ce_monlien_123"
 */
export const getCheminEnsDossierTef = (idLien: string, nomLien: string): TefRefs => {
    const result: TefRefs = { ce: '', co: '', ee: '', eo: '' };
    const slug = slugifier(nomLien);

    (['ce', 'co', 'ee', 'eo'] as const).forEach((type) => {
        const refChemin = getRef(cheminKeys[type]);
        const refNom = getRef(nomKeys[type]);

        if (!refChemin[idLien]) {
            refChemin[idLien] = `tef_${type}_${slug}_${idLien}`;
        }
        // Le nom affichable est toujours rafraîchi (le nom du lien a pu
        // changer entre deux extractions du même lien).
        refNom[idLien] = nomLien;

        result[type] = refChemin[idLien];
    });

    return result;
};

export interface TefItem {
    id: string; // l'identifiant de référence (id du lien, ou nom de dossier pour un orphelin)
    nom: string; // le nom affichable
    chemin: string; // le nom de dossier sur disque (ex: "tef_ce_monlien_123")
}

/** Récupère tous les éléments référencés pour un type donné (ce, co, ee, eo). */
export const getRefType = (type: TypeTef): TefItem[] => {
    const refChemin = getRef(cheminKeys[type]);
    const refNom = getRef(nomKeys[type]);

    return Object.keys(refChemin).map((id) => ({
        id,
        chemin: refChemin[id],
        nom: refNom[id] || refChemin[id],
    }));
};

/** Nom de dossier référencé pour un id précis ("" si inconnu). */
export const getDossierParId = (type: TypeTef, id: string): string => {
    return getRef(cheminKeys[type])[id] ?? '';
};

/**
 * Vrai si un lien possède déjà un dossier, pour au moins un des 4
 * types TEF (ce/co/ee/eo).
 *
 * getCheminEnsDossierTef (SEUL endroit qui écrit dans refChemin pour le
 * flux normal) le montre bien : `refChemin[idLien] = "tef_<type>_..."`.
 * La CLÉ de refChemin est donc exactement idLien, rien d'autre à
 * deviner ou approcher — refChemin[idLien] donne directement le nom de
 * dossier (utile pour le CHEMIN d'accès aux données de la carte), et
 * refNom[idLien] donne le nom affichable (utile pour le TITRE de la
 * carte, voir getRefType plus haut) : les deux sont indexés par ce
 * même idLien. Vérifier la présence d'un dossier pour idLien, c'est donc
 * juste vérifier que cette clé exacte existe — pas de comparaison
 * approchée (substring, suffixe...) qui risquerait de faire
 * correspondre le dossier d'un AUTRE lien ou d'un sujet intégré par zip.
 */
export const possedeDossierTefPourLien = (idLien: string): boolean => {
    return (['ce', 'co', 'ee', 'eo'] as const).some((type) =>
        Object.prototype.hasOwnProperty.call(getRef(cheminKeys[type]), idLien)
    );
};

/** Retire la référence d'un id précis (dossier laissé tel quel sur disque). */
export const supprimerRef = (type: TypeTef, id: string): void => {
    delete getRef(cheminKeys[type])[id];
    delete getRef(nomKeys[type])[id];
    enregistreRef();
};

/**
 * Filet de sécurité : référence un dossier déjà présent sur disque mais
 * sans entrée connue (ex. après perte de gardienReference.json). Le nom
 * du dossier sert lui-même d'id (il est déjà unique) — ne PAS utiliser
 * pour le flux normal d'extraction (voir getCheminEnsDossierTef).
 * N'écrase jamais une référence déjà présente pour ce dossier.
 */
export const enregistrerDossierOrphelin = (
    type: TypeTef,
    dossier: string,
    nomAffichable: string
): void => {
    const refChemin = getRef(cheminKeys[type]);
    const refNom = getRef(nomKeys[type]);
    if (Object.values(refChemin).includes(dossier)) return;
    refChemin[dossier] = dossier;
    refNom[dossier] = nomAffichable;
};