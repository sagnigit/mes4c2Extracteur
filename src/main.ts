import { app, BrowserWindow, WebContentsView } from 'electron';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { ipcMain } from 'electron';
import { creerWebContentsViewDansFenetre } from './backend/creeView.js';

import {
    initExporteur,
    PARTITION_EXPORT,
    clearAllExportStorage,
    getLien,
    setOuvreVueCallback,
    ecouteConnexionExport,
} from './backend/gestion_export.js';
import { initExtractionDirecte, arreterTachesDeFenetre } from './backend/extractionDirecte.js';
import { chargeRef, enregistreRef } from './backend/gardienRef.js';
import { initialiserMiseAJour } from './backend/autoUpdate.js';
// ---------------------------------------------------------------------
// Affichage de l'accueil (zoneAccueil / zoneAccueilTef / zoneAff) :
// les données CE/CO/EE/EO de TCF comme de TEF sont désormais récupérées
// exclusivement depuis le dossier "conserveur" (conserveurDonne.ts),
// via les canaux IPC 'conserveur:*' dédiés ci-dessous. L'ancien système
// par dossier "donnee" (donneeSeries.ts, canaux IPC 'donnee:*') a été
// retiré : plus aucun écran ne l'appelait (l'export passe par
// gestion_export.ts / demanderExport, pas par ce module).
import {
    TypeEpreuve,
    getNomSeries,
    lireCoupleDonnees as lireCoupleDonneesConserveur,
    lireTransformData as lireTransformDataConserveur,
    sauvegarderTransformCeOuCo as sauvegarderTransformCeOuCoConserveur,
    sauvegarderTransformEE as sauvegarderTransformEEConserveur,
    sauvegarderTransformEO as sauvegarderTransformEOConserveur,
    genererTransformationsManquantes as genererTransformationsManquantesConserveur,
    synchroniserRefsDepuisDisque,
} from './backend/conserveurDonne.js';
// TCF EO passe désormais exclusivement par son propre module dédié
// (voir donnee_tcf_eo.ts) : conserveurDonne.ts n'est pas impliqué pour
// cette donnée-là.
import {
    listerCartesTcfEo,
    lireDonneeTcfEo,
    sauvegarderTransformeTcfEo,
} from './backend/donnee_tcf_eo.js';
// TCF EE suit exactement le même principe (voir donnee_tcf_ee.ts).
import {
    listerCartesTcfEe,
    lireDonneeTcfEe,
    sauvegarderTransformeTcfEe,
} from './backend/donnee_tcf_ee.js';
// TCF CE suit lui aussi ce même principe (voir donnee_tcf_ce.ts) : un
// dossier tcf_ce_... = une carte, transformé = copie de l'extrait dont
// seul enonce peut devenir une image (composée côté renderer, voir
// enregistrerImageEnonceTcfCe).
import {
    listerCartesTcfCe,
    lireDonneeTcfCe,
    sauvegarderTransformeTcfCe,
    enregistrerImageEnonceTcfCe,
} from './backend/donnee_tcf_ce.js';
// TCF CO, lui, RÉUTILISE l'affichage commun de zoneAff.ts (comme le
// TEF) au lieu d'avoir sa propre page dédiée — seules ces 4 fonctions
// (format d'affichage identique au TEF) sont branchées ci-dessous sur
// les canaux 'conserveur:*' lorsque examen === 'tcf' && type === 'co'.
import {
    listerCartesTcfCo,
    lireCoupleAffichageTcfCo,
    lireTransformeAffichageTcfCo,
    sauvegarderTransformePartielTcfCo,
} from './backend/donnee_tcf_co.js';


// Recréation de __filename et __dirname en ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let mainWindow: BrowserWindow | null = null;

//view 

const optionView = {
    marge: { haut: 57, droite: 0, bas: 0, gauche: 0 },
    viewOptions: {
        webPreferences: {
            partition: PARTITION_EXPORT
        }
    },
    url: getLien("connect"),
};

let leView: WebContentsView | null = null;
let arreterEcouteConnexion: (() => void) | null = null;

const ouvreView = () => {
    if (!leView) {
        // La vue doit toujours repartir de la page de connexion (au cas où
        // une précédente ouverture aurait navigué ailleurs) : on la
        // reconstruit avec l'URL courante à chaque ouverture.
        optionView.url = getLien('connect');
        leView = creerWebContentsViewDansFenetre((mainWindow as BrowserWindow), optionView);

        // Dès que la connexion faite dans la vue aboutit (cookie posé ou
        // redirection hors de la page de connexion), on ferme la vue et on
        // prévient le renderer, qui peut alors relancer l'exportation
        // demandée initialement (nouveau clic sur "Exporter").
        arreterEcouteConnexion = ecouteConnexionExport(leView.webContents, () => {
            mainWindow?.webContents.send('export:session-detectee');
            fermeView();
        });
    }
}

const fermeView = () => {
    if (arreterEcouteConnexion) {
        arreterEcouteConnexion();
        arreterEcouteConnexion = null;
    }
    if (leView) {
        mainWindow?.contentView.removeChildView((leView as WebContentsView));
        leView = null;
    }
}

ipcMain.on('ferme-view', () => {
    fermeView()
});

function createWindow() {
    const minLarg = 1100;
    const minHaut = 650;
    mainWindow = new BrowserWindow({
        width: minLarg,
        height: minHaut,
        minWidth: minLarg,
        minHeight: minHaut,
        frame: false, // supprime la barre de titre par défaut
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: true, // recommandé pour la sécurité
            preload: path.join(__dirname, '../public/preload.cjs')
        },
        title: "Mes4C2 - Extracteur",
        icon: path.join(__dirname, "../public/assets/logo.ico")
    });

    const nomFichierHtml = path.join(__dirname, '../public/index.html');

    // Charger le fichier index.html
    mainWindow.loadFile(nomFichierHtml);

    //chargement des reference pour la gstion des creation et recuperation des dosier et autre
    chargeRef();

    // Toute la gestion de l'extraction directe (ouverture de la
    // WebContentsView d'injection, écoutes did-finish-load/did-fail-load,
    // IPC retour de donnée, relais vers le renderer, boutons
    // "Relancer"/"Arrêter") est isolée dans extractionDirecte.ts.
    initExtractionDirecte(mainWindow);

    //on initialise les ecoute et les element d'exportations
    initExporteur(mainWindow);
    // Permet à gestion_export.ts d'ouvrir la zone de connexion lui-même
    // dès qu'une exportation est demandée sans session valide.
    setOuvreVueCallback(ouvreView);

    // Branche l'écoute 'update:verifier' et les événements
    // electron-updater sur cette fenêtre (voir zoneParam.ts /
    // updateEcoute.ts côté renderer pour le déclenchement).
    initialiserMiseAJour(mainWindow);

    // Ouvrir les DevTools détachés
    mainWindow.webContents.openDevTools({ mode: 'detach' });

    mainWindow.on('closed', async () => {
        mainWindow = null;
    });

    ipcMain.on('window-refresh', () => {
        fermeView()
        mainWindow?.loadFile(nomFichierHtml);
    });

    ipcMain.on('window-minimize', () => {
        mainWindow?.minimize();
    });

    ipcMain.on('window-close', () => {
        mainWindow?.close();
    });

    ipcMain.on('actualise-graph', () => {
        mainWindow?.webContents.send('window-maximized', mainWindow.isMaximized());
    });

    ipcMain.on('window-toggle-maximize', () => {
        if (mainWindow) {
            if (mainWindow.isMaximized()) {
                mainWindow.unmaximize();
                mainWindow.webContents.send('window-maximized', false);
            } else {
                mainWindow.maximize();
                mainWindow.webContents.send('window-maximized', true);
            }
        }
    });

    // --- IPC : affichage de l'accueil (dossier "conserveur", voir
    // conserveurDonne.ts) — seule source de données désormais utilisée
    // par zoneAccueil / zoneAccueilTef / zoneAff pour CE/CO/EE/EO,
    // TCF comme TEF. ---

    ipcMain.handle(
        'conserveur:list-series',
        async (_event, args: { examen?: 'tef' | 'tcf'; type: TypeEpreuve }) => {
            // TCF · CO : dossiers "tcf_co_..." (donnee_tcf_co.ts), pas le
            // système générique TEF (conserveurDonne.ts) — voir le
            // commentaire d'en-tête plus haut sur l'import de donnee_tcf_co.js.
            if (args.examen === 'tcf' && args.type === 'co') {
                return listerCartesTcfCo().map((c) => ({
                    id: c.id,
                    nom: c.nom,
                    examen: 'tcf' as const,
                    type: 'co' as const,
                }));
            }
            return getNomSeries(args.type);
        }
    );

    ipcMain.handle(
        'conserveur:read-couple',
        async (_event, args: { examen?: 'tef' | 'tcf'; type: TypeEpreuve; id: string }) => {
            if (args.examen === 'tcf' && args.type === 'co') {
                return lireCoupleAffichageTcfCo(args.id);
            }
            return lireCoupleDonneesConserveur(args.type, args.id);
        }
    );

    ipcMain.handle(
        'conserveur:read-transform',
        async (_event, args: { examen?: 'tef' | 'tcf'; type: TypeEpreuve; id: string }) => {
            if (args.examen === 'tcf' && args.type === 'co') {
                return lireTransformeAffichageTcfCo(args.id);
            }
            try {
                const transforme = await lireTransformDataConserveur(args.type, args.id);
                return { success: true, transforme };
            } catch (err: any) {
                return { success: false, error: err?.message ?? String(err) };
            }
        }
    );

    ipcMain.handle(
        'conserveur:save-transform',
        async (_event, args: { examen?: 'tef' | 'tcf'; type: TypeEpreuve; id: string; donnees: any }) => {
            if (args.examen === 'tcf' && args.type === 'co') {
                return sauvegarderTransformePartielTcfCo(args.id, args.donnees);
            }
            if (args.type === 'ce' || args.type === 'co') {
                return sauvegarderTransformCeOuCoConserveur(args.type, args.id, args.donnees);
            }
            if (args.type === 'ee') {
                return sauvegarderTransformEEConserveur(args.id, args.donnees);
            }
            return sauvegarderTransformEOConserveur(args.id, args.donnees);
        }
    );

    // --- IPC : données TCF EO (dossier "conserveur", mais via le module
    // dédié donnee_tcf_eo.ts — un dossier = une carte, voir ce fichier) ---

    ipcMain.handle('tcf-eo:list', async () => {
        return listerCartesTcfEo();
    });

    ipcMain.handle('tcf-eo:read', async (_event, idLien: string) => {
        return lireDonneeTcfEo(idLien);
    });

    ipcMain.handle('tcf-eo:save-transform', async (_event, args: { idLien: string; parties: any[] }) => {
        return sauvegarderTransformeTcfEo(args.idLien, args.parties);
    });

    // --- IPC : données TCF EE (dossier "conserveur", mais via le module
    // dédié donnee_tcf_ee.ts — un dossier = une carte, voir ce fichier) ---

    ipcMain.handle('tcf-ee:list', async () => {
        return listerCartesTcfEe();
    });

    ipcMain.handle('tcf-ee:read', async (_event, idLien: string) => {
        return lireDonneeTcfEe(idLien);
    });

    ipcMain.handle('tcf-ee:save-transform', async (_event, args: { idLien: string; parties: any[] }) => {
        return sauvegarderTransformeTcfEe(args.idLien, args.parties);
    });

    // --- IPC : données TCF CE (dossier "conserveur", mais via le module
    // dédié donnee_tcf_ce.ts — un dossier = une carte, voir ce fichier) ---

    ipcMain.handle('tcf-ce:list', async () => {
        return listerCartesTcfCe();
    });

    ipcMain.handle('tcf-ce:read', async (_event, idLien: string) => {
        return lireDonneeTcfCe(idLien);
    });

    ipcMain.handle('tcf-ce:save-transform', async (_event, args: { idLien: string; questions: any[] }) => {
        return sauvegarderTransformeTcfCe(args.idLien, args.questions);
    });

    ipcMain.handle(
        'tcf-ce:save-image',
        async (_event, args: { idLien: string; indexQuestion: number; donneeBase64: string; extension: string }) => {
            return enregistrerImageEnonceTcfCe(args.idLien, args.indexQuestion, args.donneeBase64, args.extension);
        }
    );

}

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
    app.quit();
} else {
    app.on('second-instance', () => {
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.focus();
        }
    });

    app.on('ready', async () => {
        // La base doit être prête et les routes IPC enregistrées AVANT
        // d'ouvrir la fenêtre, sinon le renderer pourrait appeler
        // window.api.invoke(...) avant que main.ts sache y répondre.

        // Dossier "conserveur" (accueil) : synchronise les références à
        // partir du disque puis génère les transformés manquants, pour
        // que l'accueil ait tout de suite des cartes à jour.
        await synchroniserRefsDepuisDisque();
        await genererTransformationsManquantesConserveur();

        createWindow();
    });

    app.on('window-all-closed', () => {
        if (process.platform !== 'darwin') {
            app.quit();
        }
    });

    app.on('activate', () => {
        if (mainWindow === null) {
            createWindow();
        }
    });

    app.on('before-quit', async () => {
        // Annule toute extraction en cours (ferme sa WebContentsView,
        // arrête son minuteur) avant que la fenêtre ne soit détruite.
        enregistreRef();
        if (mainWindow) {
            arreterTachesDeFenetre(mainWindow);
        }
        await clearAllExportStorage();
    });
}
/*
AQ.Ab8RN6KqbAu7JTr9rIZN5aI13Hn2f9_YKul7HAgsNt95jUJ76A
*/