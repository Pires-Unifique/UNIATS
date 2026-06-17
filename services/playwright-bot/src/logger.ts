import pino from 'pino';

export function criarLogger(opts: { level: string; pretty: boolean }) {
  return pino({
    level: opts.level,
    ...(opts.pretty
      ? { transport: { target: 'pino-pretty', options: { colorize: true } } }
      : {}),
  });
}

export type Logger = ReturnType<typeof criarLogger>;
