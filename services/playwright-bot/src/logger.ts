import pino from 'pino';

export function criarLogger(opts: { level: string; pretty: boolean }) {
  // pino-pretty é devDependency — na imagem de produção pode não existir. Se
  // pedimos pretty mas ele falta, o pino() lança ("unable to determine transport
  // target for pino-pretty") e derrubaria o bot no boot. Tentamos e, na falha,
  // caímos pra logs JSON em vez de crashar.
  if (opts.pretty) {
    try {
      return pino({
        level: opts.level,
        transport: { target: 'pino-pretty', options: { colorize: true } },
      });
    } catch {
      /* sem pino-pretty → JSON */
    }
  }
  return pino({ level: opts.level });
}

export type Logger = ReturnType<typeof criarLogger>;
