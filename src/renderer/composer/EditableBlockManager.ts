/**
 * EditableBlockManager
 * ---------------------
 * Gère une liste d'EditableBlock empilés verticalement.
 *
 * Structure DOM (3 niveaux) :
 *
 *   this.container                        <- "grand conteneur" (public, mount())
 *     ├── this.toolbarZone                <- zone du HAUT : apparaît/disparaît
 *     │     └── this.toolbar.element         selon qu'un bloc est actif ou non.
 *     │                                       Ne réserve AUCUN espace quand cachée
 *     │                                       (display: none), donc le cadre du
 *     │                                       dessous récupère toute la place dès
 *     │                                       que la barre disparaît.
 *     └── this.scrollFrame                <- "cadre" : SEUL élément dont la classe
 *           └── this.blocksContainer          CSS change selon le contexte (voir
 *                 ├── EditableBlock            plus bas). Contient blocksContainer.
 *                 ├── EditableBlock
 *                 └── ...
 *
 * `blocksContainer` (exposé via la propriété publique `content`) est le
 * conteneur qui garde réellement toutes les zones de saisie. Contrairement
 * à avant, il n'est PLUS JAMAIS manipulé (ni classe ajoutée/retirée, ni
 * style inline posé dessus) : il porte une seule et unique classe CSS,
 * tout le temps, qui lui fait simplement prendre la hauteur de son
 * contenu et la largeur de son parent (this.scrollFrame).
 *
 * C'est désormais `this.scrollFrame` qui concentre toute la logique de
 * bascule visuelle, via DEUX classes CSS MUTUELLEMENT EXCLUSIVES (jamais
 * les deux en même temps) :
 *   - "mode édition" (par défaut) : display flex en colonne, flex: 1,
 *     overflow-y auto (défilement si le contenu dépasse), contenu aligné
 *     en haut-gauche (justify-content / align-items: flex-start).
 *   - "mode capture" : utilisé UNIQUEMENT pendant la composition de
 *     l'image finale (voir zoneImgtemplate.ts / composerSurImageTemplate).
 *     scrollFrame est alors littéralement déplacé hors du manager pour
 *     être inséré dans la zone "image template", À LA PLACE de l'ancien
 *     cadre overlay : la classe "mode capture" lui donne donc la MÊME
 *     position/dimension (absolute) que portait cet ancien cadre, et un
 *     display flex qui centre son contenu. Comme scrollFrame porte tout
 *     ce dont on a besoin (blocksContainer + tous les blocs), UNE SEULE
 *     capture (de la grande div du template) suffit désormais — plus
 *     besoin de capturer blocksContainer séparément puis d'insérer le
 *     résultat comme <img> (2 captures) : voir enterCaptureMode() /
 *     fitCaptureContent() / exitCaptureMode() plus bas, et
 *     zoneImgtemplate.ts qui orchestre l'aller-retour.
 *
 * Il possède aussi une BlockFormattingToolbar UNIQUE (pas une par
 * bloc) : quand un bloc devient actif (focus), le manager affiche la
 * barre et la synchronise sur l'état de ce bloc ; quand plus aucun
 * bloc n'est actif, la barre disparaît. La barre agit sur le bloc
 * actif via les méthodes exposées par EditableBlock (setAlign,
 * toggleBold, ...), donc la mise en forme reste "au niveau du bloc"
 * (pas une sélection de texte).
 *
 * Le bouton "supprimer" de la barre d'outils supprime le bloc actif
 * et redonne le focus au bloc suivant (ou précédent, si le dernier a
 * été supprimé). Il se cache automatiquement s'il ne reste qu'un seul
 * bloc dans le manager (syncState reçoit `canDelete = blocks.length > 1`).
 *
 * Fonctions principales du cycle "capture" (voir aussi zoneImgtemplate.ts) :
 *  - enterCaptureMode(hostFrame) : verrouille l'édition, cache la barre
 *    d'outils, rend les blocs "seamless" (texte continu, indissociables
 *    visuellement), bascule scrollFrame de sa classe "édition" vers sa
 *    classe "capture", puis le déplace dans `hostFrame` (la grande div du
 *    template), à la place de l'ancien cadre.
 *  - fitCaptureContent() : à appeler une fois enterCaptureMode() effectué
 *    ET le DOM effectivement rendu (scrollFrame déjà positionné dans son
 *    nouvel hôte) : ajuste progressivement une taille de police COMMUNE à
 *    tous les blocs pour remplir un maximum de l'espace du cadre SANS
 *    déborder — ni en hauteur (blocksContainer ne doit pas dépasser la
 *    hauteur de scrollFrame), ni en largeur À L'INTÉRIEUR d'une zone
 *    éditable (un texte en "pas de retour à la ligne" qui déborderait
 *    créerait un scroll horizontal, ce qui gâcherait l'image finale) —
 *    tout en respectant le delta de taille (A+/A-) propre à chaque bloc.
 *  - exitCaptureMode() : inverse enterCaptureMode()/fitCaptureContent() :
 *    remet scrollFrame exactement là où il était dans le DOM (même
 *    parent, même position), lui redonne sa classe "édition", annule le
 *    mode "texte continu", remet la police par défaut et redonne
 *    l'édition. Doit être appelé après la capture, que celle-ci ait
 *    réussi ou non.
 *  - preview() / exitPreview() / init() / deleteBlock() : voir plus bas.
 */

import { EditableBlock, EditableBlockOptions, BlockAlign, BlockFormatState } from "./EditableBlock.js";
import { BlockFormattingToolbar, ToolbarActions } from "./BlockFormattingToolbar.js";

const CLASSE_SCROLL_FRAME_EDITION = "editable-block-manager__scroll-frame--edition";
const CLASSE_SCROLL_FRAME_CAPTURE = "editable-block-manager__scroll-frame--capture";

/**
 * Un élément à partir duquel construire un bloc : son texte et sa mise
 * en forme initiale (les champs de `format` omis gardent la valeur par
 * défaut d'un bloc neuf, voir EditableBlock — align: "left", bold/italic/
 * underline: false, wrap: true, colorIndex: null, fontSizeDeltaPx: 0).
 * Utilisé par chargerDepuisElements() pour peupler le manager avec
 * plusieurs blocs déjà mis en forme, en une seule fois.
 */
export interface BlocInitial {
  texte: string;
  format: Partial<BlockFormatState>;
}

export class EditableBlockManager {
  /** Grand conteneur : uniquement de la mise en page (barre + cadre). À monter dans le DOM via mount(). */
  public readonly container: HTMLDivElement;

  /** Zone du haut : apparaît/disparaît selon qu'un bloc est actif. */
  private readonly toolbarZone: HTMLDivElement;
  /** Accès public en lecture seule à la zone de la barre d'outils (pour mountSplit). */
  public get toolbarElement(): HTMLDivElement {
    return this.toolbarZone;
  }

  /**
   * Cadre : seul élément dont la classe CSS change (édition <-> capture,
   * voir enterCaptureMode()/exitCaptureMode()). Accès public en lecture
   * seule (pour mountSplit, et pour zoneImgtemplate.ts qui a besoin de le
   * déplacer temporairement dans la zone template).
   */
  private readonly scrollFrame: HTMLDivElement;
  public get scrollAreaElement(): HTMLDivElement {
    return this.scrollFrame;
  }

  /**
   * Conteneur qui garde réellement toutes les zones de saisie. Exposé
   * publiquement en lecture seule sous le nom `content`. Ne reçoit plus
   * aucune classe/style dynamique : une seule classe CSS fixe (largeur du
   * parent, hauteur du contenu) — voir editable-block-manager__blocks en
   * CSS.
   */
  private readonly blocksContainer: HTMLDivElement;
  public get content(): HTMLDivElement {
    return this.blocksContainer;
  }

  private blocks: EditableBlock[] = [];

  private topLabel: string;
  private bottomLabel: string;
  private placeholder: string;
  private colors: [string, string];

  private isPreview: boolean = false;
  private isCaptureMode: boolean = false;

  private toolbar: BlockFormattingToolbar;
  private activeBlock: EditableBlock | null = null;

  // Taille de police "de base" utilisée par les blocs qui n'ont pas de
  // delta A+/A- : celle utilisée en édition normale (avant enterCaptureMode),
  // et celle trouvée par l'auto-fit une fois en mode capture.
  private readonly baseFontSizePx: number;
  private fittedBaseFontSizePx: number;

  // Position d'origine de scrollFrame dans le DOM, mémorisée par
  // enterCaptureMode() pour permettre à exitCaptureMode() de le remettre
  // exactement là où il était (même parent, même emplacement).
  private scrollFrameHomeParent: HTMLElement | null = null;
  private scrollFrameHomeNextSibling: ChildNode | null = null;

  constructor(
    width: string = "100%",
    height: string = "auto",
    topLabel: string = "+",
    bottomLabel: string = "+",
    placeholder: string = "Écrivez ici...",
    colors: [string, string] = ["#7e7e7e", "#910505" ],
    baseFontSizePx: number = 16
  ) {
    this.topLabel = topLabel;
    this.bottomLabel = bottomLabel;
    this.placeholder = placeholder;
    this.colors = colors;
    this.baseFontSizePx = baseFontSizePx;
    this.fittedBaseFontSizePx = baseFontSizePx;

    // Grand conteneur : uniquement la mise en page (colonne : barre puis cadre)
    this.container = document.createElement("div");
    this.container.classList.add("editable-block-manager");
    this.container.style.width = width;
    this.container.style.height = height;

    // Zone du haut : cachée par défaut (aucun espace réservé), accueille la barre d'outils
    this.toolbarZone = document.createElement("div");
    this.toolbarZone.classList.add("editable-block-manager__toolbar-zone");

    // Cadre : démarre toujours en mode "édition" (voir haut de fichier)
    this.scrollFrame = document.createElement("div");
    this.scrollFrame.classList.add("editable-block-manager__scroll-frame");
    this.scrollFrame.classList.add(CLASSE_SCROLL_FRAME_EDITION);

    // Conteneur des zones de saisie : une seule classe fixe, jamais modifiée
    this.blocksContainer = document.createElement("div");
    this.blocksContainer.classList.add("editable-block-manager__blocks");

    this.scrollFrame.appendChild(this.blocksContainer);
    this.container.append(this.toolbarZone, this.scrollFrame);

    // Barre d'outils unique, partagée par tous les blocs
    const actions: ToolbarActions = {
      onAlign: (align: BlockAlign) => this.applyToActive((b) => b.setAlign(align)),
      onToggleBold: () => this.applyToActive((b) => b.toggleBold()),
      onToggleItalic: () => this.applyToActive((b) => b.toggleItalic()),
      onToggleUnderline: () => this.applyToActive((b) => b.toggleUnderline()),
      onToggleWrap: () => this.applyToActive((b) => b.toggleWrap()),
      onCycleColor: () => this.applyToActive((b) => b.cycleColor()),
      onIncreaseFont: () => this.applyToActive((b) => b.increaseFontSize(this.currentBaseFontSizePx())),
      onDecreaseFont: () => this.applyToActive((b) => b.decreaseFontSize(this.currentBaseFontSizePx())),
      onDelete: () => this.requestDeleteActive(),
    };
    this.toolbar = new BlockFormattingToolbar({ colors: this.colors, actions });
    this.toolbar.mount(this.toolbarZone);

    // On démarre toujours avec un seul bloc, qui reçoit le focus
    const first = this.createBlock();
    this.blocks.push(first);
    this.blocksContainer.appendChild(first.container);
    first.focusEditable();

    // Écoute globale (phase de capture) : un clic qui ne tombe NI sur une
    // div éditable, NI sur la barre d'outils, NI sur un bouton +/- doit
    // désélectionner tout bloc actif. Sans ça, cliquer "ailleurs" (une
    // zone non éditable, du vide, etc.) ne fait PAS perdre nativement le
    // focus à la div éditable en cours -> le bloc restait actif et la
    // barre d'outils visible indéfiniment.
    document.addEventListener("mousedown", this.handleDocumentMouseDown, true);
  }

  /**
   * Force la désélection quand le clic ne concerne ni une zone éditable,
   * ni la barre d'outils, ni un bouton d'insertion +/-. L'activation
   * elle-même n'est JAMAIS déclenchée ici : elle ne vient que du focus
   * natif posé sur une `.editable-block__content` (clic direct dessus
   * ou tabulation) — voir EditableBlock.activate().
   */
  private handleDocumentMouseDown = (event: MouseEvent): void => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    // Clic sur une zone éditable : le focus natif gère lui-même l'activation.
    if (target.closest(".editable-block__content")) return;

    // Clic sur la barre d'outils ou sur un bouton +/- d'insertion : ces
    // boutons empêchent déjà eux-mêmes le vol de focus (preventDefault
    // sur leur propre mousedown), on ne touche à rien ici.
    if (target.closest(".block-toolbar") || target.closest(".editable-block__btn")) return;

    // Toute autre zone (y compris hors du manager) : on désélectionne tout.
    this.blurActiveElement();
  };

  /** Crée un nouvel EditableBlock connecté au manager (insertion + activation + couleurs) */
  private createBlock(): EditableBlock {
    const options: EditableBlockOptions = {
      onTopClick: (refContainer) => this.insertAbove(refContainer),
      onBottomClick: (refContainer) => this.insertBelow(refContainer),
      topLabel: this.topLabel,
      bottomLabel: this.bottomLabel,
      placeholder: this.placeholder,
      colors: this.colors,
      onActivate: (block) => this.handleBlockActivate(block),
      onDeactivate: (block) => this.handleBlockDeactivate(block),
    };
    const block = new EditableBlock(options);
    block.applyEffectiveFontSize(this.currentBaseFontSizePx());
    return block;
  }

  /** Taille de police "de base" actuelle : celle de l'auto-fit si le mode capture est actif, sinon la taille normale */
  private currentBaseFontSizePx(): number {
    return this.isCaptureMode ? this.fittedBaseFontSizePx : this.baseFontSizePx;
  }

  /** Applique une action au bloc actif puis resynchronise la barre d'outils */
  private applyToActive(fn: (block: EditableBlock) => void): void {
    if (!this.activeBlock) return;
    fn(this.activeBlock);
    this.syncToolbar();
  }

  private syncToolbar(): void {
    if (!this.activeBlock) return;
    this.toolbar.syncState(this.activeBlock.getFormatSnapshot(), this.blocks.length > 1);
  }

  /** Un bloc vient de recevoir le focus : on affiche/synchronise la barre d'outils */
  private handleBlockActivate(block: EditableBlock): void {
    this.activeBlock = block;
    this.showToolbarZone();
    this.syncToolbar();
  }

  /**
   * Un bloc vient de perdre le focus. On attend le prochain "tick"
   * (microtask) pour voir si un AUTRE bloc du manager a immédiatement
   * pris le focus (cas normal d'un clic d'un bloc vers un autre) avant
   * de cacher la barre — ce qui évite un clignotement inutile.
   */
  private handleBlockDeactivate(_block: EditableBlock): void {
    queueMicrotask(() => {
      if (!this.container.contains(document.activeElement)) {
        this.activeBlock = null;
        this.hideToolbarZone();
      }
    });
  }

  /** Affiche la zone du haut (la barre reprend sa place, le cadre du dessous rétrécit d'autant) */
  private showToolbarZone(): void {
    this.toolbarZone.classList.add("editable-block-manager__toolbar-zone--visible");
    this.toolbar.show();
  }

  /** Cache la zone du haut (aucun espace réservé : le cadre du dessous occupe alors tout le conteneur) */
  private hideToolbarZone(): void {
    this.toolbar.hide();
    this.toolbarZone.classList.remove("editable-block-manager__toolbar-zone--visible");
  }

  /** Retire le focus de l'élément qui l'a actuellement, sans action de l'utilisateur */
  private blurActiveElement(): void {
    const active = document.activeElement;
    if (active instanceof HTMLElement && this.container.contains(active)) {
      active.blur();
    }
  }

  /** Insère un nouveau bloc juste AU-DESSUS du bloc référencé */
  private insertAbove(refContainer: HTMLDivElement): void {
    const index = this.blocks.findIndex((b) => b.container === refContainer);
    if (index === -1) return;

    const newBlock = this.createBlock();
    this.blocks.splice(index, 0, newBlock);
    this.blocksContainer.insertBefore(newBlock.container, refContainer);

    newBlock.focusEditable();
  }

  /** Insère un nouveau bloc juste EN-DESSOUS du bloc référencé */
  private insertBelow(refContainer: HTMLDivElement): void {
    const index = this.blocks.findIndex((b) => b.container === refContainer);
    if (index === -1) return;

    const newBlock = this.createBlock();
    this.blocks.splice(index + 1, 0, newBlock);

    const nextSibling = refContainer.nextElementSibling;
    if (nextSibling) {
      this.blocksContainer.insertBefore(newBlock.container, nextSibling);
    } else {
      this.blocksContainer.appendChild(newBlock.container);
    }

    newBlock.focusEditable();
  }

  /** Supprime un bloc précis. Impossible s'il ne reste qu'un seul bloc. */
  public deleteBlock(block: EditableBlock): void {
    if (this.blocks.length <= 1) return;

    const index = this.blocks.indexOf(block);
    if (index === -1) return;

    if (this.activeBlock === block) {
      this.activeBlock = null;
    }

    block.destroy();
    this.blocks.splice(index, 1);
  }

  /**
   * Supprime le bloc ACTUELLEMENT ACTIF (appelé par le bouton
   * "supprimer" de la barre d'outils) puis donne le focus au bloc
   * suivant (ou, si c'était le dernier, au nouveau dernier bloc).
   */
  public requestDeleteActive(): void {
    if (!this.activeBlock || this.blocks.length <= 1) return;

    const index = this.blocks.indexOf(this.activeBlock);
    const toDelete = this.activeBlock;
    this.deleteBlock(toDelete);

    const nextIndex = Math.min(index, this.blocks.length - 1);
    const next = this.blocks[nextIndex];
    if (next) {
      next.focusEditable();
    } else {
      this.activeBlock = null;
      this.hideToolbarZone();
    }
  }

  /**
   * Mode aperçu : retire le focus, cache les blocs sans texte, rend
   * tous les blocs restants non modifiables. La classe qui pilote ce
   * mode est posée sur le grand conteneur (this.container), jamais sur
   * blocksContainer.
   */
  public preview(): void {
    this.isPreview = true;
    this.blurActiveElement();
    this.activeBlock = null;
    this.hideToolbarZone();
    this.container.classList.add("editable-block-manager--preview");

    this.blocks.forEach((block) => {
      const hasText = block.getText().length > 0;
      block.setVisible(hasText);
      block.setEditable(false);
    });
  }

  /** Sort du mode aperçu */
  public exitPreview(): void {
    this.isPreview = false;
    this.container.classList.remove("editable-block-manager--preview");

    this.blocks.forEach((block) => {
      block.setVisible(true);
      block.setEditable(true);
    });
  }

  /**
   * Déplace scrollFrame (avec tout son contenu : blocksContainer + tous
   * les blocs) dans `hostFrame`, à la place de l'ancien cadre overlay de
   * zoneImgtemplate.ts, et bascule sa classe CSS de "édition" vers
   * "capture" (les deux étant mutuellement exclusives — jamais les deux
   * en même temps sur scrollFrame). Verrouille aussi l'édition et rend
   * les blocs "seamless" (texte continu, sans distinction visuelle).
   *
   * La position/le parent d'origine de scrollFrame sont mémorisés pour
   * qu'exitCaptureMode() puisse l'y remettre exactement.
   *
   * À utiliser juste avant fitCaptureContent() (voir plus bas) — appeler
   * les deux en 2 temps permet à l'appelant (zoneImgtemplate.ts) de
   * s'assurer que `hostFrame` est bien visible/rendu (ex: ouvrir le panel
   * qui le contient) avant que la mesure de police n'ait lieu.
   */
  public enterCaptureMode(hostFrame: HTMLElement): void {
    if (this.isCaptureMode) return;

    // Mémorise où remettre scrollFrame ensuite
    this.scrollFrameHomeParent = this.scrollFrame.parentElement;
    this.scrollFrameHomeNextSibling = this.scrollFrame.nextSibling;

    // Verrouille l'édition et cache la barre d'outils
    this.blurActiveElement();
    this.activeBlock = null;
    this.hideToolbarZone();
    this.blocks.forEach((b) => b.setEditable(false));

    // Rend les zones indissociables visuellement (aucune bordure/écart visible)
    this.blocks.forEach((b) => b.setSeamless(true));

    // Bascule de classe SUR scrollFrame (seul élément manipulé) : édition -> capture
    this.scrollFrame.classList.remove(CLASSE_SCROLL_FRAME_EDITION);
    this.scrollFrame.classList.add(CLASSE_SCROLL_FRAME_CAPTURE);

    // Déplace le cadre dans son hôte temporaire (à la place de l'ancien overlay)
    hostFrame.appendChild(this.scrollFrame);

    this.isCaptureMode = true;
  }

  /**
   * À appeler après enterCaptureMode(), une fois certain que le nouveau
   * placement de scrollFrame est effectivement rendu (host visible dans
   * le DOM). Ajuste progressivement une taille de police COMMUNE à tous
   * les blocs pour remplir un maximum de l'espace du cadre SANS déborder.
   */
  public async fitCaptureContent(): Promise<void> {
    if (!this.isCaptureMode) return;

    // Attend la frame suivante pour être sûr que la bascule de classe et
    // le déplacement dans le DOM sont bien rendus avant de mesurer.
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

    this.autoFitFontSize();
  }

  /**
   * Inverse enterCaptureMode()/fitCaptureContent() : remet scrollFrame
   * exactement là où il était (même parent, même emplacement), lui
   * redonne sa classe "édition", annule le mode "texte continu", remet
   * la police par défaut et redonne l'édition. À appeler après la
   * capture, que celle-ci ait réussi ou échoué.
   */
  public exitCaptureMode(): void {
    if (!this.isCaptureMode) return;

    // Bascule de classe SUR scrollFrame : capture -> édition
    this.scrollFrame.classList.remove(CLASSE_SCROLL_FRAME_CAPTURE);
    this.scrollFrame.classList.add(CLASSE_SCROLL_FRAME_EDITION);

    // Remet scrollFrame exactement à sa place d'origine dans le DOM
    if (this.scrollFrameHomeParent) {
      if (
        this.scrollFrameHomeNextSibling &&
        this.scrollFrameHomeNextSibling.parentNode === this.scrollFrameHomeParent
      ) {
        this.scrollFrameHomeParent.insertBefore(this.scrollFrame, this.scrollFrameHomeNextSibling);
      } else {
        this.scrollFrameHomeParent.appendChild(this.scrollFrame);
      }
    }
    this.scrollFrameHomeParent = null;
    this.scrollFrameHomeNextSibling = null;

    // Annule le mode "texte continu"
    this.blocks.forEach((b) => b.setSeamless(false));

    // Remet la police par défaut (et remet à zéro le delta A+/A- de chaque bloc)
    this.blocks.forEach((b) => b.resetFontSize());
    this.fittedBaseFontSizePx = this.baseFontSizePx;

    // Rend les zones à nouveau modifiables
    this.blocks.forEach((b) => b.setEditable(true));

    this.isCaptureMode = false;

    // Redonne le focus au premier bloc, comme au départ
    if (this.blocks.length > 0) {
      this.blocks[0].focusEditable();
    }
  }

  /**
   * Réduit la police commune au minimum, puis l'augmente
   * progressivement tant que le contenu ne déborde pas du cadre
   * (scrollFrame). Chaque bloc applique cette taille commune + SON PROPRE
   * delta A+/A- (voir EditableBlock.applyEffectiveFontSize), donc les
   * blocs déjà agrandis/réduits manuellement restent différenciés.
   */
  private autoFitFontSize(): void {
    const minFont = 6;
    const maxFont = 300;
    let bestFit = minFont;

    this.setFontSizeForAll(minFont);

    for (let size = minFont; size <= maxFont; size++) {
      this.setFontSizeForAll(size);
      if (this.isOverflowing()) {
        bestFit = size - 1;
        break;
      }
      bestFit = size;
    }

    const finalSize = Math.max(bestFit, minFont);
    this.setFontSizeForAll(finalSize);
    this.fittedBaseFontSizePx = finalSize;
  }

  private setFontSizeForAll(base: number): void {
    this.blocks.forEach((b) => b.applyEffectiveFontSize(base));
  }

  /**
   * Vrai si le contenu dépasse le cadre disponible (scrollFrame).
   *
   * La hauteur se vérifie en comparant la hauteur RÉELLE du contenu
   * (blocksContainer.scrollHeight — blocksContainer n'ayant plus de
   * hauteur fixe, elle vaut toujours la hauteur de son contenu) à la
   * hauteur DISPONIBLE dans le cadre (scrollFrame.clientHeight, fixe en
   * mode capture).
   *
   * La largeur, elle, ne peut PAS se vérifier de la même façon : chaque
   * bloc garde une largeur fixe (width: 100%), donc quand un bloc est en
   * mode "nowrap" (retour à la ligne désactivé, overflow-x: auto sur sa
   * div éditable), son texte peut déborder À L'INTÉRIEUR de la div sans
   * jamais agrandir le scrollWidth de blocksContainer. Il faut donc
   * comparer, bloc par bloc, le scrollWidth propre de chaque div
   * éditable à la largeur (clientWidth) de blocksContainer, qui reflète
   * la largeur interne réellement disponible.
   */
  private isOverflowing(): boolean {
    let enfantDeborde = false;
    for (let b of this.blocks) {
      const d = b.getContentEditable();
      if (d.scrollWidth > this.blocksContainer.clientWidth) {
        enfantDeborde = true;
        break;
      }
    }

    return (
      this.blocksContainer.scrollHeight > this.scrollFrame.clientHeight || enfantDeborde
    );
  }

  /** Retourne le texte de tous les blocs, dans l'ordre visuel */
  public getAllTexts(): string[] {
    return this.blocks.map((b) => b.getText());
  }

  /** Retourne la liste des instances EditableBlock, dans l'ordre visuel */
  public getBlocks(): EditableBlock[] {
    return [...this.blocks];
  }

  /** Insère le conteneur dans le DOM à l'intérieur d'un parent donné */
  public mount(parent: HTMLElement): void {
    parent.appendChild(this.container);
  }

  /**
   * Variante de mount() qui sépare la barre d'outils de la zone
   * scrollable, dans deux parents DIFFÉRENTS : la barre d'outils reste
   * fixe (n'a pas vocation à défiler), seule la zone scrollable (qui
   * porte toutes les zones éditables) doit défiler. À utiliser quand
   * l'appelant a besoin que le scroll ne concerne QUE le contenu, pas
   * la barre — sinon, préférer mount().
   */
  public mountSplit(toolbarParent: HTMLElement, scrollAreaParent: HTMLElement): void {
    toolbarParent.appendChild(this.toolbarZone);
    scrollAreaParent.appendChild(this.scrollFrame);
  }

  /** Réinitialise tout : efface tous les blocs et remet un bloc unique vide, focus */
  public init(): void {
    // Si le manager était en plein cycle de capture (cas anormal), on
    // annule proprement avant de tout réinitialiser.
    if (this.isCaptureMode) {
      this.exitCaptureMode();
    }

    this.blurActiveElement();
    this.blocks.forEach((b) => b.destroy());
    this.blocks = [];

    this.isPreview = false;
    this.activeBlock = null;
    this.hideToolbarZone();
    this.container.classList.remove("editable-block-manager--preview");

    const first = this.createBlock();
    this.blocks.push(first);
    this.blocksContainer.appendChild(first.container);
    first.focusEditable();
  }

  /**
   * Remplace tout le contenu actuel du manager par une nouvelle liste de
   * blocs, empilés les uns EN DESSOUS des autres dans l'ordre du tableau
   * fourni, chacun recevant son texte et sa mise en forme initiale (voir
   * BlocInitial). Si le tableau est vide, se comporte comme init() (un
   * seul bloc vide, mise en forme par défaut).
   *
   * Comme init(), annule d'abord proprement un éventuel cycle de capture
   * en cours, vide tous les blocs existants, et donne le focus au premier
   * bloc créé.
   */
  public chargerDepuisElements(elements: BlocInitial[]): void {
    if (this.isCaptureMode) {
      this.exitCaptureMode();
    }

    this.blurActiveElement();
    this.blocks.forEach((b) => b.destroy());
    this.blocks = [];

    this.isPreview = false;
    this.activeBlock = null;
    this.hideToolbarZone();
    this.container.classList.remove("editable-block-manager--preview");

    const listeElements: BlocInitial[] = elements.length > 0 ? elements : [{ texte: "", format: {} }];

    listeElements.forEach((element, index) => {
      const bloc = this.createBlock();
      bloc.setText(element.texte);
      bloc.applyFormatState(element.format);
      // Réapplique la taille effective (base + delta) : createBlock()
      // l'avait déjà fait avec un delta à 0, applyFormatState peut avoir
      // changé ce delta juste au-dessus.
      bloc.applyEffectiveFontSize(this.currentBaseFontSizePx());

      this.blocks.push(bloc);
      this.blocksContainer.appendChild(bloc.container);

      if (index === 0) {
        bloc.focusEditable();
      }
    });
  }

  /** Retire complètement le conteneur du DOM (que mount() ou mountSplit() ait été utilisé) */
  public destroy(): void {
    document.removeEventListener("mousedown", this.handleDocumentMouseDown, true);
    this.toolbar.destroy();
    this.toolbarZone.remove();
    this.scrollFrame.remove();
    this.container.remove();
  }
}