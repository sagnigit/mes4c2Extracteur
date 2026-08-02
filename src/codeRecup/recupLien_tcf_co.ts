// Récupération des liens (page "tableau de bord" Compréhension Orale,
// formation-tcfcanada.com) : même structure de page que Compréhension
// Écrite (voir recupLien_tcf_ce.ts), donc même code.
//
// Modèle "retour direct" (voir extractionDirecte.ts) : le script
// retourne lui-même sa valeur (null en cas d'erreur, sinon une chaîne
// JSON représentant un tableau de { url, nom }), sans passer par
// window.extraction.envoyerDonnee/envoyerErreur.
export const strCode = `
(() => {
    try {
        let divEngl = document.querySelectorAll('[class="mb-4 rounded-lg border border-gray-200 bg-white p-4 shadow-sm"]')[0];
        let tabEnglLien = divEngl.querySelectorAll('a');
        let tabValeur = [];
        for (let englLien of tabEnglLien) {
            if (englLien.href.includes('/tarification')) {
                continue;
            }
            let divPrEcrt = englLien.querySelector('[class="min-w-0 flex-1"]');
            if (!divPrEcrt) {
                divPrEcrt = englLien.querySelector('[class="relative min-w-0 flex-1"]');
            }
            if (divPrEcrt) {
                tabValeur.push({
                    url: englLien.href,
                    nom: divPrEcrt.querySelectorAll(':scope > *')[0].textContent
                });
            }
        }
        return JSON.stringify(tabValeur);
    } catch (err) {
        return null;
    }
})();
`;