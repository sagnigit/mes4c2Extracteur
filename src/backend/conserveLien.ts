import { getRef, genereId } from './gardienRef.js';

// Un lien extrait et conservé : url + nom affichable, identifié par un
// id stable (indépendant de l'url), utilisé ensuite pour demander la
// récupération de la donnée de CE lien précis — voir actualiseItem
// dans zoneExtract.ts, qui envoie (idActu, id) au processus principal.
export interface NomLienExtrait {
  id: string;
  nom: string;
}

export interface LienBrute {
   url: string,
   nom: string 
}

const racineLien = "lien";
const racineNomLien = "nom_lien";

const creeRacineId = (racine: string, idActu: string) => {
    return `${racine}_${idActu}`;
}

export const getNomLien = (idActu: string): NomLienExtrait[] =>{
    const dataNom = getRef(creeRacineId(racineNomLien, idActu));
    return Object.entries(dataNom).map(([cle, valeur]) => {
        return {
            id: cle,
            nom: valeur
        }
    })
}

export const rechargeLien = (idActu: string, tabValeur: LienBrute[]) => {
    console.log(idActu);
    const dataLien = getRef(creeRacineId(racineLien, idActu));
    const dataNom = getRef(creeRacineId(racineNomLien, idActu));
    const tabLien: string[] = Object.values(dataLien);
    const tabId: string[] = Object.keys(dataLien);
    tabValeur.forEach(valeur => {
        const url = valeur.url;
        const nom = valeur.nom;
        const index = tabLien.indexOf(url);
        if (index < 0) {
            const novId = genereId(idActu);
            dataLien[novId] = url;
            dataNom[novId] = nom;
        }
        else {
            const ancienId = tabId[index];
            dataNom[ancienId] = nom;
        }
    });
    return getNomLien(idActu);
}

export const getLien = (idActu: string, idItem: string) => {
    const dataLien = getRef(creeRacineId(racineLien, idActu));
    return dataLien[idItem];
}