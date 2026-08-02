// autoUpdate.ts
//
// Mise à jour automatique de l'application via electron-updater, à
// partir des GitHub Releases du dépôt configuré dans le champ "build"
// (clé "publish") de package.json.
//
// Ce module n'est PAS branché automatiquement : à appeler soi-même
// depuis main.ts, une fois la fenêtre principale créée :
//
//   import { initialiserMiseAJour } from './backend/autoUpdate.js';
//   initialiserMiseAJour(mainWindow);
//
// Déroulement :
// - Le renderer déclenche la vérification en envoyant l'IPC
//   'update:verifier' (ex: clic sur un bouton "Vérifier les mises à
//   jour" dans une zone Paramètres).
// - Si une mise à jour est disponible : elle est téléchargée
//   automatiquement (autoDownload), puis, une fois le téléchargement
//   terminé, l'application se ferme et relance elle-même après
//   installation (autoUpdater.quitAndInstall).
// - Si l'application est déjà à jour : un message est renvoyé au
//   renderer sur le canal 'update:statut' avec { statut: 'a-jour' }.
// - En cas d'erreur (réseau, dépôt introuvable...) : 'update:statut'
//   avec { statut: 'erreur', message }.
//
// Remarque : electron-updater ne fonctionne que sur une application
// EMPAQUETÉE (via "npm run dist", voir package.json) — en mode
// développement ("npm start"), checkForUpdates() échoue silencieusement
// ou renvoie une erreur, ce qui est normal.

import { ipcMain, BrowserWindow } from 'electron';
// electron-updater est un module CommonJS : sous Node en mode ESM
// ("type": "module" dans package.json), il n'expose PAS de named
// exports fiables (l'erreur "Named export 'autoUpdater' not found"
// vient de là). Il faut importer le module par défaut puis en extraire
// autoUpdater soi-même.
import electronUpdater from 'electron-updater';
const { autoUpdater } = electronUpdater;

export type StatutMiseAJour =
    | { statut: 'verification' }
    | { statut: 'a-jour' }
    | { statut: 'telechargement'; pourcentage: number }
    | { statut: 'pret-a-installer' }
    | { statut: 'erreur'; message: string };

let dejaInitialise = false;

/**
 * Branche l'écoute IPC ('update:verifier') et les événements
 * d'electron-updater sur la fenêtre donnée. À appeler une seule fois,
 * après la création de la fenêtre principale. Les appels suivants sont
 * ignorés (pas de double écoute).
 */
export const initialiserMiseAJour = (fenetrePrincipale: BrowserWindow): void => {
    if (dejaInitialise) return;
    dejaInitialise = true;

    // On gère nous-mêmes la fermeture/relance (voir 'update-downloaded'
    // ci-dessous) plutôt que de laisser electron-updater le faire à la
    // fermeture naturelle de l'application.
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = false;

    const envoyerStatut = (statut: StatutMiseAJour): void => {
        if (!fenetrePrincipale.isDestroyed()) {
            fenetrePrincipale.webContents.send('update:statut', statut);
        }
    };

    autoUpdater.on('checking-for-update', () => {
        envoyerStatut({ statut: 'verification' });
    });

    // Aucune mise à jour trouvée : l'application est déjà à jour.
    autoUpdater.on('update-not-available', () => {
        envoyerStatut({ statut: 'a-jour' });
    });

    autoUpdater.on('download-progress', (progression) => {
        envoyerStatut({
            statut: 'telechargement',
            pourcentage: Math.round(progression.percent),
        });
    });

    // Téléchargement terminé : on prévient le renderer puis on ferme
    // l'application ; electron-updater installe la mise à jour et
    // relance automatiquement l'application ensuite (second argument
    // "true" de quitAndInstall = relance forcée après installation).
    autoUpdater.on('update-downloaded', () => {
        envoyerStatut({ statut: 'pret-a-installer' });
        autoUpdater.quitAndInstall(false, true);
    });

    autoUpdater.on('error', (err) => {
        envoyerStatut({ statut: 'erreur', message: err?.message ?? String(err) });
    });

    // --- Déclenchement depuis le renderer ---
    ipcMain.on('update:verifier', () => {
        autoUpdater.checkForUpdates().catch((err) => {
            envoyerStatut({ statut: 'erreur', message: err?.message ?? String(err) });
        });
    });
};