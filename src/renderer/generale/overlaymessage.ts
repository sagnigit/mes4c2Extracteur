/**
 * OverlayMessage
 * ----------------
 * Classe qui prend une <div> hôte et crée par-dessus elle (en position absolute)
 * une zone d'affichage :
 *  - légèrement transparente, pour laisser voir le contenu de la div en dessous
 *  - avec un loader (gif) centré
 *  - avec un message texte centré, sous/à côté du loader
 *
 * La zone peut être ajoutée / retirée à volonté (show/hide/destroy),
 * et son message peut être changé à tout moment via setMessage().
 *
 * Le lien du gif de chargement est une variable globale modifiable :
 *   OVERLAY_LOADER_GIF_URL = "https://mon-domaine.com/mon-loader.gif";
 * (ou en passant l'option `loaderSrc` au constructeur pour une instance précise)
 *
 * Utilisation :
 *   const overlay = new OverlayMessage(document.getElementById("ma-zone")!);
 *   overlay.show("Chargement en cours...");
 *   // ...
 *   overlay.setMessage("Presque terminé...");
 *   // ...
 *   overlay.hide();
 */

// ---------------------------------------------------------------------
// Variable globale : lien du gif de chargement utilisé par défaut
// ---------------------------------------------------------------------
export let OVERLAY_LOADER_GIF_URL = "assets/imageSpinner.gif";

/** Permet de changer le loader par défaut pour toutes les futures instances */
export function setOverlayLoaderGifUrl(url: string): void {
  OVERLAY_LOADER_GIF_URL = url;
}

export interface OverlayMessageOptions {
  /** Opacité du fond de l'overlay (0 = invisible, 1 = opaque). Défaut : 0.55 */
  backgroundOpacity?: number;
  /** Couleur du fond de l'overlay (sans l'opacité). Défaut : "255, 255, 255" (blanc) */
  backgroundColorRgb?: string;
  /** Lien du gif de loader pour CETTE instance (sinon utilise la variable globale) */
  loaderSrc?: string;
  /** Afficher le loader ou non. Défaut : true */
  showLoader?: boolean;
}

export class OverlayMessage {
  private host: HTMLElement;
  private options: Required<OverlayMessageOptions>;

  private overlayEl: HTMLDivElement | null = null;
  private loaderEl!: HTMLImageElement;
  private messageEl!: HTMLDivElement;

  constructor(host: HTMLElement, options: OverlayMessageOptions = {}) {
    this.host = host;
    this.options = {
      backgroundOpacity: options.backgroundOpacity ?? 0.55,
      backgroundColorRgb: options.backgroundColorRgb ?? "255, 255, 255",
      loaderSrc: options.loaderSrc ?? OVERLAY_LOADER_GIF_URL,
      showLoader: options.showLoader ?? true,
    };

    // L'overlay étant en position absolute, la div hôte doit être en
    // position relative (ou autre chose que static) pour servir de repère.
    const currentPosition = getComputedStyle(this.host).position;
    if (currentPosition === "static") {
      this.host.style.position = "relative";
    }
  }

  // ---------------------------------------------------------------------
  // API publique
  // ---------------------------------------------------------------------

  /**
   * Affiche la zone de message par-dessus la div hôte.
   * @param message Texte à afficher. S'il est vide, seul le loader est visible.
   */
  public show(message: string = ""): void {
    if (!this.overlayEl) {
      this.buildOverlay();
    }
    this.setMessage(message);
    this.overlayEl!.style.display = "flex";
  }

  /** Cache la zone de message (sans la détruire, réutilisable via show()) */
  public hide(): void {
    if (this.overlayEl) {
      this.overlayEl.style.display = "none";
    }
  }

  /** Retire complètement la zone de message du DOM */
  public destroy(): void {
    if (this.overlayEl && this.overlayEl.parentElement) {
      this.overlayEl.parentElement.removeChild(this.overlayEl);
    }
    this.overlayEl = null;
  }

  /** Indique si la zone de message est actuellement affichée */
  public isVisible(): boolean {
    return !!this.overlayEl && this.overlayEl.style.display !== "none";
  }

  /**
   * Change le contenu texte du message affiché.
   * Si le texte est vide, la zone de texte est masquée (seul le loader reste visible).
   */
  public setMessage(text: string): void {
    if (!this.overlayEl) {
      this.buildOverlay();
    }
    const cleanText = text?.trim() ?? "";
    this.messageEl.textContent = cleanText;
    this.messageEl.style.display = cleanText.length > 0 ? "" : "none";
  }

  /** Affiche ou masque le loader indépendamment du message */
  public setLoaderVisible(visible: boolean): void {
    if (!this.overlayEl) {
      this.buildOverlay();
    }
    this.loaderEl.style.display = visible ? "" : "none";
  }

  /** Change dynamiquement le gif de loader pour cette instance */
  public setLoaderSrc(url: string): void {
    if (!this.overlayEl) {
      this.buildOverlay();
    }
    this.loaderEl.src = url;
  }

  // ---------------------------------------------------------------------
  // Construction interne du DOM (une seule fois, à la demande)
  // ---------------------------------------------------------------------
  private buildOverlay(): void {
    this.overlayEl = document.createElement("div");
    this.overlayEl.className = "ov-msg-overlay";
    this.overlayEl.style.backgroundColor = `rgba(${this.options.backgroundColorRgb}, ${this.options.backgroundOpacity})`;

    const contentEl = document.createElement("div");
    contentEl.className = "ov-msg-content";

    this.loaderEl = document.createElement("img");
    this.loaderEl.className = "ov-msg-loader";
    this.loaderEl.src = this.options.loaderSrc;
    this.loaderEl.alt = "Chargement...";
    this.loaderEl.style.display = this.options.showLoader ? "" : "none";

    this.messageEl = document.createElement("div");
    this.messageEl.className = "ov-msg-text";
    this.messageEl.style.display = "none";

    contentEl.append(this.loaderEl, this.messageEl);
    this.overlayEl.appendChild(contentEl);

    this.host.appendChild(this.overlayEl);
  }
}