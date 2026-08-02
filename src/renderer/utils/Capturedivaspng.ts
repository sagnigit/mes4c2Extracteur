/**
 * captureDivAsPng
 * ----------------
 * Capture une div (et son contenu) sous forme d'image PNG à fond
 * transparent, en s'appuyant sur la librairie "html-to-image" chargée
 * globalement via <script src="vendor/html-to-image.js"></script>
 * (donc AVANT le script du module qui appelle cette fonction).
 *
 * Le résultat est retourné via un callback, sous forme de Blob (ou
 * null en cas d'échec).
 */

// html-to-image est chargé en global (UMD) par un <script> classique,
// pas via un import ES module : on déclare juste sa forme minimale
// utilisée ici pour que TypeScript nous laisse l'utiliser.
declare const htmlToImage: {
    toBlob: (
        node: HTMLElement,
        options?: {
            backgroundColor?: string;
            pixelRatio?: number;
            quality?: number;
            cacheBust?: boolean;
        }
    ) => Promise<Blob | null>;
};

export type CaptureCallback = (blob: Blob | null) => void;

/**
 * Capture la div donnée en PNG à fond transparent et renvoie le
 * résultat (Blob | null) via le callback.
 */
export function captureDivAsPng(div: HTMLElement, callback: CaptureCallback): void {
    htmlToImage
        .toBlob(div, {
            // Pas de backgroundColor défini -> le fond reste transparent
            pixelRatio: window.devicePixelRatio || 1,
            // cacheBust ajouterait "?timestamp" à l'URL de chaque <img> de
            // la div, y compris les URL "blob:" (ex: image composée dans
            // le cadre du template) — ce qui les rend invalides et fait
            // échouer toute la capture. On ne capture ici que des
            // ressources locales (blob:/data:/fichiers embarqués), donc
            // le cache-busting n'apporte rien et ne doit pas être activé.
        })
        .then((blob) => {
            callback(blob);
        })
        .catch((error) => {
            console.error("Erreur lors de la capture de la div en PNG :", error);
            callback(null);
        });
}