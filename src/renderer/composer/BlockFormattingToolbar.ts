/**
 * BlockFormattingToolbar
 * -----------------------
 * Barre d'outils UNIQUE, partagée par tous les EditableBlock d'un même
 * EditableBlockManager. Elle ne connaît aucun bloc directement : le
 * manager lui fournit des `actions` (callbacks) et lui demande de se
 * "synchroniser" (syncState) avec l'état du bloc actuellement actif.
 *
 * Comportement :
 *  - cachée par défaut (aucun bloc actif) ;
 *  - apparaît + se met à jour quand un bloc devient actif
 *    (EditableBlockManager appelle show() puis syncState()) ;
 *  - disparaît quand plus aucun bloc n'est actif (EditableBlockManager
 *    appelle hide()).
 *
 * Boutons (icônes Material Icons via la classe .iconMateriel fournie
 * par le projet, en utilisant le nom de la ligature comme texte) :
 *   format_align_left / format_align_center / format_align_justify /
 *   format_align_right, wrap_text (retour à la ligne), format_bold,
 *   format_underlined, format_italic, palette (couleur, 2 couleurs
 *   disponibles + "aucune"), A+ / A- (texte brut, pas une icône),
 *   delete (masqué automatiquement s'il ne reste qu'une seule zone).
 *
 * Chaque bouton empêche son propre "mousedown" de voler le focus à la
 * zone éditable (comme les boutons +/- d'EditableBlock), et affiche
 * une infobulle native via l'attribut `title`. Les boutons ne portent
 * aucun texte visible : uniquement l'icône (ligature Material Icons en
 * `textContent` du `<span class="iconMateriel">`), sauf A+ / A- qui
 * n'ont pas d'équivalent Material Icons et restent en texte brut.
 */

import { BlockAlign, BlockFormatState } from "./EditableBlock.js";

export interface ToolbarActions {
  onAlign: (align: BlockAlign) => void;
  onToggleBold: () => void;
  onToggleItalic: () => void;
  onToggleUnderline: () => void;
  onToggleWrap: () => void;
  onCycleColor: () => void;
  onIncreaseFont: () => void;
  onDecreaseFont: () => void;
  onDelete: () => void;
}

export interface BlockFormattingToolbarOptions {
  /** Les 2 couleurs proposées par le bouton palette */
  colors: [string, string];
  actions: ToolbarActions;
}

interface IconButtonConfig {
  /** Nom de la ligature Material Icons (ex: "format_bold") */
  icon?: string;
  /** Texte brut affiché à la place d'une icône (ex: "A+") */
  label?: string;
  tooltip: string;
  onClick: () => void;
  extraClass?: string;
}

const ALIGN_ORDER: BlockAlign[] = ["left", "center", "justify", "right"];

export class BlockFormattingToolbar {
  public readonly element: HTMLDivElement;

  private colors: [string, string];
  private actions: ToolbarActions;

  private alignButtons = new Map<BlockAlign, HTMLButtonElement>();
  private boldButton: HTMLButtonElement;
  private italicButton: HTMLButtonElement;
  private underlineButton: HTMLButtonElement;
  private wrapButton: HTMLButtonElement;
  private colorButton: HTMLButtonElement;
  private colorSwatch: HTMLSpanElement;
  private deleteButton: HTMLButtonElement;

  constructor(options: BlockFormattingToolbarOptions) {
    this.colors = options.colors;
    this.actions = options.actions;

    this.element = document.createElement("div");
    this.element.classList.add("block-toolbar");

    // --- Groupe alignement ---
    const alignGroup = this.buildGroup();
    ALIGN_ORDER.forEach((align) => {
      const btn = this.createIconButton({
        icon: this.alignIcon(align),
        tooltip: this.alignTooltip(align),
        onClick: () => this.actions.onAlign(align),
      });
      this.alignButtons.set(align, btn);
      alignGroup.appendChild(btn);
    });

    // --- Retour à la ligne (séparé, comme sur la maquette fournie) ---
    this.wrapButton = this.createIconButton({
      icon: "wrap_text",
      tooltip: "Retour à la ligne automatique",
      onClick: () => this.actions.onToggleWrap(),
    });

    // --- Groupe gras / souligné / italique ---
    const styleGroup = this.buildGroup();
    this.boldButton = this.createIconButton({
      icon: "format_bold",
      tooltip: "Gras",
      onClick: () => this.actions.onToggleBold(),
    });
    this.underlineButton = this.createIconButton({
      icon: "format_underlined",
      tooltip: "Souligné",
      onClick: () => this.actions.onToggleUnderline(),
    });
    this.italicButton = this.createIconButton({
      icon: "format_italic",
      tooltip: "Italique",
      onClick: () => this.actions.onToggleItalic(),
    });
    styleGroup.append(this.boldButton, this.underlineButton, this.italicButton);

    // --- Groupe couleur / taille / suppression ---
    const utilGroup = this.buildGroup();

    this.colorButton = this.createIconButton({
      icon: "palette",
      tooltip: "Changer la couleur du texte",
      onClick: () => this.actions.onCycleColor(),
    });
    this.colorSwatch = document.createElement("span");
    this.colorSwatch.classList.add("block-toolbar__swatch");
    this.colorButton.appendChild(this.colorSwatch);

    const increaseBtn = this.createIconButton({
      label: "A+",
      tooltip: "Agrandir la police",
      onClick: () => this.actions.onIncreaseFont(),
    });
    const decreaseBtn = this.createIconButton({
      label: "A-",
      tooltip: "Réduire la police",
      onClick: () => this.actions.onDecreaseFont(),
    });

    this.deleteButton = this.createIconButton({
      icon: "delete",
      tooltip: "Supprimer cette zone",
      onClick: () => this.actions.onDelete(),
      extraClass: "block-toolbar__btn--danger",
    });

    utilGroup.append(this.colorButton, increaseBtn, decreaseBtn, this.deleteButton);

    this.element.append(alignGroup, this.wrapButton, styleGroup, utilGroup);

    this.hide();
  }

  private buildGroup(): HTMLDivElement {
    const group = document.createElement("div");
    group.classList.add("block-toolbar__group");
    return group;
  }

  private alignIcon(align: BlockAlign): string {
    switch (align) {
      case "left":
        return "format_align_left";
      case "center":
        return "format_align_center";
      case "justify":
        return "format_align_justify";
      case "right":
        return "format_align_right";
      default:
        return "format_align_left";
    }
  }

  private alignTooltip(align: BlockAlign): string {
    switch (align) {
      case "left":
        return "Aligner à gauche";
      case "center":
        return "Centrer";
      case "justify":
        return "Justifier";
      case "right":
        return "Aligner à droite";
      default:
        return "";
    }
  }

  private createIconButton(config: IconButtonConfig): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.classList.add("block-toolbar__btn");
    if (config.extraClass) {
      btn.classList.add(config.extraClass);
    }
    btn.title = config.tooltip; // infobulle native du navigateur

    if (config.icon) {
      const span = document.createElement("span");
      span.classList.add("iconMateriel");
      span.textContent = config.icon;
      btn.appendChild(span);
    } else if (config.label) {
      const span = document.createElement("span");
      span.classList.add("block-toolbar__label");
      span.textContent = config.label;
      btn.appendChild(span);
    }

    // Empêche le clic sur la barre d'outils de voler le focus à la zone éditable active
    btn.addEventListener("mousedown", (e) => e.preventDefault());
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      config.onClick();
    });

    return btn;
  }

  /**
   * Met à jour l'état visuel (bouton "pressé", couleur du témoin,
   * visibilité du bouton supprimer) selon le bloc actuellement actif.
   */
  public syncState(state: BlockFormatState, canDelete: boolean): void {
    this.alignButtons.forEach((btn, align) => {
      btn.classList.toggle("block-toolbar__btn--active", state.align === align);
    });

    this.boldButton.classList.toggle("block-toolbar__btn--active", state.bold);
    this.italicButton.classList.toggle("block-toolbar__btn--active", state.italic);
    this.underlineButton.classList.toggle("block-toolbar__btn--active", state.underline);
    this.wrapButton.classList.toggle("block-toolbar__btn--active", state.wrap);

    const currentColor = state.colorIndex === null ? "" : this.colors[state.colorIndex];
    this.colorSwatch.style.background = currentColor || "transparent";
    this.colorButton.classList.toggle("block-toolbar__btn--active", state.colorIndex !== null);

    this.deleteButton.style.display = canDelete ? "" : "none";
  }

  /** Met à jour les 2 couleurs affichées par le témoin du bouton palette */
  public setColors(colors: [string, string]): void {
    this.colors = colors;
  }

  public show(): void {
    this.element.classList.add("block-toolbar--visible");
  }

  public hide(): void {
    this.element.classList.remove("block-toolbar--visible");
  }

  /** Insère la barre dans le conteneur donné (désormais une zone dédiée : editable-block-manager__toolbar-zone) */
  public mount(parent: HTMLElement): void {
    parent.appendChild(this.element);
  }

  public destroy(): void {
    this.element.remove();
  }
}