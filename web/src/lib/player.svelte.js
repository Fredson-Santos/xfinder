/**
 * O que o player deve tocar. As páginas chamam `openPlayer(...)`; o componente
 * <Player> observa `player.session` e (re)inicia a reprodução.
 *
 * @typedef {{
 *   name: string, host: string,
 *   url?: string,
 *   resolve?: () => Promise<string>,   // fontes resolvidas sob demanda (episódios em outros servidores)
 * }} Source
 *
 * @typedef {{
 *   title: string, subtitle?: string, poster?: string,
 *   type: 'movie'|'series'|'live',
 *   sources: Source[],
 *   initialTime?: number,
 *   onProgress?: (p: {currentTime:number, duration:number, finished:boolean}) => void,
 *   queue?: { hasPrev:boolean, hasNext:boolean, nextLabel?:string, prev:() => void, next:() => void } | null,
 *   onClose: () => void,
 * }} PlayRequest
 */

export const player = $state({
  session: 0,
  /** @type {PlayRequest|null} */
  request: null,
});

/** @param {PlayRequest} request */
export function openPlayer(request) {
  player.request = request;
  player.session++;
}

export function stopPlayer() {
  player.request = null;
  player.session++;
}
