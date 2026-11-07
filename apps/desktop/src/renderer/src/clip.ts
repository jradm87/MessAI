/** Área de transferência do SO: pelo processo principal quando dá (lê imagem, não depende de foco); senão navigator.clipboard. */
export const copyText = (t: string): Promise<void> =>
  window.messai.clipboardWrite ? window.messai.clipboardWrite(t) : navigator.clipboard.writeText(t);
export const readClipboard = async (): Promise<{ text: string; png: string | null }> =>
  window.messai.clipboardRead ? window.messai.clipboardRead() : { text: await navigator.clipboard.readText().catch(() => ""), png: null };
