import { enhanceEntityDetailStatisticsHtmlV2 } from './entity-detail-statistics-ui-v2.js';

const SUCCESS_RENDER = "host.innerHTML=content(data,s,c)+'<div class=\"entity-detail-controls\">'+toolbar(s,c)+panel(s,c)+'</div>';bind(host,s,c)";
const ORDERED_RENDER = "host.innerHTML=content(data,s,c)+'<div class=\"entity-detail-controls\">'+toolbar(s,c)+panel(s,c)+'</div>';const scoreNode=host.querySelector('.entity-detail-score');const controlsNode=host.querySelector('.entity-detail-controls');if(scoreNode&&controlsNode)scoreNode.after(controlsNode);bind(host,s,c)";
const TRAINER_SPECIALS = "if(c.market)specials+=special('Resultat som favorit',data.favoriteResults,'Marknadsrank 1 vid sista giltiga snapshot före spelstopp')+special('Resultat som skräll',data.longshotResults,'Marknadsandel ≤ '+num(data.definitions?.longshotPercentMax??5)+'% vid spelstopp');return score(data,c)";
const TRAINER_SPECIALS_WITH_HOME = "if(c.market)specials+=special('Resultat som favorit',data.favoriteResults,'Marknadsrank 1 vid sista giltiga snapshot före spelstopp')+special('Resultat som skräll',data.longshotResults,'Marknadsandel ≤ '+num(data.definitions?.longshotPercentMax??5)+'% vid spelstopp');if(s.page==='trainers')specials+=special('Hemmabana',data.homeTrackResults,'Senaste verifierade officiella hemmabana')+special('Övriga banor',data.otherTrackResults,'Endast tränare med verifierad hemmabana');return score(data,c)";

export function enhanceEntityDetailStatisticsHtml(html) {
  let enhanced = enhanceEntityDetailStatisticsHtmlV2(html);
  if (!enhanced.includes(SUCCESS_RENDER)) throw new Error('entity detail UI composition target is missing');
  if (!enhanced.includes(TRAINER_SPECIALS)) throw new Error('trainer detail specialist target is missing');
  enhanced = enhanced.replace(TRAINER_SPECIALS, TRAINER_SPECIALS_WITH_HOME);
  return enhanced.replace(SUCCESS_RENDER, ORDERED_RENDER);
}
