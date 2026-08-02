// Récupération des liens (page "sujets d'actualité" Expression Orale,
// formation-tcfcanada.com) : même principe que Expression Écrite (voir
// recupLien_tcf_ee.ts), sections décalées d'un cran.
//
// Modèle "retour direct" (voir extractionDirecte.ts) : le script
// retourne lui-même sa valeur, ici via une Promise qu'executeJavaScript
// attend automatiquement (null en cas d'erreur, sinon une chaîne JSON
// représentant un tableau de { url, nom }).
export const strCode = `
new Promise((resolve) => {
    try {
        let leMainEngl = document.querySelectorAll('main')[0];
        let tabSectionMainEngl = leMainEngl.querySelectorAll('section');
        let tabBout = tabSectionMainEngl[1].querySelectorAll('button');
        let divEnglLien = tabSectionMainEngl[2].querySelectorAll('div')[0];
        let tabValeur = [];
        const recuperLien = () => {
            let divDesBaliseLien = divEnglLien.querySelectorAll('div')[1];
            let tabBaliseLien = divDesBaliseLien.querySelectorAll('a');
            for (let baliseLien of tabBaliseLien) {
                tabValeur.unshift({
                    url: baliseLien.href,
                    nom: baliseLien.querySelector('h3').textContent
                });
            }
        };
        let indiceBout = 0;
        const parcourBout = () => {
            if (indiceBout < tabBout.length) {
                tabBout[indiceBout].click();
                setTimeout(() => {
                    recuperLien();
                    indiceBout += 1;
                    parcourBout();
                }, 800);
            } else {
                resolve(JSON.stringify(tabValeur));
            }
        };
        parcourBout();
    } catch (err) {
        resolve(null);
    }
});
`;