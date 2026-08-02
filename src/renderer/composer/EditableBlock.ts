/**
 * EditableBlock
 * -------------
 * Crée un conteneur <div> contenant :
 *   - un bouton "du haut"   -> insère un nouveau bloc au-dessus
 *   - une div éditable (contentEditable)
 *   - un bouton "du bas"    -> insère un nouveau bloc en-dessous
 *
 * La sélection est pilotée directement par le focus natif du navigateur
 * sur la zone éditable.
 *   - focus  -> activate()   -> les boutons apparaissent + onActivate()
 *   - blur   -> deactivate() -> les boutons disparaissent + onDeactivate()
 *
 * Astuce : les boutons empêchent leur propre "mousedown" de voler le
 * focus (preventDefault), sinon cliquer dessus ferait perdre le focus
 * à la zone éditable AVANT que le clic ne soit traité.
 *
 * ------------------------------------------------------------------
 * Mise en forme minimale (nouveau)
 * ------------------------------------------------------------------
 * Chaque bloc porte désormais un petit état de mise en forme
 * (BlockFormatState) appliqué à l'ENSEMBLE de sa zone éditable (pas
 * une sélection de texte) :
 *   - alignement (gauche / centre / justifié / droite)
 *   - gras / italique / souligné
 *   - retour à la ligne automatique (oui/non)
 *   - couleur du texte (aucune, ou l'une des 2 couleurs fournies)
 *   - un delta de taille de police (px), utilisé par les boutons A+/A-
 *     et respecté par EditableBlockManager.autoFitFontSize() pour que les
 *     blocs déjà agrandis/réduits manuellement gardent leur différence
 *     relative après un nouvel ajustement automatique.
 *
 * C'est EditableBlockManager (via sa BlockFormattingToolbar) qui pilote
 * ces méthodes ; EditableBlock ne sait pas dessiner de barre d'outils,
 * il expose juste les actions et son état courant (getFormatSnapshot).
 */

export type EditableBlockCallback = (container: HTMLDivElement) => void;
export type EditableBlockActivationCallback = (block: EditableBlock) => void;

export type BlockAlign = "left" | "center" | "right" | "justify";

export interface BlockFormatState {
  align: BlockAlign;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  /** true = le texte revient à la ligne (normal), false = pas de retour à la ligne (nowrap) */
  wrap: boolean;
  /** index dans le tableau `colors` fourni au bloc, ou null = couleur par défaut */
  colorIndex: number | null;
  /** décalage (px) appliqué par-dessus la taille de police "de base" courante */
  fontSizeDeltaPx: number;
}

export interface EditableBlockOptions {
  onTopClick: EditableBlockCallback;
  onBottomClick: EditableBlockCallback;
  topLabel?: string;
  bottomLabel?: string;
  placeholder?: string;
  /** Les 2 couleurs disponibles pour ce bloc (cyclées par le bouton palette) */
  colors?: [string, string];
  /** Appelé quand le bloc devient actif (focus) */
  onActivate?: EditableBlockActivationCallback;
  /** Appelé quand le bloc devient inactif (blur) */
  onDeactivate?: EditableBlockActivationCallback;
}

const MIN_FONT_PX = 6;

export class EditableBlock {
  public readonly container: HTMLDivElement;

  private editableDiv: HTMLDivElement;
  private topButton: HTMLButtonElement;
  private bottomButton: HTMLButtonElement;
  private active: boolean = false;

  private colors: [string, string];
  private onActivateCb?: EditableBlockActivationCallback;
  private onDeactivateCb?: EditableBlockActivationCallback;

  private format: BlockFormatState = {
    align: "left",
    bold: false,
    italic: false,
    underline: false,
    wrap: true,
    colorIndex: null,
    fontSizeDeltaPx: 0,
  };

  constructor(options: EditableBlockOptions) {
    const {
      onTopClick,
      onBottomClick,
      topLabel = "+",
      bottomLabel = "+",
      placeholder = "Écrivez ici...",
      colors = ["#1a1a1a", "#e63946"],
      onActivate,
      onDeactivate,
    } = options;

    this.colors = colors;
    this.onActivateCb = onActivate;
    this.onDeactivateCb = onDeactivate;

    // Conteneur principal
    this.container = document.createElement("div");
    this.container.classList.add("editable-block");

    // Bouton du haut : insère un nouveau bloc au-dessus
    this.topButton = document.createElement("button");
    this.topButton.type = "button";
    this.topButton.textContent = topLabel;
    this.topButton.classList.add("editable-block__btn", "editable-block__btn--top");
    this.topButton.addEventListener("mousedown", (e) => e.preventDefault());
    this.topButton.addEventListener("click", () => {
      onTopClick(this.container);
    });

    // Div éditable : source unique de vérité pour la sélection (focus/blur)
    this.editableDiv = document.createElement("div");
    this.editableDiv.classList.add("editable-block__content");
    this.editableDiv.contentEditable = "true";
    //this.editableDiv.setAttribute("data-placeholder", placeholder);
    this.editableDiv.addEventListener("focus", () => this.activate());
    this.editableDiv.addEventListener("blur", () => this.deactivate());
    this.editableDiv.addEventListener("paste", this.handlePaste);

    // Bouton du bas : insère un nouveau bloc en-dessous
    this.bottomButton = document.createElement("button");
    this.bottomButton.type = "button";
    this.bottomButton.textContent = bottomLabel;
    this.bottomButton.classList.add("editable-block__btn", "editable-block__btn--bottom");
    this.bottomButton.addEventListener("mousedown", (e) => e.preventDefault());
    this.bottomButton.addEventListener("click", () => {
      onBottomClick(this.container);
    });

    // Assemblage
    this.container.appendChild(this.topButton);
    this.container.appendChild(this.editableDiv);
    this.container.appendChild(this.bottomButton);

    // Applique l'état de mise en forme initial (valeurs par défaut) au DOM
    this.applyAllFormatStyles();

    // Un bloc démarre toujours inactif tant qu'il n'a pas le focus
    this.deactivate();
  }

  /** Récupère le texte actuellement écrit */
  public getText(): string {
    return this.editableDiv.innerText.trim();
  }

  /**
   * Largeur réelle du contenu de la zone éditable (scrollWidth).
   * Utile pour détecter un débordement horizontal en mode "nowrap"
   * (white-space: pre) : dans ce cas editableDiv a overflow-x: auto,
   * donc le texte peut déborder à L'INTÉRIEUR de la div sans jamais
   * agrandir le scrollWidth du conteneur parent (blocksContainer), qui
   * garde une largeur fixe (width: 100%). Il faut donc comparer ce
   * scrollWidth à la largeur du conteneur des zones directement, bloc
   * par bloc (voir EditableBlockManager.isOverflowing()).
   */
  public getContentEditable(): HTMLDivElement {
    return this.editableDiv;
  }

  /** Modifie le texte affiché */
  public setText(text: string): void {
    this.editableDiv.innerText = text;
  }

  /** Donne le focus à la zone éditable (déclenche activate() via l'event 'focus') */
  public focusEditable(): void {
    this.editableDiv.focus();
  }

  /**
   * Force un collage en TEXTE BRUT uniquement : on empêche le
   * comportement par défaut du navigateur (qui coller du HTML avec ses
   * propres balises/styles) et on insère à la place le texte brut du
   * presse-papier, à l'endroit du curseur, en respectant la sélection
   * courante (remplace le texte sélectionné s'il y en a une).
   */
  private handlePaste = (event: ClipboardEvent): void => {
    event.preventDefault();

    const text = event.clipboardData?.getData("text/plain") ?? "";
    if (!text) return;

    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;

    const range = selection.getRangeAt(0);
    range.deleteContents();

    // Insère le texte brut ligne par ligne, avec de vrais retours à la
    // ligne (<br>), pour ne coller AUCUNE balise/mise en forme héritée
    // du contenu copié (gras, liens, couleurs, listes, etc.).
    const lines = text.split(/\r\n|\r|\n/);
    const fragment = document.createDocumentFragment();
    lines.forEach((line, index) => {
      fragment.appendChild(document.createTextNode(line));
      if (index < lines.length - 1) {
        fragment.appendChild(document.createElement("br"));
      }
    });

    range.insertNode(fragment);

    // Replace le curseur juste après le texte inséré
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
  };

  /** Retire le focus de la zone éditable (déclenche deactivate() via l'event 'blur') */
  public blurEditable(): void {
    this.editableDiv.blur();
  }

  /** Active le bloc : affiche les boutons (appelé automatiquement au focus) */
  public activate(): void {
    this.active = true;
    this.container.classList.add("editable-block--active");
    this.container.classList.remove("editable-block--inactive");
    this.onActivateCb?.(this);
  }

  /** Désactive le bloc : cache les boutons (appelé automatiquement au blur) */
  public deactivate(): void {
    this.active = false;
    this.container.classList.remove("editable-block--active");
    this.container.classList.add("editable-block--inactive");
    this.onDeactivateCb?.(this);
  }

  /** Indique si le bloc est actif */
  public isActive(): boolean {
    return this.active;
  }

  /** Affiche ou cache complètement le bloc */
  public setVisible(visible: boolean): void {
    this.container.style.display = visible ? "" : "none";
  }

  /** Rend la zone éditable modifiable ou non */
  public setEditable(editable: boolean): void {
    this.editableDiv.contentEditable = editable ? "true" : "false";
  }

  /**
   * Mode "texte continu" : supprime toute distinction visuelle du bloc
   * (bordures, fond, padding, écart) pour qu'il se fonde avec les
   * autres blocs, comme un seul bloc de texte.
   */
  public setSeamless(seamless: boolean): void {
    this.container.classList.toggle("editable-block--seamless", seamless);
  }

  /** Fixe une taille de police précise (en px) sur la zone éditable, sans toucher au delta A+/A- */
  public setFontSize(px: number): void {
    this.editableDiv.style.fontSize = `${px}px`;
  }

  /** Retire la taille de police forcée, revient à la taille par défaut du CSS, et remet le delta A+/A- à zéro */
  public resetFontSize(): void {
    this.editableDiv.style.fontSize = "";
    this.format.fontSizeDeltaPx = 0;
  }

  // ------------------------------------------------------------------
  // Mise en forme minimale : alignement / gras / italique / souligné /
  // retour à la ligne / couleur / taille de police relative
  // ------------------------------------------------------------------

  /** Applique un alignement de texte au bloc */
  public setAlign(align: BlockAlign): void {
    this.format.align = align;
    this.editableDiv.style.textAlign = align;
  }

  public getAlign(): BlockAlign {
    return this.format.align;
  }

  /** Bascule le gras, retourne le nouvel état */
  public toggleBold(): boolean {
    this.setBold(!this.format.bold);
    return this.format.bold;
  }

  /** Fixe directement l'état gras (à la différence de toggleBold, qui bascule) */
  public setBold(bold: boolean): void {
    this.format.bold = bold;
    this.editableDiv.style.fontWeight = bold ? "bold" : "normal";
  }

  /** Bascule l'italique, retourne le nouvel état */
  public toggleItalic(): boolean {
    this.setItalic(!this.format.italic);
    return this.format.italic;
  }

  /** Fixe directement l'état italique (à la différence de toggleItalic, qui bascule) */
  public setItalic(italic: boolean): void {
    this.format.italic = italic;
    this.editableDiv.style.fontStyle = italic ? "italic" : "normal";
  }

  /** Bascule le soulignement, retourne le nouvel état */
  public toggleUnderline(): boolean {
    this.setUnderline(!this.format.underline);
    return this.format.underline;
  }

  /** Fixe directement le soulignement (à la différence de toggleUnderline, qui bascule) */
  public setUnderline(underline: boolean): void {
    this.format.underline = underline;
    this.editableDiv.style.textDecoration = underline ? "underline" : "none";
  }

  /** Bascule le retour à la ligne automatique, retourne le nouvel état */
  public toggleWrap(): boolean {
    this.setWrap(!this.format.wrap);
    return this.format.wrap;
  }

  /** Fixe directement le retour à la ligne automatique (à la différence de toggleWrap, qui bascule) */
  public setWrap(wrap: boolean): void {
    this.format.wrap = wrap;
    this.editableDiv.style.whiteSpace = wrap ? "pre-wrap" : "pre";
    this.editableDiv.style.overflowX = wrap ? "hidden" : "auto";
  }

  /**
   * Fait défiler la couleur du texte : aucune -> couleur 1 -> couleur 2 -> aucune.
   * Retourne le nouvel index de couleur (null = couleur par défaut).
   */
  public cycleColor(): number | null {
    const next = this.format.colorIndex === null ? 0 : this.format.colorIndex === 0 ? 1 : null;
    this.setColorIndex(next);
    return next;
  }

  /** Fixe directement l'index de couleur (à la différence de cycleColor, qui bascule) */
  public setColorIndex(index: number | null): void {
    this.format.colorIndex = index;
    this.editableDiv.style.color = index === null ? "" : this.colors[index];
  }

  /** Met à jour les 2 couleurs disponibles pour ce bloc (et ré-applique la couleur courante) */
  public setColors(colors: [string, string]): void {
    this.colors = colors;
    if (this.format.colorIndex !== null) {
      this.editableDiv.style.color = this.colors[this.format.colorIndex];
    }
  }

  /** Augmente le delta de taille de police et ré-applique la taille effective (base + delta) */
  public increaseFontSize(currentBasePx: number, step: number = 2): number {
    this.format.fontSizeDeltaPx += step;
    this.applyEffectiveFontSize(currentBasePx);
    return this.format.fontSizeDeltaPx;
  }

  /** Diminue le delta de taille de police (sans descendre sous MIN_FONT_PX) et ré-applique */
  public decreaseFontSize(currentBasePx: number, step: number = 2): number {
    const minDelta = MIN_FONT_PX - currentBasePx;
    this.format.fontSizeDeltaPx = Math.max(minDelta, this.format.fontSizeDeltaPx - step);
    this.applyEffectiveFontSize(currentBasePx);
    return this.format.fontSizeDeltaPx;
  }

  /** Applique la taille effective = base courante (fournie par le manager) + delta propre au bloc */
  public applyEffectiveFontSize(basePx: number): void {
    const size = Math.max(MIN_FONT_PX, basePx + this.format.fontSizeDeltaPx);
    this.editableDiv.style.fontSize = `${size}px`;
  }

  public getFontSizeDeltaPx(): number {
    return this.format.fontSizeDeltaPx;
  }

  /**
   * Fixe directement le delta de taille de police (à la différence de
   * increaseFontSize/decreaseFontSize, qui l'incrémentent/décrémentent
   * par pas). Ne réapplique PAS la taille effective elle-même : celle-ci
   * dépend de la base courante, connue seulement du manager — appeler
   * applyEffectiveFontSize(basePx) juste après si le rendu doit être
   * immédiat.
   */
  public setFontSizeDeltaPx(deltaPx: number): void {
    this.format.fontSizeDeltaPx = deltaPx;
  }

  /** Copie de l'état de mise en forme courant, pour synchroniser une barre d'outils */
  public getFormatSnapshot(): BlockFormatState {
    return { ...this.format };
  }

  /**
   * Applique directement un état de mise en forme fourni : à la
   * différence des méthodes toggle...() / cycleColor() (qui basculent
   * l'état courant), celle-ci FIXE chaque valeur donnée. Les champs omis
   * dans `format` gardent la valeur déjà en place sur le bloc (pas de
   * valeur par défaut imposée ici). Utilisée pour préremplir un bloc avec
   * une mise en forme initiale connue à l'avance (voir
   * EditableBlockManager.chargerDepuisElements).
   */
  public applyFormatState(format: Partial<BlockFormatState>): void {
    if (format.align !== undefined) this.setAlign(format.align);
    if (format.bold !== undefined) this.setBold(format.bold);
    if (format.italic !== undefined) this.setItalic(format.italic);
    if (format.underline !== undefined) this.setUnderline(format.underline);
    if (format.wrap !== undefined) this.setWrap(format.wrap);
    if (format.colorIndex !== undefined) this.setColorIndex(format.colorIndex);
    if (format.fontSizeDeltaPx !== undefined) this.setFontSizeDeltaPx(format.fontSizeDeltaPx);
  }

  /** Ré-applique tous les styles issus de `format` (utile juste après construction) */
  private applyAllFormatStyles(): void {
    this.editableDiv.style.textAlign = this.format.align;
    this.editableDiv.style.fontWeight = this.format.bold ? "bold" : "normal";
    this.editableDiv.style.fontStyle = this.format.italic ? "italic" : "normal";
    this.editableDiv.style.textDecoration = this.format.underline ? "underline" : "none";
    this.editableDiv.style.whiteSpace = this.format.wrap ? "pre-wrap" : "pre";
    this.editableDiv.style.overflowX = this.format.wrap ? "hidden" : "auto";
    this.editableDiv.style.color = this.format.colorIndex === null ? "" : this.colors[this.format.colorIndex];
  }

  /** Insère le bloc dans le DOM à l'intérieur d'un parent donné */
  public mount(parent: HTMLElement): void {
    parent.appendChild(this.container);
  }

  /** Retire le bloc du DOM */
  public destroy(): void {
    this.editableDiv.removeEventListener("paste", this.handlePaste);
    this.container.remove();
  }
}