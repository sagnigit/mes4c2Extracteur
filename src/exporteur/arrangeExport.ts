// arrangeExport.ts
//
// Met en forme les données TRANSFORMÉES d'UN SEUL élément (une carte ou
// une série, selon le type) au format attendu par le site distant, EN
// REPRENANT EXACTEMENT le contrat de l'ancien export (mêmes champs de
// formulaire, mêmes en-têtes, même façon de calculer les points) — voir
// les fichiers historiques fournis en référence :
//   - ancien export TCF (session.fetch, arrangerCE/CO/EE/EO)
//   - ancien export TEF/générique (FormData npm + node-fetch,
//     exportComp/exportExpr)
//
// Différence avec l'ancien système : ici on exporte TOUJOURS un seul
// élément à la fois (un clic = une carte). Ce qui change donc, ce n'est
// plus le nombre d'éléments à exporter, mais le nombre de REQUÊTES que
// cet élément unique nécessite :
//   - CE / CO (TEF comme TCF) : une question = une requête -> plusieurs
//     paquets, envoyés PROGRESSIVEMENT (voir export_progressif.ts) ;
//   - EE / EO : toutes les données de l'élément tiennent dans une seule
//     requête -> un seul paquet, envoyé de façon UNIQUE
//     (voir export_unique.ts).
//
// Chaque fonction arrangerXxx() ci-dessous reçoit les données déjà
// transformées (trans_xx.json, tel que lu par recupererTransformeEtChemin*
// dans conserveurDonne.ts / donnee_tcf_*.ts) + le dossier absolu de
// l'élément (pour aller lire les médias référencés) + le "ss"/"tt"
// (nom de série / numéro de test, voir decouperSerieEtTest plus bas) et
// retourne un ResultatArrangement prêt à être envoyé.

import * as path from 'path';
import * as fsp from 'fs/promises';

export type TypeEpreuve = 'ce' | 'co' | 'ee' | 'eo';
export type Examen = 'tcf' | 'tef';

// En-tête commun à toutes les requêtes d'export (identique à l'ancien
// code : headersExpr / headersComp partagent ce même en-tête).
export const HEADER_API_DPLUS: Record<string, string> = { 'Dplus-fetch-api': 'Request_Fetch_Dplus' };

// Indice de type utilisé par le site distant dans le tableau "sagni"
// envoyé pour l'EE/l'EO (identique à l'ancien exportExpr, qui poussait
// tabEcrit[0] dans chaque ligne — ici on utilise l'indice fixe du type).
const INDICE_TYPE_EPREUVE: Record<TypeEpreuve, number> = { ce: 0, co: 1, ee: 2, eo: 3 };

// Un paquet = un corps de requête prêt à être envoyé (fetch).
//  - corps        : version "lisible" (objet/tableau JS), pour l'affichage
//                    uniquement (gestionMessage côté renderer) — jamais
//                    envoyée telle quelle.
//  - corpsRequete : ce qui est réellement passé en body à fetch.
//  - entetes      : en-têtes spécifiques à ce paquet (Content-Type
//                    notamment), déjà fusionnés avec HEADER_API_DPLUS. Pour
//                    un FormData, PAS de Content-Type ici : fetch le
//                    calcule lui-même (boundary multipart).
//  - progression  : uniquement pour CE/CO — place de la question dans
//                    l'élément en cours d'export.
export interface PaquetEnvoi {
    corps: any;
    corpsRequete: BodyInit;
    entetes: Record<string, string>;
}

export interface ResultatArrangement {
    paquets: PaquetEnvoi[];
    mode: 'unique' | 'progressif';
    /** Si renseigné, les données sont invalides/incomplètes : rien à envoyer. */
    erreur?: string;
}

// ---------------------------------------------------------------------
// ss / tt (nom de série / numéro de test / libellé de session)
// ---------------------------------------------------------------------
//
// Utilisé UNIQUEMENT en repli lorsque aucun ss manuel n'a été saisi
// dans la zone d'affichage (champ "Nom du sujet (ss)", stocké dans le
// JSON transformé). Si un ss manuel est présent, gestion_export.ts
// l'utilise tel quel et force tt = "".
//
// Comportement auto selon la zone :
//
//   • TCF · EE / EO
//       → on renvoie le NOM AFFICHABLE de la carte TEL QUEL
//         (ex. "Août 2026"). C'est ce libellé qui part en dernière
//         position de chaque ligne sagni : mois + année, pas seulement
//         l'année, et sans préfixe "Série ".
//
//   • Tout le reste (TCF · CE/CO, TEF · CE/CO/EE/EO)
//       → on extrait les deux premiers nombres du nom affichable
//         (convention héritée de l'ancien "{numSerie}_{numTest}") :
//           "135_65"     → ss = "Série 135", tt = "65"
//           "Août 2026"  → ss = "Série 2026", tt = ""
//         Si aucun chiffre n'est trouvé, ss = nom affichable brut.
//
export function decouperSerieEtTest(
    nomAffichable: string,
    examen?: Examen,
    type?: TypeEpreuve
): { ss: string; tt: string } {
    const nom = (nomAffichable ?? '').trim();

    // TCF expression écrite / orale : libellé complet de la carte
    // (mois + année), sans transformation.
    if (examen === 'tcf' && (type === 'ee' || type === 'eo')) {
        return { ss: nom, tt: '' };
    }

    // CE / CO (TCF + TEF) et TEF EE/EO : découpage numérique historique.
    const nombres = nom.match(/\d+/g) ?? [];
    const numSerie = nombres[0] ?? '';
    const numTest = nombres[1] ?? '';
    return {
        ss: numSerie ? `Série ${numSerie}` : nom,
        tt: numTest,
    };
}

// ---------------------------------------------------------------------
// Grille de points (identique à l'ancien exportSite.ts) : le nombre de
// points d'une question dépend de sa POSITION dans la compréhension,
// pas d'une éventuelle valeur "points" présente dans les données.
// ---------------------------------------------------------------------

const GRILLE_POINTS: { min: number; max: number; points: number }[] = [
    { min: 1, max: 4, points: 3 },
    { min: 5, max: 11, points: 9 },
    { min: 12, max: 20, points: 14 },
    { min: 21, max: 30, points: 21 },
    { min: 31, max: 36, points: 26 },
    { min: 37, max: 40, points: 33 },
];

function pointsPourQuestion(numeroQuestion: number): number {
    const tranche = GRILLE_POINTS.find((t) => numeroQuestion >= t.min && numeroQuestion <= t.max);
    return tranche ? tranche.points : 0;
}

// ---------------------------------------------------------------------
// Médias
// ---------------------------------------------------------------------

async function existeChemin(cible: string): Promise<boolean> {
    try {
        await fsp.access(cible);
        return true;
    } catch {
        return false;
    }
}

async function lireMediaBase64(
    cheminDossier: string,
    cheminRelatif: string | undefined
): Promise<{ donneeBase64: string; extension: string } | null> {
    if (!cheminRelatif || cheminRelatif.trim() === '') return null;
    const cheminAbsolu = path.join(cheminDossier, cheminRelatif.replace(/\\/g, '/'));
    if (!(await existeChemin(cheminAbsolu))) return null;
    try {
        const buffer = await fsp.readFile(cheminAbsolu);
        const extension = path.extname(cheminAbsolu).replace('.', '') || 'bin';
        return { donneeBase64: buffer.toString('base64'), extension };
    } catch {
        return null;
    }
}

// ---------------------------------------------------------------------
// CE / CO — format commun TEF (ce, co) ET TCF · CO :
//   { index, image, audio?, consigne, propositions:{A,B,C,D}, bonneReponse, points? }
// Une question = une requête multipart/form-data (comme l'ancien
// exportComp/completeCompEcrt/completeCompOrale).
// ---------------------------------------------------------------------

export interface ItemComprehension {
    index?: number;
    image?: string;
    audio?: string;
    consigne?: string;
    propositions?: Record<string, string>;
    bonneReponse?: string;
    /** Présent surtout pour TCF · CO (points issus de l'extrait / transformé). */
    points?: number;
}

export interface OptionsArrangementComprehension {
    /**
     * true  → utiliser item.points du transformé (TCF · CO).
     * false → grille de points selon la position (TEF · CE / TEF · CO).
     * Défaut : false.
     */
    pointsDepuisDonnees?: boolean;
}

export async function arrangerComprehension(
    donnees: ItemComprehension[],
    type: 'ce' | 'co',
    cheminDossier: string,
    ss: string,
    tt: string,
    options?: OptionsArrangementComprehension
): Promise<ResultatArrangement> {
    if (!Array.isArray(donnees) || donnees.length === 0) {
        return { paquets: [], mode: 'progressif', erreur: `Données ${type.toUpperCase()} transformées absentes ou vides.` };
    }

    const pointsDepuisDonnees = options?.pointsDepuisDonnees === true;
    const paquets: PaquetEnvoi[] = [];
    const total = donnees.length;

    for (let i = 0; i < donnees.length; i++) {
        const item = donnees[i];
        const numeroQuestion = typeof item.index === 'number' ? item.index + 1 : i + 1;

        // TCF · CO : points du transformé ; TEF : grille selon la position.
        const pts = pointsDepuisDonnees
            ? (typeof item.points === 'number' && Number.isFinite(item.points) ? item.points : 0)
            : pointsPourQuestion(numeroQuestion);

        const propositions = item.propositions ?? { A: '', B: '', C: '', D: '' };
        const clesProp = Object.keys(propositions);

        const formulaire = new FormData();
        clesProp.forEach((cle, indice) => {
            const valeur = propositions[cle];
            const texte = valeur && String(valeur).trim() !== '' ? String(valeur) : `Proposition ${cle}`;
            formulaire.append(`p${indice + 1}`, texte);
        });
        formulaire.append('res', String(clesProp.indexOf(item.bonneReponse ?? '')));
        formulaire.append('pts', String(pts));
        formulaire.append('quest', String(numeroQuestion));
        formulaire.append('provent', 'ajaxSave');
        formulaire.append('ss', ss);
        formulaire.append('tt', tt);

        const corpsAffichage: Record<string, any> = {
            question: numeroQuestion,
            pts,
            ss,
            tt,
            type: type === 'ce' ? 0 : 1,
        };

        if (type === 'ce') {
            formulaire.append('q', item.consigne ?? '');
            formulaire.append('type', '0');
            const image = await lireMediaBase64(cheminDossier, item.image);
            if (image) {
                formulaire.append(
                    'img',
                    new Blob([Buffer.from(image.donneeBase64, 'base64')], { type: `image/${image.extension}` }),
                    `monfichier.${image.extension}`
                );
                corpsAffichage.img = `(image jointe, ${image.extension})`;
            }
        } else {
            formulaire.append('type', '1');
            formulaire.append('indQuest', item.consigne ?? '');
            const audio = await lireMediaBase64(cheminDossier, item.audio);
            if (audio) {
                formulaire.append(
                    'q',
                    new Blob([Buffer.from(audio.donneeBase64, 'base64')], { type: `audio/${audio.extension}` }),
                    `monfichier.${audio.extension}`
                );
                corpsAffichage.q = `(audio joint, ${audio.extension})`;
            }
            const image = await lireMediaBase64(cheminDossier, item.image);
            if (image) {
                formulaire.append(
                    'img',
                    new Blob([Buffer.from(image.donneeBase64, 'base64')], { type: `image/${image.extension}` }),
                    `monfichier.${image.extension}`
                );
                corpsAffichage.img = `(image jointe, ${image.extension})`;
            }
        }

        formulaire.append('ext', 'true');

        paquets.push({
            corps: corpsAffichage,
            corpsRequete: formulaire,
            entetes: { ...HEADER_API_DPLUS },
        });
    }

    return { paquets, mode: 'progressif' };
}

// ---------------------------------------------------------------------
// TCF · CE — format DÉDIÉ (différent du reste) :
//   { points, options: string[], correctAnswerIndex, enonce, question }
// où `enonce` est encore du TEXTE tant que l'image n'a pas été composée
// côté graphique, et devient un chemin "trans_img/enonce_N.<ext>" une
// fois l'image générée (voir enregistrerImageEnonceTcfCe).
//
// Confirmé à partir de l'ancien code (enregistreExtract.js /
// exportSite.js) : l'ancien completeCompEcrt envoyait TOUJOURS
// q = eltExp[question] (texte de la question) et img = eltExp[enoncer]
// (image du passage de lecture) — jamais l'inverse. On reproduit donc :
//   - q   = item.question (le texte de la question posée)
//   - img = l'image générée à partir de item.enonce (le texte du passage
//           de lecture), si elle a déjà été composée.
// Autre point confirmé par l'ancien exportComp : "pts" est la valeur
// DÉJÀ PRÉSENTE dans la donnée (eltExp[points]), jamais recalculée à
// partir d'une grille selon la position de la question. Les données
// TCF CE (QuestionCE) ont justement un champ "points" dédié : c'est
// celui-là qu'il faut envoyer tel quel, comme le faisait l'ancien code
// (contrairement à arrangerComprehension ci-dessus, pour le TEF/CO, qui
// elle n'a jamais eu de champ "points" propre et doit le recalculer).
// ---------------------------------------------------------------------

export interface ItemTcfCe {
    points?: number;
    options?: string[];
    correctAnswerIndex?: number;
    enonce?: string;
    question?: string;
}

const PREFIXE_IMAGE_ENONCE_TCF_CE = 'trans_img/';

export async function arrangerTcfCe(
    donnees: ItemTcfCe[],
    cheminDossier: string,
    ss: string,
    tt: string
): Promise<ResultatArrangement> {
    if (!Array.isArray(donnees) || donnees.length === 0) {
        return { paquets: [], mode: 'progressif', erreur: 'Données CE (TCF) transformées absentes ou vides.' };
    }

    const paquets: PaquetEnvoi[] = [];
    const total = donnees.length;

    for (let i = 0; i < donnees.length; i++) {
        const item = donnees[i];
        const numeroQuestion = i + 1;
        const options = Array.isArray(item.options) ? item.options : [];

        const formulaire = new FormData();
        for (let indice = 0; indice < 4; indice++) {
            const valeur = options[indice];
            const texte = valeur && String(valeur).trim() !== '' ? String(valeur) : `Proposition ${indice + 1}`;
            formulaire.append(`p${indice + 1}`, texte);
        }
        formulaire.append('res', String(item.correctAnswerIndex ?? -1));
        formulaire.append('pts', String(item.points ?? 0));
        formulaire.append('quest', String(numeroQuestion));
        formulaire.append('provent', 'ajaxSave');
        formulaire.append('ss', ss);
        formulaire.append('tt', tt);
        formulaire.append('type', '0');
        formulaire.append('q', item.question ?? '');

        const corpsAffichage: Record<string, any> = {
            question: numeroQuestion,
            pts: item.points ?? 0,
            ss,
            tt,
            type: 0,
        };

        const enonceEstImage =
            typeof item.enonce === 'string' && item.enonce.startsWith(PREFIXE_IMAGE_ENONCE_TCF_CE);
        if (enonceEstImage) {
            const image = await lireMediaBase64(cheminDossier, item.enonce);
            if (image) {
                formulaire.append(
                    'img',
                    new Blob([Buffer.from(image.donneeBase64, 'base64')], { type: `image/${image.extension}` }),
                    `monfichier.${image.extension}`
                );
                corpsAffichage.img = `(image jointe, ${image.extension})`;
            }
        }

        formulaire.append('ext', 'true');

        paquets.push({
            corps: corpsAffichage,
            corpsRequete: formulaire,
            entetes: { ...HEADER_API_DPLUS },
        });
    }

    return { paquets, mode: 'progressif' };
}

// ---------------------------------------------------------------------
// EE (TEF) — format { A: { consigne }, B: { consigne } }.
// Un seul envoi (comme l'ancien exportExpr), urlencoded, avec le
// tableau "sagni" sérialisé.
// ---------------------------------------------------------------------

export interface DonneesEE {
    A?: { consigne?: string };
    B?: { consigne?: string };
}

export function arrangerEE(donnees: DonneesEE, ss: string, tt: string): ResultatArrangement {
    if (!donnees || !donnees.A || !donnees.B) {
        return { paquets: [], mode: 'unique', erreur: 'Données EE transformées absentes ou incomplètes.' };
    }

    const ligne = [INDICE_TYPE_EPREUVE.ee, donnees.A.consigne ?? '', donnees.B.consigne ?? ''];

    const corpsRequete = new URLSearchParams({
        provent: 'ajaxSave',
        sagni: JSON.stringify([ligne]),
        ext: 'true',
    });

    return {
        paquets: [{
            corps: { sagni: [ligne], ss, tt },
            corpsRequete,
            entetes: { ...HEADER_API_DPLUS, 'Content-Type': 'application/x-www-form-urlencoded' },
        }],
        mode: 'unique',
    };
}

// ---------------------------------------------------------------------
// EE (TEF) — LOT (sélection groupée) : contrairement à arrangerEE
// ci-dessus (un seul élément), la sélection groupée d'une zone TEF · EE
// doit fusionner TOUS les sujets retenus en un seul tableau "sagni" et
// n'envoyer qu'UNE SEULE requête pour tout le lot — reproduit fidèlement
// l'ancien comportement multi-séries (voir exportSite.ts::arrangerEE
// historique, qui accumulait déjà une ligne par série dans un seul
// paquet "unique"). Les éléments dont les données sont absentes ou
// incomplètes sont simplement écartés du tableau (voir `idsInvalides`,
// reportés séparément par l'appelant) plutôt que de faire échouer tout
// le lot.
// ---------------------------------------------------------------------

export interface ElementEELot {
    id: string;
    donnees: DonneesEE;
}

export interface ResultatArrangementLotEE extends ResultatArrangement {
    /** Identifiants des éléments écartés (données absentes/incomplètes), jamais envoyés. */
    idsInvalides: string[];
    /** Identifiants effectivement inclus dans le paquet fusionné. */
    idsRetenus: string[];
}

export function arrangerEELot(elements: ElementEELot[]): ResultatArrangementLotEE {
    const lignes: any[] = [];
    const idsRetenus: string[] = [];
    const idsInvalides: string[] = [];

    for (const { id, donnees } of elements) {
        if (!donnees || !donnees.A || !donnees.B) {
            idsInvalides.push(id);
            continue;
        }
        lignes.push([INDICE_TYPE_EPREUVE.ee, donnees.A.consigne ?? '', donnees.B.consigne ?? '']);
        idsRetenus.push(id);
    }

    if (lignes.length === 0) {
        return {
            paquets: [],
            mode: 'unique',
            erreur: 'Aucune donnée EE exploitable dans la sélection.',
            idsInvalides,
            idsRetenus,
        };
    }

    const corpsRequete = new URLSearchParams({
        provent: 'ajaxSave',
        sagni: JSON.stringify(lignes),
        ext: 'true',
    });

    return {
        paquets: [{
            corps: { sagni: lignes },
            corpsRequete,
            entetes: { ...HEADER_API_DPLUS, 'Content-Type': 'application/x-www-form-urlencoded' },
        }],
        mode: 'unique',
        idsInvalides,
        idsRetenus,
    };
}

// ---------------------------------------------------------------------
// EO (TEF) — format { A: { image, consigne, description }, B: { ... } }.
// Un seul envoi multipart/form-data (comme l'ancien arrangerEO).
// ---------------------------------------------------------------------

export interface DonneesEO {
    A?: { image?: string; consigne?: string; description?: string };
    B?: { image?: string; consigne?: string; description?: string };
}

export async function arrangerEO(
    donnees: DonneesEO,
    cheminDossier: string,
    ss: string,
    tt: string
): Promise<ResultatArrangement> {
    if (!donnees || !donnees.A || !donnees.B) {
        return { paquets: [], mode: 'unique', erreur: 'Données EO transformées absentes ou incomplètes.' };
    }

    const consigneA = donnees.A.consigne ?? '';
    const descriptionA = donnees.A.description ?? '';
    const consigneB = donnees.B.consigne ?? '';
    const descriptionB = donnees.B.description ?? '';
    const ligne = [INDICE_TYPE_EPREUVE.eo, consigneA, descriptionA, consigneB, descriptionB];

    const formulaire = new FormData();
    formulaire.append('provent', 'ajaxSave');
    formulaire.append('ext', 'true');
    formulaire.append('sagni', JSON.stringify([ligne]));

    const corpsAffichage: Record<string, any> = { sagni: [ligne], ss, tt };

    const imageA = await lireMediaBase64(cheminDossier, donnees.A.image);
    if (imageA) {
        formulaire.append(
            'fileA',
            new Blob([Buffer.from(imageA.donneeBase64, 'base64')], { type: `image/${imageA.extension}` }),
            `monfichier.${imageA.extension}`
        );
        corpsAffichage.fileA = `(image jointe, ${imageA.extension})`;
    }

    const imageB = await lireMediaBase64(cheminDossier, donnees.B.image);
    if (imageB) {
        formulaire.append(
            'fileB',
            new Blob([Buffer.from(imageB.donneeBase64, 'base64')], { type: `image/${imageB.extension}` }),
            `monfichier.${imageB.extension}`
        );
        corpsAffichage.fileB = `(image jointe, ${imageB.extension})`;
    }

    return {
        paquets: [{ corps: corpsAffichage, corpsRequete: formulaire, entetes: { ...HEADER_API_DPLUS } }],
        mode: 'unique',
    };
}

// ---------------------------------------------------------------------
// TCF · EE — un tableau de "combinaisons" (une en général), chacune
// { nomPartie, tache2: [tâche 1, tâche 2], tache3: [thème, document 1,
// document 2] } (voir donnee_tcf_ee.ts / recupDonnee_tcf_ee.ts : les 3
// tâches historiques sont regroupées en 2 champs pour partager le même
// modèle que l'EO, mais RIEN n'est perdu — tache2[0]/tache2[1] sont les
// tâches 1 et 2, tache3[0..2] sont le thème + les 2 documents de la
// tâche 3).
//
// Une ligne par combinaison :
//   [ <p>tâche1</p>, <p>tâche2</p>,
//     <h2>thème</h2><h4>Document 1</h4><p>doc1</p><h4>Document 2</h4><p>doc2</p>,
//     2,                          <- code de type (EE), fixe
//     <libellé session> ]         <- nom complet de la carte, ex. "Août 2026"
//                                    (passé tel quel depuis gestion_export,
//                                    sans extraction numérique de l'année)
// Tout le tableau de lignes part en une seule requête urlencoded
// (sagni = JSON.stringify(lignes)), jamais en plusieurs requêtes.
// Chaque texte passe par enleverChevrons (retire les "<<"/">>" que le
// site source ajoute autour d'un texte) avant d'être inséré dans le
// HTML, exactement comme l'ancien code.
// ---------------------------------------------------------------------

export interface PartieTcfEe {
    nomPartie?: string;
    tache2?: string[]; // [tâche 1, tâche 2]
    tache3?: string[]; // [thème, document 1, document 2]
}

// ---------------------------------------------------------------------
// TCF · EO — un tableau de "parties", chacune { nomPartie, tache2:
// string[], tache3: string[] } où, ICI, tache2/tache3 sont deux
// tableaux PARALLÈLES de sujets (pas 2/3 champs fixes comme pour l'EE)
// — voir donnee_tcf_eo.ts / recupDonnee_tcf_eo.ts.
//
// Reproduit EXACTEMENT l'ancien genererExportExpOrl + exportExpr : pour
// CHAQUE partie, une ligne par sujet i (i de 0 à
// min(tache2.length, tache3.length) - 1) :
//   [ '', <p>tache2[i]</p>, <p>tache3[i]</p>, 3, <numéro de série brut> ]
// Toutes les lignes de toutes les parties sont accumulées puis envoyées
// en une seule requête urlencoded, comme l'ancien code.
// ---------------------------------------------------------------------

export interface PartieTcfEo {
    nomPartie?: string;
    tache2?: string[];
    tache3?: string[];
}

// Retire les "<<"/">>" ajoutés par le site source autour d'un texte,
// avant insertion dans le HTML envoyé — identique à l'ancien
// enleverChevrons (enregistreExtract.js).
function enleverChevrons(chaine?: string): string {
    let valeur = (chaine ?? '').trim();
    if (valeur.startsWith('<<')) valeur = valeur.slice(2);
    if (valeur.endsWith('>>')) valeur = valeur.slice(0, -2);
    return valeur.trim();
}

// Identifiant de session envoyé en dernière position de chaque ligne
// sagni pour TCF · EE / EO.
//
// Depuis gestion_export, `ss` est le NOM COMPLET de la carte
// (ex. "Août 2026") — pas un "Série N" numérique. On l'envoie tel quel
// pour que le site distant affiche le mois + l'année, et non l'année
// seule. Si un jour un préfixe "Série " était encore fourni, on le
// retire pour rester compatible avec l'ancien contrat.
const PREFIXE_SS = 'Série ';
function identifiantSessionTcf(ss: string): string {
    const brut = (ss ?? '').trim();
    return brut.startsWith(PREFIXE_SS) ? brut.slice(PREFIXE_SS.length).trim() : brut;
}

export function arrangerTcfEeOuEo(
    donnees: (PartieTcfEe | PartieTcfEo)[],
    type: 'ee' | 'eo',
    ss: string,
    tt: string
): ResultatArrangement {
    if (!Array.isArray(donnees) || donnees.length === 0) {
        return { paquets: [], mode: 'unique', erreur: `Données ${type.toUpperCase()} (TCF) transformées absentes ou vides.` };
    }

    // Ex. "Août 2026" — libellé complet de la carte, pas seulement l'année.
    const identifiantSession = identifiantSessionTcf(ss);
    const lignes: any[] = [];

    if (type === 'ee') {
        for (const partie of donnees as PartieTcfEe[]) {
            const tache2 = partie.tache2 ?? [];
            const tache3 = partie.tache3 ?? [];
            const synthese =
                `<h2>${enleverChevrons(tache3[0])}</h2>` +
                `<h4>Document 1</h4><p>${enleverChevrons(tache3[1])}</p>` +
                `<h4>Document 2</h4><p>${enleverChevrons(tache3[2])}</p>`;
            lignes.push([
                `<p>${enleverChevrons(tache2[0])}</p>`,
                `<p>${enleverChevrons(tache2[1])}</p>`,
                synthese,
                INDICE_TYPE_EPREUVE.ee,
                identifiantSession,
            ]);
        }
    } else {
        for (const partie of donnees as PartieTcfEo[]) {
            const tache2 = partie.tache2 ?? [];
            const tache3 = partie.tache3 ?? [];
            const nb = Math.min(tache2.length, tache3.length);
            for (let i = 0; i < nb; i += 1) {
                lignes.push([
                    '',
                    `<p>${enleverChevrons(tache2[i])}</p>`,
                    `<p>${enleverChevrons(tache3[i])}</p>`,
                    INDICE_TYPE_EPREUVE.eo,
                    identifiantSession,
                ]);
            }
        }
    }

    if (lignes.length === 0) {
        return {
            paquets: [],
            mode: 'unique',
            erreur: `Données ${type.toUpperCase()} (TCF) transformées vides après mise en forme.`,
        };
    }

    const corpsRequete = new URLSearchParams({
        provent: 'ajaxSave',
        sagni: JSON.stringify(lignes),
        ext: 'true',
    });

    return {
        paquets: [{
            corps: { sagni: lignes, ss, tt },
            corpsRequete,
            entetes: { ...HEADER_API_DPLUS, 'Content-Type': 'application/x-www-form-urlencoded' },
        }],
        mode: 'unique',
    };
}