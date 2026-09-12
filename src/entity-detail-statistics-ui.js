import { enhanceEntityDetailStatisticsHtmlV2 } from './entity-detail-statistics-ui-v2.js';

const SUCCESS_RENDER = "host.innerHTML=content(data,s,c)+'<div class=\"entity-detail-controls\">'+toolbar(s,c)+panel(s,c)+'</div>';bind(host,s,c)";
const ORDERED_RENDER = "host.innerHTML=content(data,s,c)+'<div class=\"entity-detail-controls\">'+toolbar(s,c)+panel(s,c)+'</div>';const scoreNode=host.querySelector('.entity-detail-score');const controlsNode=host.querySelector('.entity-detail-controls');if(scoreNode&&controlsNode)scoreNode.after(controlsNode);bind(host,s,c)";
const TRAINER_SPECIALS = "if(c.market)specials+=special('Resultat som favorit',data.favoriteResults,'Marknadsrank 1 vid sista giltiga snapshot före spelstopp')+special('Resultat som skräll',data.longshotResults,'Marknadsandel ≤ '+num(data.definitions?.longshotPercentMax??5)+'% vid spelstopp');return score(data,c)";
const TRAINER_SPECIALS_WITH_HOME = "if(s.page==='trainers')specials+=special('Hemmabana',data.homeTrackResults,'Senaste verifierade officiella hemmabana')+special('Övriga banor',data.otherTrackResults,'Endast tränare med verifierad hemmabana');if(c.market)specials+=special('Resultat som favorit',data.favoriteResults,'Marknadsrank 1 vid sista giltiga snapshot före spelstopp')+special('Resultat som skräll',data.longshotResults,'Marknadsandel ≤ '+num(data.definitions?.longshotPercentMax??5)+'% vid spelstopp');return score(data,c)";
const HORSE_AGE_OPTIONS = "if(!values.length&&s.options?.birthYears?.length){const y=new Date().getFullYear();values=[...new Set(s.options.birthYears.map(v=>y-Number(v)).filter(v=>v>=2&&v<=30))].sort((a,b)=>a-b)}";
const HORSE_AGE_OPTIONS_FOR_YEAR = "if(!values.length&&s.options?.birthYears?.length){const y=Number(s.filters.year)||new Date().getFullYear();values=[...new Set(s.options.birthYears.map(v=>y-Number(v)).filter(v=>v>=2&&v<=30))].sort((a,b)=>a-b)}";
const LEGACY_CLEANUP = "function cleanup(page,s){document.getElementById('trainerDetailStatisticsV2')?.remove();document.getElementById('trainerStatsBuildD')?.remove();document.getElementById('driverStatsBuildC')?.remove();if(page==='horses'){captureHorseExtra(s);document.getElementById('horseStatsBuildB')?.remove()}if(page==='trainers')document.querySelector('.entity-stat-filter-shell')?.remove();if(page==='drivers'){document.querySelector('.grid.grid-3')?.remove();document.querySelector('.breakdown-grid.stat-section')?.remove()}}";
const COMPLETE_CLEANUP = "function cleanup(page,s){document.getElementById('trainerDetailStatisticsV2')?.remove();document.getElementById('trainerStatsBuildD')?.remove();document.getElementById('driverStatsBuildC')?.remove();if(page==='horses'){captureHorseExtra(s);document.getElementById('horseStatsBuildB')?.remove()}if(page==='trainers')document.querySelector('.entity-stat-filter-shell')?.remove();if(page==='drivers'){document.querySelector('.grid.grid-3')?.remove();document.querySelector('.breakdown-grid.stat-section')?.remove()}app.querySelector(':scope > .data-groups')?.remove()}";

export function enhanceEntityDetailStatisticsHtml(html) {
  let enhanced = enhanceEntityDetailStatisticsHtmlV2(html);
  if (!enhanced.includes(SUCCESS_RENDER)) throw new Error('entity detail UI composition target is missing');
  if (!enhanced.includes(TRAINER_SPECIALS)) throw new Error('trainer detail specialist target is missing');
  if (!enhanced.includes(HORSE_AGE_OPTIONS)) throw new Error('horse detail age-option target is missing');
  if (!enhanced.includes(LEGACY_CLEANUP)) throw new Error('legacy detail cleanup target is missing');
  enhanced = enhanced.replace(TRAINER_SPECIALS, TRAINER_SPECIALS_WITH_HOME);
  enhanced = enhanced.replace(HORSE_AGE_OPTIONS, HORSE_AGE_OPTIONS_FOR_YEAR);
  enhanced = enhanced.replace(LEGACY_CLEANUP, COMPLETE_CLEANUP);
  return enhanced.replace(SUCCESS_RENDER, ORDERED_RENDER);
}
