import path from 'path';
import { app } from "electron";
import fs from 'fs'; // Pour lire et écrire des fichiers
import {
    compteurs,
    listeIdActu
} from '../varUni.js';

export interface DictString {
    [key: string]: string
}

interface DictRef {
    [key: string]: DictString
}

export const creer_dossier = (cheminDossier: string) => {
    if (!fs.existsSync(cheminDossier)) {
        // Créer le répertoire
        fs.mkdirSync(cheminDossier, { recursive: true });
        return false;
    }
    return true;
}

export const viderDossier = (dossier: string) => {
    if (!fs.existsSync(dossier)) {
        return false;
    }

    const fichiers = fs.readdirSync(dossier);

    for (const fichier of fichiers) {
        const cheminComplet = path.join(dossier, fichier);
        const stats = fs.statSync(cheminComplet);

        if (stats.isDirectory()) {
            viderDossier(cheminComplet);
            fs.rmdirSync(cheminComplet);
        } else {
            fs.unlinkSync(cheminComplet);
        }
    }
    return true;
};


const dossierAcesible = app.getPath('userData');//dans lequel on peut lire et ecrire meme lorsque l'appplication est installer
export const dossierConserveur = path.join(dossierAcesible, "conserveur");

const fichierRef = path.join(dossierConserveur, "gardienReference.json");
var dataRef: DictRef = {}

let dejaCharge = false;

export const chargeRef = () => {
    // Ne recharge JAMAIS depuis le disque après le premier appel : cette
    // fonction est rappelée par précaution un peu partout (donnee_tcf_eo.ts,
    // conserveurDonne.ts...) avant d'utiliser getRef/genereId. Si elle
    // relisait le fichier à chaque fois, elle écraserait en mémoire toute
    // mutation pas encore explicitement enregistrée (enregistreRef()) —
    // par exemple la liste des liens tout juste découverte via
    // "Actualiser", qui n'est sauvegardée qu'au moment où on extrait le
    // contenu d'un lien : le premier lien traité effaçait alors la
    // découverte de tous les autres avant qu'ils aient pu être extraits.
    if (dejaCharge) return;
    dejaCharge = true;

    creer_dossier(dossierConserveur);
    if (fs.existsSync(fichierRef)) {
        const valeurBrute = fs.readFileSync(fichierRef, "utf-8");
        dataRef = JSON.parse(valeurBrute);
    }
    else {
        const comp: DictString = {};
        dataRef[compteurs] = comp;
        ([
            ...listeIdActu
        ] as string[]).forEach(cleCompteur => {
            comp[cleCompteur] = "0";
        });
    }
}

export const enregistreRef = () => {
    fs.writeFileSync(fichierRef, JSON.stringify(dataRef));
}

export const genereId = (ref: string): string => {
    const strComp = dataRef[compteurs][ref];
    if (!strComp) {
        dataRef[compteurs][ref] = "1";
        return "1";
    }
    const novCompt = `${parseInt(strComp) + 1}`;
    dataRef[compteurs][ref] = novCompt;
    return novCompt;
}

export const getRef = (idRef: string): DictString => {
    let valeur = dataRef[idRef];
    if (!valeur) {
        valeur = {};
        dataRef[idRef] = valeur;
    }
    return valeur;
}