/** Aviso flutuante único (substitui o anterior). */
export const toastState = $state({ message: '', id: 0 });

let timer;
export function toast(message, ms = 3200) {
  clearTimeout(timer);
  toastState.message = message;
  toastState.id++;
  timer = setTimeout(() => { toastState.message = ''; }, ms);
}
