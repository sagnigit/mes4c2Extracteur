import { contextBridge, ipcRenderer } from 'electron';

// ---------------------------------------------------------------------
// Preload chargé UNIQUEMENT dans les WebContentsView ouvertes par
// extractionDirecte.ts (jamais dans la fenêtre principale de l'app,
// qui utilise préload.ts / window.api).
//
// Le "code JS à injecter" fourni à lancerExtraction(...) doit, une fois
// la valeur récupérée sur la page, appeler :
//   window.extraction.envoyerDonnee(valeur)
// ou, s'il rencontre une erreur pendant l'extraction :
//   window.extraction.envoyerErreur("message d'explication")
//
// Ces deux appels remontent, via IPC, jusqu'au processus principal qui
// les relaie (voir extractionDirecte.ts) à la fonction de traitement /
// à la gestion d'erreur de la tâche correspondante.
// ---------------------------------------------------------------------
contextBridge.exposeInMainWorld('extraction', {
    envoyerDonnee: (valeur: any) => ipcRenderer.send('extraction:donnee', valeur),
    envoyerErreur: (message: string) => ipcRenderer.send('extraction:erreur', String(message)),
});
