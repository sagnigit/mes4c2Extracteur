import { BrowserWindow, WebContentsView, WebContentsViewConstructorOptions } from "electron";

export interface OptionsWebContentsView {
    /** URL à charger directement dans la WebContentsView (optionnel) */
    url?: string;
    /** Options de construction transmises à WebContentsView (webPreferences, etc.) */
    viewOptions?: WebContentsViewConstructorOptions;
    /** Marges à respecter par rapport aux bords de la fenêtre */
    marge?: { haut?: number; droite?: number; bas?: number; gauche?: number };
}

/**
 * Crée une WebContentsView, l'attache à la fenêtre donnée, et la redimensionne
 * automatiquement à chaque redimensionnement / maximisation / restauration
 * de la fenêtre principale.
 */
export function creerWebContentsViewDansFenetre(
    fenetrePrincipale: BrowserWindow,
    options: OptionsWebContentsView = {}
): WebContentsView {
    const vue = new WebContentsView(options.viewOptions);
    fenetrePrincipale.contentView.addChildView(vue);

    const marge = {
        haut: options.marge?.haut ?? 0,
        droite: options.marge?.droite ?? 0,
        bas: options.marge?.bas ?? 0,
        gauche: options.marge?.gauche ?? 0,
    };

    const ajusterTaille = (): void => {
        const { width, height } = fenetrePrincipale.getContentBounds();
        vue.setBounds({
            x: marge.gauche,
            y: marge.haut,
            width: Math.max(0, width - marge.gauche - marge.droite),
            height: Math.max(0, height - marge.haut - marge.bas),
        });
    };

    // Taille initiale
    ajusterTaille();

    // Réajuste à chaque changement de taille de la fenêtre
    fenetrePrincipale.on("resize", ajusterTaille);
    fenetrePrincipale.on("maximize", ajusterTaille);
    fenetrePrincipale.on("unmaximize", ajusterTaille);
    fenetrePrincipale.on("enter-full-screen", ajusterTaille);
    fenetrePrincipale.on("leave-full-screen", ajusterTaille);

    // Nettoyage des listeners quand la fenêtre se ferme
    fenetrePrincipale.on("closed", () => {
        fenetrePrincipale.removeListener("resize", ajusterTaille);
        fenetrePrincipale.removeListener("maximize", ajusterTaille);
        fenetrePrincipale.removeListener("unmaximize", ajusterTaille);
        fenetrePrincipale.removeListener("enter-full-screen", ajusterTaille);
        fenetrePrincipale.removeListener("leave-full-screen", ajusterTaille);
    });

    if (options.url) {
        vue.webContents.loadURL(options.url);
    }
    console.log(options.url);

    return vue;
}
