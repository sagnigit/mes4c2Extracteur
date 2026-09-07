// zoneAuth.ts
//
// Panel d'authentification plein écran, SANS bouton retour.
// - S'ouvre automatiquement au démarrage de l'application
// - Peut être rouvert depuis Paramètres (Déconnexion) ou ailleurs via
//   ouvrirZoneAuth()
// - Ne se ferme QUE lorsque le mot de passe saisi est correct
//
// Le mot de passe est vérifié côté main (gestionAuth.ts → JSON).
// Les retours (succès / échec) sont notifiés via gestionMessages.ts.

import { Panel } from '../composer/Panel.js';
import { typeErreur, typeReussite, creerMessage } from './gestionMessage.js';

const NOM_APP = 'Mes4C2-Extracteur';
const LOGO_SRC = 'assets/logo.ico';

let panAuth: Panel;
let bodyAuth: HTMLElement;
let inputMdp: HTMLInputElement | null = null;
let messageErreur: HTMLElement | null = null;
let btnSubmit: HTMLButtonElement | null = null;
let verificationEnCours = false;

export const initZoneAuth = (): void => {
    panAuth = new Panel('', false);
    panAuth.hideHeader();
    panAuth.getContainer().classList.add('za-root');
    bodyAuth = panAuth.getBody();
    bodyAuth.classList.add('za-body');
    renderZoneAuth(bodyAuth);
};

/** Ouvre le panel d'authentification (démarrage, déconnexion, etc.). */
export const ouvrirZoneAuth = (): void => {
    if (inputMdp) {
        inputMdp.value = '';
        inputMdp.type = 'password';
    }
    effacerErreur();
    panAuth.open();
    requestAnimationFrame(() => inputMdp?.focus());
};

/** Fermeture UNIQUEMENT après mot de passe correct (interne). */
const fermerZoneAuth = (): void => {
    panAuth.close();
};

const effacerErreur = (): void => {
    if (!messageErreur || !inputMdp) return;
    messageErreur.textContent = '';
    messageErreur.classList.remove('za-error--visible');
    messageErreur.setAttribute('hidden', '');
    inputMdp.removeAttribute('aria-invalid');
};

const afficherErreur = (texte: string): void => {
    if (!messageErreur || !inputMdp) return;
    messageErreur.textContent = texte;
    messageErreur.classList.add('za-error--visible');
    messageErreur.removeAttribute('hidden');
    inputMdp.setAttribute('aria-invalid', 'true');
};

const definirEtatChargement = (actif: boolean): void => {
    if (!btnSubmit || !inputMdp) return;
    btnSubmit.disabled = actif;
    inputMdp.disabled = actif;
    btnSubmit.classList.toggle('za-btn--loading', actif);
    btnSubmit.textContent = actif ? 'Vérification…' : 'Déverrouiller';
};

const tenterConnexion = async (): Promise<void> => {
    if (verificationEnCours) return;
    const saisie = (inputMdp?.value ?? '').trim();

    if (!saisie) {
        afficherErreur('Veuillez saisir un mot de passe.');
        inputMdp?.focus();
        return;
    }

    verificationEnCours = true;
    definirEtatChargement(true);

    try {
        const res = (await window.api.invoke('auth:verifier', saisie)) as { ok?: boolean };
        if (res?.ok) {
            effacerErreur();
            creerMessage(typeReussite, 'Authentification', 'Connexion réussie.');
            fermerZoneAuth();
            return;
        }
        afficherErreur('Mot de passe incorrect. Réessayez.');
        creerMessage(typeErreur, 'Authentification', 'Mot de passe incorrect.');
        if (inputMdp) {
            inputMdp.value = '';
            inputMdp.classList.add('za-input--shake');
            window.setTimeout(() => inputMdp?.classList.remove('za-input--shake'), 450);
        }
    } catch (err: any) {
        const message = err?.message ?? 'Impossible de vérifier le mot de passe.';
        afficherErreur(message);
        creerMessage(typeErreur, 'Authentification', message);
    } finally {
        verificationEnCours = false;
        definirEtatChargement(false);
        inputMdp?.focus();
    }
};

const renderZoneAuth = (container: HTMLElement): void => {
    container.innerHTML = '';

    const fond = el('div', 'za-fond');
    const carte = el('div', 'za-carte');

    // Logo
    const logoWrap = el('div', 'za-logo-wrap');
    const logo = document.createElement('img');
    logo.className = 'za-logo';
    logo.src = LOGO_SRC;
    logo.alt = NOM_APP;
    logo.onerror = () => {
        logo.style.display = 'none';
        const mono = el('div', 'za-logo-mono', 'M4');
        logoWrap.appendChild(mono);
    };
    logoWrap.appendChild(logo);

    // Titres
    const titre = el('h1', 'za-titre', NOM_APP);
    const sousTitre = el('p', 'za-sous-titre', 'Authentification requise pour continuer');

    // Formulaire
    const form = document.createElement('form');
    form.className = 'za-form';
    form.noValidate = true;
    form.addEventListener('submit', (e) => {
        e.preventDefault();
        void tenterConnexion();
    });

    const label = el('label', 'za-label', 'Mot de passe');
    label.setAttribute('for', 'za-mdp');

    // Ligne input + bouton afficher/masquer
    const ligneMdp = el('div', 'za-mdp-ligne');

    inputMdp = document.createElement('input');
    inputMdp.type = 'password';
    inputMdp.id = 'za-mdp';
    inputMdp.className = 'za-input';
    inputMdp.placeholder = 'Entrez le mot de passe';
    inputMdp.autocomplete = 'current-password';
    inputMdp.spellcheck = false;
    inputMdp.setAttribute('aria-describedby', 'za-mdp-erreur');
    // L'erreur disparaît dès qu'on interagit avec le champ
    inputMdp.addEventListener('focus', () => effacerErreur());
    inputMdp.addEventListener('input', () => effacerErreur());
    inputMdp.addEventListener('click', () => effacerErreur());

    const btnOeil = document.createElement('button');
    btnOeil.type = 'button';
    btnOeil.className = 'za-oeil iconMateriel';
    btnOeil.title = 'Afficher le mot de passe';
    btnOeil.setAttribute('aria-label', 'Afficher le mot de passe');
    btnOeil.textContent = 'visibility';
    btnOeil.addEventListener('click', () => {
        if (!inputMdp) return;
        const visible = inputMdp.type === 'text';
        inputMdp.type = visible ? 'password' : 'text';
        btnOeil.textContent = visible ? 'visibility' : 'visibility_off';
        btnOeil.title = visible ? 'Afficher le mot de passe' : 'Masquer le mot de passe';
        btnOeil.setAttribute(
            'aria-label',
            visible ? 'Afficher le mot de passe' : 'Masquer le mot de passe'
        );
        inputMdp.focus();
    });

    ligneMdp.append(inputMdp, btnOeil);

    messageErreur = el('p', 'za-error');
    messageErreur.id = 'za-mdp-erreur';
    messageErreur.setAttribute('role', 'alert');
    messageErreur.setAttribute('hidden', '');

    btnSubmit = document.createElement('button');
    btnSubmit.type = 'submit';
    btnSubmit.className = 'za-btn zoneReacif';
    btnSubmit.textContent = 'Déverrouiller';

    form.append(label, ligneMdp, messageErreur, btnSubmit);

    const pied = el('p', 'za-pied', 'Accès réservé · session protégée');

    carte.append(logoWrap, titre, sousTitre, form, pied);
    fond.appendChild(carte);
    container.appendChild(fond);
};

function el<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    className?: string,
    text?: string
): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}