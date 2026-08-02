import { session as electronSession } from 'electron';
import type { Session, BrowserWindow } from 'electron';
import { ipcMain } from 'electron';
import { getRef } from './gardienRef.js';

import {
    recupererTransformeEtCheminTefCe,
    recupererTransformeEtCheminTefCo,
    recupererTransformeEtCheminTefEe,
    recupererTransformeEtCheminTefEo,
    getNomSeries,
} from './conserveurDonne.js';
import { recupererTransformeEtCheminTcfCe, listerCartesTcfCe } from './donnee_tcf_ce.js';
import { recupererTransformeEtCheminTcfCo, listerCartesTcfCo } from './donnee_tcf_co.js';
import { recupererTransformeEtCheminTcfEe, listerCartesTcfEe } from './donnee_tcf_ee.js';
import { recupererTransformeEtCheminTcfEo, listerCartesTcfEo } from './donnee_tcf_eo.js';

import {
    decouperSerieEtTest,
    arrangerComprehension,
    arrangerTcfCe,
    arrangerEE,
    arrangerEO,
    arrangerTcfEeOuEo,
    type ResultatArrangement,
    type TypeEpreuve,
    type Examen,
} from '../exporteur/arrangeExport.js';
import { envoyerUnique } from '../exporteur/export_unique.js';
import { envoyerProgressif } from '../exporteur/export_progressif.js';
// Import de type UNIQUEMENT (aucun code renderer chargé côté main) :
// voir ZoneExport dans exportEcoute.ts ('tcf-ce' .. 'tef-eo').
import type { ZoneExport } from '../varUni.js';


export const PARTITION_EXPORT = 'persist:site-recuperateur';
const idRef = "outil_exportation";

let feneTreGbl: BrowserWindow;

// Renseigné par main.ts (setOuvreVueCallback) : permet d'ouvrir la
// WebContentsView de connexion depuis ici dès qu'une exportation est
// demandée sans session déjà valide, sans dépendance circulaire vers
// main.ts (qui, lui, importe déjà ce fichier).
let onDemandeOuvertureVue: (() => void) | null = null;
export const setOuvreVueCallback = (fn: () => void) => {
    onDemandeOuvertureVue = fn;
};

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

export const getLien = (type: "connect" | "tcf" | "tef") => {
    const dataOutil = getRef(idRef);
    return dataOutil[`url-${dataOutil["mode"]}-${type}`];
}

// ---------------------------------------------------------------------
// Lecture du transformé + du nom affichable d'UN élément, quelle que
// soit sa zone (tcf-ce -> tef-eo) : c'est ce nom affichable qui sert
// ensuite à déduire ss/tt (voir decouperSerieEtTest, arrangeExport.ts).
// ---------------------------------------------------------------------

interface DonneesElement {
    success: boolean;
    transforme?: any;
    cheminDossier?: string;
    nom?: string;
    error?: string;
}

async function lireElementPourExport(examen: Examen, type: TypeEpreuve, id: string): Promise<DonneesElement> {
    if (examen === 'tef') {
        const lecteur = {
            ce: recupererTransformeEtCheminTefCe,
            co: recupererTransformeEtCheminTefCo,
            ee: recupererTransformeEtCheminTefEe,
            eo: recupererTransformeEtCheminTefEo,
        }[type];
        const resultat = await lecteur(id);
        if (!resultat.success) return { success: false, error: resultat.error ?? 'Donnée introuvable.' };
        const nom = getNomSeries(type).find((s) => s.id === id)?.nom ?? id;
        return { success: true, transforme: resultat.transforme, cheminDossier: resultat.cheminDossier, nom };
    }

    // TCF
    if (type === 'ce') {
        const resultat = await recupererTransformeEtCheminTcfCe(id);
        if (!resultat.success) return { success: false, error: resultat.error ?? 'Donnée introuvable.' };
        const nom = listerCartesTcfCe().find((c) => c.id === id)?.nom ?? id;
        return { success: true, transforme: resultat.transforme, cheminDossier: resultat.cheminDossier, nom };
    }
    if (type === 'co') {
        const resultat = await recupererTransformeEtCheminTcfCo(id);
        if (!resultat.success) return { success: false, error: resultat.error ?? 'Donnée introuvable.' };
        const nom = listerCartesTcfCo().find((c) => c.id === id)?.nom ?? id;
        return { success: true, transforme: resultat.transforme, cheminDossier: resultat.cheminDossier, nom };
    }
    if (type === 'ee') {
        const resultat = await recupererTransformeEtCheminTcfEe(id);
        if (!resultat.success) return { success: false, error: resultat.error ?? 'Donnée introuvable.' };
        const nom = listerCartesTcfEe().find((c) => c.id === id)?.nom ?? id;
        return { success: true, transforme: resultat.transforme, cheminDossier: resultat.cheminDossier, nom };
    }
    const resultat = await recupererTransformeEtCheminTcfEo(id);
    if (!resultat.success) return { success: false, error: resultat.error ?? 'Donnée introuvable.' };
    const nom = listerCartesTcfEo().find((c) => c.id === id)?.nom ?? id;
    return { success: true, transforme: resultat.transforme, cheminDossier: resultat.cheminDossier, nom };
}

// ---------------------------------------------------------------------
// Arrangement : dispatch vers la bonne fonction d'arrangeExport.ts
// selon (examen, type). TCF · CO réutilise l'arrangement CE/CO commun
// (même format de transformé que le TEF, voir donnee_tcf_co.ts) ;
// TCF · CE a son propre arrangement (format dédié) ; TCF · EE/EO
// également (voir arrangerTcfEeOuEo).
// ---------------------------------------------------------------------

async function arrangerElement(
    examen: Examen,
    type: TypeEpreuve,
    transforme: any,
    cheminDossier: string,
    ss: string,
    tt: string
): Promise<ResultatArrangement> {
    if (type === 'ce' && examen === 'tef') return arrangerComprehension(transforme, 'ce', cheminDossier, ss, tt);
    if (type === 'co') return arrangerComprehension(transforme, 'co', cheminDossier, ss, tt);
    if (type === 'ce' && examen === 'tcf') return arrangerTcfCe(transforme, cheminDossier, ss, tt);
    if (type === 'ee' && examen === 'tef') return arrangerEE(transforme, ss, tt);
    if (type === 'eo' && examen === 'tef') return arrangerEO(transforme, cheminDossier, ss, tt);
    // TCF · EE ou EO
    return arrangerTcfEeOuEo(transforme, type as 'ee' | 'eo', ss, tt);
}

export const initExporteur = (feneTre: BrowserWindow) => {
    feneTreGbl = feneTre;
    const dataOutil = getRef(idRef);

    //initialisation des outil d'exportation
    if ([...Object.keys(dataOutil)].length <= 0) {
        dataOutil["mode"] = "defaut";
        dataOutil["url-defaut-tcf"] = "https://dashboard.mes4c2-tcfcanada.com/auth/saveAll.php";
        dataOutil["url-defaut-tef"] = "https://dashboard.mes4c2-tcfcanada.com/auth/saveAll2.php";
        dataOutil["url-defaut-connect"] = "https://dashboard.mes4c2-tcfcanada.com/";
        dataOutil["url-perso-tcf"] = "";
        dataOutil["url-perso-tef"] = "";
        dataOutil["url-perso-connect"] = "";
    }

    //gestion des ecouteurs pour la recuperation des references dans le renderer 
    ipcMain.handle('param:recup-ref', async () => {
        return {
            ["mode"]: dataOutil["mode"],
            ["url-perso-tcf"]: dataOutil["url-perso-tcf"],
            ["url-perso-tef"]: dataOutil["url-perso-connect"],
            ["url-perso-connect"]: dataOutil["url-perso-connect"]
        };
    });

    //---->>  gestion des ecouteurs d'enregistrement des referecnce venant du renderer

    ipcMain.on('param:mode', (_event, mode: string) => {
        dataOutil["mode"] = mode;
    });

    ipcMain.on('param:url', (_event, info: { type: string, valeur: string }) => {
        dataOutil[`url-perso-${info.type}`] = info.valeur;
    });

    //----->> gestion de l'exportation d'UN élément (une carte / une série)
    //
    // `info.zone` est de la forme "tcf-ce" .. "tef-eo" (voir ZoneExport,
    // exportEcoute.ts côté renderer) : on en déduit l'examen et le type.
    // `info.id` identifie l'élément dans cette zone.
    ipcMain.on('export-ecoute:lancer', async (_event, info: { zone: ZoneExport; id: string }) => {
        const [examen, type] = info.zone.split('-') as [Examen, TypeEpreuve];

        try {
            // 1) Session sur le site distant : si absente, on ne peut
            // rien envoyer -> on prévient le renderer (payload `null`,
            // voir le contrat de exportEcoute.ts) et on ouvre la zone de
            // connexion.
            const aSession = await possedeSessionExport();
            if (!aSession) {
                feneTreGbl.webContents.send('export-ecoute:fin', null);
                onDemandeOuvertureVue?.();
                return;
            }

            // 2) Lecture du transformé + du nom affichable de l'élément.
            const element = await lireElementPourExport(examen, type, info.id);
            if (!element.success || !element.transforme) {
                feneTreGbl.webContents.send('export-ecoute:fin', {
                    type: info.zone,
                    correct: false,
                    message: element.error ?? 'Donnée introuvable.',
                });
                return;
            }

            // 3) Arrangement (mise en forme + vérification) propre au
            // couple examen/type.
            const { ss, tt } = decouperSerieEtTest(element.nom ?? info.id);
            const arrangement = await arrangerElement(
                examen,
                type,
                element.transforme,
                element.cheminDossier ?? '',
                ss,
                tt
            );

            if (arrangement.erreur || arrangement.paquets.length === 0) {
                feneTreGbl.webContents.send('export-ecoute:fin', {
                    type: info.zone,
                    correct: false,
                    message: arrangement.erreur ?? 'Rien à exporter.',
                });
                return;
            }

            // 4) Envoi effectif : un seul fetch (EE/EO) ou une suite de
            // fetch envoyés l'un après l'autre, question par question
            // (CE/CO), avec arrêt net à la première erreur.
            const session = obtenirSessionExport();
            const url = getLien(examen);

            if (arrangement.mode === 'unique') {
                const resultat = await envoyerUnique(session, url, arrangement.paquets[0]);
                feneTreGbl.webContents.send('export-ecoute:fin', {
                    type: info.zone,
                    correct: resultat.success,
                    message: resultat.success
                        ? 'Exportation réussie.'
                        : (resultat.error ?? "Erreur lors de l'exportation."),
                });
            } else {
                const resultat = await envoyerProgressif(session, url, arrangement.paquets);
                feneTreGbl.webContents.send('export-ecoute:fin', {
                    type: info.zone,
                    correct: resultat.success,
                    message: resultat.success
                        ? `Exportation réussie (${resultat.nbEnvoyes} question(s)).`
                        : (resultat.dernierResultat?.error ?? "Erreur lors de l'exportation."),
                });
            }
        } catch (err: any) {
            feneTreGbl.webContents.send('export-ecoute:fin', {
                type: info.zone,
                correct: false,
                message: err?.message ?? String(err),
            });
        }
    });

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
        const cookies = await obtenirSessionExport().cookies.get({ url: getLien("connect") });
        return cookies.length > 0;
    } catch {
        return false;
    }
}

// ---------------------------------------------------------------------
// Détection de connexion réussie dans la vue de connexion (voir
// main.ts::ouvreView) : combine un cookie posé pour l'hôte du site
// récupérateur ET une navigation qui quitte l'URL initiale de la page
// de connexion (reprend le principe de l'ancien exportSite.ts).
// ---------------------------------------------------------------------

function hoteCorrespond(domaineCookie: string, hoteCible: string): boolean {
    const nettoye = (domaineCookie || '').replace(/^\./, '');
    return hoteCible === nettoye || hoteCible.endsWith(`.${nettoye}`);
}

export function ecouteConnexionExport(
    webContents: Electron.WebContents,
    onSessionDetectee: () => void
): () => void {
    const session = obtenirSessionExport();
    const hoteCible = new URL(getLien('connect')).hostname;
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
