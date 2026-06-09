import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  StatusAdmissao,
  StatusDocumentoAdmissional,
  ResultadoExameAdmissional,
  TipoDocumentoAdmissional,
} from '@uniats/db';

import { PrismaService } from '../../prisma/prisma.service.js';

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
  constructor(private readonly prisma: PrismaService) {}

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
    return this.obter(criada.id);
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
