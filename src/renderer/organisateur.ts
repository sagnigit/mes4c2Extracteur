import { createCustomTitleBar } from './fondation.js';
import { initZoneExtract } from './zoneGraph/zoneExtract.js';
import { initZoneParam } from './zoneGraph/zoneParam.js';
import { initTempleteImg } from './zoneGraph/zoneImgtemplate.js';
import { initZoneVisionneuse } from './zoneGraph/zoneVisionneuse.js';
import { initView } from './zoneGraph/zoneView.js';
import { initMsgTemporaire } from './zoneGraph/gestionMessage.js';
import { initZoneExtractionDirecte } from './zoneGraph/zoneExtractionDirecte.js';
import { initZoneAccueil, ouvrirZoneAccueil } from './zoneGraph/zoneAccueil.js';
import { initZoneBloquante } from './zoneGraph/zoneBloquante.js';
import {initEcouteExport} from './zoneGraph/exportEcoute.js';
import {initEcouteMiseAJour} from './zoneGraph/updateEcoute.js';
import {initEcouteMajCodesExtraction} from './zoneGraph/majCodesEcoute.js';

export const organise = () => {
    createCustomTitleBar();
    initZoneAccueil();
    initZoneExtract();
    initZoneParam();
    initTempleteImg()
    initZoneVisionneuse();
    initView();
    initMsgTemporaire();
    initZoneExtractionDirecte();
    initZoneBloquante();
    initEcouteExport();
    initEcouteMiseAJour();
    initEcouteMajCodesExtraction();
    ouvrirZoneAccueil();
}

/*
http://172.30.133.130/login/
http://172.30.133.130/auth/saveAll2.php
*/