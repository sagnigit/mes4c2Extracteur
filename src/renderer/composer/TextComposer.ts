/**
 * TextComposer
 * ------------
 * Remplace l'ancien trio EditableBlockManager / EditableBlock /
 * BlockFormattingToolbar par un éditeur de texte riche unique, basé
 * sur Quill.js (chargé en global via <script src="vendor/quill.min.js">,
 * exactement comme html-to-image — voir Capturedivaspng.ts).
 *
 * Pourquoi ce changement :
 *  - Quill fournit déjà tout ce que l'ancien système réimplémentait à la
 *    main (gras/italique/souligné, alignement, couleur, taille de
 *    police...), avec en plus une VRAIE sélection de texte (mise en
 *    forme au caractère près, pas juste "par bloc entier").
 *  - L'ajustement à la taille du cadre (ex-fitToSize / autoFitFontSize)
 *    ne boucle plus sur chaque taille de police entière en testant un
 *    débordement à chaque essai. On mesure UNE SEULE FOIS la taille
 *    "naturelle" du texte (celle voulue par l'utilisateur, non
 *    contrainte), puis on l'agrandit ou le réduit avec un simple
 *    transform: scale(). Comme scale() redimensionne le rendu déjà mis
 *    en forme sans en modifier le contenu, TOUS les styles (gras,
 *    couleurs, alignement, tailles relatives entre mots...) sont
 *    conservés automatiquement, sans rien recalculer.
 *
 * Structure DOM :
 *
 *   this.container                      <- conteneur public (mount())
 *     ├── this.toolbarHost                  <- barre d'outils Quill (fixe)
 *     └── this.frame                        <- "cadre" (scroll en édition,
 *           └── this.stage                     taille fixe une fois ajusté)
 *                 └── (le DOM généré par Quill : .ql-container/.ql-editor)
 *
 * `frame` est ce qu'il faut capturer en image (captureDivAsPng) : exposé
 * en lecture seule via la propriété `content`, comme le faisait
 * auparavant EditableBlockManager.content (blocksContainer).
 *
 * ------------------------------------------------------------------
 * Option "retour à la ligne" (par paragraphe)
 * ------------------------------------------------------------------
 * Reprend l'ancien EditableBlock.toggleWrap() : un bouton dédié dans la
 * barre d'outils (icône ↔) permet, pour le paragraphe où se trouve le
 * curseur, d'EMPÊCHER le retour à la ligne automatique (le texte reste
 * sur une seule ligne, quitte à déborder horizontalement — utile pour
 * un titre qu'on veut garder sur une seule ligne quoi qu'il arrive).
 * Par défaut (bouton inactif), le comportement normal s'applique : le
 * texte continue sur la ligne du bas dès qu'il atteint le bord du
 * cadre.
 *
 * C'est un vrai format Quill (attributor de classe, niveau bloc,
 * `ql-nowrap-on`), donc il suit le texte comme n'importe quelle autre
 * mise en forme (gras, couleur...), y compris à travers fitToSize().
 */

declare const Quill: any;

// Palette de couleurs proposée dans la barre d'outils (reprend l'esprit
// des 2 couleurs "cyclables" de l'ancien système, avec quelques teintes
// utiles en plus). "false" = bouton "couleur par défaut" (retire la
// couleur), ajouté automatiquement par Quill en premier de la liste.
const PALETTE_COULEURS = ["#1a1a1a", "#e63946", "#2e86c1", "#ffffff", "#f1c40f", "#1b7a3d"];

// Tailles de police proposées pendant la SAISIE (avant ajustement au
// cadre). Une fois fitToSize() appliqué, ces tailles "de base" ne
// comptent plus que les unes PAR RAPPORT AUX AUTRES : le scale() global
// grossit/réduit ensuite tout l'ensemble en gardant ces proportions.
const TAILLES_POLICE = ["12px", "14px", "16px", "18px", "24px", "32px", "48px", "64px", "96px"];

// Un seul enregistrement global suffit (Quill.register n'a pas besoin
// d'être répété à chaque instance de TextComposer).
let taillesEnregistrees = false;
function enregistrerTaillesPolice(): void {
  if (taillesEnregistrees) return;
  const SizeStyle = Quill.import("attributors/style/size");
  SizeStyle.whitelist = TAILLES_POLICE;
  Quill.register(SizeStyle, true);
  taillesEnregistrees = true;
}

// Nom de la classe CSS posée sur un paragraphe quand le retour à la
// ligne automatique y est désactivé (voir le commentaire d'en-tête).
// Construit par Quill/Parchment comme `${keyName}-${value}`, voir
// enregistrerFormatNowrap ci-dessous : "ql-nowrap" + "-" + "on".
const NOWRAP_FORMAT_NAME = "nowrap";
const NOWRAP_FORMAT_VALEUR = "on";
const NOWRAP_CLASSE_CSS = "ql-nowrap-on";

let nowrapFormatEnregistre = false;
function enregistrerFormatNowrap(): void {
  if (nowrapFormatEnregistre) return;
  // Même mécanisme que le format natif "align" de Quill (voir
  // formats/align.js dans la lib) : un attributor de CLASSE, au niveau
  // du BLOC (donc appliqué au paragraphe entier, pas à une sélection de
  // caractères) — cohérent avec le fait que l'ancien "wrap" était lui
  // aussi une propriété par bloc, pas par sélection.
  const Parchment = Quill.import("parchment");
  const NowrapClass = new Parchment.Attributor.Class("nowrap", "ql-nowrap", {
    scope: Parchment.Scope.BLOCK,
  });
  Quill.register(NowrapClass, true);
  nowrapFormatEnregistre = true;
}

const attendreFrame = (): Promise<void> =>
  new Promise((resolve) => requestAnimationFrame(() => resolve()));

export class TextComposer {
  /** Conteneur public : toolbar + cadre. À monter via mount() ou mountSplit(). */
  public readonly container: HTMLDivElement;

  /** Barre d'outils Quill (générée par Quill puis déplacée ici). */
  private readonly toolbarHost: HTMLDivElement;
  public get toolbarElement(): HTMLDivElement {
    return this.toolbarHost;
  }

  /**
   * Cadre : pendant la saisie, c'est une zone scrollable de taille
   * "normale" (width/height fournis au constructeur). Une fois
   * fitToSize() appelé, il devient une boîte à taille FIXE (px) qui
   * centre `stage` — c'est cette boîte qu'il faut capturer en image.
   */
  private readonly frame: HTMLDivElement;
  public get content(): HTMLDivElement {
    return this.frame;
  }
  public get scrollAreaElement(): HTMLDivElement {
    return this.frame;
  }

  /**
   * "Scène" : porte le DOM de Quill. C'est CET élément qui reçoit le
   * transform: scale() lors de fitToSize() — jamais `frame`, qui doit
   * garder sa taille exacte (c'est le cadre final capturé).
   */
  private readonly stage: HTMLDivElement;

  private readonly editorHost: HTMLDivElement;
  private quill: any;

  /** Bouton "empêcher le retour à la ligne" (ajouté manuellement à la barre Quill). */
  private readonly btnNowrap: HTMLButtonElement;

  private isFitted = false;

  private readonly originalFrameWidth: string;
  private readonly originalFrameHeight: string;

  constructor(
    width: string = "100%",
    height: string = "260px",
    placeholder: string = "Écrivez ici..."
  ) {
    enregistrerTaillesPolice();
    enregistrerFormatNowrap();

    this.originalFrameWidth = width;
    this.originalFrameHeight = height;

    this.container = document.createElement("div");
    this.container.classList.add("text-composer");

    this.toolbarHost = document.createElement("div");
    this.toolbarHost.classList.add("text-composer__toolbar");

    this.frame = document.createElement("div");
    this.frame.classList.add("text-composer__frame");
    this.frame.style.width = width;
    this.frame.style.height = height;

    this.stage = document.createElement("div");
    this.stage.classList.add("text-composer__stage");

    this.editorHost = document.createElement("div");
    this.editorHost.classList.add("text-composer__editor");

    this.stage.appendChild(this.editorHost);
    this.frame.appendChild(this.stage);
    this.container.append(this.toolbarHost, this.frame);

    this.quill = new Quill(this.editorHost, {
      theme: "snow",
      placeholder,
      modules: {
        toolbar: {
          container: [
            ["bold", "italic", "underline"],
            [{ align: [] }],
            [{ color: PALETTE_COULEURS }],
            [{ size: TAILLES_POLICE }],
            ["clean"],
          ],
        },
      },
    });

    // Quand `toolbar.container` est un tableau (pas une référence DOM),
    // Quill génère lui-même la barre d'outils et l'insère juste AVANT
    // l'élément éditeur, comme frère dans le même parent (donc ici, dans
    // `stage`). On la déplace dans `toolbarHost` pour qu'elle reste fixe
    // au-dessus du cadre (qui, lui, peut défiler ou être redimensionné).
    const barreGeneree = this.editorHost.previousElementSibling as HTMLElement | null;
    if (barreGeneree?.classList.contains("ql-toolbar")) {
      this.toolbarHost.appendChild(barreGeneree);
    }

    // Bouton "empêcher le retour à la ligne", ajouté à la main (ce n'est
    // pas un format standard de Quill) : reprend l'ancien
    // EditableBlock.toggleWrap(). Par défaut (bouton inactif), le texte
    // continue normalement sur la ligne du bas en atteignant le bord du
    // cadre ; actif, le paragraphe courant reste sur une seule ligne.
    const groupeNowrap = document.createElement("span");
    groupeNowrap.classList.add("ql-formats");

    this.btnNowrap = document.createElement("button");
    this.btnNowrap.type = "button";
    this.btnNowrap.classList.add("tc-nowrap-btn");
    this.btnNowrap.title = "Empêcher le retour à la ligne (garder sur une seule ligne)";
    this.btnNowrap.textContent = "↔";

    // Comme les boutons natifs de Quill : empêche le mousedown de voler
    // le focus/la sélection AVANT que le clic ne soit traité, sinon
    // format() s'appliquerait à la mauvaise position (ou à aucune).
    this.btnNowrap.addEventListener("mousedown", (e) => e.preventDefault());
    this.btnNowrap.addEventListener("click", () => {
      const plage = this.quill.getSelection();
      if (!plage) return;
      const formatsCourants = this.quill.getFormat(plage);
      const estActif = formatsCourants[NOWRAP_FORMAT_NAME] === NOWRAP_FORMAT_VALEUR;
      this.quill.format(NOWRAP_FORMAT_NAME, estActif ? false : NOWRAP_FORMAT_VALEUR);
      this.synchroniserBoutonNowrap(plage);
    });

    groupeNowrap.appendChild(this.btnNowrap);
    if (barreGeneree?.classList.contains("ql-toolbar")) {
      barreGeneree.appendChild(groupeNowrap);
    } else {
      this.toolbarHost.appendChild(groupeNowrap);
    }

    // Resynchronise l'état visuel du bouton (actif/inactif) à chaque
    // changement de sélection, pour refléter le format du paragraphe où
    // se trouve actuellement le curseur. On utilise la plage transmise
    // par l'évènement plutôt que quill.getFormat() sans argument, qui
    // forcerait le focus et planterait s'il n'y a aucune sélection.
    this.quill.on("selection-change", (plage: any) => this.synchroniserBoutonNowrap(plage));
  }

  /** Met à jour l'apparence du bouton "empêcher le retour à la ligne" selon la plage donnée (ou la sélection courante). */
  private synchroniserBoutonNowrap(plage?: any): void {
    const plageEffective = plage !== undefined ? plage : this.quill.getSelection();
    if (!plageEffective) {
      this.btnNowrap.classList.remove("ql-active");
      return;
    }
    const formatsCourants = this.quill.getFormat(plageEffective);
    const estActif = formatsCourants[NOWRAP_FORMAT_NAME] === NOWRAP_FORMAT_VALEUR;
    this.btnNowrap.classList.toggle("ql-active", estActif);
  }

  /** Texte actuellement présent dans l'éditeur (sans le saut de ligne final ajouté par Quill). */
  public getText(): string {
    return this.quill.getText().trim();
  }

  /** Remplace tout le contenu par du texte brut (aucune mise en forme). */
  public setText(text: string): void {
    this.quill.setText(text);
  }

  /** Donne le focus à l'éditeur. */
  public focusEditable(): void {
    this.quill.focus();
  }

  /** Retire le focus de l'éditeur, s'il l'a. */
  private blurActiveElement(): void {
    const actif = document.activeElement;
    if (actif instanceof HTMLElement && this.container.contains(actif)) {
      actif.blur();
    }
  }

  /** Réinitialise tout : efface le contenu, revient en mode saisie normal, focus. */
  public init(): void {
    this.resetToInitialState();
    this.quill.setText("");
    this.focusEditable();
  }

  /**
   * Ajuste la "scène" (tout le texte composé, avec sa mise en forme) à
   * une taille de cadre cible EXACTE (en pixels), via un simple
   * transform: scale() — voir le commentaire d'en-tête du fichier.
   *
   * @param height hauteur cible du cadre, en pixels
   * @param width  largeur cible du cadre, en pixels
   */
  public async fitToSize(height: number, width: number): Promise<void> {
    // 1) Verrouille l'édition et le focus.
    this.quill.enable(false);
    this.blurActiveElement();

    // 2) Le cadre passe en taille FIXE (px) : c'est lui, désormais, qui
    //    sera capturé tel quel. Il centre `stage` en son sein.
    this.frame.classList.add("text-composer__frame--fitted");
    this.frame.style.width = `${width}px`;
    this.frame.style.height = `${height}px`;

    // 3) Mesure la taille "naturelle" du texte : chaque paragraphe sur
    //    UNE SEULE ligne, sans aucune contrainte de largeur — c'est la
    //    forme la plus fidèle à ce que l'utilisateur a réellement
    //    composé, avant tout redimensionnement.
    this.stage.classList.add("text-composer__stage--measuring");
    await attendreFrame();
    const largeurNaturelle = this.stage.scrollWidth;
    const hauteurNaturelle = this.stage.scrollHeight;
    this.stage.classList.remove("text-composer__stage--measuring");

    let echelle: number;

    if (largeurNaturelle <= width) {
      // Le texte tient sur ses lignes naturelles sans avoir besoin d'un
      // retour à la ligne supplémentaire : on peut librement l'agrandir
      // OU le réduire pour occuper au mieux le cadre dans les deux
      // dimensions. C'est le cas typique du "grossissement progressif" :
      // un titre court doit grossir pour remplir l'espace disponible.
      this.stage.classList.add("text-composer__stage--nowrap");
      this.stage.style.width = `${largeurNaturelle}px`;
      echelle = Math.min(width / largeurNaturelle, height / hauteurNaturelle);
    } else {
      // Le texte est trop large pour tenir sur une ligne : on autorise
      // le retour à la ligne normal (largeur = largeur du cadre), on
      // mesure la hauteur qui en résulte, puis on ne RÉDUIT que si
      // nécessaire (jamais d'agrandissement ici, sinon le texte
      // déborderait latéralement du cadre).
      this.stage.style.width = `${width}px`;
      await attendreFrame();
      const hauteurAvecRetours = this.stage.scrollHeight;

      // Les paragraphes marqués "empêcher le retour à la ligne" (voir le
      // bouton ↔) restent sur une seule ligne MÊME dans cette branche —
      // c'est tout leur but. Si l'un d'eux est encore plus large que le
      // cadre à ce stade, il faut en tenir compte dans l'échelle finale
      // pour éviter qu'il ne déborde latéralement (le cadre ajusté a
      // overflow: hidden).
      let largeurMaxNowrap = 0;
      this.editorHost.querySelectorAll(`.${NOWRAP_CLASSE_CSS}`).forEach((noeud) => {
        largeurMaxNowrap = Math.max(largeurMaxNowrap, (noeud as HTMLElement).scrollWidth);
      });

      echelle = Math.min(1, height / hauteurAvecRetours);
      if (largeurMaxNowrap > 0) {
        echelle = Math.min(echelle, width / largeurMaxNowrap);
      }
    }

    this.stage.style.transform = `scale(${echelle})`;
    this.isFitted = true;
  }

  /** Annule fitToSize() : redonne au cadre sa taille d'origine, réactive l'édition. */
  public resetToInitialState(): void {
    this.frame.classList.remove("text-composer__frame--fitted");
    this.frame.style.width = this.originalFrameWidth;
    this.frame.style.height = this.originalFrameHeight;

    this.stage.classList.remove("text-composer__stage--measuring", "text-composer__stage--nowrap");
    this.stage.style.width = "";
    this.stage.style.transform = "";

    this.quill.enable(true);
    this.isFitted = false;
  }

  /** Insère le conteneur dans le DOM à l'intérieur d'un parent donné. */
  public mount(parent: HTMLElement): void {
    parent.appendChild(this.container);
  }

  /**
   * Variante de mount() qui sépare la barre d'outils du cadre, dans deux
   * parents DIFFÉRENTS : la barre reste fixe, seul le cadre (qui peut
   * défiler pendant la saisie) est placé dans l'autre parent.
   */
  public mountSplit(toolbarParent: HTMLElement, frameParent: HTMLElement): void {
    toolbarParent.appendChild(this.toolbarHost);
    frameParent.appendChild(this.frame);
  }

  /** Retire complètement le conteneur du DOM (que mount() ou mountSplit() ait été utilisé). */
  public destroy(): void {
    this.toolbarHost.remove();
    this.frame.remove();
    this.container.remove();
  }
}
