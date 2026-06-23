import { createHash } from 'node:crypto';

import {
  BadRequestException,
  Injectable,
  ConflictException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import {
  Prisma,
  StatusAdmissao,
  StatusDocumentoAdmissional,
  ResultadoExameAdmissional,
  TipoDocumentoAdmissional,
} from '@uniats/db';

import { PrismaService } from '../../prisma/prisma.service.js';
import { QUEUE_NAMES } from '../../queue/queue.module.js';
import { StorageService } from '../storage/storage.service.js';

/** Content-Types aceitos no upload de documento (imagens + PDF). */
const MIME_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'application/pdf': 'pdf',
};

/**
 * Regras de negócio da Admissão (processo pós-contratação).
 *
 * NÃO há autorização aqui — a separação por equipe (recrutamento × admissão)
 * é feita só na interface por enquanto; o permissionamento por grupo de AD
 * será plugado depois, por cima destes endpoints.
 */

// Ordem canônica das etapas (CANCELADA fica fora do fluxo linear).
const ORDEM: StatusAdmissao[] = [
  StatusAdmissao.AGUARDANDO_ACEITE,
  StatusAdmissao.PROPOSTA_ACEITA,
  StatusAdmissao.COLETA_DOCUMENTOS,
  StatusAdmissao.DOCUMENTOS_EM_ANALISE,
  StatusAdmissao.EXAME_MEDICO,
  StatusAdmissao.ASSINATURA_CONTRATO,
  StatusAdmissao.ENVIO_ESOCIAL,
  StatusAdmissao.INTEGRACAO,
  StatusAdmissao.CONCLUIDA,
];

// Documentos que nascem no checklist; `true` = obrigatório.
const CHECKLIST_PADRAO: Array<[TipoDocumentoAdmissional, boolean]> = [
  [TipoDocumentoAdmissional.RG, true],
  [TipoDocumentoAdmissional.CPF, true],
  [TipoDocumentoAdmissional.CTPS, true],
  [TipoDocumentoAdmissional.PIS_NIS, true],
  [TipoDocumentoAdmissional.COMPROVANTE_RESIDENCIA, true],
  [TipoDocumentoAdmissional.DADOS_BANCARIOS, true],
  [TipoDocumentoAdmissional.FOTO_3X4, true],
  [TipoDocumentoAdmissional.TITULO_ELEITOR, false],
  [TipoDocumentoAdmissional.COMPROVANTE_ESCOLARIDADE, false],
  [TipoDocumentoAdmissional.CERTIDAO_NASCIMENTO_CASAMENTO, false],
  [TipoDocumentoAdmissional.RESERVISTA, false],
  [TipoDocumentoAdmissional.DEPENDENTES, false],
];

@Injectable()
export class AdmissaoService {
  private readonly logger = new Logger(AdmissaoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    @InjectQueue(QUEUE_NAMES.RG_OCR) private readonly filaRgOcr: Queue,
  ) {}

  async listar(status?: StatusAdmissao) {
    const itens = await this.prisma.admissao.findMany({
      where: { excluido_em: null, ...(status ? { status } : {}) },
      orderBy: [{ atualizado_em: 'desc' }],
      select: {
        id: true,
        status: true,
        cargo: true,
        data_admissao: true,
        atualizado_em: true,
        candidato: { select: { nome_completo: true } },
        vaga: { select: { titulo: true } },
      },
    });

    return itens.map((a) => ({
      id: a.id,
      status: a.status,
      candidato_nome: a.candidato.nome_completo,
      vaga_titulo: a.vaga?.titulo ?? null,
      cargo: a.cargo,
      data_admissao: a.data_admissao,
      atualizado_em: a.atualizado_em,
    }));
  }

  async obter(id: string) {
    const a = await this.prisma.admissao.findUnique({
      where: { id },
      include: {
        candidato: {
          select: {
            id: true,
            nome_completo: true,
            email: true,
            telefone: true,
          },
        },
        vaga: { select: { id: true, titulo: true } },
        documentos: { orderBy: { tipo: 'asc' } },
        exame: true,
        eventos: { orderBy: { criado_em: 'desc' } },
        solicitacao_acesso: true,
      },
    });
    if (!a) throw new NotFoundException(`Admissão ${id} não existe.`);
    // Decimal → string para serialização JSON segura.
    return { ...a, salario: a.salario?.toString() ?? null };
  }

  /**
   * Cria uma admissão a partir de uma candidatura CONTRATADO. Idempotente:
   * se já existe admissão para a candidatura, devolve a existente.
   */
  async criarDeCandidatura(candidaturaId: string) {
    const cand = await this.prisma.candidatura.findUnique({
      where: { id: candidaturaId },
      select: {
        id: true,
        status: true,
        vaga_id: true,
        candidato_id: true,
        admissao: { select: { id: true } },
      },
    });
    if (!cand) {
      throw new NotFoundException(`Candidatura ${candidaturaId} não existe.`);
    }
    if (cand.admissao) {
      return this.obter(cand.admissao.id);
    }
    if (cand.status !== 'CONTRATADO') {
      throw new ConflictException(
        'Só é possível iniciar admissão de candidatura com status CONTRATADO.',
      );
    }

    const id = await this.criarRegistroAdmissao(cand);
    return this.obter(id);
  }

  /**
   * Gatilho automático (webhook de contratação / sync): cria a admissão se a
   * candidatura está CONTRATADA e ainda não tem admissão. Idempotente e SEM
   * exceção — nunca quebra o fluxo que a chamou.
   */
  async criarDeCandidaturaSeElegivel(candidaturaId: string): Promise<boolean> {
    const cand = await this.prisma.candidatura.findUnique({
      where: { id: candidaturaId },
      select: {
        id: true,
        status: true,
        vaga_id: true,
        candidato_id: true,
        admissao: { select: { id: true } },
      },
    });
    if (!cand || cand.admissao || cand.status !== 'CONTRATADO') return false;
    await this.criarRegistroAdmissao(cand);
    return true;
  }

  /**
   * Backfill: cria admissões para candidaturas JÁ contratadas que ainda não têm
   * admissão (quem passou do R&S na Gupy e entrou na etapa de admissão).
   * `desdeDias` limita a contratações recentes para não arrastar admitidos
   * antigos; `limite` protege contra lotes gigantes. Idempotente.
   */
  async backfillContratados(
    opts: { desdeDias?: number; limite?: number } = {},
  ): Promise<{ candidatas: number; criadas: number }> {
    const limite = Math.min(Math.max(opts.limite ?? 200, 1), 500);
    const where: Prisma.CandidaturaWhereInput = {
      status: 'CONTRATADO',
      admissao: { is: null },
    };
    if (opts.desdeDias && opts.desdeDias > 0) {
      where.movido_em = {
        gte: new Date(Date.now() - opts.desdeDias * 86_400_000),
      };
    }
    const cands = await this.prisma.candidatura.findMany({
      where,
      select: { id: true, candidato_id: true, vaga_id: true },
      orderBy: { movido_em: 'desc' },
      take: limite,
    });

    let criadas = 0;
    for (const c of cands) {
      try {
        await this.criarRegistroAdmissao(c);
        criadas += 1;
      } catch (err) {
        this.logger.warn(
          `Backfill: falha ao criar admissão p/ candidatura ${c.id}: ${(err as Error).message}`,
        );
      }
    }
    this.logger.log(
      `Backfill de contratados: ${criadas}/${cands.length} admissão(ões) criada(s).`,
    );
    return { candidatas: cands.length, criadas };
  }

  /** Cria o registro de admissão (checklist + exame + evento inicial). */
  private async criarRegistroAdmissao(cand: {
    id: string;
    candidato_id: string;
    vaga_id: string;
  }): Promise<string> {
    const criada = await this.prisma.admissao.create({
      data: {
        candidatura_id: cand.id,
        candidato_id: cand.candidato_id,
        vaga_id: cand.vaga_id,
        status: StatusAdmissao.AGUARDANDO_ACEITE,
        documentos: {
          create: CHECKLIST_PADRAO.map(([tipo, obrigatorio]) => ({
            tipo,
            obrigatorio,
          })),
        },
        exame: { create: {} },
        eventos: {
          create: {
            para_status: StatusAdmissao.AGUARDANDO_ACEITE,
            observacao: 'Admissão iniciada a partir da contratação.',
          },
        },
      },
      select: { id: true },
    });
    return criada.id;
  }

  /**
   * Avança/transiciona a etapa. Permite ir para a próxima etapa, voltar uma,
   * ou CANCELAR (de qualquer etapa, exceto CONCLUIDA). Bloqueia ENVIO_ESOCIAL
   * enquanto docs obrigatórios não estiverem aprovados e ASO não for apto.
   */
  async transicionar(
    id: string,
    para: StatusAdmissao,
    opts: { observacao?: string; autorId?: string; autorNome?: string } = {},
  ) {
    const atual = await this.prisma.admissao.findUnique({
      where: { id },
      include: { documentos: true, exame: true },
    });
    if (!atual) throw new NotFoundException(`Admissão ${id} não existe.`);
    if (atual.status === para) {
      throw new BadRequestException(`Admissão já está em ${para}.`);
    }
    if (atual.status === StatusAdmissao.CONCLUIDA) {
      throw new ConflictException('Admissão concluída não pode mudar de etapa.');
    }

    if (para !== StatusAdmissao.CANCELADA) {
      const iAtual = ORDEM.indexOf(atual.status);
      const iAlvo = ORDEM.indexOf(para);
      if (iAlvo === -1) {
        throw new BadRequestException(`Etapa inválida: ${para}.`);
      }
      // Só permite avançar 1 etapa ou retroceder 1 (evita pular validações).
      if (Math.abs(iAlvo - iAtual) !== 1) {
        throw new BadRequestException(
          'Transição inválida: avance/retroceda uma etapa por vez.',
        );
      }
      // Gate de eSocial: docs obrigatórios aprovados + ASO apto.
      if (para === StatusAdmissao.ENVIO_ESOCIAL) {
        this.validarProntoParaESocial(atual.documentos, atual.exame);
      }
    }

    const dadosExtra: Prisma.AdmissaoUpdateInput = {};
    if (para === StatusAdmissao.PROPOSTA_ACEITA && !atual.data_aceite) {
      dadosExtra.data_aceite = new Date();
    }
    if (para === StatusAdmissao.CONCLUIDA) {
      dadosExtra.data_conclusao = new Date();
    }

    await this.prisma.admissao.update({
      where: { id },
      data: {
        status: para,
        ...dadosExtra,
        eventos: {
          create: {
            de_status: atual.status,
            para_status: para,
            observacao: opts.observacao,
            autor_id: opts.autorId,
            autor_nome: opts.autorNome,
          },
        },
      },
    });
    return this.obter(id);
  }

  async cancelar(id: string, motivo: string, autorNome?: string) {
    const a = await this.prisma.admissao.findUnique({
      where: { id },
      select: { status: true },
    });
    if (!a) throw new NotFoundException(`Admissão ${id} não existe.`);
    if (a.status === StatusAdmissao.CONCLUIDA) {
      throw new ConflictException('Admissão concluída não pode ser cancelada.');
    }
    await this.prisma.admissao.update({
      where: { id },
      data: {
        status: StatusAdmissao.CANCELADA,
        motivo_cancelamento: motivo,
        eventos: {
          create: {
            de_status: a.status,
            para_status: StatusAdmissao.CANCELADA,
            observacao: motivo,
            autor_nome: autorNome,
          },
        },
      },
    });
    return this.obter(id);
  }

  async atualizarDados(id: string, dados: Prisma.AdmissaoUpdateInput) {
    await this.garantirExiste(id);
    await this.prisma.admissao.update({ where: { id }, data: dados });
    return this.obter(id);
  }

  /** Avalia um documento do checklist (aprovar/recusar/marcar enviado). */
  async avaliarDocumento(
    admissaoId: string,
    documentoId: string,
    dados: {
      status: StatusDocumentoAdmissional;
      motivo_recusa?: string | null;
      arquivo_url?: string | null;
      nome_arquivo?: string | null;
      analisadoPor?: string;
    },
  ) {
    const doc = await this.prisma.documentoAdmissional.findFirst({
      where: { id: documentoId, admissao_id: admissaoId },
      select: { id: true },
    });
    if (!doc) {
      throw new NotFoundException('Documento não encontrado nesta admissão.');
    }
    const analisado =
      dados.status === StatusDocumentoAdmissional.APROVADO ||
      dados.status === StatusDocumentoAdmissional.REPROVADO;
    await this.prisma.documentoAdmissional.update({
      where: { id: documentoId },
      data: {
        status: dados.status,
        motivo_recusa:
          dados.status === StatusDocumentoAdmissional.REPROVADO
            ? (dados.motivo_recusa ?? null)
            : null,
        arquivo_url: dados.arquivo_url ?? undefined,
        nome_arquivo: dados.nome_arquivo ?? undefined,
        enviado_em:
          dados.status === StatusDocumentoAdmissional.ENVIADO
            ? new Date()
            : undefined,
        analisado_por: analisado ? (dados.analisadoPor ?? null) : null,
        analisado_em: analisado ? new Date() : null,
      },
    });
    return this.obter(admissaoId);
  }

  /**
   * Recebe o arquivo de um documento (upload), salva no storage e marca como
   * ENVIADO. Se for o RG, dispara o OCR por IA (que, ao concluir, aciona o
   * gatilho de criação de acesso). Reenviar o arquivo limpa o OCR anterior e
   * reprocessa.
   */
  async anexarArquivoDocumento(
    admissaoId: string,
    documentoId: string,
    arquivo: { buffer: Buffer; originalname?: string; mimetype?: string },
  ) {
    if (!arquivo?.buffer?.length) {
      throw new BadRequestException('Arquivo vazio.');
    }
    const mime = (arquivo.mimetype ?? '').toLowerCase().split(';')[0].trim();
    const ext = MIME_EXT[mime];
    if (!ext) {
      throw new BadRequestException(
        `Tipo de arquivo não suportado: "${mime}". Aceitos: JPG, PNG, WEBP, GIF, PDF.`,
      );
    }

    const doc = await this.prisma.documentoAdmissional.findFirst({
      where: { id: documentoId, admissao_id: admissaoId },
      select: { id: true, tipo: true },
    });
    if (!doc) {
      throw new NotFoundException('Documento não encontrado nesta admissão.');
    }

    const sha256 = createHash('sha256').update(arquivo.buffer).digest('hex');
    const key = this.storage.buildKey({
      kind: 'documento-admissional',
      sha256,
      extension: ext,
    });
    const put = await this.storage.putObject(key, {
      body: arquivo.buffer,
      contentType: mime,
      metadata: { admissaoId, documentoId, tipo: doc.tipo },
    });

    await this.prisma.documentoAdmissional.update({
      where: { id: documentoId },
      data: {
        arquivo_url: put.key,
        arquivo_sha256: put.sha256,
        nome_arquivo: arquivo.originalname ?? null,
        status: StatusDocumentoAdmissional.ENVIADO,
        enviado_em: new Date(),
        // Reenvio: invalida OCR/análise anteriores para reprocessar.
        dados_extraidos_json: Prisma.JsonNull,
        ocr_versao: null,
        ocr_processado_em: null,
        analisado_por: null,
        analisado_em: null,
      },
    });

    // RG → OCR por IA (que dispara o gatilho de acesso ao concluir).
    if (doc.tipo === TipoDocumentoAdmissional.RG) {
      const jobId = `rg-ocr-${documentoId}`;
      await this.filaRgOcr.remove(jobId).catch(() => undefined);
      await this.filaRgOcr.add(
        'rg-ocr',
        { admissaoId, documentoId },
        { jobId },
      );
    }

    return this.obter(admissaoId);
  }

  async atualizarExame(
    admissaoId: string,
    dados: {
      clinica?: string | null;
      agendado_para?: string | null;
      realizado_em?: string | null;
      resultado?: ResultadoExameAdmissional;
      restricoes?: string | null;
      aso_url?: string | null;
    },
  ) {
    await this.garantirExiste(admissaoId);
    await this.prisma.exameAdmissional.upsert({
      where: { admissao_id: admissaoId },
      create: {
        admissao_id: admissaoId,
        clinica: dados.clinica ?? null,
        agendado_para: dados.agendado_para ? new Date(dados.agendado_para) : null,
        realizado_em: dados.realizado_em ? new Date(dados.realizado_em) : null,
        resultado: dados.resultado ?? ResultadoExameAdmissional.PENDENTE,
        restricoes: dados.restricoes ?? null,
        aso_url: dados.aso_url ?? null,
      },
      update: {
        clinica: dados.clinica ?? undefined,
        agendado_para: dados.agendado_para
          ? new Date(dados.agendado_para)
          : undefined,
        realizado_em: dados.realizado_em
          ? new Date(dados.realizado_em)
          : undefined,
        resultado: dados.resultado ?? undefined,
        restricoes: dados.restricoes ?? undefined,
        aso_url: dados.aso_url ?? undefined,
      },
    });
    return this.obter(admissaoId);
  }

  // ------------------------------------------------------------------

  private validarProntoParaESocial(
    documentos: Array<{
      obrigatorio: boolean;
      status: StatusDocumentoAdmissional;
    }>,
    exame: { resultado: ResultadoExameAdmissional } | null,
  ): void {
    const pendentes = documentos.filter(
      (d) => d.obrigatorio && d.status !== StatusDocumentoAdmissional.APROVADO,
    );
    if (pendentes.length > 0) {
      throw new ConflictException(
        `Há ${pendentes.length} documento(s) obrigatório(s) ainda não aprovado(s).`,
      );
    }
    const aptos: ResultadoExameAdmissional[] = [
      ResultadoExameAdmissional.APTO,
      ResultadoExameAdmissional.APTO_COM_RESTRICOES,
    ];
    if (!exame || !aptos.includes(exame.resultado)) {
      throw new ConflictException(
        'Exame admissional (ASO) precisa estar APTO antes do envio ao eSocial.',
      );
    }
  }

  private async garantirExiste(id: string): Promise<void> {
    const a = await this.prisma.admissao.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!a) throw new NotFoundException(`Admissão ${id} não existe.`);
  }
}
