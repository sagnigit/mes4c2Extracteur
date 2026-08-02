// Récupération du contenu d'une page d'entraînement Compréhension Écrite
// (formation-tcfcanada.com, page /epreuve/comprehension-ecrite/entrainement/{slug}) :
//
// L'ANCIEN code (celui qui cherchait des containers [id^="review-question-"]
// et cliquait pour "dérouler la correction") ciblait une AUTRE page — une
// page de correction qui n'existe (plus ?) sous cette forme. La page
// réellement chargée aujourd'hui est un composant Next.js (QuizPlayer) qui
// reçoit directement, dans ses props serveur, la série ET la liste
// complète des questions (image, audio, options, bonne réponse, énoncé...)
// — pas besoin de dérouler/cliquer quoi que ce soit, tout est déjà dans le
// payload de la page.
//
// Comme pour recupDonnee_tef_session.ts, on récupère ce payload en
// exécutant le VRAI code de chaque balise <script>self.__next_f.push(...)</script>
// dans un bac à sable où "self" pointe vers un faux objet (React Flight /
// RSC de Next.js — même mécanisme que flight-parser.ts, page différente).
// Le texte brut ainsi obtenu est ensuite analysé côté main process (un
// parseur adapté à la forme {series, questions:[...]} de CETTE page,
// réutilisant les utilitaires de découpage/résolution de chunks de
// flight-parser.ts) — ici on se contente de le renvoyer tel quel.
//
// Modèle "retour direct" (voir extractionDirecte.ts) : le script
// retourne lui-même sa valeur (null en cas d'erreur ou de page vide,
// sinon le texte brut concaténé), sans passer par
// window.extraction.envoyerDonnee/envoyerErreur.
export const strCode = `
(() => {
    try {
        const scripts = [...document.querySelectorAll('script')]
            .map(s => s.textContent || '')
            .filter(t => t.trim().startsWith('self.__next_f.push'));

        const collected = [];
        const fakeSelf = { __next_f: { push: (arg) => { collected.push(arg[1]); } } };

        for (const code of scripts) {
            try {
                new Function('self', code)(fakeSelf);
            } catch (e) {
                console.error("Erreur de parsing d'un chunk :", e);
            }
        }

        const raw = collected.join('');
        return raw && raw.trim() !== '' ? raw : null;
    } catch (err) {
        return null;
    }
})();
`;