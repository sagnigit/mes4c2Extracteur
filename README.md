# ExtractDirect (unifié) — objectifcanada-tcf.com

Ceci fusionne dans **une seule application Electron** ce qui existait avant en plusieurs
morceaux séparés :

1. l'app qui naviguait "en dur" sur une liste fixe de séries (`1001` à `1035` + `1901`)
   et extrayait le contenu de chaque page (ancien `main.ts` / `flight-parser.ts`) ;
2. le script qui téléchargeait ensuite les médias (images/audio) référencés dans les
   `co.json` / `ce.json` / `ee.json` / `eo.json` (ancien `telecharge.ts`) ;
3. le système de navigation "robuste" développé pour `tcf_modeste`, qui gère les
   redirections (ex. renvoi vers une page de connexion) en affichant la page en grand
   pour laisser l'utilisateur naviguer/se connecter à la main, puis reprend
   automatiquement dès que la bonne URL est atteinte (fichiers `fenetre.js` /
   `extractDnsFen.js` / `positFenSecond.js` de `tcf_modeste`).

## Ce qui a changé par rapport à l'ancien `extractDirect`

- Il n'y a plus de liste figée de séries dans le code : **on ajoute les liens soi-même**
  depuis l'interface (un lien = un dossier de destination), ou en une fois via
  "Ajout en série" (motif `{n}` + bornes début/fin — pratique pour générer d'un coup
  les liens `.../tef/1001` à `.../tef/1035`, comme avant, mais sans toucher au code).
- La page cible n'est plus chargée directement dans la fenêtre principale : elle est
  chargée dans une **BrowserView dédiée**, invisible tant que tout va bien. Si le site
  redirige ailleurs (session expirée, page de connexion...), la vue s'affiche dans la
  zone prévue de l'interface pour que vous puissiez naviguer/vous connecter à la main ;
  dès que l'URL attendue est atteinte, la vue se recache automatiquement et
  l'extraction continue (vous pouvez aussi cliquer sur "Continuer" pour forcer la
  reprise, ou "Annuler").
- Chaque entrée peut être **extraite à tout moment** (bouton "Extraire") : cela relit
  la page Next.js, reconstruit les données (CO/CE/EE/EO) via `flight-parser.ts`
  (inchangé), et écrit `co.json` / `ce.json` / `ee.json` / `eo.json` dans le dossier
  de l'entrée.
- Chaque entrée dispose aussi d'un bouton **"Télécharger médias"** qui reprend le
  traitement de l'ancien `telecharge.ts` (téléchargement des images/audio référencés,
  mise à jour des champs `imagePath` / `audioPath` dans les json).
- La liste des entrées et le dossier racine sont sauvegardés automatiquement (fichier
  `entrees.json` dans le dossier de données utilisateur d'Electron), donc conservés
  d'un lancement à l'autre.

## Bug corrigé : preload en ESM vs CommonJS

Dans la première version livrée, `preload.ts` était compilé par `tsc` en même temps
que le reste (donc en syntaxe `import ... from 'electron'`, à cause de `"type":
"module"` dans `package.json`). Or **Electron charge toujours le script preload en
CommonJS**, quel que soit le `"type"` du `package.json` — l'`import` y provoque donc
une erreur silencieuse (`Cannot use import statement outside a module`), le preload
échoue à s'exécuter, et `window.api` n'existe jamais côté renderer : toute
l'interface reste figée (rien ne s'affiche, aucun bouton ne répond), car
`renderer.js` plante dès sa première ligne utilisant `window.api`.

C'est exactement pour cette raison que dans `tcf_modeste`, `preload.cjs` et
`preloadSecond.cjs` étaient écrits en `.cjs` plutôt qu'en `.ts` compilé. La correction
ici applique le même principe : le preload est maintenant un fichier **`public/preload.cjs`
en CommonJS pur** (non transpilé par tsc), chargé directement par `main.ts`. Vérifié
par un test automatisé (chargement réel de l'app + appel `window.api` depuis le
renderer) qui confirme que l'ajout d'un lien, la liste des entrées et le dossier
racine fonctionnent bien de bout en bout.

## Installation / lancement

```bash
npm install
npm run build   # compile TypeScript -> dist/
npm start       # (fait build + lance electron .)
```

## Structure

```
src/
  main.ts          point d'entrée Electron (fenêtre principale)
  preload.ts        pont sécurisé renderer <-> main (contextBridge)
  store.ts          persistance des entrées (lien+dossier) et du dossier racine
  navigation.ts      BrowserView + gestion des redirections (inspiré de tcf_modeste)
  extraction.ts      orchestration : navigation -> injection -> parsing -> écriture json
  telecharge.ts      téléchargement des médias référencés dans les json
  flight-parser.ts   (inchangé) décodage du payload Next.js RSC -> tableaux CO/CE/EE/EO
  ipc.ts             câblage des canaux IPC renderer <-> modules ci-dessus
public/
  index.html / style.css / renderer.js   interface (liste des liens, ajout, journal...)
```

## Prochaine étape (fusion avec tcf_modeste)

Comme discuté : `tcf_modeste` gère un autre site (WordPress via des boutons
Elementor, avec récupération automatique des liens enfants, export vers Word,
graphiques, etc.). La logique d'extraction "cœur" (CO/CE/EE/EO + téléchargement
média) est en revanche très proche entre les deux projets. Une fusion complète
consisterait à généraliser `navigation.ts` (déjà repris de tcf_modeste) et à ajouter
un "profil de site" par site (sélecteurs/scripts d'injection propres à chaque site),
pour que la même application gère les deux sources avec un seul cœur commun.
