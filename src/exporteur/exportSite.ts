import * as path from 'path';
import * as fsp from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { session as electronSession } from 'electron';
import type { Session } from 'electron';

// Recréation de __filename / __dirname en ESM (identique à main.ts)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// NOTE : ce fichier utilise les classes Web globales FormData, Blob et
// AbortController, fournies nativement par Node 18+ (donc par Electron,
// qui embarque une version de Node récente) — pas besoin du paquet npm
// "form-data" utilisé par l'ancien code. `session.fetch` (Electron) sait
// nativement envoyer un FormData en multipart/form-data.

// ---------------------------------------------------------------------
// Exportation des données TRANSFORMÉES vers le site distant.
//
// Principe :
// - On reçoit un type d'épreuve (ce/co/ee/eo) et une liste de noms de
//   dossiers (séries) à exporter pour ce type.
// - On lit, pour chaque série, le fichier trans_{type}.json déjà
//   généré/édité (voir main.ts).
// - Une fonction d'arrangement PROPRE À CHAQUE TYPE vérifie ces données
//   et les met en forme selon le modèle attendu par le site distant.
//   Cette fonction décide aussi si l'envoi doit se faire :
//     - "unique"     : un seul fetch avec tout le paquet arrangé
//     - "progressif" : un fetch par paquet, les paquets étant envoyés
//                      les uns après les autres (on attend la réponse,
//                      erreur ou non, avant d'envoyer le paquet suivant)
// - Chaque envoi (succès ou erreur) déclenche un callback de
//   progression, destiné à être relayé au renderer via IPC (voir
//   l'exemple de branchement dans main.ts).
//
// Authentification : la WebContentsView ouverte via 'ouvre-view' (voir
// creeView.ts / main.ts) utilise la partition dédiée et persistante
// PARTITION_EXPORT (webPreferences.partition, voir optionView dans
// main.ts). Une fois l'utilisateur connecté sur le site récupérateur
// dans cette vue, les cookies de session sont déposés dans cette même
// partition : `obtenirSessionExport()` (session.fromPartition) donne
// donc accès à une session déjà authentifiée, et `session.fetch(...)`
// (et non le fetch global de Node) garantit que ces cookies sont bien
// envoyés avec les requêtes d'export.
// ---------------------------------------------------------------------

export type TypeEpreuve = 'ce' | 'co' | 'ee' | 'eo';

// Indice de chaque type d'épreuve, utilisé notamment comme premier élément
// du tableau envoyé pour l'EE (voir arrangerEE) : correspond à la position
// du type dans TYPES_EPREUVE ('ce'=0, 'co'=1, 'ee'=2, 'eo'=3).
const INDICE_TYPE_EPREUVE: Record<TypeEpreuve, number> = { ce: 0, co: 1, ee: 2, eo: 3 };

// Valeur fixe attendue par le site distant en dernière position du
// tableau "sagni" envoyé pour l'EO — propre au contrat serveur pour ce
// type (indépendante de la position de 'eo' dans TYPES_EPREUVE), comme
// pour l'EE (voir INDICE_TYPE_EPREUVE.ee, utilisé lui aussi comme code de
// type dans son propre "sagni").

// Adresse réelle du site récupérateur (même hôte que URL_CONNECT — voir
// le commentaire laissé dans oraganisateur.ts). C'est ce qui garantit que
// les cookies posés lors de la connexion sur URL_CONNECT sont bien
// automatiquement rattachés par `session.fetch` aux requêtes envoyées ici :
// Electron n'attache que les cookies dont le domaine correspond à l'URL
// de la requête, donc les deux doivent partager le même hôte.
const URL_EXPORT = 'http://192.168.10.1/auth/saveAll2.php';
export const URL_CONNECT = "http://192.168.10.1/login/";

// En-tête commun à toutes les requêtes d'export, tel que dans l'ancien
// code (headersExpr / headersComp partagent ce même en-tête, seul le
// Content-Type diffère selon le type de corps envoyé — voir chaque
// fonction d'arrangement plus bas).
const HEADER_API_DPLUS: Record<string, string> = { 'Dplus-fetch-api': 'Request_Fetch_Dplus' };

// Délai maximum d'attente d'une réponse pour un paquet envoyé (identique à
// l'ancien "durreAtente"). Passé ce délai, le fetch en cours est annulé
// (AbortController) et l'échec est reporté avec un message dédié — voir
// envoyerRequete plus bas.
const DUREE_ATTENTE_MS = 60000;

// Partition dédiée et persistante utilisée à la fois par la
// WebContentsView de connexion (voir optionView dans main.ts) et par les
// requêtes d'export ci-dessous : les cookies posés lors de la connexion
// dans la vue restent donc disponibles ici, même après fermeture de la
// vue, et survivent au redémarrage de l'application ("persist:").
export const PARTITION_EXPORT = 'persist:site-recuperateur';

// Nettoyage COMPLET de la partition d'export (tout le storage + cookies + cache + etc.)
export async function clearAllExportStorage(): Promise<void> {
    try {
        const exportSession = electronSession.fromPartition(PARTITION_EXPORT);

        // Supprime TOUT le storage (cookies, localStorage, IndexedDB, Cache, Service Workers, etc.)
        await exportSession.clearStorageData();

        // Option supplémentaire : vider explicitement les cookies
        await exportSession.cookies.flushStore();
        await exportSession.clearStorageData({ storages: ['cookies'] });

    } catch (err: any) {
        console.error('❌ Erreur lors du nettoyage complet de la partition :', err);
    }
}

// Session correspondant à cette partition (créée à la demande par
// Electron si elle n'existe pas encore).
export function obtenirSessionExport(): Session {
    return electronSession.fromPartition(PARTITION_EXPORT);
}

// Indique si une session (cookies) existe déjà pour le site d'export,
// c'est-à-dire si l'utilisateur s'est déjà connecté via la
// WebContentsView. Sert à décider, avant de lancer une exportation, s'il
// faut d'abord ouvrir la zone de connexion ou si on peut envoyer
// directement les données.
export async function possedeSessionExport(): Promise<boolean> {
    try {
        const cookies = await obtenirSessionExport().cookies.get({ url: URL_CONNECT });
        return cookies.length > 0;
    } catch {
        return false;
    }
}

// Un cookie dont le domaine correspond à l'hôte cible (en tenant compte
// du "." de tête que portent les cookies posés sur un domaine parent,
// ex: ".exemple-site-recuperateur.tld").
function hoteCorrespond(domaineCookie: string, hoteCible: string): boolean {
    const nettoye = (domaineCookie || '').replace(/^\./, '');
    return hoteCible === nettoye || hoteCible.endsWith(`.${nettoye}`);
}

// Écoute deux signaux, dans la vue de connexion elle-même, pour détecter
// qu'une connexion vient de réussir, et déclenche `onSessionDetectee`
// (une seule fois) dès que l'un des deux se produit :
//
// 1) Cookie posé/modifié dans la partition d'export pour l'hôte du site
//    récupérateur.
// 2) Navigation qui quitte la page de connexion initiale : la première
//    navigation observée sert de référence (c'est le chargement de la
//    page de connexion elle-même), toute navigation suivante vers une
//    URL différente (redirection après authentification vers un
//    dashboard, une page d'accueil, ...) est considérée comme le signe
//    d'une connexion réussie.
//
// Le second signal est en général plus fiable que le premier : certains
// sites posent déjà un cookie technique (anti-CSRF, préférences...)
// avant même que l'utilisateur ne se connecte, ce qui déclencherait une
// fermeture prématurée avec le seul signal cookie.
//
// Retourne une fonction à appeler pour arrêter l'écoute (à faire dès que
// la vue se ferme, détection ou fermeture manuelle, pour ne pas
// accumuler les écouteurs d'une ouverture de vue à l'autre).
export function ecouteConnexionExport(
    webContents: Electron.WebContents,
    onSessionDetectee: () => void
): () => void {
    const session = obtenirSessionExport();
    const hoteCible = new URL(URL_CONNECT).hostname;
    let declenchee = false;
    let urlReference: string | null = null;

    const tenterDeclenchement = () => {
        if (declenchee) return;
        declenchee = true;
        onSessionDetectee();
    };

    const gestionnaireCookie = (
        _event: Electron.Event,
        cookie: Electron.Cookie,
        _cause: string,
        removed: boolean
    ) => {
        if (removed) return;
        if (!hoteCorrespond(cookie.domain ?? '', hoteCible)) return;
        tenterDeclenchement();
    };

    const gestionnaireNavigation = (_event: Electron.Event, url: string) => {
        if (urlReference === null) {
            // Première navigation observée = chargement de la page de
            // connexion elle-même, sert juste de référence.
            urlReference = url;
            return;
        }
        if (url === urlReference) return;
        tenterDeclenchement();
    };

    session.cookies.on('changed', gestionnaireCookie);
    webContents.on('did-navigate', gestionnaireNavigation);

    return () => {
        session.cookies.removeListener('changed', gestionnaireCookie);
        webContents.removeListener('did-navigate', gestionnaireNavigation);
    };
}

function getDonneeDir(): string {
    return path.join(__dirname, '../donnee');
}

async function existeChemin(cheminCible: string): Promise<boolean> {
    try {
        await fsp.access(cheminCible);
        return true;
    } catch {
        return false;
    }
}

// Lit un média (image/audio) référencé par un chemin relatif au dossier
// de la série et le convertit en base64, prêt à être glissé dans un
// corps JSON. Retourne null si aucun média (chemin vide ou fichier
// introuvable).
async function lireMediaBase64(
    serieDir: string,
    cheminRelatif: string | undefined
): Promise<{ donneeBase64: string; extension: string } | null> {
    if (!cheminRelatif || cheminRelatif.trim() === '') return null;
    const cheminAbsolu = path.join(serieDir, cheminRelatif);
    if (!(await existeChemin(cheminAbsolu))) return null;
    try {
        const buffer = await fsp.readFile(cheminAbsolu);
        const extension = path.extname(cheminAbsolu).replace('.', '') || 'bin';
        return { donneeBase64: buffer.toString('base64'), extension };
    } catch {
        return null;
    }
}

async function lireDonneesTransformees(serie: string, type: TypeEpreuve): Promise<any> {
    const fichier = path.join(getDonneeDir(), serie, `trans_${type}.json`);
    const contenu = await fsp.readFile(fichier, 'utf-8');
    return JSON.parse(contenu);
}

// Grille de points selon le numéro de la question dans la compréhension
// (CE ou CO), au lieu de la valeur "points" éventuellement présente dans
// les données (celle-ci n'est plus utilisée pour l'export) :
//   Q1-Q4 -> 3 pts, Q5-Q11 -> 9 pts, Q12-Q20 -> 14 pts, Q21-Q30 -> 21 pts,
//   Q31-Q36 -> 26 pts, Q37-Q40 -> 33 pts.
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

// Le nom d'un dossier de série est de la forme "{numSerie}_{numTest}"
// (ex: "135_65") :
//  - ss = "Série {numSerie}" (partie avant le "_")
//  - tt = "{numTest}" (partie après le "_")
// À AJUSTER si l'ordre réel des deux nombres dans le nom de dossier est
// inversé — c'est le seul endroit à changer.
function decouperNomSerie(serie: string): { ss: string; tt: string } {
    const [avantTiret, apresTiret] = serie.split('_');
    return {
        ss: `Série ${apresTiret ?? ''}`,
        tt: apresTiret ?? '',
    };
}

// ---------------------------------------------------------------------
// Arrangement par type
// ---------------------------------------------------------------------

type ModeEnvoi = 'unique' | 'progressif';

// Un paquet = un corps de requête prêt à être envoyé (fetch), associé à
// la ou les séries qu'il concerne (pour pouvoir répercuter le résultat
// de la requête sur chacune d'elles).
//  - corps        : version "lisible" (objet / tableau JS), utilisée
//                    uniquement pour l'affichage (voir gestionMessage côté
//                    renderer) — jamais envoyée telle quelle.
//  - corpsRequete : ce qui est réellement passé en body à fetch (peut être
//                    un URLSearchParams, une chaîne JSON, un FormData...),
//                    propre à chaque type, comme dans l'ancien code
//                    (URLSearchParams pour l'EE, multipart pour CE/CO...).
//  - entetes      : en-têtes spécifiques à ce paquet (Content-Type
//                    notamment), à fusionner avec HEADER_API_DPLUS. Pour un
//                    FormData, ne PAS mettre de Content-Type ici : fetch le
//                    calcule lui-même (boundary multipart).
//  - progression  : méta optionnelle utilisée pour un suivi détaillé
//                    (CE/CO, question par question) — voir exporterVersSite.
interface PaquetEnvoi {
    series: string[];
    corps: any;
    corpsRequete: BodyInit;
    entetes: Record<string, string>;
    progression?: {
        numeroQuestion: number;
        totalQuestions: number;
        nouvelleSerie: boolean;
    };
}

interface SerieInvalide {
    serie: string;
    raison: string;
}

interface ResultatArrangement {
    paquets: PaquetEnvoi[];
    mode: ModeEnvoi;
    invalides: SerieInvalide[];
    // Si true (CE/CO/EO) : dès qu'un paquet échoue (erreur serveur ou
    // délai dépassé), on arrête complètement l'envoi des paquets restants
    // (questions suivantes ET séries suivantes), au lieu de continuer.
    arreterAuPremierEchec?: boolean;
}

interface EntreeDonnee {
    serie: string;
    donnees: any;
}

// CE et CO ("compréhensions") : chaque QUESTION (élément du tableau
// trans_ce.json / trans_co.json) est envoyée dans SA PROPRE requête
// multipart/form-data, l'une après l'autre — comme l'ancien
// exportComp/completeCompEcrt/completeCompOrale. On ne regroupe donc pas
// par série : `paquets` contient un paquet par question, dans l'ordre
// (toutes les questions d'une série avant de passer à la suivante), avec
// `arreterAuPremierEchec: true` pour que l'envoi s'arrête net à la
// première erreur ou au premier délai dépassé (voir exporterVersSite).
//
// Champs du formulaire (identiques à l'ancien code, sauf pts/ss/tt) :
//   p1..p4  : les 4 propositions (texte, ou "Proposition X" si vide)
//   res     : position (0-3) de la bonne réponse parmi p1..p4
//   pts     : PLUS pris dans les données -> calculé via pointsPourQuestion()
//   quest   : numéro de la question (1-based = index + 1)
//   provent : 'ajaxSave'
//   ss      : "Série {numSerie}", tt : {numTest} -> voir decouperNomSerie()
//   ext     : true
//   type    : 0 (CE) ou 1 (CO)
//   CE : q = consigne (texte), img = image (si présente)
//   CO : q = fichier audio, img = image (si présente)
async function arrangerComprehension(
    entrees: EntreeDonnee[],
    type: 'ce' | 'co'
): Promise<ResultatArrangement> {
    const paquets: PaquetEnvoi[] = [];
    const invalides: SerieInvalide[] = [];
    const libelle = type.toUpperCase();

    for (const { serie, donnees } of entrees) {
        if (!Array.isArray(donnees) || donnees.length === 0) {
            invalides.push({ serie, raison: `Données ${libelle} transformées absentes ou vides.` });
            continue;
        }

        const serieDir = path.join(getDonneeDir(), serie);
        const { ss, tt } = decouperNomSerie(serie);
        const totalQuestions = donnees.length;

        for (let i = 0; i < donnees.length; i++) {
            const item = donnees[i];
            const numeroQuestion = typeof item.index === 'number' ? item.index + 1 : i + 1;

            const propositions = item.propositions ?? { A: '', B: '', C: '', D: '' };
            const clesProp = Object.keys(propositions);

            const formulaire = new FormData();
            clesProp.forEach((cle, indice) => {
                const valeur = propositions[cle];
                const texte = valeur && String(valeur).trim() !== '' ? String(valeur) : `Proposition ${cle}`;
                formulaire.append(`p${indice + 1}`, texte);
            });;
            formulaire.append('res', String(clesProp.indexOf(item.bonneReponse)));
            formulaire.append('pts', String(pointsPourQuestion(numeroQuestion)));
            formulaire.append('quest', String(numeroQuestion));
            formulaire.append('provent', 'ajaxSave');
            formulaire.append('ss', ss);
            formulaire.append('tt', tt);

            // Corps "affichable" (gestionMessage) : pas de binaire dedans,
            // juste de quoi identifier la question et vérifier les valeurs
            // calculées (points, ss/tt).
            const corpsAffichage: Record<string, any> = {
                serie,
                question: numeroQuestion,
                pts: pointsPourQuestion(numeroQuestion),
                ss,
                tt,
                type: type === 'ce' ? 0 : 1,
            };

            if (type === 'ce') {
                formulaire.append('q', item.consigne ?? '');
                formulaire.append('type', '0');
                const image = await lireMediaBase64(serieDir, item.image);
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
                const audio = await lireMediaBase64(serieDir, item.audio);
                if (audio) {
                    formulaire.append(
                        'q',
                        new Blob([Buffer.from(audio.donneeBase64, 'base64')], { type: `audio/${audio.extension}` }),
                        `monfichier.${audio.extension}`
                    );
                    corpsAffichage.q = `(audio joint, ${audio.extension})`;
                }
                const image = await lireMediaBase64(serieDir, item.image);
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
                series: [serie],
                corps: corpsAffichage,
                corpsRequete: formulaire,
                // Pas de Content-Type explicite : fetch calcule lui-même le
                // Content-Type multipart avec la bonne "boundary" pour un
                // FormData — le fixer à la main casserait le parsing côté
                // serveur (contrairement à l'ancien code qui utilisait
                // `datas.getHeaders()`, propre au paquet npm "form-data").
                entetes: { ...HEADER_API_DPLUS },
                progression: { numeroQuestion, totalQuestions, nouvelleSerie: i === 0 },
            });
        }
    }

    return { paquets, mode: 'progressif', invalides, arreterAuPremierEchec: true };
}

async function arrangerCE(entrees: EntreeDonnee[]): Promise<ResultatArrangement> {
    return arrangerComprehension(entrees, 'ce');
}

async function arrangerCO(entrees: EntreeDonnee[]): Promise<ResultatArrangement> {
    return arrangerComprehension(entrees, 'co');
}

// EE : aucun média, données très légères -> toutes les séries sont
// regroupées et envoyées en une seule requête (mode "unique").
// Corps AFFICHÉ (gestionMessage) : le tableau des lignes, une ligne par
// série retenue : [indiceType, consigne de A, consigne de B].
// Corps RÉELLEMENT ENVOYÉ : reproduit fidèlement l'ancien exportExpr — un
// formulaire urlencoded avec ce même tableau sérialisé en JSON dans le
// champ "sagni" (et non un body JSON brut) :
//   new URLSearchParams({ provent: 'ajaxSave', sagni: JSON.stringify(lignes), ext: 'true' })
// avec les en-têtes historiques (headersExpr) : Dplus-fetch-api +
// Content-Type urlencoded.
async function arrangerEE(entrees: EntreeDonnee[]): Promise<ResultatArrangement> {
    const invalides: SerieInvalide[] = [];
    const seriesRetenues: string[] = [];
    const lignes: any[] = [];

    for (const { serie, donnees } of entrees) {
        if (!donnees || !donnees.A || !donnees.B) {
            invalides.push({ serie, raison: 'Données EE transformées absentes ou incomplètes.' });
            continue;
        }
        lignes.push([INDICE_TYPE_EPREUVE.ee, donnees.A.consigne ?? '', donnees.B.consigne ?? '']);
        seriesRetenues.push(serie);
    }

    if (lignes.length === 0) return { paquets: [], mode: 'unique', invalides };

    const corpsRequete = new URLSearchParams({
        provent: 'ajaxSave',
        sagni: JSON.stringify(lignes),
        ext: 'true',
    });

    return {
        paquets: [{
            series: seriesRetenues,
            corps: lignes,
            corpsRequete,
            entetes: { ...HEADER_API_DPLUS, 'Content-Type': 'application/x-www-form-urlencoded' },
        }],
        mode: 'unique',
        invalides,
    };
}

// EO : comme CE/CO, une série = une requête, les requêtes étant envoyées
// l'une après l'autre avec arrêt net à la première erreur ou au premier
// délai dépassé (arreterAuPremierEchec) — contrairement à CE/CO il n'y a
// pas de découpage par question : chaque paquet correspond à une série
// entière (sections A et B).
//
// Corps RÉELLEMENT ENVOYÉ (multipart/form-data, comme CE/CO) :
//   provent : 'ajaxSave'
//   ext     : 'true'
//   sagni   : JSON.stringify([[consigneA, descriptionA, consigneB, descriptionB, TYPE_EO]])
//   fileA   : image de la section A (si présente)
//   fileB   : image de la section B (si présente)
// En-têtes : identiques aux compréhensions (HEADER_API_DPLUS uniquement,
// pas de Content-Type -> calculé par fetch pour le multipart).
async function arrangerEO(entrees: EntreeDonnee[]): Promise<ResultatArrangement> {
    const paquets: PaquetEnvoi[] = [];
    const invalides: SerieInvalide[] = [];

    for (const { serie, donnees } of entrees) {
        if (!donnees || !donnees.A || !donnees.B) {
            invalides.push({ serie, raison: 'Données EO transformées absentes ou incomplètes.' });
            continue;
        }

        const serieDir = path.join(getDonneeDir(), serie);
        const consigneA = donnees.A.consigne ?? '';
        const descriptionA = donnees.A.description ?? '';
        const consigneB = donnees.B.consigne ?? '';
        const descriptionB = donnees.B.description ?? '';

        const ligne = [INDICE_TYPE_EPREUVE.eo ,consigneA, descriptionA, consigneB, descriptionB];

        const formulaire = new FormData();
        formulaire.append('provent', 'ajaxSave');
        formulaire.append('ext', 'true');
        formulaire.append('sagni', JSON.stringify([ligne]));

        // Corps "affichable" (gestionMessage) : le tableau sagni tel quel,
        // sans le binaire des images (remplacé par un repère textuel une
        // fois les fichiers effectivement ajoutés ci-dessous).
        const corpsAffichage: Record<string, any> = { serie, sagni: [ligne] };

        const imageA = await lireMediaBase64(serieDir, donnees.A.image);
        if (imageA) {
            formulaire.append(
                'fileA',
                new Blob([Buffer.from(imageA.donneeBase64, 'base64')], { type: `image/${imageA.extension}` }),
                `monfichier.${imageA.extension}`
            );
            corpsAffichage.fileA = `(image jointe, ${imageA.extension})`;
        }

        const imageB = await lireMediaBase64(serieDir, donnees.B.image);
        if (imageB) {
            formulaire.append(
                'fileB',
                new Blob([Buffer.from(imageB.donneeBase64, 'base64')], { type: `image/${imageB.extension}` }),
                `monfichier.${imageB.extension}`
            );
            corpsAffichage.fileB = `(image jointe, ${imageB.extension})`;
        }

        paquets.push({
            series: [serie],
            corps: corpsAffichage,
            corpsRequete: formulaire,
            // Pas de Content-Type explicite : comme pour CE/CO, fetch
            // calcule lui-même le Content-Type multipart (boundary) pour
            // un FormData.
            entetes: { ...HEADER_API_DPLUS },
        });
    }

    return { paquets, mode: 'progressif', invalides, arreterAuPremierEchec: true };
}

type FonctionArrangement = (entrees: EntreeDonnee[]) => Promise<ResultatArrangement>;

const ARRANGEURS: Record<TypeEpreuve, FonctionArrangement> = {
    ce: arrangerCE,
    co: arrangerCO,
    ee: arrangerEE,
    eo: arrangerEO,
};

// ---------------------------------------------------------------------
// Envoi réseau
// ---------------------------------------------------------------------

interface ResultatRequete {
    success: boolean;
    status?: number;
    data?: any;
    error?: string;
}

// Utilise `session.fetch`, PAS le fetch global de Node : c'est ce qui
// garantit que les cookies déposés par la connexion faite dans la
// WebContentsView sont bien envoyés avec la requête (Electron attache
// automatiquement les cookies de la session dont le domaine correspond à
// l'URL appelée — d'où l'importance que URL_EXPORT et URL_CONNECT
// partagent le même hôte, voir plus haut).
//
// IMPORTANT (lecture du corps) : on lit TOUJOURS le corps en texte brut
// D'ABORD (`reponse.text()`), puis on tente `JSON.parse` nous-mêmes sur
// ce texte — plutôt que d'appeler `reponse.json()` directement. En effet,
// une fois `reponse.json()` appelé, le flux du corps est déjà consommé en
// interne (même s'il échoue) : impossible de retomber sur `reponse.text()`
// après coup pour voir ce qui a réellement été renvoyé. En procédant
// ainsi, on peut toujours logger/afficher le texte brut du serveur, même
// quand ce n'est pas du JSON valide (ex: un script PHP qui laisse fuiter
// un warning/notice en HTML avant le JSON, provoquant un
// "Unexpected token '<'..." au parsing).
async function envoyerRequete(session: Session, paquet: PaquetEnvoi): Promise<ResultatRequete> {
    // Contrôleur de temps : si aucune réponse n'arrive avant DUREE_ATTENTE_MS,
    // on annule le fetch en cours (abort) plutôt que d'attendre indéfiniment.
    const controleurTemps = new AbortController();
    const idDelai = setTimeout(() => controleurTemps.abort(), DUREE_ATTENTE_MS);

    try {
        const reponse = await session.fetch(URL_EXPORT, {
            method: 'POST',
            headers: paquet.entetes,
            body: paquet.corpsRequete,
            signal: controleurTemps.signal,
        });

        // 1) Toujours récupérer le texte brut en premier.
        const texteBrut = await reponse.text();

        // 2) Log complet, INTÉGRAL, du texte brut renvoyé par le serveur —
        // visible dans le terminal du process principal (pas les DevTools,
        // ce fichier tourne dans le main process, voir la note en tête de
        // fichier). C'est ce qui permet de voir le message d'erreur PHP
        // en entier, quel que soit son format (JSON valide ou non).
        console.log(
            `[export] réponse brute du serveur pour ${paquet.series.join(', ')} ` +
            `(status ${reponse.status}) :\n${texteBrut}`
        );

        // 3) Tentative de parsing JSON sur ce même texte (et non un nouvel
        // appel à reponse.json(), qui échouerait : le corps a déjà été
        // consommé par reponse.text() ci-dessus).
        let donneesReponse: any = null;
        let erreurParsing: string | null = null;
        try {
            donneesReponse = JSON.parse(texteBrut);
        } catch (err: any) {
            erreurParsing = err?.message ?? String(err);
        }

        // Un échec de parsing JSON est traité comme une erreur MÊME SI le
        // serveur a répondu avec un statut HTTP 200 (fréquent avec un
        // script PHP mal terminé qui laisse fuiter du HTML avant/à la
        // place du JSON attendu) — avant ce correctif, ce cas passait
        // inaperçu : `donneesReponse` restait `null` et `reponse.ok` valait
        // `true`, donc l'envoi remontait comme un SUCCÈS silencieux.
        if (!reponse.ok || erreurParsing) {
            const messageServeur =
                donneesReponse && (donneesReponse.message || donneesReponse.error);
            const messageErreur = messageServeur
                ? String(messageServeur)
                : erreurParsing
                    ? `Réponse du serveur non reconnue comme du JSON (${erreurParsing}). Contenu brut :\n${texteBrut}`
                    : `Erreur HTTP ${reponse.status}`;

            return {
                success: false,
                status: reponse.status,
                // On garde le texte brut dans `data` quand le JSON n'a pas
                // pu être parsé, pour qu'il remonte aussi jusqu'au message
                // affiché côté renderer (gestionMessage) — voir zoneExport.ts.
                data: donneesReponse ?? texteBrut,
                error: messageErreur,
            };
        }

        return { success: true, status: reponse.status, data: donneesReponse };
    } catch (err: any) {
        // Le fetch a été annulé par notre propre contrôleur de temps (et pas
        // par une annulation externe) : on distingue ce cas avec un message
        // dédié, à afficher tel quel côté renderer (gestionMessage).
        if (controleurTemps.signal.aborted) {
            return { success: false, error: "Le délai d'attente est terminé" };
        }
        return { success: false, error: err?.message ?? String(err) };
    } finally {
        clearTimeout(idDelai);
    }
}

// ---------------------------------------------------------------------
// Orchestration exposée à main.ts
// ---------------------------------------------------------------------

export interface ProgressionExport {
    type: TypeEpreuve;
    serie: string;
    etat: 'en_cours' | 'succes' | 'erreur';
    message?: string;
    // Renseigné uniquement pour CE/CO (envoi question par question) : place
    // de la question courante dans sa série.
    question?: { numero: number; total: number };
    // true uniquement sur le tout premier paquet d'une série (permet au
    // renderer d'afficher un message temporaire "passage à la série X").
    nouvelleSerie?: boolean;
}

export interface ResultatSerieExport {
    serie: string;
    success: boolean;
    error?: string;
}

// Un envoi = ce qui a réellement été échangé avec le serveur pour un
// paquet donné : le corps envoyé (le tableau [[2, consigneA, consigneB], ...]
// pour l'EE) et la réponse du serveur (ou l'erreur survenue). Permet au
// renderer d'afficher le JSON envoyé / reçu tel quel (voir zoneExport.ts).
export interface ResultatEnvoiPaquet {
    series: string[];
    corps: any;
    success: boolean;
    data?: any;
    error?: string;
}

export interface ResultatExportGlobal {
    success: boolean;
    resultats: ResultatSerieExport[];
    envois: ResultatEnvoiPaquet[];
}

// `session` : la session à utiliser pour l'authentification (passer la
// session de la fenêtre principale — voir le branchement conseillé dans
// main.ts en commentaire plus bas).
// `onProgression` : callback appelé à chaque changement d'état d'une
// série, à relayer au renderer (mainWindow.webContents.send(...)).
export async function exporterVersSite(
    type: TypeEpreuve,
    series: string[],
    onProgression: (info: ProgressionExport) => void
): Promise<ResultatExportGlobal> {
    const session = obtenirSessionExport();
    const entrees: EntreeDonnee[] = [];
    const resultats: ResultatSerieExport[] = [];
    const envois: ResultatEnvoiPaquet[] = [];

    // 1) Lecture des fichiers trans_{type}.json de chaque série demandée.
    for (const serie of series) {
        try {
            const donnees = await lireDonneesTransformees(serie, type);
            entrees.push({ serie, donnees });
        } catch (err: any) {
            const message = `Lecture impossible pour ${serie} : ${err?.message ?? err}`;
            onProgression({ type, serie, etat: 'erreur', message });
            resultats.push({ serie, success: false, error: message });
        }
    }

    if (entrees.length === 0) {
        return { success: resultats.every((r) => r.success), resultats, envois };
    }

    // 2) Arrangement + vérification, propre au type.
    const { paquets, mode, invalides, arreterAuPremierEchec } = await ARRANGEURS[type](entrees);

    for (const invalide of invalides) {
        onProgression({ type, serie: invalide.serie, etat: 'erreur', message: invalide.raison });
        resultats.push({ serie: invalide.serie, success: false, error: invalide.raison });
    }

    if (paquets.length === 0) {
        return { success: resultats.every((r) => r.success), resultats, envois };
    }

    // 3) Envoi effectif : un seul fetch (mode "unique") ou une suite de
    // fetch envoyés l'un après l'autre, en attendant à chaque fois la
    // réponse (ou l'erreur) avant de lancer le paquet suivant (mode
    // "progressif"). Pour CE/CO, chaque paquet est UNE question ; plusieurs
    // paquets consécutifs partagent donc la même série tant qu'on n'est pas
    // passé à la suivante (voir `progression.nouvelleSerie`) — on cumule
    // donc le résultat par série au fur et à mesure (accumulateurSeries)
    // plutôt que de pousser un résultat par paquet.
    const accumulateurSeries = new Map<string, { success: boolean; error?: string }>();

    for (const paquet of paquets) {
        for (const serie of paquet.series) {
            onProgression({
                type,
                serie,
                etat: 'en_cours',
                message: paquet.progression
                    ? `Question ${paquet.progression.numeroQuestion}/${paquet.progression.totalQuestions} en cours d'envoi…`
                    : undefined,
                question: paquet.progression
                    ? { numero: paquet.progression.numeroQuestion, total: paquet.progression.totalQuestions }
                    : undefined,
                nouvelleSerie: paquet.progression?.nouvelleSerie,
            });
        }

        const reponse = await envoyerRequete(session, paquet);

        // Le serveur retourne toujours un message (data.message / data.error,
        // ou l'erreur réseau/HTTP survenue) : on conserve ici, avec le corps
        // exact envoyé, de quoi l'afficher tel quel côté renderer.
        envois.push({
            series: paquet.series,
            corps: paquet.corps,
            success: reponse.success,
            data: reponse.data,
            error: reponse.error,
        });

        for (const serie of paquet.series) {
            const accumule = accumulateurSeries.get(serie) ?? { success: true, error: undefined };
            if (!reponse.success) {
                accumule.success = false;
                accumule.error = reponse.error;
            }
            accumulateurSeries.set(serie, accumule);

            onProgression({
                type,
                serie,
                etat: reponse.success ? 'succes' : 'erreur',
                message: reponse.success ? undefined : reponse.error,
                question: paquet.progression
                    ? { numero: paquet.progression.numeroQuestion, total: paquet.progression.totalQuestions }
                    : undefined,
            });
        }

        if (!reponse.success && arreterAuPremierEchec) {
            // Une question/série a échoué (erreur serveur ou délai dépassé) :
            // on arrête net, sans envoyer les questions/séries restantes.
            break;
        }

        // mode "unique" : un seul paquet de toute façon, la boucle
        // s'arrête naturellement.
        void mode;
    }

    for (const [serie, accumule] of accumulateurSeries.entries()) {
        resultats.push({ serie, success: accumule.success, error: accumule.error });
    }

    return { success: resultats.every((r) => r.success), resultats, envois };
}