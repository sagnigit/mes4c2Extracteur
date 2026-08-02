// Récupération du contenu d'un lien précis (Expression Écrite / Orale,
// formation-tcfcanada.com) : chaque page contient plusieurs "parties",
// chacune avec un onglet à 3 boutons (le 2e et le 3e révèlent chacun un
// jeu de sujets, capturés l'un après l'autre avec un court délai entre
// chaque clic — d'où la Promise). Repris tel quel d'un ancien code qui
// renvoyait sa valeur via window.transiteur.sendMessage(...) ; adapté
// ici au modèle "retour direct" (voir extractionDirecte.ts) : le script
// retourne lui-même sa valeur, via une Promise qu'executeJavaScript
// attend automatiquement (null en cas d'erreur, sinon une chaîne JSON
// représentant un tableau de { nomPartie, tache2, tache3 }).
export const strCode = `
new Promise((resolve) => {
    try {
        let tabPartie = document.querySelectorAll('[class="scroll-mt-24 overflow-hidden rounded-3xl bg-white shadow-lg"]');

        const recuperText = (engl) => (engl) ? engl.textContent : "";

        const recupTextDnsBalise = (engl, b) => (engl) ? recuperText(engl.querySelector('' + b)) : "";

        const recupSujectTache = (engl) => {
            let divPorteur = engl.querySelector('[class="mx-auto grid max-w-3xl grid-cols-1 gap-6"]');
            return (divPorteur) ? [...divPorteur.querySelectorAll('p')].map((engText) => recuperText(engText)) : [];
        };

        const verifValeur = (valeur) => {
            let nb1 = valeur[1].length;
            let nb2 = valeur[2].length;
            if (nb1 !== nb2) return false;
            if (nb1 === 0) return false;
            return true;
        };

        for (let engl of tabPartie) {
            let bout = engl.querySelector('[class="w-full cursor-pointer bg-linear-to-r from-blue-600 to-cyan-500 px-4 py-3 text-left transition-all hover:brightness-105 sm:px-8 sm:py-5"]');
            bout.click();
        }

        let tabTotale = [];
        for (let engl of tabPartie) {
            let divNom = engl.querySelectorAll(':scope > *')[0];
            tabTotale.push([recupTextDnsBalise(divNom, 'h2')]);
        }

        const tabContBout = [[], []];

        const recupFinale = (indice) => {
            if (indice < tabContBout.length) {
                for (let bout of tabContBout[indice]) {
                    bout.click();
                }
                setTimeout(() => {
                    tabTotale.forEach((valeur, posit) => {
                        valeur.push(recupSujectTache(tabPartie[posit]));
                    });
                    recupFinale(indice + 1);
                }, 800);
            } else {
                let tabValeur = [];
                for (let valeur of tabTotale) {
                    if (verifValeur(valeur)) {
                        tabValeur.push({
                            nomPartie: valeur[0],
                            tache2: valeur[1],
                            tache3: valeur[2]
                        });
                    }
                }
                resolve(JSON.stringify(tabValeur));
            }
        };

        setTimeout(() => {
            for (let engl of tabPartie) {
                let divBout = engl.querySelector('[class="flex w-full rounded-xl border border-gray-200 bg-white p-1 shadow-lg"]');
                let tabEnglBout = divBout.querySelectorAll('button');
                tabContBout[0].push(tabEnglBout[1]);
                tabContBout[1].push(tabEnglBout[2]);
            }
            recupFinale(0);
        }, 800);
    } catch (err) {
        resolve(null);
    }
});
`;
