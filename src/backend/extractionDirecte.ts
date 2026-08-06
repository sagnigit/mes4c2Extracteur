import { BrowserWindow, WebContentsView, ipcMain, session as electronSession } from 'electron';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import {
    DOCK_LARGEUR,
    DOCK_HAUTEUR,
    DOCK_MARGE,
    HAUTEUR_BARRE_TITRE,
    ZONE_HAUT,
    ZONE_MARGE,
    DELAI_PAR_DEFAUT_MS,
} from '../partagesExtractionDirecte.js';
import {
    initOutil,
    dataLienPincipale,
    dataCodeRecupLien,
    dataCodeRecupDonnee,
    dataManipLien,
    dataManipDonne,
    definirNotifieurMajLiens,
    definirNotifieurDonneeTraitee,
    definirNotifieurProgressionDonnee,
    mettreAJourCodesExtraction,
    possedeDonnee,
} from './outi_exract.js';
import { getLien, getNomLien } from './conserveLien.js';
import { integrerSujet } from './nonExtract.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ---------------------------------------------------------------------
// Partition dédiée et persistante pour les pages ouvertes en vue d'une
// extraction directe de données. Volontairement distincte de
// PARTITION_EXPORT (exportSite.ts / creeView.ts) : ce sont des sites
// tiers quelconques, pas le site récupérateur authentifié.
// ---------------------------------------------------------------------
export const PARTITION_EXTRACTION = 'persist:extraction-directe';

export function obtenirSessionExtraction() {
    return electronSession.fromPartition(PARTITION_EXTRACTION);
}

export type EtatTache =
    | 'chargement'      // page cible en cours de chargement (mode réduit)
    | 'zone_erreur'      // page incorrecte / erreur / délai dépassé (mode zone)
    | 'injecte'          // page correcte chargée, code injecté, en attente de la donnée
    | 'termine'          // donnée reçue et traitée, vue fermée
    | 'arrete';          // annulée par l'utilisateur ou par l'appelant

export interface OptionsExtraction {
    /** Lien exact attendu. L'injection n'a lieu que si l'URL chargée correspond exactement à ce lien. */
    url: string;
    /** Code JS à injecter dans la page une fois celle-ci chargée et conforme à `url`. */
    codeAInjecter: string;
    /** Délai maximum (ms) avant abandon si rien n'a abouti. Défaut : 30000. */
    delaiMaxMs?: number;
    /** Fonction de traitement appelée avec la valeur envoyée par le code injecté (window.extraction.envoyerDonnee). */
    onDonnee: (valeur: any) => void | Promise<void>;
    /** Optionnel : suivi de chaque changement d'état (log, UI custom, etc.). */
    onEtat?: (etat: EtatTache, detail?: string) => void;
}

export interface TacheExtractionHandle {
    id: string;
    arreter: () => void;
}

interface TacheInterne {
    id: string;
    options: OptionsExtraction;
    fenetre: BrowserWindow;
    vue: WebContentsView;
    etat: EtatTache;
    minuteur: NodeJS.Timeout | null;
}

const taches = new Map<string, TacheInterne>();
let compteurId = 1;
const genererId = (): string => `extraction-${compteurId++}`;

// Une seule tâche à la fois occupe la "grande zone" (grande vue +
// bandeau de message côté renderer) — les suivantes patientent en mode
// réduit (état interne toujours 'zone_erreur', simplement pas encore
// mises en avant) jusqu'à ce que la place se libère.
let tacheEnZone: string | null = null;
const filesAttenteZone: string[] = [];

let envoyerVersRenderer: ((canal: string, ...args: any[]) => void) | null = null;
function definirEnvoiRenderer(fn: (canal: string, ...args: any[]) => void): void {
    envoyerVersRenderer = fn;
}

function notifierRenderer(tache: TacheInterne, messagePourZone?: string): void {
    envoyerVersRenderer?.('extraction:etat', {
        id: tache.id,
        etat: tache.etat,
        message: messagePourZone,
        url: tache.options.url,
    });
}

// ---------------------------------------------------------------------
// Positionnement des vues
// ---------------------------------------------------------------------

function calculerBornesReduites(fenetre: BrowserWindow, indice: number): Electron.Rectangle {
    const { width } = fenetre.getContentBounds();
    const parLigne = Math.max(1, Math.floor((width - DOCK_MARGE) / (DOCK_LARGEUR + DOCK_MARGE)));
    const colonne = indice % parLigne;
    const ligne = Math.floor(indice / parLigne);
    return {
        x: DOCK_MARGE + colonne * (DOCK_LARGEUR + DOCK_MARGE),
        y: HAUTEUR_BARRE_TITRE + DOCK_MARGE + ligne * (DOCK_HAUTEUR + DOCK_MARGE),
        width: DOCK_LARGEUR,
        height: DOCK_HAUTEUR,
    };
}

function calculerBornesZone(fenetre: BrowserWindow): Electron.Rectangle {
    const { width, height } = fenetre.getContentBounds();
    return {
        x: ZONE_MARGE,
        y: ZONE_HAUT,
        width: Math.max(0, width - ZONE_MARGE * 2),
        height: Math.max(0, height - ZONE_HAUT - ZONE_MARGE),
    };
}

// Recalcule et réapplique la position de toutes les vues actives d'une
// fenêtre (à l'ajout/retrait d'une tâche, ou au redimensionnement).
function reajusterVues(fenetre: BrowserWindow): void {
    let indice = 0;
    for (const id of ordreTachesActives(fenetre)) {
        const tache = taches.get(id);
        if (!tache) continue;
        if (tache.id === tacheEnZone) {
            tache.vue.setBounds(calculerBornesZone(fenetre));
        } else {
            tache.vue.setBounds(calculerBornesReduites(fenetre, indice));
            indice += 1;
        }
    }
}

function ordreTachesActives(fenetre: BrowserWindow): string[] {
    return Array.from(taches.values())
        .filter((t) => t.fenetre === fenetre)
        .map((t) => t.id);
}

const fenetresEcoutees = new WeakSet<BrowserWindow>();
function assurerEcouteRedimensionnement(fenetre: BrowserWindow): void {
    if (fenetresEcoutees.has(fenetre)) return;
    fenetresEcoutees.add(fenetre);
    const reajuster = () => reajusterVues(fenetre);
    fenetre.on('resize', reajuster);
    fenetre.on('maximize', reajuster);
    fenetre.on('unmaximize', reajuster);
    fenetre.on('closed', () => {
        fenetre.removeListener('resize', reajuster);
        fenetre.removeListener('maximize', reajuster);
        fenetre.removeListener('unmaximize', reajuster);
        arreterTachesDeFenetre(fenetre);
    });
}

// ---------------------------------------------------------------------
// Gestion de la "grande zone" (une seule tâche à la fois)
// ---------------------------------------------------------------------

function demanderZone(tache: TacheInterne): void {
    if (tacheEnZone === null) {
        tacheEnZone = tache.id;
    } else if (tacheEnZone !== tache.id && !filesAttenteZone.includes(tache.id)) {
        filesAttenteZone.push(tache.id);
    }
    reajusterVues(tache.fenetre);
}

function libererZoneSiPossible(idLibere: string, fenetre: BrowserWindow): void {
    if (tacheEnZone !== idLibere) {
        const posFile = filesAttenteZone.indexOf(idLibere);
        if (posFile !== -1) filesAttenteZone.splice(posFile, 1);
        return;
    }
    tacheEnZone = null;
    const prochainId = filesAttenteZone.shift();
    if (prochainId) {
        const prochaine = taches.get(prochainId);
        if (prochaine) {
            tacheEnZone = prochaine.id;
            notifierRenderer(prochaine, dernierMessageErreur.get(prochaine.id));
        }
    }
    reajusterVues(fenetre);
}

// Mémorise le dernier message d'erreur par tâche, pour pouvoir le
// réafficher si une tâche patientait en file avant de prendre la zone.
const dernierMessageErreur = new Map<string, string>();

// ---------------------------------------------------------------------
// Cycle de vie d'une tâche
// ---------------------------------------------------------------------

/**
 * Compare deux URLs sur pathname + search uniquement.
 * Le pathname actuel doit se terminer par le pathname attendu
 * (tolère les préfixes de locale, ex. /fr/examen/... ↔ /examen/...).
 * Les query strings doivent être strictement identiques.
 */
function urlsCompatibles(urlAttendu: string, urlActuel: string): boolean {
    try {
        const attendu = new URL(urlAttendu);
        const actuel = new URL(urlActuel);
        // Normalise les slash finaux pour éviter les faux négatifs
        const pathAttendu = attendu.pathname.replace(/\/+$/, '') || '/';
        const pathActuel = actuel.pathname.replace(/\/+$/, '') || '/';
        const cheminValide = pathActuel === pathAttendu || pathActuel.endsWith(pathAttendu);
        const paramsValides = actuel.search === attendu.search;
        return cheminValide && paramsValides;
    } catch {
        return false;
    }
}

function passerEnErreur(tache: TacheInterne, raison: string): void {
    if (tache.etat === 'termine' || tache.etat === 'arrete') return;
    if (tache.minuteur) {
        clearTimeout(tache.minuteur);
        tache.minuteur = null;
    }
    tache.etat = 'zone_erreur';
    dernierMessageErreur.set(tache.id, raison);
    tache.options.onEtat?.('zone_erreur', raison);
    demanderZone(tache);
    if (tacheEnZone === tache.id) {
        notifierRenderer(tache, raison);
    }
}

function demarrerMinuteur(tache: TacheInterne, messageDepassement: string): void {
    const delai = tache.options.delaiMaxMs ?? DELAI_PAR_DEFAUT_MS;
    tache.minuteur = setTimeout(() => {
        passerEnErreur(tache, messageDepassement);
    }, delai);
}

function injecter(tache: TacheInterne): void {
    if (tache.minuteur) {
        clearTimeout(tache.minuteur);
        tache.minuteur = null;
    }
    tache.etat = 'injecte';
    tache.options.onEtat?.('injecte');
    // La page correcte est chargée : si la tâche occupait la grande
    // zone, elle se referme et la vue reprend sa place en mode réduit.
    if (tacheEnZone === tache.id) {
        libererZoneSiPossible(tache.id, tache.fenetre);
    } else {
        reajusterVues(tache.fenetre);
    }
    notifierRenderer(tache);

    const delaiInjection = tache.options.delaiMaxMs ?? DELAI_PAR_DEFAUT_MS;
    let minuteurInjection: NodeJS.Timeout | null = null;
    const timeoutInjection = new Promise<never>((_resolve, reject) => {
        minuteurInjection = setTimeout(
            () => reject(new Error("Le délai d'attente est dépassé (aucune réponse du code injecté).")),
            delaiInjection
        );
    });

    Promise.race([
        tache.vue.webContents.executeJavaScript(tache.options.codeAInjecter),
        timeoutInjection,
    ])
        .then((valeur: any) => {
            // Nouveau modèle : le code injecté retourne directement sa
            // valeur (soit `null` en cas d'erreur détectée dans la page,
            // soit une chaîne JSON représentant le tableau de résultats),
            // qu'executeJavaScript() attend lui-même si c'est une Promise
            // (cas des codes qui doivent cliquer/patienter avant de
            // conclure — voir recupLien_tcf_ee.ts / recupLien_tcf_eo.ts).
            // Plus besoin d'attendre extraction:donnee / extraction:erreur
            // (canal conservé pour compatibilité, voir preloadExtraction.ts).
            //
            // `null` (ou `undefined`, si le code ne retourne rien du
            // tout) signifie que le code a détecté une erreur sur la
            // page (et non une réussite avec "rien à renvoyer") : ça doit
            // passer en zone d'erreur (message permanent, tant qu'on n'a
            // pas relancé ou arrêté), sans jamais appeler la fonction de
            // traitement (onDonnee) — pas seulement un warning en console.
            if (valeur === null || valeur === undefined) {
                passerEnErreur(tache, "Le code injecté n'a retourné aucune donnée.");
                return;
            }
            void finaliser(tache, valeur);
        })
        .catch((err: any) => {
            // Si une erreur plus précise a déjà été posée entre-temps
            // (ex: redirection détectée par did-navigate ci-dessus), on
            // garde CETTE raison-là plutôt que l'échec en cascade que
            // provoque généralement la navigation (ex: "Render frame was
            // disposed") — moins utile pour comprendre ce qui s'est passé.
            if (tache.etat === 'zone_erreur') return;
            passerEnErreur(tache, `Erreur lors de l'injection du code : ${err?.message ?? err}`);
        })
        .finally(() => {
            if (minuteurInjection) clearTimeout(minuteurInjection);
        });
}

async function finaliser(tache: TacheInterne, valeur: any): Promise<void> {
    // Si une erreur a déjà été posée entre-temps (ex: la page a redirigé
    // pendant qu'on attendait cette réponse, voir did-navigate plus bas),
    // une résolution tardive de l'ancienne exécution ne doit surtout pas
    // écraser cet état d'erreur en le faisant passer pour une réussite.
    if (tache.etat === 'termine' || tache.etat === 'arrete' || tache.etat === 'zone_erreur') return;
    if (tache.minuteur) {
        clearTimeout(tache.minuteur);
        tache.minuteur = null;
    }
    tache.etat = 'termine';
    tache.options.onEtat?.('termine');
    notifierRenderer(tache);

    // Le code injecté a déjà répondu : la page (webContentsView) n'a
    // plus aucune raison de rester ouverte pendant tout le traitement qui
    // suit (téléchargement des médias, génération des transformés...) —
    // elle se ferme MAINTENANT, avant même d'attendre onDonnee.
    // L'overlay de zoneExtractionDirecte.ts, lui, reste ouvert pendant
    // tout ce traitement (voir ecouteProgressionDonnee, côté renderer) :
    // c'est lui qui empêche toute autre action et qui affiche la
    // progression, jusqu'à ce que TOUT (images, audio, json) soit chargé.
    fermerTache(tache.id);

    try {
        await tache.options.onDonnee(valeur);
    } catch (err: any) {
        console.error(`extraction — échec du traitement post-extraction (${tache.id}) :`, err);
    }
}

function fermerTache(id: string): void {
    const tache = taches.get(id);
    if (!tache) return;
    if (tache.minuteur) clearTimeout(tache.minuteur);
    taches.delete(id);
    dernierMessageErreur.delete(id);
    const fenetre = tache.fenetre;
    try {
        fenetre.contentView.removeChildView(tache.vue);
    } catch {
        /* la fenêtre a peut-être déjà été fermée */
    }
    // removeChildView() ne fait que détacher la vue de l'arbre visuel :
    // le webContents sous-jacent continue de tourner tant qu'il n'est
    // pas explicitement fermé (JS, timers, et donc lecture audio/vidéo
    // qui continuerait indéfiniment en arrière-plan). close() est la
    // méthode dédiée pour un WebContents créé via WebContentsView (pas
    // de fenêtre à fermer pour déclencher ce nettoyage autrement).
    try {
        if (!tache.vue.webContents.isDestroyed()) {
            tache.vue.webContents.close();
        }
    } catch {
        /* déjà détruit, ou fenêtre déjà fermée */
    }
    libererZoneSiPossible(id, fenetre);
    reajusterVues(fenetre);
}

// ---------------------------------------------------------------------
// API publique
// ---------------------------------------------------------------------

export function lancerExtraction(
    fenetre: BrowserWindow,
    options: OptionsExtraction
): TacheExtractionHandle {
    assurerEcouteRedimensionnement(fenetre);

    const id = genererId();
    const vue = new WebContentsView({
        webPreferences: {
            partition: PARTITION_EXTRACTION,
            preload: path.join(__dirname, '../public/preloadExtraction.cjs'),
            contextIsolation: true,
            sandbox: false,
        },
    });

    const tache: TacheInterne = {
        id,
        options,
        fenetre,
        vue,
        etat: 'chargement',
        minuteur: null,
    };
    taches.set(id, tache);

    // Notifie le renderer TOUT DE SUITE, avant même d'ajouter la vue à
    // la fenêtre ou de commencer à charger quoi que ce soit : l'overlay
    // doit s'ouvrir avant le webview, jamais après.
    notifierRenderer(tache);

    fenetre.contentView.addChildView(vue);
    reajusterVues(fenetre);

    const cibleAttendue = options.url;

    // La page (bonne ou mauvaise) a fini de charger : c'est le seul
    // moment où l'on décide d'injecter ou de basculer en erreur. On
    // n'agit QUE si la tâche est encore en train de charger cette
    // navigation précise (tache.etat === 'chargement') : sinon, un
    // événement tardif (ex. la page finit de charger juste après que le
    // minuteur ait déjà fait passer la tâche en 'zone_erreur') relancerait
    // à tort l'injection et donnerait l'impression que "la page se
    // relance" juste après l'ouverture du message d'erreur.
    vue.webContents.on('did-finish-load', () => {
        if (tache.etat !== 'chargement') return;
        const urlActuelle = vue.webContents.getURL();
        if (urlsCompatibles(cibleAttendue, urlActuelle)) {
            injecter(tache);
        } else {
            passerEnErreur(tache, 'La page chargée ne correspond pas au lien attendu.');
        }
    });

    vue.webContents.on(
        'did-fail-load',
        (
            _event: Electron.Event,
            errorCode: number,
            errorDescription: string,
            _validatedURL: string,
            isMainFrame: boolean
        ) => {
            if (!isMainFrame) return;
            if (errorCode === -3) return; // ERR_ABORTED : navigation volontairement remplacée par une autre, pas une vraie erreur
            // Même restriction que did-finish-load ci-dessus : ignorer un
            // échec tardif qui ne concerne plus la navigation en cours.
            if (tache.etat !== 'chargement') return;
            passerEnErreur(
                tache,
                `Échec du chargement de la page : ${errorDescription} (${errorCode}).`
            );
        }
    );

    // Certaines pages chargent d'abord correctement le lien attendu, puis
    // redirigent/rechargent une autre page juste après (redirection
    // différée, souvent via un script ou un méta-refresh) — pile pendant
    // qu'on injecte le code ou qu'on attend sa réponse. Le résultat qui
    // arriverait alors concernerait une page différente : on surveille
    // donc TOUTE navigation survenant une fois le code injecté (état
    // 'injecte'), et on bascule en erreur dès que l'URL change, sans
    // attendre le délai. La surveillance reste active jusqu'à la réponse
    // ou le délai — c'est ici qu'on guette la redirection.
    // Comparaison pathname + search uniquement (tolère /fr/, /en/, etc.).
    vue.webContents.on('did-navigate', (_event: Electron.Event, urlNavigue: string) => {
        if (tache.etat !== 'injecte') return;
        if (urlsCompatibles(cibleAttendue, urlNavigue)) return;
        passerEnErreur(
            tache,
            'La page a redirigé vers une autre adresse pendant la récupération des données.'
        );
    });

    // Retour du code injecté (voir preloadExtraction.ts).
    vue.webContents.ipc.on('extraction:donnee', (_event: Electron.IpcMainEvent, valeur: any) => {
        void finaliser(tache, valeur);
    });
    vue.webContents.ipc.on('extraction:erreur', (_event: Electron.IpcMainEvent, message: any) => {
        passerEnErreur(tache, `Erreur signalée par le code injecté : ${message}`);
    });

    demarrerMinuteur(tache, "Le délai d'attente est dépassé (chargement de la page).");
    vue.webContents.loadURL(options.url);

    return {
        id,
        arreter: () => arreterTache(id),
    };
}

/** Recharge le lien cible d'une tâche actuellement en zone d'erreur (bouton "Relancer le site"). */
export function relancerTache(id: string): void {
    const tache = taches.get(id);
    if (!tache || tache.etat === 'termine' || tache.etat === 'arrete') return;
    if (tache.minuteur) {
        clearTimeout(tache.minuteur);
        tache.minuteur = null;
    }
    tache.etat = 'chargement';
    tache.options.onEtat?.('chargement');
    notifierRenderer(tache);
    demarrerMinuteur(tache, "Le délai d'attente est dépassé (chargement de la page).");
    tache.vue.webContents.loadURL(tache.options.url);
}

/** Annule définitivement une tâche (bouton "Arrêter l'opération"). */
export function arreterTache(id: string): void {
    const tache = taches.get(id);
    if (!tache) return;
    if (tache.etat === 'termine' || tache.etat === 'arrete') return;
    tache.etat = 'arrete';
    tache.options.onEtat?.('arrete');
    notifierRenderer(tache);
    fermerTache(id);
}

/** Annule toutes les tâches d'une fenêtre (à sa fermeture). */
export function arreterTachesDeFenetre(fenetre: BrowserWindow): void {
    for (const tache of Array.from(taches.values())) {
        if (tache.fenetre === fenetre) arreterTache(tache.id);
    }
}

// ---------------------------------------------------------------------
// Initialisation unique, à appeler depuis main.ts (une seule fois, après
// la création de la fenêtre principale). Regroupe tout le câblage :
// relais des changements d'état vers le renderer, et écoute des actions
// du bandeau ("Relancer le site" / "Arrêter l'opération"). Aucun autre
// branchement IPC lié à l'extraction directe n'est nécessaire ailleurs.
// ---------------------------------------------------------------------
let dejaInitialise = false;
export function initExtractionDirecte(fenetre: BrowserWindow): void {
    definirEnvoiRenderer((canal, ...args) => {
        fenetre.webContents.send(canal, ...args);
    });
    // Prévient zoneExtract.ts (via extraction:liens-maj) chaque fois
    // qu'une liste de liens vient d'être fusionnée/enregistrée, pour
    // qu'il rafraîchisse l'affichage de la page concernée.
    definirNotifieurMajLiens((idActu, liens) => {
        fenetre.webContents.send('extraction:liens-maj', idActu, liens);
    });
    // Prévient zoneExtract.ts (message temporaire) et zoneAccueil.ts
    // (rafraîchissement de la carte) une fois l'enregistrement d'une
    // donnée terminé (succès ou échec).
    definirNotifieurDonneeTraitee((idActu, info) => {
        fenetre.webContents.send('extraction:donnee-traitee', idActu, info);
    });
    // Progression pendant le traitement post-extraction
    // (téléchargements TEF, génération des transformés, etc.).
    // Côté renderer : écouter 'extraction:donnee-progression'
    // → info = { etape, message, detail? }
    definirNotifieurProgressionDonnee((idActu, info) => {
        fenetre.webContents.send('extraction:donnee-progression', idActu, info);
    });
    initOutil(); // initialiser les data utilisées pour la récupération
    if (dejaInitialise) return;
    dejaInitialise = true;

    // "Codes d'injection" (module 02 de zoneParam.ts -> majCodesEcoute.ts) :
    // télécharge la dernière version des 3 dictionnaires depuis le Gist
    // GitHub, les applique en mémoire et les enregistre sur disque (voir
    // mettreAJourCodesExtraction dans outi_exract.ts), puis renvoie le
    // bilan au renderer pour fermer la zoneBloquante et afficher un
    // message temporaire (succès ou erreur).
    ipcMain.on('outil-extract:maj', async () => {
        const resultat = await mettreAJourCodesExtraction();
        fenetre.webContents.send('outil-extract:maj-fin', resultat);
    });

    ipcMain.on('extraction:relancer', (_event, id: string) => {
        relancerTache(id);
    });
    ipcMain.on('extraction:arreter', (_event, id: string) => {
        arreterTache(id);
    });

    // Charge la liste des liens déjà enregistrés pour un idActu (appelé
    // par zoneExtract.ts à l'initialisation de chaque page, pour
    // afficher tout de suite ce qui a déjà été extrait précédemment).
    ipcMain.handle('extraction:listerLiens', async (_event, idActu: string) => {
        // Enrichit chaque lien avec `aDossier` : vrai si ce lien a déjà
        // un dossier de donnée associé (voir possedeDonnee dans
        // outi_exract.ts), pour permettre à zoneExtract.ts de distinguer
        // visuellement les liens déjà traités des autres.
        return getNomLien(idActu).map((lien) => ({
            ...lien,
            aDossier: possedeDonnee(idActu, lien.id),
        }));
    });

    // "Actualiser liste" (voir ActualisableList dans zoneExtract.ts) :
    // ouvre la page principale du type demandé (idActu, ex: "tcf-ce")
    // dans une vue d'extraction directe.
    ipcMain.on('extraction:recupLien', (_event, idActu: string) => {
        const url = dataLienPincipale[idActu];
        if (!url) {
            console.warn(`extraction:recupLien — identifiant inconnu : "${idActu}"`);
            return;
        }
        lancerExtraction(fenetre, {
            url,
            codeAInjecter: dataCodeRecupLien[idActu] ?? '',
            onDonnee: dataManipLien[idActu],
        });
    });

    // Clic sur le NOM d'un lien déjà extrait (voir actualiseItem dans
    // zoneExtract.ts) : ouvre CE lien précis et y injecte le code de
    // récupération de contenu (dataCodeRecupDonnee[idActu]), puis confie
    // le résultat à dataManipDonne[idActu] (voir outi_exract.ts), qui
    // crée ou met à jour la série correspondante.
    ipcMain.on(
        'extraction:recupDonnee',
        async (_event, args: { idActu: string; idItem: string }) => {
            const { idActu, idItem } = args;
            const gestionnaire = dataManipDonne[idActu];
            if (!gestionnaire) {
                console.warn(`extraction:recupDonnee — identifiant inconnu : "${idActu}"`);
                return;
            }
            const lien = getLien(idActu, idItem);
            if (!lien) {
                console.warn(
                    `extraction:recupDonnee — lien introuvable ("${idActu}", "${idItem}").`
                );
                return;
            }
            lancerExtraction(fenetre, {
                url: lien,
                codeAInjecter: dataCodeRecupDonnee[idActu] ?? '',
                onDonnee: (valeur) => gestionnaire(valeur, idActu, idItem),
            });
        }
    );

    //initialmisation des la recuperation des elemnt du zip
    ipcMain.handle("extraction:prendre_dans_zip", async (_evnt, arg = null) => {
        return integrerSujet((message) => fenetre.webContents.send("message-overlay", message));
    });
}