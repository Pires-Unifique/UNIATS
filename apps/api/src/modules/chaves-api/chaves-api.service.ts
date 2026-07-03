import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { ChaveApiCriadaDTO, ChaveApiDTO } from '@uniats/shared';
import { createHash, randomBytes } from 'node:crypto';

import { PrismaService } from '../../prisma/prisma.service.js';
import { ESCOPOS_CHAVE_API } from '../auth/auth.types.js';
import type { Area, UsuarioAutenticado } from '../auth/auth.types.js';

/** Prefixo do formato da chave — identifica visualmente um segredo do Collab. */
const PREFIXO_CHAVE = 'clb_';
/** Tamanho do trecho exibível (prefixo + primeiros hex) na UI/listagem. */
const TAMANHO_PREFIXO_VISIVEL = 12;

/**
 * Chaves de API — acesso de MÁQUINA à API com escopos por área.
 * A chave completa só existe na resposta da criação: guardamos apenas o
 * SHA-256 (a autenticação em si vive em AuthService.autenticarPorChaveApi).
 */
@Injectable()
export class ChavesApiService {
  private readonly logger = new Logger(ChavesApiService.name);

  constructor(private readonly prisma: PrismaService) {}

  async listar(): Promise<ChaveApiDTO[]> {
    const chaves = await this.prisma.chaveApi.findMany({
      orderBy: { criado_em: 'desc' },
      take: 200,
    });
    return chaves.map(toDTO);
  }

  async gerar(
    input: { nome?: string; escopos?: string[]; validade_dias?: number | null },
    autor: UsuarioAutenticado,
  ): Promise<ChaveApiCriadaDTO> {
    const nome = input.nome?.trim();
    if (!nome) throw new BadRequestException('nome é obrigatório.');
    const escopos = this.validarEscopos(input.escopos ?? []);

    let expiraEm: Date | null = null;
    if (input.validade_dias != null) {
      const dias = Number(input.validade_dias);
      if (!Number.isInteger(dias) || dias < 1 || dias > 3650) {
        throw new BadRequestException('validade_dias deve ser inteiro entre 1 e 3650.');
      }
      expiraEm = new Date(Date.now() + dias * 24 * 60 * 60 * 1000);
    }

    // 24 bytes ~ 48 hex: entropia de sobra; o hash é o que vai ao banco.
    const chave = `${PREFIXO_CHAVE}${randomBytes(24).toString('hex')}`;
    const hash = createHash('sha256').update(chave, 'utf8').digest('hex');
    const prefixo = chave.slice(0, TAMANHO_PREFIXO_VISIVEL);

    const criada = await this.prisma.chaveApi.create({
      data: {
        nome,
        prefixo,
        hash,
        escopos,
        criado_por_id: autor.chave_api ? null : autor.id,
        criado_por_nome: autor.nome,
        expira_em: expiraEm,
      },
    });

    await this.auditar(autor, 'chave_api_criada', criada.id, {
      depois: { nome, escopos, expira_em: expiraEm?.toISOString() ?? null },
    });
    this.logger.log(`Chave de API "${nome}" (${prefixo}…) criada por ${autor.email}.`);

    // Única vez que a chave completa sai do servidor.
    return { ...toDTO(criada), chave };
  }

  async revogar(id: string, autor: UsuarioAutenticado): Promise<ChaveApiDTO> {
    const atual = await this.prisma.chaveApi.findUnique({ where: { id } });
    if (!atual) throw new NotFoundException(`Chave ${id} não encontrada.`);
    if (atual.revogado_em) {
      throw new BadRequestException('Esta chave já foi revogada.');
    }

    const chave = await this.prisma.chaveApi.update({
      where: { id },
      data: {
        revogado_em: new Date(),
        revogado_por_id: autor.chave_api ? null : autor.id,
      },
    });

    await this.auditar(autor, 'chave_api_revogada', id, {
      antes: { nome: atual.nome, escopos: atual.escopos },
    });
    this.logger.log(`Chave de API "${atual.nome}" (${atual.prefixo}…) revogada por ${autor.email}.`);
    return toDTO(chave);
  }

  // -----------------------------------------------------------------------

  private validarEscopos(entrada: string[]): Area[] {
    const unicos = [...new Set(entrada.map((e) => e.trim()))].filter(Boolean);
    if (unicos.length === 0) {
      throw new BadRequestException('Selecione ao menos um escopo.');
    }
    const invalidos = unicos.filter(
      (e) => !ESCOPOS_CHAVE_API.includes(e as Area),
    );
    if (invalidos.length > 0) {
      throw new BadRequestException(
        `Escopo(s) inválido(s): ${invalidos.join(', ')}. Válidos: ${ESCOPOS_CHAVE_API.join(', ')} ('admin' é proibido para chaves).`,
      );
    }
    return unicos as Area[];
  }

  private async auditar(
    autor: UsuarioAutenticado,
    acao: string,
    chaveId: string,
    diff: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.prisma.registroAuditoria.create({
        data: {
          usuario_id: autor.chave_api ? null : autor.id,
          acao,
          entidade: 'chave_api',
          entidade_id: chaveId,
          diff: diff as object,
        },
      });
    } catch (err) {
      this.logger.error(`Falha ao auditar ${acao}: ${(err as Error).message}`);
    }
  }
}

function toDTO(c: {
  id: string;
  nome: string;
  prefixo: string;
  escopos: string[];
  criado_por_nome: string | null;
  expira_em: Date | null;
  ultimo_uso_em: Date | null;
  revogado_em: Date | null;
  criado_em: Date;
}): ChaveApiDTO {
  return {
    id: c.id,
    nome: c.nome,
    prefixo: c.prefixo,
    escopos: c.escopos,
    criado_por_nome: c.criado_por_nome,
    expira_em: c.expira_em?.toISOString() ?? null,
    ultimo_uso_em: c.ultimo_uso_em?.toISOString() ?? null,
    revogado_em: c.revogado_em?.toISOString() ?? null,
    criado_em: c.criado_em.toISOString(),
  };
}
