import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import { Prisma } from '@triagem/db';

import { PrismaService } from '../../../prisma/prisma.service.js';
import {
  EMBEDDING_PROVIDER,
  type EmbeddingProvider,
} from '../../embeddings/embedding.provider.js';
import type { CurriculoEstruturado } from '../../claude/curriculo.schema.js';
import {
  TEXTO_CANONICO_VERSAO,
  montarTextoCanonicoCurriculo,
  montarTextoCanonicoVaga,
} from './texto-canonico.js';

export type EmbeddingAlvo = 'vaga' | 'curriculo';

@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name);
  private readonly dimensoes: number;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(EMBEDDING_PROVIDER) private readonly provider: EmbeddingProvider,
  ) {
    // A dimensão esperada vem do provedor ativo (Voyage=1024, e5-base=768, etc.).
    this.dimensoes = this.provider.dimensoes;
  }

  /**
   * Gera (ou regenera) o embedding de uma VAGA.
   * Idempotente por (vaga_id, modelo) — apaga registros anteriores do mesmo modelo
   * antes de inserir um novo, para evitar acúmulo histórico ofuscando a busca.
   */
  async embedarVaga(vagaId: string): Promise<{ embeddingId: string }> {
    const vaga = await this.prisma.vaga.findUnique({
      where: { id: vagaId },
      select: {
        id: true,
        titulo: true,
        descricao: true,
        departamento: true,
        unidade: true,
        cidade: true,
        estado: true,
        remoto: true,
        tipo_contrato: true,
        requisitos_json: true,
        requisitos_texto: true,
      },
    });
    if (!vaga) throw new NotFoundException(`Vaga ${vagaId} não existe.`);

    const texto = montarTextoCanonicoVaga(vaga);
    if (!texto.trim()) {
      throw new BadRequestException(
        'Vaga sem dados suficientes para gerar embedding.',
      );
    }

    return this.gravar({
      alvo: 'vaga',
      alvoId: vaga.id,
      texto,
    });
  }

  /**
   * Gera (ou regenera) o embedding de um CURRÍCULO já estruturado pela Camada 2.
   */
  async embedarCurriculo(
    candidaturaId: string,
  ): Promise<{ embeddingId: string }> {
    const cv = await this.prisma.curriculoProcessado.findUnique({
      where: { candidatura_id: candidaturaId },
      select: {
        id: true,
        resumo: true,
        experiencias: true,
        formacoes: true,
        competencias: true,
        idiomas: true,
        certificacoes: true,
        anos_experiencia: true,
        texto_normalizado: true,
        parser_versao: true,
      },
    });
    if (!cv) {
      throw new NotFoundException(
        `Currículo da candidatura ${candidaturaId} não existe.`,
      );
    }
    if (!cv.parser_versao || cv.parser_versao === 'pending') {
      throw new BadRequestException(
        `Currículo da candidatura ${candidaturaId} ainda não foi estruturado.`,
      );
    }

    // Tenta usar a estrutura LLM-parseada; cai para texto_normalizado em último caso.
    const texto = montarTextoCanonicoCurriculo({
      resumo: cv.resumo,
      estruturado: {
        experiencias:
          (cv.experiencias as CurriculoEstruturado['experiencias']) ?? [],
        formacoes:
          (cv.formacoes as CurriculoEstruturado['formacoes']) ?? [],
        competencias: cv.competencias ?? [],
        idiomas: (cv.idiomas as CurriculoEstruturado['idiomas']) ?? [],
        certificacoes:
          (cv.certificacoes as CurriculoEstruturado['certificacoes']) ?? [],
        anos_experiencia: cv.anos_experiencia ?? undefined,
      },
    });

    const textoFinal = texto.trim() || cv.texto_normalizado;
    if (!textoFinal) {
      throw new BadRequestException(
        'Currículo sem conteúdo suficiente para embedding.',
      );
    }

    return this.gravar({
      alvo: 'curriculo',
      alvoId: cv.id,
      texto: textoFinal,
    });
  }

  /**
   * Núcleo: chama Voyage, valida dimensão, apaga embeddings anteriores do mesmo
   * (alvo, modelo) e insere o novo via SQL bruto (pgvector).
   */
  private async gravar(input: {
    alvo: EmbeddingAlvo;
    alvoId: string;
    texto: string;
  }): Promise<{ embeddingId: string }> {
    const { vetores, modelo, usage } = await this.provider.embed({
      textos: [input.texto],
      inputType: 'document',
    });

    const vetor = vetores[0];
    if (vetor.length !== this.dimensoes) {
      throw new Error(
        `Vetor com dimensão inesperada: ${vetor.length} ≠ ${this.dimensoes}`,
      );
    }

    // Mantemos histórico curto: 1 embedding por (alvo, modelo). Re-embedar substitui.
    // Uma única transação evita janela onde o ranking veria 0 vetores.
    const embeddingId: string = await this.prisma.$transaction<string>(async (tx): Promise<string> => {
      if (input.alvo === 'vaga') {
        await tx.embedding.deleteMany({
          where: { vaga_id: input.alvoId, modelo },
        });
      } else {
        await tx.embedding.deleteMany({
          where: { curriculo_id: input.alvoId, modelo },
        });
      }

      // pgvector exige a sintaxe '[v1,v2,...]'::vector. Geramos com cuidado:
      // - vetor é array de Number(), portanto seguro (não é entrada de usuário).
      // - IDs são UUIDs validados pelo Prisma e passamos como parâmetros (não interpolação).
      const vetorLiteral = `[${vetor.join(',')}]`;
      const id = crypto.randomUUID();

      if (input.alvo === 'vaga') {
        await tx.$executeRaw(Prisma.sql`
          INSERT INTO embeddings (id, vaga_id, trecho, vetor, modelo, modelo_versao, criado_em)
          VALUES (
            ${id}::uuid,
            ${input.alvoId}::uuid,
            ${input.texto},
            ${vetorLiteral}::vector,
            ${modelo},
            ${TEXTO_CANONICO_VERSAO},
            NOW()
          )
        `);
      } else {
        await tx.$executeRaw(Prisma.sql`
          INSERT INTO embeddings (id, curriculo_id, trecho, vetor, modelo, modelo_versao, criado_em)
          VALUES (
            ${id}::uuid,
            ${input.alvoId}::uuid,
            ${input.texto},
            ${vetorLiteral}::vector,
            ${modelo},
            ${TEXTO_CANONICO_VERSAO},
            NOW()
          )
        `);
      }

      return id;
    });

    this.logger.log(
      `Embedding gravado: alvo=${input.alvo} id=${input.alvoId} ` +
        `tokens=${usage?.total_tokens ?? 'n/a'} modelo=${modelo}`,
    );

    return { embeddingId };
  }
}
