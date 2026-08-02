// Récupération des liens de session (page
// objectifcanada-tcf.com/fr/examen/tef) : chaque série est un lien
// <a id="other" href="/examen/tef/{numero}"> contenant un <p> avec le
// texte "Série {numero}". Les séries verrouillées (et le bouton
// "Méthodologie tef") pointent vers /checkout au lieu du vrai lien —
// on les ignore donc en ne gardant que les href qui correspondent au
// motif /examen/tef/{numéro}.
//
// Modèle "retour direct" (voir extractionDirecte.ts) : le script
// retourne lui-même sa valeur (null en cas d'erreur, sinon une chaîne
// JSON représentant un tableau de { url, nom }), sans passer par
// window.extraction.envoyerDonnee/envoyerErreur.
export const strCode = `
(() => {
    try {
        let tabLien = document.querySelectorAll('a[id="other"]');
        let tabValeur = [];
        for (let lien of tabLien) {
            let chemin = lien.getAttribute('href') || '';
            // Ignore "Méthodologie tef" et les séries verrouillées
            // (les deux pointent vers /checkout, pas vers la série).
            if (!/\\/examen\\/tef\\/\\d+/.test(chemin)) continue;
            let elemNom = lien.querySelector('p');
            let nom = elemNom ? elemNom.textContent.trim() : '';
            tabValeur.push({
                url: lien.href,
                nom: nom
            });
        }
        return JSON.stringify(tabValeur);
    } catch (err) {
        return null;
    }
})();
`;