// Récupération du contenu d'un lien précis (Expression Écrite,
// formation-tcfcanada.com) : chaque page contient une ou plusieurs
// "combinaisons" de sujet, chacune avec un bouton à révéler puis 3
// tâches (tâche 1 : message ~60 mots, tâche 2 : texte descriptif
// ~120 mots, tâche 3 : essai ~250 mots à partir de 2 documents).
//
// Adapté ici au même modèle "retour direct" que recupDonnee_tcf_eo.ts
// (Promise résolue directement par executeJavaScript, JSON.stringify(...)
// ou null en cas d'erreur), ET à la MÊME FORME de sortie que l'EO
// ({ nomPartie, tache2: string[], tache3: string[] }), pour être traité
// par le même gestionnaire générique (voir creerGestionnaireDonneeExpression
// dans outi_exract.ts) :
//   - nomPartie = nom de la combinaison (identique à l'ancien nomCombi)
//   - tache2    = [tâche 1, tâche 2] (les deux tâches courtes, regroupées)
//   - tache3    = [thème du document, document 1, document 2] (l'essai)
// Rien n'est perdu : les 3 tâches sont toutes présentes, seulement
// réparties en 2 groupes au lieu de 3 pour correspondre au modèle
// "Section A / Section B" déjà utilisé pour l'affichage/l'export.
export const strCode = `
new Promise((resolve) => {
    try {
        let tabCombi = document.querySelectorAll('[class="scroll-mt-24 overflow-hidden rounded-2xl border-2 border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800"]');

        const recuperText = (engl) => (engl) ? engl.textContent : "";

        const recupTextDnsBalise = (engl, b) => (engl) ? recuperText(engl.querySelector('' + b)) : "";

        const recuperCombi = (englCombi) => {
            let tabP = englCombi ? englCombi.querySelectorAll('p') : [];
            return {
                nomPartie: recupTextDnsBalise(englCombi, 'h3'),
                tache2: [recuperText(tabP[0]), recuperText(tabP[1])],
                tache3: [recupTextDnsBalise(englCombi, 'h4'), recuperText(tabP[2]), recuperText(tabP[3])]
            };
        };

        for (let engl of tabCombi) {
            let bout = engl.querySelector('button');
            if (bout) bout.click();
        }

        setTimeout(() => {
            let tabValeur = [];
            for (let engl of tabCombi) {
                tabValeur.push(recuperCombi(engl));
            }
            resolve(JSON.stringify(tabValeur));
        }, 120);
    } catch (err) {
        resolve(null);
    }
});
`;
