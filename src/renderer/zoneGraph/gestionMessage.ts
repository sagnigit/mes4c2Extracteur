// gestionMessages.ts
//
// Gestion de deux types de messages :
//  - "temporaires"  -> disparaissent seuls apres un delai, en haut a droite,
//                      empilement du HAUT vers le BAS.
//  - "permanents"    -> restent affiches tant que l'utilisateur ne les ferme
//                      pas, en bas a droite, empilement du BAS vers le HAUT.
//
// Les deux peuvent etre fermes manuellement (bouton "x").
// Les zones sont creees dynamiquement (pas de dependance a du HTML existant)
// et forcees au-dessus de tout le reste via un z-index tres eleve.

let zoneMessageTemp: HTMLDivElement;
let zoneMessagePermanente: HTMLDivElement;
let audioTemp: HTMLAudioElement;

export const typeInfo = "info";
export const typeReussite = "reussite";
export const typeErreur = "erreur";

// 5000 ms (5 secondes) est la duree la plus communement utilisee pour
// les notifications "toast" (Material Design, Bootstrap Toasts, react-toastify...)
const DUREE_AFFICHAGE_DEFAUT = 5000;

// Doit correspondre a la duree de transition definie dans le CSS (0.4s)
const DUREE_ANIMATION = 400;

const joueSong = () => {
    if (!audioTemp) return;
    // On reinitialise au debut (utile si on rappelle vite)
    audioTemp.currentTime = 0;
    audioTemp.play();
};

// Cree une zone (div) si elle n'existe pas deja et l'ajoute au document.
// -> "zoneMessage" est bien CREE ici, jamais recupere via un id deja present
// dans une page HTML.
const creerZoneSiAbsente = (id: string, classesCss: string[]): HTMLDivElement => {
    let zone = document.getElementById(id) as HTMLDivElement | null;
    if (!zone) {
        zone = document.createElement("div");
        zone.id = id;
        zone.classList.add(...classesCss);
        document.body.appendChild(zone);
    }
    return zone;
};

export const initMsgTemporaire = () => {
    zoneMessageTemp = creerZoneSiAbsente("zoneMessageTemporaire", ["zoneMessages"]);
    zoneMessagePermanente = creerZoneSiAbsente("zoneMessagePermanente", ["zoneMessages"]);

    if (!audioTemp) {
        audioTemp = new Audio("doc_audio/songTemp.wav");
    }
};

const obtenirIconEtClasse = (typeMessage: string, suffixe: string) => {
    let classGestioCouleur = "";
    let icon = "";
    switch (typeMessage) {
        case typeInfo:
            classGestioCouleur = `info-${suffixe}`;
            icon = "info_outline";
            break;
        case typeReussite:
            classGestioCouleur = `reussite-${suffixe}`;
            icon = "check_circle_outline";
            break;
        case typeErreur:
            classGestioCouleur = `erreur-${suffixe}`;
            icon = "block";
            break;
    }
    return { classGestioCouleur, icon };
};

// Construit le porteur DOM commun aux deux types de messages.
// "suffixe" (temp / perm) permet d'avoir des classes CSS distinctes
// et donc un design different pour chaque type.
const construireMessageDOM = (
    typeMessage: string,
    titre: string,
    contenuMessage: string,
    suffixe: "temp" | "perm",
    classeBase: string
): HTMLDivElement => {
    const { classGestioCouleur, icon } = obtenirIconEtClasse(typeMessage, suffixe);

    const porteur = document.createElement("div");
    porteur.innerHTML = `
        <div class="entete-message-${suffixe}">
            <div class="gauche-entete-${suffixe}">
                <span class="iconMateriel icon-${suffixe}">${icon}</span>
                ${titre}
            </div>
            <div class="bout-sup-${suffixe} zoneReacif">
                x
            </div>
        </div>
        <div class="corps-${suffixe}">
            ${contenuMessage}
        </div>
    `;
    porteur.classList.add(classeBase, classGestioCouleur);
    return porteur;
};

/**
 * Cree un message TEMPORAIRE (toast).
 * S'affiche en haut a droite, s'empile du haut vers le bas,
 * disparait seul apres "duree" ms, ou peut etre ferme a la main.
 */
export const creerMessage = (
    typeMessage: string,
    titre: string,
    contenuMessage = "bonjour",
    duree: number = DUREE_AFFICHAGE_DEFAUT
) => {
    const porteur = construireMessageDOM(typeMessage, titre, contenuMessage, "temp", "porteurMessage-temp");
    zoneMessageTemp.appendChild(porteur);

    const fermer = () => {
        porteur.classList.remove("enter-temp");
        porteur.classList.add("leave-temp");
        setTimeout(() => {
            porteur.remove();
        }, DUREE_ANIMATION);
    };

    setTimeout(() => {
        joueSong();
        porteur.classList.add("enter-temp");
    }, 10);

    const atendrePourFermer = setTimeout(() => {
        fermer();
    }, duree);

    porteur.querySelector(".bout-sup-temp")?.addEventListener("click", () => {
        clearTimeout(atendrePourFermer);
        fermer();
    });
};

/**
 * Cree un message PERMANENT (notification persistante).
 * S'affiche en bas a droite, s'empile du bas vers le haut,
 * et reste affiche tant que l'utilisateur ne clique pas sur "x".
 *
 * Retourne une fonction "fermer" permettant de le fermer par code
 * (ex: apres une action reussie qui rend la notif obsolete).
 */
export const creerMessagePermanent = (
    typeMessage: string,
    titre: string,
    contenuMessage = "bonjour"
): (() => void) => {
    const porteur = construireMessageDOM(typeMessage, titre, contenuMessage, "perm", "porteurMessage-perm");
    zoneMessagePermanente.appendChild(porteur);

    const fermer = () => {
        porteur.classList.remove("enter-perm");
        porteur.classList.add("leave-perm");
        setTimeout(() => {
            porteur.remove();
        }, DUREE_ANIMATION);
    };

    setTimeout(() => {
        porteur.classList.add("enter-perm");
    }, 10);

    porteur.querySelector(".bout-sup-perm")?.addEventListener("click", () => {
        fermer();
    });

    return fermer;
};