import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { ClaudeService } from '../claude/claude.service.js';
import { redigirRegex } from './redacao.regex.js';

interface TurnoBase {
  falante?: string | null;
  texto: string;
}

/**
 * Orquestra as DUAS camadas da censura LGPD (ver docs em redacao.regex.ts e
 * redacao.schema.ts). É o único ponto que os processors chamam antes de persistir:
 *
 *   Camada 1 (regex, sempre)  → identificadores estruturados (CPF, telefone, …)
 *   Camada 2 (Claude, opcional) → dados sensíveis contextuais (saúde, religião, …)
 *
 * Contrato: o que sai daqui é o que pode ir ao banco. O texto cru fica só em memória.
 */
@Injectable()
export class RedacaoService {
  private readonly logger = new Logger(RedacaoService.name);
  private readonly semanticaEnabled: boolean;

  constructor(
    private readonly claude: ClaudeService,
    config: ConfigService,
  ) {
    // Escape hatch operacional: desligar a Camada 2 deixa só o piso da regex
    // (não recomendado em produção — perde a cobertura de dados sensíveis).
    this.semanticaEnabled =
      (config.get<string>('REDACAO_SEMANTICA_ENABLED') ?? 'true') !== 'false';
  }

  /** Camada 1 isolada (determinística) sobre um texto solto. Usada como piso extra. */
  redigirRegexTexto(texto: string): string {
    return redigirRegex(texto ?? '').texto;
  }

  /**
   * Redige uma lista de turnos preservando a estrutura (falante/tempos) e
   * devolvendo também o texto corrido remontado ("Falante: fala" por linha).
   * A Camada 2 é fail-closed: se o Claude falhar com erro retryável, propaga
   * para o BullMQ re-tentar — não persistimos texto meio-censurado.
   */
  async redigirTurnos<T extends TurnoBase>(
    turnos: T[],
    opts: { signal?: AbortSignal } = {},
  ): Promise<{
    turnos: T[];
    texto: string;
    categorias: string[];
    houveOcultacao: boolean;
  }> {
    if (turnos.length === 0) {
      return { turnos: [], texto: '', categorias: [], houveOcultacao: false };
    }

    const categorias = new Set<string>();

    // Camada 1 — regex por turno (piso determinístico, roda antes de ir ao Claude).
    const regexados: T[] = turnos.map((t) => {
      const r = redigirRegex((t.texto ?? '').toString());
      r.categorias.forEach((c) => categorias.add(c));
      return { ...t, texto: r.texto } as T;
    });

    // Camada 2 — semântica via Claude.
    let finais: T[] = regexados;
    if (this.semanticaEnabled) {
      const { textos } = await this.claude.redigirSensivel(
        regexados.map((t) => ({ falante: t.falante ?? null, texto: t.texto })),
        { signal: opts.signal },
      );
      finais = regexados.map((t, i) => ({ ...t, texto: textos[i] ?? t.texto }) as T);
      for (const t of finais) {
        for (const m of t.texto.matchAll(/\[OCULTADO:\s*([^\]]+)\]/g)) {
          categorias.add(m[1].trim());
        }
      }
    }

    const texto = finais
      .map((t) => {
        const f = (t.falante ?? '').toString().trim();
        return f ? `${f}: ${t.texto}` : t.texto;
      })
      .join('\n')
      .trim();

    if (categorias.size > 0) {
      // Loga só as CATEGORIAS — nunca o conteúdo ocultado.
      this.logger.log(
        `Censura LGPD: ${finais.length} turnos, categorias=[${[...categorias].join(', ')}]`,
      );
    }

    return {
      turnos: finais,
      texto,
      categorias: [...categorias],
      houveOcultacao: categorias.size > 0,
    };
  }
}
