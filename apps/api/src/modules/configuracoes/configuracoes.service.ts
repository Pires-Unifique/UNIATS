import { Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service.js';

/** TTL do cache em memória — a API é instância única, então segundos bastam. */
const CACHE_TTL_MS = 15_000;

/**
 * Configurações do sistema (chave/valor Json) editáveis pela seção Sistema.
 * O env continua sendo o PADRÃO de cada configuração; o valor salvo aqui,
 * quando existe, sobrepõe. Escritas invalidam o cache na hora (leituras de
 * outros pontos do app pegam a mudança em até ~15s).
 */
@Injectable()
export class ConfiguracoesService {
  private readonly logger = new Logger(ConfiguracoesService.name);
  private readonly cache = new Map<string, { valor: unknown; lidoEm: number }>();

  constructor(private readonly prisma: PrismaService) {}

  /** Valor salvo para a chave, ou null quando não há override. */
  async obter<T>(chave: string): Promise<T | null> {
    const emCache = this.cache.get(chave);
    if (emCache && Date.now() - emCache.lidoEm < CACHE_TTL_MS) {
      return emCache.valor as T | null;
    }
    const linha = await this.prisma.configuracaoSistema.findUnique({
      where: { chave },
    });
    const valor = (linha?.valor ?? null) as T | null;
    this.cache.set(chave, { valor, lidoEm: Date.now() });
    return valor;
  }

  async salvar(
    chave: string,
    valor: object,
    atualizadoPorId: string | null,
  ): Promise<void> {
    await this.prisma.configuracaoSistema.upsert({
      where: { chave },
      create: { chave, valor, atualizado_por_id: atualizadoPorId },
      update: { valor, atualizado_por_id: atualizadoPorId },
    });
    this.cache.set(chave, { valor, lidoEm: Date.now() });
    this.logger.log(`Configuração '${chave}' atualizada.`);
  }

  /** Remove o override — a configuração volta ao padrão do ambiente (env). */
  async remover(chave: string): Promise<void> {
    await this.prisma.configuracaoSistema
      .delete({ where: { chave } })
      .catch(() => undefined); // já não existia — idempotente
    this.cache.set(chave, { valor: null, lidoEm: Date.now() });
    this.logger.log(`Configuração '${chave}' removida (volta ao padrão do env).`);
  }
}
