/**
 * Utilitários de normalização de texto extraído de currículos.
 * Mantemos puros para facilitar teste unitário.
 */

const MAX_NORMALIZADO_BYTES = 50_000;

/**
 * Normaliza texto extraído: trim, colapsa espaços, remove caracteres de controle,
 * trunca em 50KB para conter custo de LLM.
 */
export function normalizarTexto(input: string): string {
  if (!input) return '';
  const semControle = input
    // Remove caracteres de controle (mas mantém \n e \t)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
    // Normaliza unicode
    .normalize('NFKC');

  const compactado = semControle
    .split('\n')
    .map((linha) => linha.replace(/[ \t\u00A0]+/g, ' ').trim())
    .filter((linha) => linha.length > 0)
    .join('\n');

  // Corta no limite de bytes, sem cortar caractere multi-byte no meio.
  if (Buffer.byteLength(compactado, 'utf8') <= MAX_NORMALIZADO_BYTES) {
    return compactado;
  }
  const buf = Buffer.from(compactado, 'utf8').subarray(
    0,
    MAX_NORMALIZADO_BYTES,
  );
  return buf.toString('utf8');
}

/** Heurística defensiva: tem PDF que extrai como gibberish (sem espaços, ou todo \u0000). */
export function pareceTextoUtil(texto: string): boolean {
  if (!texto || texto.length < 50) return false;
  const ratioEspacos =
    (texto.match(/\s/g)?.length ?? 0) / texto.length;
  // Currículos legítimos têm ~10-25% de whitespace. < 2% = texto corrompido.
  return ratioEspacos > 0.02;
}
