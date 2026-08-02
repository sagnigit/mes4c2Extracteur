// Récupération du contenu d'une page d'entraînement Compréhension Orale
// (formation-tcfcanada.com, page /epreuve/comprehension-orale/entrainement/{slug}) :
//
// Même page/composant que pour la CE (QuizPlayer, Next.js) : la série ET
// la liste complète des questions sont déjà présentes dans les props
// serveur du composant — image (souvent présente pour les premières
// questions, "au son"), audio (systématiquement présent ici, c'est le
// cœur de l'épreuve), énoncé, options de réponse, index de la bonne
// réponse, points, niveau, transcription... — pas besoin de
// dérouler/cliquer quoi que ce soit, tout est déjà dans le payload de
// la page.
//
// Forme des questions renvoyées par cette page (voir shape observée) :
//   {
//     id, orderIndex, points, level,
//     imageUrl: string | null,        // lien de l'image (souvent null au-delà des toutes premières questions)
//     audioUrl: string,               // lien du fichier audio à écouter
//     prompt: string,                 // énoncé/consigne de la question
//     options: string[],              // propositions de réponse (4, parfois vides pour les "choisissez l'image")
//     correctAnswerIndex: number,     // index (0-based) de la bonne réponse dans options
//     explanation: string | null,
//     extractedText: { transcript, language, speakers, words, model },  // transcription complète de l'audio
//     aiReasoning: string
//   }
//
// Exactement comme pour recupDonnee_tef_session.ts et recupDonnee_tcf_ce.ts,
// on récupère ce payload en exécutant le VRAI code de chaque balise
// <script>self.__next_f.push(...)</script> dans un bac à sable où "self"
// pointe vers un faux objet (React Flight / RSC de Next.js — même
// mécanisme que flight-parser.ts, page différente). Le texte brut ainsi
// obtenu est ensuite analysé côté main process (un parseur adapté à la
// forme {series, questions:[...]} de CETTE page — mêmes utilitaires de
// découpage/résolution de chunks que pour la CE, seul le mapping des
// champs image/audio/transcript diffère) — ici on se contente de le
// renvoyer tel quel.
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