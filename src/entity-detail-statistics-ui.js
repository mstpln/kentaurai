import { enhanceEntityDetailStatisticsHtmlV2 } from './entity-detail-statistics-ui-v2.js';

const SUCCESS_RENDER = "host.innerHTML=content(data,s,c)+'<div class=\"entity-detail-controls\">'+toolbar(s,c)+panel(s,c)+'</div>';bind(host,s,c)";
const ORDERED_RENDER = "host.innerHTML=content(data,s,c)+'<div class=\"entity-detail-controls\">'+toolbar(s,c)+panel(s,c)+'</div>';const scoreNode=host.querySelector('.entity-detail-score');const controlsNode=host.querySelector('.entity-detail-controls');if(scoreNode&&controlsNode)scoreNode.after(controlsNode);bind(host,s,c)";

export function enhanceEntityDetailStatisticsHtml(html) {
  const enhanced = enhanceEntityDetailStatisticsHtmlV2(html);
  if (!enhanced.includes(SUCCESS_RENDER)) throw new Error('entity detail UI composition target is missing');
  return enhanced.replace(SUCCESS_RENDER, ORDERED_RENDER);
}
