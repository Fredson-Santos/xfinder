import { toast } from './toast.svelte.js';

/**
 * Copia texto para a área de transferência de forma universal e resiliente.
 * Funciona tanto em contextos seguros (HTTPS / localhost) quanto em conexões
 * HTTP na rede local (ex: http://192.168.1.X:2332), contornando a restrição
 * do `navigator.clipboard` que fica `undefined` em conexões não-HTTPS.
 */
export async function copyText(text, successMessage = 'Link copiado!') {
  if (!text) return false;

  let success = false;

  // 1. Tenta API moderna do Clipboard se disponível (HTTPS / localhost)
  if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    try {
      await navigator.clipboard.writeText(text);
      success = true;
    } catch {
      // Falhou ou permissão negada, cai no fallback clássico
    }
  }

  // 2. Fallback clássico via document.execCommand (funciona em HTTP / rede local)
  if (!success && typeof document !== 'undefined') {
    try {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.setAttribute('readonly', '');
      textarea.style.position = 'fixed';
      textarea.style.top = '0';
      textarea.style.left = '0';
      textarea.style.width = '2em';
      textarea.style.height = '2em';
      textarea.style.padding = '0';
      textarea.style.border = 'none';
      textarea.style.outline = 'none';
      textarea.style.boxShadow = 'none';
      textarea.style.background = 'transparent';
      textarea.style.opacity = '0';
      textarea.style.pointerEvents = 'none';

      const selection = document.getSelection();
      const originalRange = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;

      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      textarea.setSelectionRange(0, text.length);

      success = document.execCommand('copy');
      document.body.removeChild(textarea);

      if (originalRange && selection) {
        selection.removeAllRanges();
        selection.addRange(originalRange);
      }
    } catch {
      success = false;
    }
  }

  // 3. Fallback final via prompt interativo
  if (!success && typeof window !== 'undefined') {
    try {
      window.prompt('Copie o link abaixo:', text);
      success = true;
    } catch {
      success = false;
    }
  }

  if (success && successMessage) {
    toast(successMessage);
  }

  return success;
}

