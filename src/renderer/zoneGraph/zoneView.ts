import { Panel } from '../composer/Panel.js';
import { lenceFermetureView } from './donneeApi.js';
import {creerMessage, creerMessagePermanent, typeErreur, typeReussite} from './gestionMessage.js';


let panAffichage: Panel;

export const initView = () => {
    panAffichage = new Panel("Se connecter au cite Recuperateur", true, () => {
        lenceFermetureView();
    });
    // La connexion faite dans la zone de connexion vient d'aboutir (vue
    // fermée automatiquement côté main) : il suffit de recliquer sur
    // "Exporter" pour lancer l'exportation demandée initialement.
    window.api.on('export:session-detectee', () => {
        panAffichage.close();
        creerMessage(
            typeReussite,
            'Connexion réussie',
            'Vous pouvez maintenant relancer l’exportation.'
        );
    });
}

export const ouvreView = () => {
    panAffichage.open();
}