/**
 * SelectableList
 * ----------------
 * Classe qui prend une <div> hôte, la vide, puis y injecte :
 *  - un en-tête avec le nombre total d'éléments et le nombre d'éléments sélectionnés
 *  - une zone scrollable (et uniquement celle-ci) affichant les éléments en grille
 *    (ou un message centré si la liste est vide)
 *  - un bouton d'exportation, visible uniquement si au moins un élément est sélectionné
 *
 * Utilisation :
 *   const list = new SelectableList(document.getElementById("mon-div")!, {
 *     onExport: (selected) => console.log(selected),
 *   });
 *   list.setItems(["Pomme", "Banane", "Cerise"]);
 *   list.getSelectedItems();
 */

export interface SelectableItem {
  id: string;
  text: string;
}

export type SelectableListInput = string | SelectableItem;

export interface SelectableListOptions {
  /** Appelé quand l'utilisateur clique sur le bouton d'export */
  onExport?: (selected: SelectableItem[]) => void;
  /** Appelé à chaque changement de sélection */
  onSelectionChange?: (selected: SelectableItem[]) => void;
  /** Texte du bouton d'export (par défaut "Exporter") */
  exportLabel?: string;
  /** Texte affiché au centre quand la liste est vide (par défaut "Aucun élément") */
  emptyLabel?: string;
  /** Permet la multi-sélection (par défaut true) */
  multiSelect?: boolean;
}

export class SelectableList {
  private host: HTMLElement;
  private options: Required<SelectableListOptions>;

  private items: SelectableItem[] = [];
  private selectedIds: Set<string> = new Set();

  // Références DOM internes
  private rootEl!: HTMLDivElement;
  private totalCountEl!: HTMLSpanElement;
  private selectedCountEl!: HTMLSpanElement;
  private itemsContainerEl!: HTMLDivElement;
  private emptyStateEl!: HTMLDivElement;
  private exportBtnEl!: HTMLButtonElement;
  private toggleAllBtnEl!: HTMLButtonElement;

  constructor(host: HTMLElement, options: SelectableListOptions = {}) {
    this.host = host;
    this.options = {
      onExport: options.onExport ?? (() => {}),
      onSelectionChange: options.onSelectionChange ?? (() => {}),
      exportLabel: options.exportLabel ?? "Exporter",
      emptyLabel: options.emptyLabel ?? "Aucun élément",
      multiSelect: options.multiSelect ?? true,
    };

    this.buildSkeleton();
  }

  // ---------------------------------------------------------------------
  // Construction du DOM (une seule fois)
  // ---------------------------------------------------------------------
  private buildSkeleton(): void {
    
    this.rootEl = document.createElement("div");
    this.rootEl.className = "sl-container";

    // --- Header ---
    const header = document.createElement("div");
    header.className = "sl-header";

    const statsEl = document.createElement("div");
    statsEl.className = "sl-stats";

    this.selectedCountEl = document.createElement("span");
    this.selectedCountEl.className = "sl-selected-count";
    this.selectedCountEl.textContent = "0";

    const sep = document.createElement("span");
    sep.className = "sl-stats-sep";
    sep.textContent = "/";

    this.totalCountEl = document.createElement("span");
    this.totalCountEl.className = "sl-total-count";
    this.totalCountEl.textContent = "0";

    const statsLabel = document.createElement("span");
    statsLabel.className = "sl-stats-label";
    statsLabel.textContent = "sélectionné(s)";

    statsEl.append(
      this.selectedCountEl,
      sep,
      this.totalCountEl,
      statsLabel
    );

    header.appendChild(statsEl);

    // --- Bouton "Tout sélectionner / Tout désélectionner" ---
    this.toggleAllBtnEl = document.createElement("button");
    this.toggleAllBtnEl.type = "button";
    this.toggleAllBtnEl.className = "sl-toggle-all-btn";
    this.toggleAllBtnEl.textContent = "Tout sélectionner";
    this.toggleAllBtnEl.addEventListener("click", () => this.handleToggleAll());
    header.appendChild(this.toggleAllBtnEl);

    // --- Zone scrollable des éléments ---
    this.itemsContainerEl = document.createElement("div");
    this.itemsContainerEl.className = "sl-items";

    // --- Message affiché quand la liste est vide ---
    this.emptyStateEl = document.createElement("div");
    this.emptyStateEl.className = "sl-empty-state";
    this.emptyStateEl.textContent = this.options.emptyLabel;

    // --- Footer avec bouton d'export ---
    const footer = document.createElement("div");
    footer.className = "sl-footer";

    this.exportBtnEl = document.createElement("button");
    this.exportBtnEl.type = "button";
    this.exportBtnEl.className = "sl-export-btn";
    this.exportBtnEl.textContent = this.options.exportLabel;
    this.exportBtnEl.addEventListener("click", () => this.handleExport());
    // Caché tant qu'aucun élément n'est sélectionné
    this.exportBtnEl.style.display = "none";

    footer.appendChild(this.exportBtnEl);

    this.rootEl.append(header, this.itemsContainerEl, footer);
    this.host.appendChild(this.rootEl);

    this.updateEmptyState();
  }

  // ---------------------------------------------------------------------
  // API publique
  // ---------------------------------------------------------------------

  /** Vide la liste des éléments (et la sélection) sans toucher au reste du DOM */
  public clear(): void {
    this.items = [];
    this.selectedIds.clear();
    this.itemsContainerEl.innerHTML = "";
    this.updateStats();
    this.updateEmptyState();
  }

  /** Vide puis remplit la liste avec de nouveaux éléments */
  public setItems(items: SelectableListInput[]): void {
    this.clear();
    this.items = items.map((item, index) =>
      typeof item === "string"
        ? { id: `item-${index}-${Date.now()}`, text: item }
        : item
    );
    this.renderItems();
    this.updateStats();
    this.updateEmptyState();
  }

  /** Ajoute des éléments sans vider les existants */
  public addItems(items: SelectableListInput[]): void {
    const newItems: SelectableItem[] = items.map((item, index) =>
      typeof item === "string"
        ? { id: `item-${this.items.length + index}-${Date.now()}`, text: item }
        : item
    );
    this.items.push(...newItems);
    newItems.forEach((item) => this.renderSingleItem(item));
    this.updateStats();
    this.updateEmptyState();
  }

  /** Retourne uniquement les éléments actuellement sélectionnés */
  public getSelectedItems(): SelectableItem[] {
    return this.items.filter((item) => this.selectedIds.has(item.id));
  }

  /** Retourne tous les éléments (sélectionnés ou non) */
  public getAllItems(): SelectableItem[] {
    return [...this.items];
  }

  /** Sélectionne tous les éléments */
  public selectAll(): void {
    this.items.forEach((item) => this.selectedIds.add(item.id));
    this.syncSelectionClasses();
    this.updateStats();
    this.options.onSelectionChange(this.getSelectedItems());
  }

  /** Désélectionne tous les éléments */
  public deselectAll(): void {
    this.selectedIds.clear();
    this.syncSelectionClasses();
    this.updateStats();
    this.options.onSelectionChange(this.getSelectedItems());
  }

  // ---------------------------------------------------------------------
  // Rendu interne
  // ---------------------------------------------------------------------

  private renderItems(): void {
    const fragment = document.createDocumentFragment();
    this.items.forEach((item) => {
      fragment.appendChild(this.createItemElement(item));
    });
    this.itemsContainerEl.appendChild(fragment);
  }

  private renderSingleItem(item: SelectableItem): void {
    this.itemsContainerEl.appendChild(this.createItemElement(item));
  }

  private createItemElement(item: SelectableItem): HTMLDivElement {
    const el = document.createElement("div");
    el.className = "sl-item";
    el.dataset.id = item.id;
    el.tabIndex = 0;
    el.setAttribute("role", "option");
    el.setAttribute("aria-selected", "false");

    const checkboxEl = document.createElement("span");
    checkboxEl.className = "sl-item-checkbox";
    checkboxEl.setAttribute("aria-hidden", "true");

    const textEl = document.createElement("span");
    textEl.className = "sl-item-text";
    textEl.textContent = item.text;

    el.append(checkboxEl, textEl);

    const toggle = () => this.toggleSelection(item.id);

    el.addEventListener("click", toggle);
    el.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        toggle();
      }
    });

    return el;
  }

  private toggleSelection(id: string): void {
    if (this.selectedIds.has(id)) {
      this.selectedIds.delete(id);
    } else {
      if (!this.options.multiSelect) {
        this.selectedIds.clear();
      }
      this.selectedIds.add(id);
    }
    this.syncSelectionClasses();
    this.updateStats();
    this.options.onSelectionChange(this.getSelectedItems());
  }

  private syncSelectionClasses(): void {
    const nodes = this.itemsContainerEl.querySelectorAll<HTMLDivElement>(
      ".sl-item"
    );
    nodes.forEach((node) => {
      const id = node.dataset.id!;
      const isSelected = this.selectedIds.has(id);
      node.classList.toggle("selected", isSelected);
      node.setAttribute("aria-selected", String(isSelected));
    });
  }

  private updateStats(): void {
    this.totalCountEl.textContent = String(this.items.length);
    this.selectedCountEl.textContent = String(this.selectedIds.size);
    this.updateToggleAllButton();
    this.updateExportButton();
  }

  private updateToggleAllButton(): void {
    const allSelected =
      this.items.length > 0 && this.selectedIds.size === this.items.length;

    this.toggleAllBtnEl.textContent = allSelected
      ? "Tout désélectionner"
      : "Tout sélectionner";
    this.toggleAllBtnEl.disabled = this.items.length === 0;
  }

  /** Affiche le bouton d'export uniquement si au moins un élément est sélectionné */
  private updateExportButton(): void {
    this.exportBtnEl.style.display =
      this.selectedIds.size > 0 ? "" : "none";
  }

  /** Affiche un message centré à la place de la grille quand il n'y a aucun élément */
  private updateEmptyState(): void {
    if (this.items.length === 0) {
      if (!this.itemsContainerEl.contains(this.emptyStateEl)) {
        this.itemsContainerEl.appendChild(this.emptyStateEl);
      }
      this.itemsContainerEl.classList.add("sl-items--empty");
    } else {
      if (this.itemsContainerEl.contains(this.emptyStateEl)) {
        this.itemsContainerEl.removeChild(this.emptyStateEl);
      }
      this.itemsContainerEl.classList.remove("sl-items--empty");
    }
  }

  private handleToggleAll(): void {
    const allSelected =
      this.items.length > 0 && this.selectedIds.size === this.items.length;

    if (allSelected) {
      this.deselectAll();
    } else {
      this.selectAll();
    }
  }

  private handleExport(): void {
    this.options.onExport(this.getSelectedItems());
  }
}