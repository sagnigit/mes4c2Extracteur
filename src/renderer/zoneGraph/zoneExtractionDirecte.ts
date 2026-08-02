import {
    ecouteEtatExtraction,
    relancerExtraction,
    arreterExtraction,
    EtatExtraction,
    ecouteProgressionDonnee,
    InfoProgressionDonnee,
} from './extractionApi.js';
import { OVERLAY_LOADER_GIF_URL } from '../generale/overlaymessage.js';

// ---------------------------------------------------------------------
// Zone d'extraction directe (renderer)
// ---------------------------------------------------------------------
// Le processus principal (extractionDirecte.ts) positionne lui-même la
// WebContentsView (mode réduit en haut à gauche, ou mode "zone" en
// grand pendant une erreur). Ce module affiche, par-dessus, un overlay
// plein écran qui accompagne toute l'opération, du lancement à la fin,
// avec le même fond légèrement sombre dans tous les cas :
//
//  - 'chargement' / 'injecte' (tout se passe bien) : carte au CENTRE de
//    l'écran, avec le message et le bouton "Suspendre" ;
//  - 'zone_erreur' : carte en haut, avec le message d'erreur et les
//    boutons "Relancer le site" / "Arrêter l'opération" ;
//  - 'termine' / 'arrete' : overlay refermé.
//
// Une seule tâche à la fois est suivie/affichée ici (la première dont on
// reçoit un état non terminal ; les suivantes patientent silencieusement,
// comme côté main où une seule tâche à la fois occupe la "grande zone").
// ---------------------------------------------------------------------

let overlay: HTMLDivElement;
let carteExecution: HTMLDivElement;
let texteExecution: HTMLSpanElement;
let boutonSuspendre: HTMLButtonElement;
let carteErreur: HTMLDivElement;
let texteErreur: HTMLSpanElement;
let boutonRelancer: HTMLButtonElement;
let boutonArreter: HTMLButtonElement;
let tacheAffichee: string | null = null;

// Progression du TRAITEMENT post-extraction (téléchargement des médias
// TEF, génération des transformés...) : contrairement à EtatExtraction,
// elle arrive APRÈS la fermeture de la vue d'extraction (voir
// finaliser() dans extractionDirecte.ts, qui notifie 'termine' — et
// donc ferme cet overlay — avant même d'attendre onDonnee). On la
// suit donc indépendamment de tacheAffichee, avec son propre
// idActu, pour pouvoir rouvrir la même carte d'exécution le temps du
// téléchargement.
let idActuEnProgression: string | null = null;

export const initZoneExtractionDirecte = (): void => {
    overlay = document.createElement('div');
    overlay.className = 'extraction-directe-overlay';

    // --- Carte "exécution normale" : au centre de l'écran ---
    carteExecution = document.createElement('div');
    carteExecution.className = 'extraction-directe-carte-execution';

    const ligneMessage = document.createElement('div');
    ligneMessage.className = 'extraction-directe-ligne-message';

    const loaderExecution = document.createElement('img');
    loaderExecution.className = 'extraction-directe-loader';
    loaderExecution.src = OVERLAY_LOADER_GIF_URL;
    loaderExecution.alt = '';

    texteExecution = document.createElement('div');
    texteExecution.className = 'extraction-directe-message-execution';

    ligneMessage.append(loaderExecution, texteExecution);

    boutonSuspendre = document.createElement('button');
    boutonSuspendre.className = 'extraction-btn extraction-directe-btn-suspendre';
    boutonSuspendre.textContent = "Suspendre l'opération";
    boutonSuspendre.addEventListener('click', () => {
        if (tacheAffichee) arreterExtraction(tacheAffichee);
    });

    carteExecution.append(ligneMessage, boutonSuspendre);

    // --- Carte "erreur" : en haut de l'écran ---
    carteErreur = document.createElement('div');
    carteErreur.className = 'extraction-directe-carte-erreur';

    texteErreur = document.createElement('span');
    texteErreur.className = 'extraction-directe-message-erreur';

    boutonRelancer = document.createElement('button');
    boutonRelancer.className = 'extraction-btn extraction-directe-btn-relancer';
    boutonRelancer.textContent = 'Relancer le site';
    boutonRelancer.addEventListener('click', () => {
        if (tacheAffichee) relancerExtraction(tacheAffichee);
    });

    boutonArreter = document.createElement('button');
    boutonArreter.className = 'extraction-btn extraction-directe-btn-arreter';
    boutonArreter.textContent = "Arrêter l'opération";
    boutonArreter.addEventListener('click', () => {
        if (tacheAffichee) arreterExtraction(tacheAffichee);
    });

    carteErreur.append(texteErreur, boutonRelancer, boutonArreter);

    overlay.append(carteExecution, carteErreur);
    document.body.appendChild(overlay);

    ecouteEtatExtraction((info: EtatExtraction) => {
        // Extraction terminée (données reçues) ou annulée : referme
        // l'overlay si c'est la tâche actuellement suivie — sauf si le
        // TRAITEMENT de cette même donnée (téléchargements TEF, etc.)
        // est déjà en cours d'affichage : dans ce cas on laisse la
        // progression garder l'overlay ouvert (voir plus bas).
        if (info.etat === 'termine' || info.etat === 'arrete') {
            if (info.id === tacheAffichee && idActuEnProgression === null) fermerOverlay();
            if (info.id === tacheAffichee) tacheAffichee = null;
            return;
        }

        // Ne pas interrompre l'affichage d'une autre tâche déjà en cours
        // de suivi : une seule à la fois, comme côté main.
        if (tacheAffichee !== null && tacheAffichee !== info.id) return;

        tacheAffichee = info.id;
        mettreAJourEtat(info);
    });

    ecouteProgressionDonnee((idActu: string, info: InfoProgressionDonnee) => {
        // Ne pas interrompre l'affichage d'une AUTRE progression déjà en
        // cours (une seule tâche à la fois, comme pour l'extraction).
        if (idActuEnProgression !== null && idActuEnProgression !== idActu) return;

        if (info.etape === 'termine') {
            idActuEnProgression = null;
            // Ne referme que si aucune tâche d'extraction n'occupe
            // encore l'overlay (cas normal : la vue est déjà fermée à ce
            // stade, voir le commentaire plus haut).
            if (tacheAffichee === null) fermerOverlay();
            return;
        }

        idActuEnProgression = idActu;
        mettreAJourProgression(info);
    });
};

const mettreAJourEtat = (info: EtatExtraction): void => {
    const enErreur = info.etat === 'zone_erreur';

    overlay.classList.add('extraction-directe-overlay--visible');
    carteExecution.classList.toggle('extraction-directe-carte-execution--visible', !enErreur);
    carteErreur.classList.toggle('extraction-directe-carte-erreur--visible', enErreur);
    boutonSuspendre.disabled = false;

    if (enErreur) {
        texteErreur.textContent = info.message ?? 'Une erreur est survenue.';
    } else {
        texteExecution.textContent =
            info.etat === 'injecte'
                ? 'Récupération des données en cours…'
                : 'Chargement de la page…';
    }
};

// Affiche/rafraîchit la carte d'exécution avec le message de
// progression (téléchargement des médias TEF, génération des
// transformés...). Pas de "Suspendre" ici : à ce stade, la page a déjà
// répondu et il n'y a plus de tâche d'extraction à interrompre — le
// bouton est désactivé plutôt que masqué, pour garder la carte stable.
const mettreAJourProgression = (info: InfoProgressionDonnee): void => {
    overlay.classList.add('extraction-directe-overlay--visible');
    carteExecution.classList.add('extraction-directe-carte-execution--visible');
    carteErreur.classList.remove('extraction-directe-carte-erreur--visible');
    boutonSuspendre.disabled = true;
    texteExecution.textContent = info.message;
};

const fermerOverlay = (): void => {
    overlay.classList.remove('extraction-directe-overlay--visible');
    carteExecution.classList.remove('extraction-directe-carte-execution--visible');
    carteErreur.classList.remove('extraction-directe-carte-erreur--visible');
    boutonSuspendre.disabled = false;
    tacheAffichee = null;
    idActuEnProgression = null;
};