import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@collab/db';

import { PrismaService } from '../../prisma/prisma.service.js';
import { StorageService } from '../storage/storage.service.js';
import { MARCADOR_PURGADO } from './retencao.constants.js';

/**
 * Retenção e apagamento dos dados do CANDIDATO (Art. 16 e 18 da LGPD).
 *
 * Complementa o RetencaoLGPDService do módulo de entrevista, que cuida de áudio
 * e transcrição. Aqui tratamos o que sobrevivia indefinidamente: currículo,
 * candidato e o rastro de mensagens.
 *
 * Duas portas de entrada, um só motor:
 *   - varredura noturna (Art. 16) — prazo vencido;
 *   - pedido do titular (Art. 18) — `apagarCandidato`, chamado pela tela.
 *
 * ┌─ POR QUE O CORTE É CALCULADO, E NÃO GRAVADO NUMA COLUNA ─────────────┐
 * │ A transcrição materializa `expira_em` no momento da criação. Aqui o   │
 * │ corte sai da env a cada execução: enquanto o prazo está sendo         │
 * │ acordado com a cyber, mudar a variável muda a política já na próxima  │
 * │ madrugada — inclusive para o que já está no banco. Com coluna, cada   │
 * │ ajuste exigiria migration + backfill.                                 │
 * └───────────────────────────────────────────────────────────────────────┘
 *
 * O apagamento é IRREVERSÍVEL e some com o blob no storage. Toda ação gera
 * RegistroAuditoria contendo apenas CATEGORIA e contagem — nunca o valor do
 * dado (Art. 37 e REQ-LOG-003).
 */

/** Status em que o processo seletivo já terminou para aquele candidato. */
const STATUS_TERMINAIS = ['REPROVADO', 'DESISTENTE', 'CONTRATADO'] as const;

/** Entrevista que ainda pode acontecer — segura o apagamento do candidato. */
const STATUS_ENTREVISTA_VIVA = ['AGENDADA', 'EM_ANDAMENTO'] as const;

/** Janela por execução: mantém o cron previsível mesmo com backlog grande. */
const LOTE = 200;

@Injectable()
export class RetencaoDadosService {
  private readonly logger = new Logger(RetencaoDadosService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly config: ConfigService,
  ) {}

  /**
   * 03:20 — depois do cron de áudio/transcrição (03:00), de propósito: se as
   * duas varreduras disputassem as mesmas entrevistas, uma veria a linha que a
   * outra acabou de mexer. Aqui elas não se cruzam.
   */
  @Cron('0 20 3 * * *', { name: 'retencao-dados-candidato' })
  async aplicarRetencaoDiaria(): Promise<void> {
    try {
      const cv = await this.purgarCurriculosExpirados();
      const cand = await this.apagarCandidatosInativos();
      this.logger.log(
        `Retenção de dados aplicada: curriculos=${cv.purgados} candidatos=${cand.apagados}`,
      );
    } catch (err) {
      this.logger.error(
        `Falha no cron de retenção de dados: ${(err as Error).message}`,
      );
    }
  }

  /** Data-limite: tudo anterior a ela está vencido. */
  private corte(envVar: string, padraoDias: number): Date {
    const dias = Number(this.config.get<number>(envVar) ?? padraoDias);
    return new Date(Date.now() - dias * 24 * 60 * 60 * 1000);
  }

  // ---------------------------------------------------------------------
  // Art. 16 — currículo vencido
  // ---------------------------------------------------------------------

  /**
   * Apaga o CONTEÚDO do currículo vencido, preservando a linha: a candidatura
   * continua existindo como histórico do processo, sem o material que a
   * sustentava. Some o arquivo no storage, somem os embeddings (é o mesmo texto
   * em forma vetorial — PII derivado) e zeram os campos estruturados.
   */
  async purgarCurriculosExpirados(): Promise<{ purgados: number }> {
    const corte = this.corte('RETENCAO_CV_DIAS', 730);

    const vencidos = await this.prisma.curriculoProcessado.findMany({
      where: {
        processado_em: { lte: corte },
        // Já purgado numa rodada anterior: fora da varredura (idempotência).
        texto_bruto: { not: MARCADOR_PURGADO },
      },
      select: { id: true, candidato_id: true, arquivo_url: true },
      take: LOTE,
    });

    let purgados = 0;
    for (const cv of vencidos) {
      try {
        await this.purgarCurriculo(cv);
        await this.auditar('retencao_lgpd_curriculo', 'curriculo_processado', cv.id, {
          categorias: ['curriculo_texto', 'curriculo_estruturado', 'embeddings'],
          tinha_arquivo: Boolean(cv.arquivo_url),
        });
        purgados++;
      } catch (err) {
        // Igual ao áudio: nada é zerado se o storage falhar — a linha volta na
        // varredura de amanhã e converge.
        this.logger.warn(
          `Falha ao purgar currículo ${cv.id} (segue pendente): ${(err as Error).message}`,
        );
      }
    }
    return { purgados };
  }

  /**
   * Blob primeiro, banco depois. Invertido, um erro no storage deixaria o
   * arquivo órfão no bucket sem nenhum ponteiro para achá-lo — foi exatamente
   * o bug que o áudio teve enquanto `deleteObject` não existia.
   */
  private async purgarCurriculo(cv: {
    id: string;
    arquivo_url: string | null;
  }): Promise<void> {
    if (cv.arquivo_url) {
      await this.storage.deleteObject(cv.arquivo_url);
    }

    // Os vetores saem junto: guardar o embedding de um CV apagado manteria o
    // candidato pesquisável por similaridade — o dado, na prática, continuaria lá.
    await this.prisma.embedding.deleteMany({ where: { curriculo_id: cv.id } });

    await this.prisma.curriculoProcessado.update({
      where: { id: cv.id },
      data: {
        arquivo_url: null,
        arquivo_sha256: null,
        texto_bruto: MARCADOR_PURGADO,
        texto_normalizado: MARCADOR_PURGADO,
        resumo: null,
        experiencias: Prisma.DbNull,
        formacoes: Prisma.DbNull,
        competencias: [],
        idiomas: Prisma.DbNull,
        certificacoes: Prisma.DbNull,
        anos_experiencia: null,
      },
    });
  }

  // ---------------------------------------------------------------------
  // Art. 16 — candidato sem processo vivo
  // ---------------------------------------------------------------------

  /**
   * Apaga a identidade de quem não tem mais nada em andamento e cuja última
   * candidatura já venceu o prazo.
   *
   * O filtro usa `criado_em` (quando ingerimos), NÃO `atualizado_em`: o upsert
   * do sync toca `atualizado_em` a cada 6 horas, então o relógio nunca venceria.
   *
   * Escrito com `none`, e não com `NOT: [...]`, de propósito: numa lista, `NOT`
   * nega a CONJUNTO das condições, então bastaria falhar UMA para o candidato
   * entrar na varredura — alguém com processo em aberto seria apagado. `none` é
   * explícito e não depende dessa leitura.
   */
  async apagarCandidatosInativos(): Promise<{ apagados: number }> {
    const corte = this.corte('RETENCAO_CANDIDATO_DIAS', 730);

    const inativos = await this.prisma.candidato.findMany({
      where: {
        excluido_em: null,
        candidaturas: {
          // Ao menos uma candidatura: quem nunca se candidatou não tem data
          // para vencer.
          some: {},
          // E NENHUMA delas pode ser recente OU ainda estar em andamento.
          none: {
            OR: [
              { criado_em: { gt: corte } },
              { status: { notIn: [...STATUS_TERMINAIS] } },
            ],
          },
        },
        // Nenhuma entrevista que ainda pode acontecer.
        entrevistas: { none: { status: { in: [...STATUS_ENTREVISTA_VIVA] } } },
        // Admissão significa contrato de trabalho: outra base legal, outro
        // prazo de guarda. Sai do escopo desta varredura.
        admissoes: { none: {} },
      },
      select: { id: true },
      take: LOTE,
    });

    let apagados = 0;
    for (const c of inativos) {
      try {
        await this.apagarCandidato(c.id, { motivo: 'retencao_prazo_vencido' });
        apagados++;
      } catch (err) {
        this.logger.warn(
          `Falha ao apagar candidato ${c.id} (segue pendente): ${(err as Error).message}`,
        );
      }
    }
    return { apagados };
  }

  // ---------------------------------------------------------------------
  // Art. 18 — pedido do titular (e motor da varredura acima)
  // ---------------------------------------------------------------------

  /**
   * Apaga os dados pessoais do candidato preservando o histórico do processo.
   *
   * O que some: nome, e-mail, telefone, LinkedIn, cidade/UF, hash de CPF,
   * currículo (texto, estrutura, arquivo e vetores), mensagens trocadas,
   * transcrições e áudios das entrevistas.
   *
   * O que fica: candidatura, score e o parecer — sem dono identificável. É o
   * que sustenta a defesa da empresa numa eventual reclamatória e o que mantém
   * a integridade referencial de pé.
   *
   * `excluido_em` funciona como LÁPIDE: `GupyService.candidatoApagado` a
   * consulta antes de qualquer upsert, então o sync não repopula o registro.
   * Sem essa dupla, o apagamento duraria até a próxima passada do cron.
   *
   * ORDEM IMPORTA — a lápide é carimbada por ÚLTIMO, e não primeiro. Isto não é
   * transacional (apagar blob no storage não tem rollback), então uma falha no
   * meio precisa ser recuperável. Carimbando por último, a falha deixa
   * `excluido_em` nulo e a próxima tentativa refaz TUDO — purgar currículo já
   * purgado, apagar mensagem já apagada e remover blob inexistente são todos
   * no-op, então converge. Se a lápide viesse primeiro, a retentativa cairia no
   * curto-circuito de idempotência logo abaixo e as sobras nunca sairiam.
   */
  async apagarCandidato(
    candidatoId: string,
    opts: { motivo: string; autorId?: string | null },
  ): Promise<{ categorias: string[] }> {
    const candidato = await this.prisma.candidato.findUnique({
      where: { id: candidatoId },
      select: {
        id: true,
        excluido_em: true,
        curriculos: { select: { id: true, arquivo_url: true } },
        entrevistas: { select: { id: true, audio_url: true } },
      },
    });
    if (!candidato) {
      throw new NotFoundException(`Candidato ${candidatoId} não existe.`);
    }
    if (candidato.excluido_em) {
      // Idempotente: repetir o pedido não é erro nem gera auditoria nova.
      return { categorias: [] };
    }

    const categorias: string[] = [];

    for (const cv of candidato.curriculos) {
      await this.purgarCurriculo(cv);
      categorias.push('curriculo');
    }

    for (const e of candidato.entrevistas) {
      if (e.audio_url) {
        await this.storage.deleteObject(e.audio_url);
        await this.prisma.entrevista.update({
          where: { id: e.id },
          data: { audio_url: null, audio_sha256: null, audio_expira_em: null },
        });
        categorias.push('audio_entrevista');
      }
      const truncadas = await this.prisma.transcricao.updateMany({
        where: { entrevista_id: e.id },
        data: {
          texto_completo: MARCADOR_PURGADO,
          segmentos: {},
          whisper_segmentos: Prisma.DbNull,
          texto_fundido: null,
          segmentos_fundidos: Prisma.DbNull,
          resumo: null,
          expira_em: null,
        },
      });
      if (truncadas.count) categorias.push('transcricao');
    }

    // Corpo e destino da mensagem são PII em texto puro — a linha inteira sai.
    const msgs = await this.prisma.mensagem.deleteMany({
      where: { candidato_id: candidatoId },
    });
    if (msgs.count) categorias.push('mensagens');

    await this.prisma.candidato.update({
      where: { id: candidatoId },
      data: {
        nome_completo: MARCADOR_PURGADO,
        email: null,
        telefone: null,
        linkedin_url: null,
        cidade: null,
        estado: null,
        cpf_hash: null,
        gupy_payload: Prisma.DbNull,
        excluido_em: new Date(),
      },
    });
    categorias.push('identificacao_candidato');

    await this.auditar('exclusao_lgpd_candidato', 'candidato', candidatoId, {
      motivo: opts.motivo,
      categorias,
    }, opts.autorId ?? null);

    return { categorias };
  }

  /** Auditoria com CATEGORIA e contagem — nunca o valor do dado (Art. 37). */
  private async auditar(
    acao: string,
    entidade: string,
    entidadeId: string,
    diff: Record<string, unknown>,
    usuarioId: string | null = null,
  ): Promise<void> {
    await this.prisma.registroAuditoria.create({
      data: {
        usuario_id: usuarioId,
        acao,
        entidade,
        entidade_id: entidadeId,
        diff: diff as unknown as object,
      },
    });
  }
}
