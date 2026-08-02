const { contextBridge, ipcRenderer } = require('electron');

// ---------------------------------------------------------------------
// Preload chargé UNIQUEMENT dans les WebContentsView ouvertes par
// extractionDirecte.ts. Conservé pour compatibilité (canal
// extraction:erreur), même si le modèle "retour direct" (Promise
// résolue par le script injecté lui-même) est maintenant privilégié.
// ---------------------------------------------------------------------
contextBridge.exposeInMainWorld('extraction', {
    envoyerDonnee: (valeur) => ipcRenderer.send('extraction:donnee', valeur),
    envoyerErreur: (message) => ipcRenderer.send('extraction:erreur', String(message)),
});
