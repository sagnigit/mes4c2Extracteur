// verificationExport.ts
//
// Point central de VÉRIFICATION de l'exportabilité d'une question déjà
// transformée. UNE fonction par zone d'export (les 8 zones de
// ZoneExport, voir varUni.ts : 'tcf-ce', 'tcf-co', 'tcf-ee', 'tcf-eo',
// 'tef-ce', 'tef-co', 'tef-ee', 'tef-eo'), chacune reçoit :
//   - item  : l'élément EXTRAIT correspondant à cette question/sujet
//             (utile pour savoir quelles zones sont réellement
//             affichées, certaines n'existant que si l'extrait en a
//             une — ex : le support image en EE/EO) ;
//   - zones : les données TRANSFORMÉES de cette question, telles que
//             maintenues côté écran (état des zones éditables :
//             texte, image, audio, liste de propositions, nombre...).
//
// et retourne true si cette question est prête à être exportée, false
// sinon.
//
// Utilisée depuis TOUS les endroits qui construisent une zone
// d'affichage avec bouton d'export + boutons numérotés :
//   - zoneAff.ts           (TEF · CE/CO/EE/EO + TCF · CO, construction
//                           commune — voir construireZoneOuvertureCommune) ;
//   - zoneAccueilTcfCe.ts  (TCF · CE) ;
//   - zoneAccueilTcfEe.ts  (TCF · EE) ;
//   - zoneAccueilTcfEo.ts  (TCF · EO).
//
// Chacun de ces fichiers appelle estQuestionExportable(zone, item,
// zones) à l'ouverture d'une série/carte ainsi qu'à CHAQUE
// modification d'une zone transformée, pour mettre à jour :
//   - le style distinctif du bouton numéroté de la question concernée ;
//   - le message d'entête (à côté du bouton d'export) indiquant
//     combien de questions restent à corriger avant que l'exportation
//     soit possible — rien ne s'affiche dès que tout est prêt.
//
// Règles d'exportabilité (une question/partie est exportable si et
// seulement si TOUT ce qui est listé ci-dessous est rempli) :
//   - tcf-ce : image de l'énoncé (composée), points, question et
//              propositions non vides ;
//   - tcf-co : audio, points et propositions non vides (la question
//              n'est PAS exigée) ;
//   - tcf-ee, tcf-eo : tous les blocs de transformé (Tâche 1/2,
//              Tâche 3 · Thème/Document 1/Document 2) non vides ;
//   - tef-ce : support (image), question et propositions non vides ;
//   - tef-co : audio, question et propositions non vides (les points
//              ne sont PAS exigés) ;
//   - tef-ee : tous les blocs de transformé présents (sujet, et
//              support image/audio si l'extrait en propose) non vides ;
//   - tef-eo : idem tef-ee, en incluant systématiquement la
//              description de l'image (sujet, support image,
//              description, support audio si présent).
//
// Deux familles de données transformées, selon d'où vient l'appel :
//   - zoneAff.ts (tef-ce/co/ee/eo + tcf-co) : `zones` est une
//     Map<string, EtatZone> (une entrée par zone : 'support', 'image',
//     'audio', 'points', 'question', 'propositions', 'sujet',
//     'support_image', 'description', 'support_audio' selon le type -
//     voir zonesCE/zonesCO/zonesEeEo dans zoneAff.ts) ;
//   - zoneAccueilTcfCe/Ee/Eo.ts (tcf-ce/ee/eo) : `zones` est
//     directement l'objet transformé de la question/partie (QuestionCE
//     / PartieEE / PartieEO), PAS une Map.
// Les types précis de zoneAff.ts (EtatZone, ...) ne sont volontairement
// pas importés ici (import circulaire : zoneAff.ts importe déjà
// estQuestionExportable depuis ce fichier) — on retrouve donc les
// mêmes formes par duck-typing, via les petits utilitaires ci-dessous.

import type { ZoneExport } from '../../varUni.js';
import type { QuestionCE } from './donneeTcfCeApi.js';
import type { PartieEE } from './donneeTcfEeApi.js';
import type { PartieEO } from './donneeTcfEoApi.js';

// ---------------------------------------------------------------------
// Utilitaires génériques
// ---------------------------------------------------------------------

/** Vrai si la valeur est absente / vide (chaîne blanche comprise). */
const estVide = (valeur: any): boolean => {
    return valeur === undefined || valeur === null || (typeof valeur === 'string' && valeur.trim() === '');
};

/** Vrai si `valeur` est une chaîne non vide (une fois les espaces retirés). */
const estTexteNonVide = (valeur: any): boolean => typeof valeur === 'string' && valeur.trim() !== '';

// --- Lecture d'une zone transformée telle que produite par
// zoneAff.ts (Map<string, EtatZone>) : on ne réimporte pas le type
// EtatZone (import circulaire), on relit juste sa forme au cas par cas.

/** Récupère l'entrée `id` d'une Map de zones transformées (zoneAff.ts), ou undefined si absente/pas une Map. */
const obtenirZoneTransformee = (zones: any, id: string): any => {
    if (!(zones instanceof Map)) return undefined;
    return zones.get(id);
};

/** Zone de nature 'image' (voir EtatZoneImage) : présente si `url` est une chaîne non vide. */
const zoneImageRemplie = (zones: any, id: string): boolean => {
    const zone = obtenirZoneTransformee(zones, id);
    return !!zone && zone.nature === 'image' && estTexteNonVide(zone.url);
};

/** Zone de nature 'audio' (voir EtatZoneAudio) : présente si `url` est une chaîne non vide. */
const zoneAudioRemplie = (zones: any, id: string): boolean => {
    const zone = obtenirZoneTransformee(zones, id);
    return !!zone && zone.nature === 'audio' && estTexteNonVide(zone.url);
};

/** Zone de nature 'texte' (voir EtatZoneTexte) : présente si `valeur` est une chaîne non vide. */
const zoneTexteRemplie = (zones: any, id: string): boolean => {
    const zone = obtenirZoneTransformee(zones, id);
    return !!zone && zone.nature === 'texte' && estTexteNonVide(zone.valeur);
};

/** Zone de nature 'nombre' (voir EtatZoneNombre) : présente si `valeur` est un nombre strictement positif. */
const zoneNombreRemplie = (zones: any, id: string): boolean => {
    const zone = obtenirZoneTransformee(zones, id);
    return !!zone && zone.nature === 'nombre' && typeof zone.valeur === 'number' && Number.isFinite(zone.valeur) && zone.valeur > 0;
};

/** Zone de nature 'liste' (voir EtatZoneListe) : présente si au moins une proposition, toutes de texte non vide. */
const zoneListeRemplie = (zones: any, id: string): boolean => {
    const zone = obtenirZoneTransformee(zones, id);
    return !!zone && zone.nature === 'liste' && Array.isArray(zone.items) && zone.items.length > 0
        && zone.items.every((it: any) => estTexteNonVide(it?.texte));
};

// --- Cas commun EE / EO (via zoneAff.ts, donc pour tef-ee / tef-eo) :
// le sujet est toujours exigé ; le support image/audio n'est exigé que
// si l'extrait en propose un (voir zonesEeEo dans zoneAff.ts) ; la
// description n'existe (et n'est exigée) que pour EO.
const estExportableEeEoCommun = (item: any, zones: any, type: 'ee' | 'eo'): boolean => {
    if (!(zones instanceof Map)) return false;

    if (!zoneTexteRemplie(zones, 'sujet')) return false;

    if (!estVide(item?._localImagePath) && !zoneImageRemplie(zones, 'support_image')) return false;

    if (type === 'eo' && !zoneTexteRemplie(zones, 'description')) return false;

    if (!estVide(item?._localAudioPath) && !zoneAudioRemplie(zones, 'support_audio')) return false;

    return true;
};

// --- Cas commun TCF EE / EO (donneeTcfEeApi.ts / donneeTcfEoApi.ts) :
// `zones` est directement l'objet PartieEE/PartieEO transformé — tous
// les blocs tache2 (Tâche 1/2) et tache3 (Tâche 3 · Thème/Document
// 1/Document 2) doivent être remplis, dans le même nombre que
// l'extrait.
const estExportablePartieTcf = (item: PartieEE | PartieEO, zones: any): boolean => {
    if (!zones) return false;

    const tache2Extrait = Array.isArray(item?.tache2) ? item.tache2 : [];
    const tache3Extrait = Array.isArray(item?.tache3) ? item.tache3 : [];
    const tache2Trans = Array.isArray(zones.tache2) ? zones.tache2 : [];
    const tache3Trans = Array.isArray(zones.tache3) ? zones.tache3 : [];

    if (tache2Trans.length !== tache2Extrait.length) return false;
    if (tache3Trans.length !== tache3Extrait.length) return false;

    return tache2Trans.every(estTexteNonVide) && tache3Trans.every(estTexteNonVide);
};

// ---------------------------------------------------------------------
// Une fonction par zone d'export
// ---------------------------------------------------------------------

/**
 * TEF · Compréhension Écrite.
 * Exportable si le support (image), la question et les propositions
 * de réponse sont tous non vides.
 */
export const estExportableTefCe = (item: any, zones: any): boolean => {
    return zoneImageRemplie(zones, 'support')
        && zoneTexteRemplie(zones, 'question')
        && zoneListeRemplie(zones, 'propositions');
};

/**
 * TEF · Compréhension Orale.
 * Exportable si l'audio, la question et les propositions de réponse
 * sont tous non vides (les points ne sont pas exigés).
 */
export const estExportableTefCo = (item: any, zones: any): boolean => {
    return zoneAudioRemplie(zones, 'audio')
        && zoneTexteRemplie(zones, 'question')
        && zoneListeRemplie(zones, 'propositions');
};

/**
 * TEF · Expression Écrite.
 * Exportable si tous les blocs de transformé (sujet, et support
 * image/audio quand l'extrait en propose un) sont non vides.
 */
export const estExportableTefEe = (item: any, zones: any): boolean => {
    return estExportableEeEoCommun(item, zones, 'ee');
};

/**
 * TEF · Expression Orale.
 * Exportable si tous les blocs de transformé sont non vides : sujet,
 * support image (si présent dans l'extrait), description de l'image,
 * et support audio (si présent dans l'extrait).
 */
export const estExportableTefEo = (item: any, zones: any): boolean => {
    return estExportableEeEoCommun(item, zones, 'eo');
};

/**
 * TCF · Compréhension Écrite.
 * Exportable si l'image de l'énoncé (composée), les points, la
 * question et les propositions de réponse sont tous non vides.
 */
export const estExportableTcfCe = (item: any, zones: any): boolean => {
    const question = zones as Partial<QuestionCE> | undefined;
    if (!question) return false;

    const imageEnonceComposee = estTexteNonVide(question._localEnonceImage);
    const pointsValides = typeof question.points === 'number' && Number.isFinite(question.points) && question.points > 0;
    const questionRemplie = estTexteNonVide(question.question);
    const propositions = Array.isArray(question.options) ? question.options : [];
    const propositionsRemplies = propositions.length > 0 && propositions.every(estTexteNonVide);

    return imageEnonceComposee && pointsValides && questionRemplie && propositionsRemplies;
};

/**
 * TCF · Compréhension Orale.
 * Exportable si l'audio, les points et les propositions de réponse
 * sont tous non vides (la question n'est pas exigée).
 */
export const estExportableTcfCo = (item: any, zones: any): boolean => {
    return zoneAudioRemplie(zones, 'audio')
        && zoneNombreRemplie(zones, 'points')
        && zoneListeRemplie(zones, 'propositions');
};

/**
 * TCF · Expression Écrite.
 * Exportable si tous les blocs de transformé (Tâche 1, Tâche 2,
 * Tâche 3 · Thème/Document 1/Document 2) sont non vides.
 */
export const estExportableTcfEe = (item: any, zones: any): boolean => {
    return estExportablePartieTcf(item as PartieEE, zones);
};

/**
 * TCF · Expression Orale.
 * Exportable si tous les blocs de transformé (Tâche 1, Tâche 2,
 * Tâche 3 · Thème/Document 1/Document 2) sont non vides.
 */
export const estExportableTcfEo = (item: any, zones: any): boolean => {
    return estExportablePartieTcf(item as PartieEO, zones);
};

/**
 * Point d'entrée UNIQUE utilisé par toutes les zones d'affichage :
 * redirige vers la fonction de vérification correspondant à la zone
 * d'export concernée (même valeur que celle passée à
 * creerBoutonExportZone, voir boutonExportZone.ts).
 */
export const estQuestionExportable = (
    zone: ZoneExport,
    item: any,
    zones: any
): boolean => {
    switch (zone) {
        case 'tef-ce': return estExportableTefCe(item, zones);
        case 'tef-co': return estExportableTefCo(item, zones);
        case 'tef-ee': return estExportableTefEe(item, zones);
        case 'tef-eo': return estExportableTefEo(item, zones);
        case 'tcf-ce': return estExportableTcfCe(item, zones);
        case 'tcf-co': return estExportableTcfCo(item, zones);
        case 'tcf-ee': return estExportableTcfEe(item, zones);
        case 'tcf-eo': return estExportableTcfEo(item, zones);
    }
};

// ---------------------------------------------------------------------
// Exportabilité d'une SÉRIE ENTIÈRE (agrégation de toutes ses questions
// / parties), à partir des données BRUTES telles que lues depuis le
// disque (extrait + transformé) — AVANT toute ouverture dans la zone
// d'affichage. Utilisée par les listes de cartes (zoneAccueilTef.ts,
// zoneAccueilTcfCe/Ee/Eo.ts) pour savoir quelles cartes afficher comme
// "exportables" (badge dans la sélection groupée, voir corpsPage.ts) :
// une série n'est exportable QUE SI TOUTES ses questions/parties le
// sont, exactement comme le bouton d'export de la zone d'affichage
// (voir rafraichirIndicateursExport dans zoneAff.ts) — mêmes règles
// (estExportableXxx ci-dessus), donc toujours cohérent avec ce qui y
// est affiché.
// ---------------------------------------------------------------------

/** Petit constructeur d'entrée "image"/"audio"/"texte"/"nombre"/"liste", même forme que EtatZone (zoneAff.ts), volontairement dupliquée ici (duck-typing, pas de type importé). */
const zoneImage = (url: any) => ({ nature: 'image', url: typeof url === 'string' && url.trim() !== '' ? url : null });
const zoneAudio = (url: any) => ({ nature: 'audio', url: typeof url === 'string' && url.trim() !== '' ? url : null });
const zoneTexte = (valeur: any) => ({ nature: 'texte', valeur: typeof valeur === 'string' ? valeur : '' });
const zoneNombre = (valeur: any) => ({ nature: 'nombre', valeur: Number(valeur ?? 0) });
const zoneListe = (propositions: any, bonneReponse: any) => ({
    nature: 'liste',
    items: (['A', 'B', 'C', 'D'] as const)
        .filter((lettre) => propositions?.[lettre] !== undefined)
        .map((lettre) => ({ texte: propositions[lettre] ?? '', correcte: bonneReponse === lettre })),
});

// Même règle que extraireLettreSection (zoneAff.ts) : déduit "A" ou "B"
// à partir d'un champ "section" du type "section A". Dupliquée ici
// (fonction pure de 3 lignes) pour éviter un import circulaire avec
// zoneAff.ts, qui importe déjà ce fichier.
const extraireLettreSection = (section: any): 'A' | 'B' | '' => {
    if (typeof section !== 'string') return '';
    const correspondance = section.trim().match(/([ab])\s*$/i);
    return correspondance ? (correspondance[1].toUpperCase() as 'A' | 'B') : '';
};

/**
 * TEF · CE/CO/EE/EO + TCF · CO (les 5 zones qui passent par "conserveur",
 * donc par la même forme de transformé brut que zoneAff.ts) : vrai si
 * la série a au moins un élément et que TOUS ses éléments sont
 * exportables.
 * `donnees` : éléments EXTRAITS de la série (ElementDonnee[]).
 * `transforme` : transformé BRUT tel que lu depuis le disque — un
 * tableau (avec un champ `index`) pour ce/co, un objet `{A, B}` pour
 * ee/eo (mêmes formes que celles lues par initialiserEtatDepuisTransforme
 * dans zoneAff.ts).
 */
export const estSerieTefExportable = (
    examen: 'tef' | 'tcf',
    type: 'ce' | 'co' | 'ee' | 'eo',
    donnees: any[],
    transforme: any
): boolean => {
    if (!Array.isArray(donnees) || donnees.length === 0) return false;
    if (!transforme) return false;

    const zoneExport = `${examen}-${type}` as ZoneExport;

    if (type === 'ce' || type === 'co') {
        const parIndex = new Map<number, any>();
        if (Array.isArray(transforme)) {
            for (const itemTrans of transforme) {
                if (typeof itemTrans?.index === 'number') parIndex.set(itemTrans.index, itemTrans);
            }
        }
        return donnees.every((_item, index) => {
            const itemTrans = parIndex.get(index);
            const zones = new Map<string, any>([
                ['support', zoneImage(itemTrans?._localImage)],
                ['image', zoneImage(itemTrans?._localImage)],
                ['audio', zoneAudio(itemTrans?._localAudio)],
                ['question', zoneTexte(itemTrans?.consigne)],
                ['points', zoneNombre(itemTrans?.points)],
                ['propositions', zoneListe(itemTrans?.propositions, itemTrans?.bonneReponse)],
            ]);
            return estQuestionExportable(zoneExport, null, zones);
        });
    }

    // ee / eo : transformé indexé par lettre de section (A/B).
    return donnees.every((itemExtrait) => {
        const lettre = extraireLettreSection(itemExtrait?.section);
        const donneesLettre = lettre ? (transforme as any)[lettre] : undefined;
        const zones = new Map<string, any>([
            ['sujet', zoneTexte(donneesLettre?.consigne)],
            ['support_image', zoneImage(donneesLettre?._localImage)],
            ['support_audio', zoneAudio(donneesLettre?._localAudio)],
            ...(type === 'eo' ? [['description', zoneTexte(donneesLettre?.description)] as [string, any]] : []),
        ]);
        return estQuestionExportable(zoneExport, itemExtrait, zones);
    });
};

/**
 * TCF · CE : vrai si le dossier a au moins une question et que TOUTES
 * ses questions transformées sont exportables. `questions` : le
 * transformé TEL QUEL (QuestionCE[]), extrait et transformé étant
 * fusionnés dans le même objet côté TCF CE (voir donneeTcfCeApi.ts).
 */
export const estSerieTcfCeExportable = (questions: QuestionCE[] | null | undefined): boolean => {
    if (!Array.isArray(questions) || questions.length === 0) return false;
    return questions.every((question) => estExportableTcfCe(null, question));
};

/**
 * TCF · EE / EO : vrai si le dossier a au moins une partie, que le
 * transformé a bien une entrée pour chacune (même longueur, même
 * ordre que l'extrait) et que TOUTES sont exportables.
 */
export const estSerieTcfEeExportable = (extrait: PartieEE[], transforme: PartieEE[] | null | undefined): boolean => {
    if (!Array.isArray(extrait) || extrait.length === 0) return false;
    if (!Array.isArray(transforme) || transforme.length !== extrait.length) return false;
    return extrait.every((partieExtrait, index) => estExportableTcfEe(partieExtrait, transforme[index]));
};

export const estSerieTcfEoExportable = (extrait: PartieEO[], transforme: PartieEO[] | null | undefined): boolean => {
    if (!Array.isArray(extrait) || extrait.length === 0) return false;
    if (!Array.isArray(transforme) || transforme.length !== extrait.length) return false;
    return extrait.every((partieExtrait, index) => estExportableTcfEo(partieExtrait, transforme[index]));
};

// ---------------------------------------------------------------------
// Nombre de questions/parties À ARRANGER (pas encore exportables) d'une
// série, à partir des mêmes données BRUTES et avec exactement les mêmes
// règles que les fonctions estSerieXxxExportable ci-dessus (une série
// est donc exportable si et seulement si son compte ici vaut 0). Utilisé
// par les cartes de la sélection groupée (voir corpsPage.ts) pour
// afficher, sur chaque carte pas encore exportable, combien de
// questions il reste à corriger avant que le sujet soit exportable.
// ---------------------------------------------------------------------

/**
 * TEF · CE/CO/EE/EO + TCF · CO : nombre d'éléments de `donnees` dont la
 * question/partie correspondante n'est pas encore exportable. Mêmes
 * règles et mêmes formes de données que estSerieTefExportable.
 */
export const compterAArrangerTef = (
    examen: 'tef' | 'tcf',
    type: 'ce' | 'co' | 'ee' | 'eo',
    donnees: any[],
    transforme: any
): number => {
    if (!Array.isArray(donnees) || donnees.length === 0) return 0;

    const zoneExport = `${examen}-${type}` as ZoneExport;

    if (type === 'ce' || type === 'co') {
        const parIndex = new Map<number, any>();
        if (Array.isArray(transforme)) {
            for (const itemTrans of transforme) {
                if (typeof itemTrans?.index === 'number') parIndex.set(itemTrans.index, itemTrans);
            }
        }
        return donnees.reduce((compte: number, _item, index) => {
            const itemTrans = parIndex.get(index);
            const zones = new Map<string, any>([
                ['support', zoneImage(itemTrans?._localImage)],
                ['image', zoneImage(itemTrans?._localImage)],
                ['audio', zoneAudio(itemTrans?._localAudio)],
                ['question', zoneTexte(itemTrans?.consigne)],
                ['points', zoneNombre(itemTrans?.points)],
                ['propositions', zoneListe(itemTrans?.propositions, itemTrans?.bonneReponse)],
            ]);
            return estQuestionExportable(zoneExport, null, zones) ? compte : compte + 1;
        }, 0);
    }

    // ee / eo : transformé indexé par lettre de section (A/B).
    return donnees.reduce((compte: number, itemExtrait) => {
        const lettre = extraireLettreSection(itemExtrait?.section);
        const donneesLettre = lettre ? (transforme as any)?.[lettre] : undefined;
        const zones = new Map<string, any>([
            ['sujet', zoneTexte(donneesLettre?.consigne)],
            ['support_image', zoneImage(donneesLettre?._localImage)],
            ['support_audio', zoneAudio(donneesLettre?._localAudio)],
            ...(type === 'eo' ? [['description', zoneTexte(donneesLettre?.description)] as [string, any]] : []),
        ]);
        return estQuestionExportable(zoneExport, itemExtrait, zones) ? compte : compte + 1;
    }, 0);
};

/** TCF · CE : nombre de questions pas encore exportables. */
export const compterAArrangerTcfCe = (questions: QuestionCE[] | null | undefined): number => {
    if (!Array.isArray(questions)) return 0;
    return questions.reduce((compte, question) => (estExportableTcfCe(null, question) ? compte : compte + 1), 0);
};

/**
 * TCF · EE / EO : nombre de parties pas encore exportables. Si le
 * transformé n'a pas (encore) la même longueur que l'extrait, chaque
 * partie de l'extrait est comptée comme à arranger.
 */
export const compterAArrangerTcfEe = (extrait: PartieEE[], transforme: PartieEE[] | null | undefined): number => {
    if (!Array.isArray(extrait) || extrait.length === 0) return 0;
    if (!Array.isArray(transforme) || transforme.length !== extrait.length) return extrait.length;
    return extrait.reduce(
        (compte, partieExtrait, index) => (estExportableTcfEe(partieExtrait, transforme[index]) ? compte : compte + 1),
        0
    );
};

export const compterAArrangerTcfEo = (extrait: PartieEO[], transforme: PartieEO[] | null | undefined): number => {
    if (!Array.isArray(extrait) || extrait.length === 0) return 0;
    if (!Array.isArray(transforme) || transforme.length !== extrait.length) return extrait.length;
    return extrait.reduce(
        (compte, partieExtrait, index) => (estExportableTcfEo(partieExtrait, transforme[index]) ? compte : compte + 1),
        0
    );
};