import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  PapelAssinante,
  Prisma,
  StatusAlteracaoContratual,
  StatusAssinatura,
  TipoAlteracaoContratual,
} from '@uniats/db';
import type {
  CriarSolicitacaoAlteracaoInputDTO,
  SolicitacaoAlteracaoDetalheDTO,
  SolicitacaoAlteracaoListItemDTO,
} from '@uniats/shared';

import { PrismaService } from '../../prisma/prisma.service.js';
import {
  AutentiqueProvider,
  SignatarioInput,
} from './providers/autentique.provider.js';
import { SeniorProvider } from './providers/senior.provider.js';

interface UsuarioCtx {
  id?: string | null;
  nome: string;
  email?: string | null;
}

/**
 * Orquestra o ciclo de vida da SOLICITAÇÃO de alteração contratual:
 *   RASCUNHO → AGUARDANDO_APROVACAO_DHO → AGUARDANDO_ASSINATURAS → ASSINADO
 *            → AGENDADA → EXECUTADA (ou FALHA_EXECUCAO) ; CANCELADA a qualquer momento.
 *
 * Toda transição grava um EventoAlteracaoContratual (log). A execução no Senior
 * acontece na `data_aplicacao` exata (ver ExecucaoSchedulerService + processor).
 */
@Injectable()
export class AlteracaoContratualService {
  private readonly logger = new Logger(AlteracaoContratualService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly autentique: AutentiqueProvider,
    private readonly senior: SeniorProvider,
  ) {}

  // ---------------- leitura ----------------

  async listar(filtro: {
    status?: StatusAlteracaoContratual;
    solicitanteId?: string;
  }): Promise<SolicitacaoAlteracaoListItemDTO[]> {
    const solicitacoes = await this.prisma.solicitacaoAlteracaoContratual.findMany({
      where: {
        excluido_em: null,
        ...(filtro.status ? { status: filtro.status } : {}),
        ...(filtro.solicitanteId ? { solicitante_id: filtro.solicitanteId } : {}),
      },
      include: { itens: { select: { tipo: true } } },
      orderBy: { criado_em: 'desc' },
      take: 200,
    });
    return solicitacoes.map((s) => ({
      id: s.id,
      status: s.status,
      colaborador_nome: s.colaborador_nome,
      colaborador_matricula: s.colaborador_matricula,
      solicitante_nome: s.solicitante_nome,
      tipos: s.itens.map((i) => i.tipo),
      data_aplicacao: toDateStr(s.data_aplicacao),
      criado_em: s.criado_em.toISOString(),
      atualizado_em: s.atualizado_em.toISOString(),
    }));
  }

  async obter(id: string): Promise<SolicitacaoAlteracaoDetalheDTO> {
    const s = await this.prisma.solicitacaoAlteracaoContratual.findUnique({
      where: { id },
      include: {
        itens: true,
        assinaturas: { orderBy: { ordem: 'asc' } },
        eventos: { orderBy: { criado_em: 'asc' } },
        execucao: true,
      },
    });
    if (!s || s.excluido_em) {
      throw new NotFoundException(`Solicitação ${id} não encontrada.`);
    }
    return mapDetalhe(s);
  }

  // ---------------- criação ----------------

  async criar(
    input: CriarSolicitacaoAlteracaoInputDTO,
    usuario: UsuarioCtx,
  ): Promise<SolicitacaoAlteracaoDetalheDTO> {
    if (!input.itens?.length) {
      throw new BadRequestException('Informe ao menos uma alteração.');
    }
    if (!input.colaborador_matricula?.trim() || !input.colaborador_nome?.trim()) {
      throw new BadRequestException('Colaborador (matrícula e nome) é obrigatório.');
    }
    const dataAplicacao = parseDate(input.data_aplicacao);
    if (!dataAplicacao) {
      throw new BadRequestException('data_aplicacao inválida (use YYYY-MM-DD).');
    }

    const itensData = await Promise.all(
      input.itens.map((item) => this.resolverItem(item, input)),
    );

    const criada = await this.prisma.solicitacaoAlteracaoContratual.create({
      data: {
        solicitante_id: usuario.id ?? null,
        solicitante_nome: usuario.nome,
        colaborador_id: input.colaborador_id ?? null,
        colaborador_matricula: input.colaborador_matricula.trim(),
        colaborador_nome: input.colaborador_nome.trim(),
        unidade_atual: input.unidade_atual ?? null,
        centro_custo_atual: input.centro_custo_atual ?? null,
        cargo_atual: input.cargo_atual ?? null,
        lider_atual: input.lider_atual ?? null,
        razoes: input.razoes?.trim() ?? '',
        data_aplicacao: dataAplicacao,
        status: StatusAlteracaoContratual.RASCUNHO,
        itens: { create: itensData },
        eventos: {
          create: {
            para_status: StatusAlteracaoContratual.RASCUNHO,
            autor_id: usuario.id ?? null,
            autor_nome: usuario.nome,
            observacao: 'Solicitação criada.',
          },
        },
      },
    });
    return this.obter(criada.id);
  }

  /** Resolve um item de entrada em dados do Prisma, derivando os rótulos "de → para". */
  private async resolverItem(
    item: CriarSolicitacaoAlteracaoInputDTO['itens'][number],
    input: CriarSolicitacaoAlteracaoInputDTO,
  ): Promise<Prisma.ItemAlteracaoContratualCreateWithoutSolicitacaoInput> {
    const tipo = item.tipo as TipoAlteracaoContratual;
    const base: Prisma.ItemAlteracaoContratualCreateWithoutSolicitacaoInput = {
      tipo,
      valor_novo: (item.valor_novo ?? '').trim(),
      valor_anterior: item.valor_anterior ?? null,
    };

    switch (tipo) {
      case TipoAlteracaoContratual.CARGO: {
        if (!item.cargo_novo_id) {
          throw new BadRequestException('Alteração de cargo exige cargo_novo_id.');
        }
        const cargo = await this.prisma.cargo.findUnique({
          where: { id: item.cargo_novo_id },
        });
        if (!cargo) throw new BadRequestException('Cargo novo inexistente.');
        base.cargo_novo = { connect: { id: cargo.id } };
        base.valor_anterior = input.cargo_atual ?? null;
        base.valor_novo = cargo.titulo;
        break;
      }
      case TipoAlteracaoContratual.UNIDADE: {
        if (!item.unidade_nova_id) {
          throw new BadRequestException('Alteração de unidade exige unidade_nova_id.');
        }
        const unidade = await this.prisma.unidade.findUnique({
          where: { id: item.unidade_nova_id },
        });
        if (!unidade) throw new BadRequestException('Unidade nova inexistente.');
        base.unidade_nova_id = unidade.id;
        base.valor_anterior = input.unidade_atual ?? null;
        base.valor_novo = unidade.nome;
        break;
      }
      case TipoAlteracaoContratual.CENTRO_CUSTO: {
        if (!item.centro_custo_novo_id) {
          throw new BadRequestException(
            'Alteração de centro de custo exige centro_custo_novo_id.',
          );
        }
        const centro = await this.prisma.centroCusto.findUnique({
          where: { id: item.centro_custo_novo_id },
        });
        if (!centro) throw new BadRequestException('Centro de custo novo inexistente.');
        base.centro_custo_novo_id = centro.id;
        base.valor_anterior = input.centro_custo_atual ?? null;
        base.valor_novo = centro.nome;
        break;
      }
      case TipoAlteracaoContratual.SALARIO: {
        // Regra: NÃO consultamos o salário atual no Senior — ambos são informados.
        if (item.salario_anterior == null || item.salario_novo == null) {
          throw new BadRequestException(
            'Alteração salarial exige salario_anterior e salario_novo (informados pelo solicitante).',
          );
        }
        const antigo = new Prisma.Decimal(item.salario_anterior);
        const novo = new Prisma.Decimal(item.salario_novo);
        base.salario_anterior = antigo;
        base.salario_novo = novo;
        base.valor_anterior = formatBRL(antigo);
        base.valor_novo = formatBRL(novo);
        break;
      }
      case TipoAlteracaoContratual.LIDER: {
        if (!item.novo_lider_nome?.trim()) {
          throw new BadRequestException('Alteração de líder exige novo_lider_nome.');
        }
        base.novo_lider_matricula = item.novo_lider_matricula ?? null;
        base.novo_lider_nome = item.novo_lider_nome.trim();
        base.valor_anterior = input.lider_atual ?? null;
        base.valor_novo = item.novo_lider_nome.trim();
        break;
      }
      default:
        throw new BadRequestException(`Tipo de alteração inválido: ${tipo}.`);
    }
    return base;
  }

  // ---------------- transições ----------------

  async submeter(id: string, usuario: UsuarioCtx) {
    const s = await this.carregar(id);
    if (s.status !== StatusAlteracaoContratual.RASCUNHO) {
      throw new ConflictException('Só é possível submeter uma solicitação em RASCUNHO.');
    }
    await this.transicionar(
      id,
      StatusAlteracaoContratual.AGUARDANDO_APROVACAO_DHO,
      usuario,
      'Enviada para aprovação do DHO.',
    );
    return this.obter(id);
  }

  /** DHO aprova: cria assinaturas (gestor + DHO) e envia ao Autentique. */
  async aprovar(
    id: string,
    usuario: UsuarioCtx,
    opts: { gestorNome?: string; gestorEmail?: string } = {},
  ) {
    const s = await this.carregar(id);
    if (s.status !== StatusAlteracaoContratual.AGUARDANDO_APROVACAO_DHO) {
      throw new ConflictException(
        'Só é possível aprovar uma solicitação aguardando aprovação do DHO.',
      );
    }

    // Quem assina como GESTOR: o NOVO líder (se houver troca de liderança) ou o
    // gestor atual do colaborador. Email pode vir do controller (override) ou
    // ser resolvido depois (MS/Senior) — em skeleton aceitamos vazio.
    const itemLider = s.itens.find(
      (i) => i.tipo === TipoAlteracaoContratual.LIDER,
    );
    const gestorNome =
      opts.gestorNome?.trim() ||
      itemLider?.novo_lider_nome ||
      s.lider_atual ||
      'Gestor do colaborador';
    const gestorEmail = opts.gestorEmail?.trim() || '';

    const signatarios: SignatarioInput[] = [
      { papel: PapelAssinante.GESTOR, nome: gestorNome, email: gestorEmail },
      {
        papel: PapelAssinante.DHO,
        nome: usuario.nome,
        email: usuario.email ?? '',
      },
    ];

    const envio = await this.autentique.enviarParaAssinatura({
      solicitacaoId: id,
      titulo: `Alteração contratual — ${s.colaborador_nome}`,
      conteudo: this.montarConteudoDocumento(s),
      signatarios,
    });

    const agora = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.assinaturaAlteracaoContratual.deleteMany({
        where: { solicitacao_id: id },
      });
      for (let i = 0; i < signatarios.length; i++) {
        const sig = signatarios[i];
        const res = envio.signatarios.find((r) => r.papel === sig.papel);
        await tx.assinaturaAlteracaoContratual.create({
          data: {
            solicitacao_id: id,
            papel: sig.papel,
            nome: sig.nome,
            email: sig.email,
            ordem: i + 1,
            status: StatusAssinatura.ENVIADA,
            autentique_signatario_id: res?.autentiqueSignatarioId ?? null,
            link_assinatura: res?.linkAssinatura ?? null,
          },
        });
      }
      await tx.solicitacaoAlteracaoContratual.update({
        where: { id },
        data: {
          status: StatusAlteracaoContratual.AGUARDANDO_ASSINATURAS,
          autentique_documento_id: envio.documentoId,
          enviado_assinatura_em: agora,
          aprovado_por_id: usuario.id ?? null,
          aprovado_por_nome: usuario.nome,
          aprovado_em: agora,
        },
      });
      await tx.eventoAlteracaoContratual.create({
        data: {
          solicitacao_id: id,
          de_status: StatusAlteracaoContratual.AGUARDANDO_APROVACAO_DHO,
          para_status: StatusAlteracaoContratual.AGUARDANDO_ASSINATURAS,
          autor_id: usuario.id ?? null,
          autor_nome: usuario.nome,
          observacao: envio.simulado
            ? 'Aprovada pelo DHO. Documento enviado ao Autentique (SIMULADO).'
            : 'Aprovada pelo DHO. Documento enviado ao Autentique.',
        },
      });
    });
    return this.obter(id);
  }

  async recusar(id: string, motivo: string, usuario: UsuarioCtx) {
    const s = await this.carregar(id);
    if (s.status === StatusAlteracaoContratual.EXECUTADA) {
      throw new ConflictException('Solicitação já executada não pode ser recusada.');
    }
    await this.prisma.solicitacaoAlteracaoContratual.update({
      where: { id },
      data: { motivo_recusa: motivo },
    });
    await this.transicionar(
      id,
      StatusAlteracaoContratual.CANCELADA,
      usuario,
      `Recusada pelo DHO: ${motivo}`,
    );
    return this.obter(id);
  }

  async cancelar(id: string, motivo: string, usuario: UsuarioCtx) {
    const s = await this.carregar(id);
    if (s.status === StatusAlteracaoContratual.EXECUTADA) {
      throw new ConflictException('Solicitação já executada não pode ser cancelada.');
    }
    await this.transicionar(
      id,
      StatusAlteracaoContratual.CANCELADA,
      usuario,
      `Cancelada: ${motivo}`,
    );
    return this.obter(id);
  }

  // ---------------- assinatura (webhook Autentique) ----------------

  /**
   * Registra a assinatura de um signatário (chamado pelo webhook do Autentique
   * ou por endpoint manual no modo simulado). Quando TODOS assinam, a solicitação
   * vira ASSINADO e é agendada a execução na `data_aplicacao`.
   */
  async registrarAssinatura(
    solicitacaoId: string,
    papel: PapelAssinante,
    dados: { assinado?: boolean; recusado?: boolean; motivo?: string } = {
      assinado: true,
    },
  ) {
    const s = await this.carregar(solicitacaoId);
    const assinatura = s.assinaturas.find((a) => a.papel === papel);
    if (!assinatura) {
      throw new NotFoundException(
        `Assinatura ${papel} não encontrada na solicitação ${solicitacaoId}.`,
      );
    }

    if (dados.recusado) {
      await this.prisma.assinaturaAlteracaoContratual.update({
        where: { id: assinatura.id },
        data: {
          status: StatusAssinatura.RECUSADA,
          recusado_em: new Date(),
          motivo_recusa: dados.motivo ?? null,
        },
      });
      await this.recusar(
        solicitacaoId,
        `Assinatura recusada por ${papel}${dados.motivo ? `: ${dados.motivo}` : ''}`,
        { nome: `Autentique (${papel})` },
      );
      return this.obter(solicitacaoId);
    }

    await this.prisma.assinaturaAlteracaoContratual.update({
      where: { id: assinatura.id },
      data: { status: StatusAssinatura.ASSINADA, assinado_em: new Date() },
    });

    const restantes = await this.prisma.assinaturaAlteracaoContratual.count({
      where: { solicitacao_id: solicitacaoId, status: { not: StatusAssinatura.ASSINADA } },
    });
    if (restantes === 0) {
      await this.marcarAssinadoEAgendar(solicitacaoId);
    }
    return this.obter(solicitacaoId);
  }

  private async marcarAssinadoEAgendar(id: string) {
    const s = await this.carregar(id);
    const agora = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.solicitacaoAlteracaoContratual.update({
        where: { id },
        data: { status: StatusAlteracaoContratual.AGENDADA, assinado_em: agora },
      });
      await tx.execucaoAlteracaoContratual.upsert({
        where: { solicitacao_id: id },
        create: { solicitacao_id: id, agendada_para: s.data_aplicacao },
        update: { agendada_para: s.data_aplicacao },
      });
      await tx.eventoAlteracaoContratual.create({
        data: {
          solicitacao_id: id,
          de_status: StatusAlteracaoContratual.AGUARDANDO_ASSINATURAS,
          para_status: StatusAlteracaoContratual.AGENDADA,
          autor_nome: 'Sistema',
          observacao: `Documento assinado. Execução agendada para ${toDateStr(s.data_aplicacao)}.`,
        },
      });
    });
    this.logger.log(
      `Solicitação ${id} assinada — execução agendada para ${toDateStr(s.data_aplicacao)}.`,
    );
  }

  // ---------------- webhook ----------------

  async processarWebhookAutentique(payload: {
    documentoId?: string;
    signatarioId?: string;
    signatarioEmail?: string;
    evento?: string;
  }) {
    if (!payload.documentoId) {
      throw new BadRequestException('Webhook sem documentoId.');
    }
    const s = await this.prisma.solicitacaoAlteracaoContratual.findFirst({
      where: { autentique_documento_id: payload.documentoId },
      include: { assinaturas: true },
    });
    if (!s) {
      this.logger.warn(
        `Webhook Autentique para documento desconhecido: ${payload.documentoId}.`,
      );
      return { ok: false };
    }
    // Casa o signatário pelo public_id do Autentique OU pelo e-mail.
    const email = payload.signatarioEmail?.toLowerCase();
    const assinatura = s.assinaturas.find(
      (a) =>
        (!!payload.signatarioId &&
          a.autentique_signatario_id === payload.signatarioId) ||
        (!!email && a.email.toLowerCase() === email),
    );
    if (!assinatura) {
      this.logger.warn(`Webhook Autentique sem signatário casável (doc ${s.id}).`);
      return { ok: false };
    }
    // Tipos do Autentique: "signature.accepted" / "signature.rejected".
    const recusado = /reject|refus|recus/.test((payload.evento ?? '').toLowerCase());
    await this.registrarAssinatura(s.id, assinatura.papel, {
      assinado: !recusado,
      recusado,
    });
    return { ok: true };
  }

  // ---------------- execução (no dia exato) ----------------

  /** Solicitações AGENDADA cuja data de aplicação já chegou e ainda não executaram. */
  async devidasParaExecucao(hoje = new Date()): Promise<string[]> {
    const limite = endOfDay(hoje);
    const devidas = await this.prisma.solicitacaoAlteracaoContratual.findMany({
      where: {
        status: StatusAlteracaoContratual.AGENDADA,
        data_aplicacao: { lte: limite },
        excluido_em: null,
      },
      select: { id: true },
    });
    return devidas.map((d) => d.id);
  }

  /** Aplica a alteração no Senior e registra o log completo da execução. */
  async executar(id: string) {
    const s = await this.carregar(id);
    if (s.status !== StatusAlteracaoContratual.AGENDADA) {
      this.logger.warn(`Execução ignorada: solicitação ${id} não está AGENDADA.`);
      return;
    }

    const alteracoes = s.itens.map((i) => ({
      tipo: i.tipo as 'CARGO' | 'SALARIO' | 'CENTRO_CUSTO' | 'UNIDADE' | 'LIDER',
      de: i.valor_anterior,
      para: i.valor_novo,
    }));

    try {
      const res = await this.senior.aplicarAlteracao({
        solicitacaoId: id,
        matricula: s.colaborador_matricula,
        dataAplicacao: toDateStr(s.data_aplicacao),
        alteracoes,
      });
      await this.prisma.$transaction(async (tx) => {
        await tx.execucaoAlteracaoContratual.update({
          where: { solicitacao_id: id },
          data: {
            executada_em: new Date(),
            sucesso: true,
            tentativas: { increment: 1 },
            payload_enviado: res.payloadEnviado as Prisma.InputJsonValue,
            resposta: (res.resposta ?? Prisma.JsonNull) as Prisma.InputJsonValue,
            erro: null,
          },
        });
        await tx.solicitacaoAlteracaoContratual.update({
          where: { id },
          data: { status: StatusAlteracaoContratual.EXECUTADA },
        });
        await tx.eventoAlteracaoContratual.create({
          data: {
            solicitacao_id: id,
            de_status: StatusAlteracaoContratual.AGENDADA,
            para_status: StatusAlteracaoContratual.EXECUTADA,
            autor_nome: 'Sistema',
            observacao: res.simulado
              ? 'Alteração aplicada no Senior (SIMULADO — provider desabilitado).'
              : 'Alteração aplicada no Senior.',
          },
        });
      });
      this.logger.log(`Solicitação ${id} executada${res.simulado ? ' (simulado)' : ''}.`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await this.prisma.$transaction(async (tx) => {
        await tx.execucaoAlteracaoContratual.update({
          where: { solicitacao_id: id },
          data: {
            sucesso: false,
            tentativas: { increment: 1 },
            erro: msg,
          },
        });
        await tx.solicitacaoAlteracaoContratual.update({
          where: { id },
          data: { status: StatusAlteracaoContratual.FALHA_EXECUCAO },
        });
        await tx.eventoAlteracaoContratual.create({
          data: {
            solicitacao_id: id,
            de_status: StatusAlteracaoContratual.AGENDADA,
            para_status: StatusAlteracaoContratual.FALHA_EXECUCAO,
            autor_nome: 'Sistema',
            observacao: `Falha ao aplicar no Senior: ${msg}`,
          },
        });
      });
      this.logger.error(`Falha ao executar solicitação ${id}: ${msg}`);
      throw err;
    }
  }

  // ---------------- helpers ----------------

  private async transicionar(
    id: string,
    para: StatusAlteracaoContratual,
    usuario: UsuarioCtx,
    observacao: string,
  ) {
    const s = await this.carregar(id);
    await this.prisma.$transaction([
      this.prisma.solicitacaoAlteracaoContratual.update({
        where: { id },
        data: { status: para },
      }),
      this.prisma.eventoAlteracaoContratual.create({
        data: {
          solicitacao_id: id,
          de_status: s.status,
          para_status: para,
          autor_id: usuario.id ?? null,
          autor_nome: usuario.nome,
          observacao,
        },
      }),
    ]);
  }

  /** Carrega a solicitação com itens + assinaturas (ou lança 404). */
  private async carregar(id: string) {
    const s = await this.prisma.solicitacaoAlteracaoContratual.findUnique({
      where: { id },
      include: { itens: true, assinaturas: true },
    });
    if (!s || s.excluido_em) {
      throw new NotFoundException(`Solicitação ${id} não encontrada.`);
    }
    return s;
  }

  // Texto do documento (uma linha por \n) — o provider o transforma em PDF.
  private montarConteudoDocumento(s: {
    colaborador_nome: string;
    colaborador_matricula: string;
    razoes: string;
    data_aplicacao: Date;
    itens: Array<{ tipo: string; valor_anterior: string | null; valor_novo: string }>;
  }): string {
    return [
      'DOCUMENTO DE ALTERAÇÃO CONTRATUAL',
      '',
      `Colaborador: ${s.colaborador_nome} (matrícula ${s.colaborador_matricula})`,
      `Data de aplicação: ${toDateStr(s.data_aplicacao)}`,
      '',
      `Razões: ${s.razoes || '-'}`,
      '',
      'Alterações:',
      ...s.itens.map((i) => `- ${i.tipo}: ${i.valor_anterior ?? '-'} -> ${i.valor_novo}`),
    ].join('\n');
  }
}

// ---------------- funções puras ----------------

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function parseDate(s: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}/.test(s)) return null;
  const d = new Date(`${s.slice(0, 10)}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function endOfDay(d: Date): Date {
  const e = new Date(d);
  e.setUTCHours(23, 59, 59, 999);
  return e;
}

function formatBRL(v: Prisma.Decimal): string {
  return `R$ ${v.toFixed(2).replace('.', ',')}`;
}

function mapDetalhe(
  s: Prisma.SolicitacaoAlteracaoContratualGetPayload<{
    include: {
      itens: true;
      assinaturas: true;
      eventos: true;
      execucao: true;
    };
  }>,
): SolicitacaoAlteracaoDetalheDTO {
  return {
    id: s.id,
    status: s.status,
    solicitante_id: s.solicitante_id,
    solicitante_nome: s.solicitante_nome,
    colaborador_id: s.colaborador_id,
    colaborador_matricula: s.colaborador_matricula,
    colaborador_nome: s.colaborador_nome,
    unidade_atual: s.unidade_atual,
    centro_custo_atual: s.centro_custo_atual,
    cargo_atual: s.cargo_atual,
    lider_atual: s.lider_atual,
    razoes: s.razoes,
    data_aplicacao: toDateStr(s.data_aplicacao),
    autentique_documento_id: s.autentique_documento_id,
    documento_url: s.documento_url,
    enviado_assinatura_em: s.enviado_assinatura_em?.toISOString() ?? null,
    assinado_em: s.assinado_em?.toISOString() ?? null,
    aprovado_por_nome: s.aprovado_por_nome,
    aprovado_em: s.aprovado_em?.toISOString() ?? null,
    motivo_recusa: s.motivo_recusa,
    observacoes: s.observacoes,
    criado_em: s.criado_em.toISOString(),
    atualizado_em: s.atualizado_em.toISOString(),
    itens: s.itens.map((i) => ({
      id: i.id,
      tipo: i.tipo,
      valor_anterior: i.valor_anterior,
      valor_novo: i.valor_novo,
      cargo_novo_id: i.cargo_novo_id,
      unidade_nova_id: i.unidade_nova_id,
      centro_custo_novo_id: i.centro_custo_novo_id,
      salario_anterior: i.salario_anterior?.toString() ?? null,
      salario_novo: i.salario_novo?.toString() ?? null,
      novo_lider_matricula: i.novo_lider_matricula,
      novo_lider_nome: i.novo_lider_nome,
    })),
    assinaturas: s.assinaturas.map((a) => ({
      id: a.id,
      papel: a.papel,
      nome: a.nome,
      email: a.email,
      ordem: a.ordem,
      status: a.status,
      link_assinatura: a.link_assinatura,
      assinado_em: a.assinado_em?.toISOString() ?? null,
      recusado_em: a.recusado_em?.toISOString() ?? null,
      motivo_recusa: a.motivo_recusa,
    })),
    eventos: s.eventos.map((e) => ({
      id: e.id,
      de_status: e.de_status,
      para_status: e.para_status,
      autor_nome: e.autor_nome,
      observacao: e.observacao,
      criado_em: e.criado_em.toISOString(),
    })),
    execucao: s.execucao
      ? {
          id: s.execucao.id,
          agendada_para: s.execucao.agendada_para.toISOString(),
          executada_em: s.execucao.executada_em?.toISOString() ?? null,
          sucesso: s.execucao.sucesso,
          tentativas: s.execucao.tentativas,
          erro: s.execucao.erro,
        }
      : null,
  };
}
