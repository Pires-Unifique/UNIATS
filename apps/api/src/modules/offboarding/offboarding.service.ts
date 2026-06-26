import { createHash, randomBytes } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  CategoriaItemEncerramento,
  FormaAssinatura,
  OrigemOffboarding,
  PapelAssinanteOffboarding,
  Prisma,
  StatusAssinatura,
  StatusItemEncerramento,
  StatusOffboarding,
  TipoRespostaItem,
} from '@uniats/db';
import type {
  AutoPrefillDTO,
  ConfirmarAutodesligamentoInputDTO,
  ConviteOffboardingDTO,
  CriarConviteInputDTO,
  CriarSolicitacaoOffboardingInputDTO,
  OffboardingSeniorSnapshot,
  SolicitacaoOffboardingDetalheDTO,
  SolicitacaoOffboardingListItemDTO,
  StatusConvite,
} from '@uniats/shared';

import { PrismaService } from '../../prisma/prisma.service.js';
import { StorageService } from '../storage/storage.service.js';
import {
  AutentiqueOffboardingProvider,
  SignatarioOffboardingInput,
} from './providers/autentique-offboarding.provider.js';
import { SeniorOffboardingProvider } from './providers/senior-offboarding.provider.js';
import { EncerramentoConectorService } from './services/encerramento-conector.service.js';

interface UsuarioCtx {
  id?: string | null;
  nome: string;
  email?: string | null;
}

/** Tipos aceitos no upload do documento ASSINADO (PDF ou scan). */
const MIME_EXT_ASSINADO: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/** Catálogo canônico das etapas de encerramento (semeadas em EM_ENCERRAMENTO). */
const ITENS_ENCERRAMENTO: Array<{
  chave: string;
  categoria: CategoriaItemEncerramento;
  titulo: string;
  tipo_resposta: TipoRespostaItem;
}> = [
  // Integrações (automáticas/simuladas)
  { chave: 'ACESSO_TI', categoria: 'INTEGRACAO', titulo: 'Remoção de acessos (TI)', tipo_resposta: 'AUTOMATICO' },
  { chave: 'BENEFICIOS', categoria: 'INTEGRACAO', titulo: 'Exclusão de benefícios', tipo_resposta: 'AUTOMATICO' },
  { chave: 'PONTO_FECHAMENTO', categoria: 'INTEGRACAO', titulo: 'Solicitar fechamento do ponto', tipo_resposta: 'AUTOMATICO' },
  // Checklist respondido pelo líder
  { chave: 'PONTO_VALIDADO', categoria: 'CHECKLIST', titulo: 'Ponto está validado?', tipo_resposta: 'BOOLEANO' },
  { chave: 'ADVERTENCIA', categoria: 'CHECKLIST', titulo: 'Possui advertência?', tipo_resposta: 'BOOLEANO' },
  { chave: 'REL_COMISSOES', categoria: 'CHECKLIST', titulo: 'Relatório de comissões', tipo_resposta: 'BOOLEANO' },
  { chave: 'REL_REEMBOLSO', categoria: 'CHECKLIST', titulo: 'Relatório de reembolso', tipo_resposta: 'BOOLEANO' },
  { chave: 'REL_VARIAVEIS', categoria: 'CHECKLIST', titulo: 'Relatório de variáveis', tipo_resposta: 'BOOLEANO' },
  { chave: 'REL_DESCONTOS', categoria: 'CHECKLIST', titulo: 'Relatório de descontos', tipo_resposta: 'BOOLEANO' },
  { chave: 'REL_PREMIOS', categoria: 'CHECKLIST', titulo: 'Relatório de prêmios', tipo_resposta: 'BOOLEANO' },
  { chave: 'ENVIAR_MERCADO', categoria: 'CHECKLIST', titulo: 'Se possui, enviar para Mercado', tipo_resposta: 'BOOLEANO' },
  { chave: 'PRESTACAO_CONTAS_FINANCEIRO', categoria: 'CHECKLIST', titulo: 'Prestação de contas ao financeiro', tipo_resposta: 'BOOLEANO' },
  { chave: 'ENVIAR_FINANCEIRO', categoria: 'CHECKLIST', titulo: 'Se possui, enviar para Financeiro', tipo_resposta: 'BOOLEANO' },
  { chave: 'DEVOLUCAO_UNIFORMES', categoria: 'CHECKLIST', titulo: 'Devolução de uniformes', tipo_resposta: 'BOOLEANO' },
  { chave: 'DEVOLUCAO_EQUIPAMENTOS', categoria: 'CHECKLIST', titulo: 'Devolução de equipamentos', tipo_resposta: 'BOOLEANO' },
  { chave: 'EMAIL_ENCAMINHADO', categoria: 'CHECKLIST', titulo: 'E-mail deve ser encaminhado?', tipo_resposta: 'BOOLEANO' },
];

/**
 * Orquestra o ciclo de vida da SOLICITAÇÃO de offboarding:
 *   RASCUNHO
 *     → (EMPREGADOR) AGUARDANDO_APROVACAO_GESTOR → AGUARDANDO_APROVACAO_DHO
 *     → (COLABORADOR ou aprovado) AGUARDANDO_ASSINATURAS → ASSINADO
 *     → EM_ENCERRAMENTO → CONCLUIDO ; RECUSADO/CANCELADO fora do fluxo feliz.
 *
 * Ao entrar em AGUARDANDO_ASSINATURAS busca o snapshot demissional no Senior,
 * gera o termo (Autentique + PDF/HTML no storage) e cria as assinaturas. Tudo
 * em MODO SIMULADO enquanto os conectores estão desabilitados.
 */
@Injectable()
export class OffboardingService {
  private readonly logger = new Logger(OffboardingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly senior: SeniorOffboardingProvider,
    private readonly autentique: AutentiqueOffboardingProvider,
    private readonly conector: EncerramentoConectorService,
    private readonly storage: StorageService,
  ) {}

  // ---------------- leitura ----------------

  async listar(filtro: {
    status?: StatusOffboarding;
    solicitanteId?: string;
  }): Promise<SolicitacaoOffboardingListItemDTO[]> {
    const lista = await this.prisma.solicitacaoOffboarding.findMany({
      where: {
        excluido_em: null,
        ...(filtro.status ? { status: filtro.status } : {}),
        ...(filtro.solicitanteId ? { solicitante_id: filtro.solicitanteId } : {}),
      },
      orderBy: { criado_em: 'desc' },
      take: 200,
    });
    return lista.map((s) => ({
      id: s.id,
      status: s.status,
      origem: s.origem,
      tipo_desligamento: s.tipo_desligamento,
      colaborador_nome: s.colaborador_nome,
      colaborador_matricula: s.colaborador_matricula,
      solicitante_nome: s.solicitante_nome,
      criado_em: s.criado_em.toISOString(),
      atualizado_em: s.atualizado_em.toISOString(),
    }));
  }

  async obter(id: string): Promise<SolicitacaoOffboardingDetalheDTO> {
    const s = await this.prisma.solicitacaoOffboarding.findUnique({
      where: { id },
      include: {
        assinaturas: { orderBy: { ordem: 'asc' } },
        itens_encerramento: { orderBy: { ordem: 'asc' } },
        eventos: { orderBy: { criado_em: 'asc' } },
      },
    });
    if (!s || s.excluido_em) {
      throw new NotFoundException(`Solicitação ${id} não encontrada.`);
    }
    return mapDetalhe(s);
  }

  /**
   * Contatos pessoais para PREFILL do formulário. Quando o Senior real está
   * ligado, vêm dele; senão (simulado), refletem o que já temos no espelho
   * (export do Senior/CSV) — NÃO inventamos. Sempre editável na UI ("verificar").
   */
  async obterContatos(matricula: string) {
    if (this.senior.habilitado()) {
      const r = await this.senior.obterContatosPessoais(matricula);
      return {
        email_pessoal: r.email_pessoal,
        whatsapp_pessoal: r.whatsapp_pessoal,
        simulado: r.simulado,
        fonte: 'senior' as const,
      };
    }
    const colab = await this.prisma.colaborador.findUnique({
      where: { matricula },
    });
    return {
      // O espelho guarda o e-mail do export; usamos como prefill (editável).
      email_pessoal: colab?.email ?? null,
      whatsapp_pessoal: null, // não há WhatsApp no export — virá do Senior
      simulado: true,
      fonte: 'espelho' as const,
    };
  }

  // ---------------- criação ----------------

  async criar(
    input: CriarSolicitacaoOffboardingInputDTO,
    usuario: UsuarioCtx,
  ): Promise<SolicitacaoOffboardingDetalheDTO> {
    if (!input.colaborador_matricula?.trim() || !input.colaborador_nome?.trim()) {
      throw new BadRequestException('Colaborador (matrícula e nome) é obrigatório.');
    }
    if (!input.motivo?.trim()) {
      throw new BadRequestException('Informe o motivo do desligamento.');
    }
    if (input.cumpre_aviso_previo && !input.aviso_previo_dias) {
      throw new BadRequestException(
        'Informe quantos dias de aviso prévio serão cumpridos.',
      );
    }

    // Enriquecemos a "situação atual" a partir do espelho de colaboradores.
    const colab = input.colaborador_id
      ? await this.prisma.colaborador.findUnique({
          where: { id: input.colaborador_id },
          include: { unidade: true, centro_custo: true },
        })
      : null;

    const criada = await this.prisma.solicitacaoOffboarding.create({
      data: {
        origem: input.origem as OrigemOffboarding,
        solicitante_id: usuario.id ?? null,
        solicitante_nome: usuario.nome,
        colaborador_id: input.colaborador_id ?? null,
        colaborador_matricula: input.colaborador_matricula.trim(),
        colaborador_nome: input.colaborador_nome.trim(),
        tipo_desligamento: input.tipo_desligamento,
        cumpre_aviso_previo: !!input.cumpre_aviso_previo,
        aviso_previo_dias: input.cumpre_aviso_previo
          ? (input.aviso_previo_dias ?? null)
          : null,
        motivo: input.motivo.trim(),
        email_pessoal: input.email_pessoal?.trim() || null,
        whatsapp_pessoal: input.whatsapp_pessoal?.trim() || null,
        forma_assinatura: input.forma_assinatura as FormaAssinatura,
        unidade_atual: colab?.unidade?.nome ?? null,
        centro_custo_atual: colab?.centro_custo?.nome ?? null,
        cargo_atual: colab?.cargo_atual ?? null,
        status: StatusOffboarding.RASCUNHO,
        eventos: {
          create: {
            para_status: StatusOffboarding.RASCUNHO,
            autor_id: usuario.id ?? null,
            autor_nome: usuario.nome,
            observacao: 'Solicitação de offboarding criada.',
          },
        },
      },
    });
    return this.obter(criada.id);
  }

  // ---------------- transições ----------------

  async submeter(id: string, usuario: UsuarioCtx) {
    const s = await this.carregar(id);
    if (s.status !== StatusOffboarding.RASCUNHO) {
      throw new ConflictException('Só é possível submeter uma solicitação em RASCUNHO.');
    }
    if (s.origem === OrigemOffboarding.EMPREGADOR) {
      // Empregador: passa pelas aprovações (gestor do CC + DHO).
      await this.transicionar(
        id,
        StatusOffboarding.AGUARDANDO_APROVACAO_GESTOR,
        usuario,
        'Enviada para aprovação do gestor do centro de custo.',
      );
    } else {
      // Próprio colaborador: vai direto à geração de documento/assinaturas.
      await this.gerarDocumentoEEnviar(id, usuario, s.status);
    }
    return this.obter(id);
  }

  /** Gestor do centro de custo aprova (origem EMPREGADOR). */
  async aprovarGestor(id: string, usuario: UsuarioCtx) {
    const s = await this.carregar(id);
    if (s.status !== StatusOffboarding.AGUARDANDO_APROVACAO_GESTOR) {
      throw new ConflictException(
        'Só é possível aprovar (gestor) uma solicitação aguardando aprovação do gestor.',
      );
    }
    await this.prisma.solicitacaoOffboarding.update({
      where: { id },
      data: {
        aprovado_gestor_por_id: usuario.id ?? null,
        aprovado_gestor_por_nome: usuario.nome,
        aprovado_gestor_em: new Date(),
      },
    });
    await this.transicionar(
      id,
      StatusOffboarding.AGUARDANDO_APROVACAO_DHO,
      usuario,
      'Aprovada pelo gestor do centro de custo. Enviada para aprovação do DHO.',
    );
    return this.obter(id);
  }

  /** DHO aprova: gera o documento e segue para assinaturas. */
  async aprovarDho(id: string, usuario: UsuarioCtx) {
    const s = await this.carregar(id);
    if (s.status !== StatusOffboarding.AGUARDANDO_APROVACAO_DHO) {
      throw new ConflictException(
        'Só é possível aprovar (DHO) uma solicitação aguardando aprovação do DHO.',
      );
    }
    await this.prisma.solicitacaoOffboarding.update({
      where: { id },
      data: {
        aprovado_dho_por_id: usuario.id ?? null,
        aprovado_dho_por_nome: usuario.nome,
        aprovado_dho_em: new Date(),
      },
    });
    await this.gerarDocumentoEEnviar(id, usuario, s.status);
    return this.obter(id);
  }

  async recusar(id: string, motivo: string, usuario: UsuarioCtx) {
    const s = await this.carregar(id);
    const recusavel: StatusOffboarding[] = [
      StatusOffboarding.AGUARDANDO_APROVACAO_GESTOR,
      StatusOffboarding.AGUARDANDO_APROVACAO_DHO,
    ];
    if (!recusavel.includes(s.status)) {
      throw new ConflictException(
        'Só é possível recusar uma solicitação aguardando aprovação (gestor ou DHO).',
      );
    }
    await this.prisma.solicitacaoOffboarding.update({
      where: { id },
      data: {
        motivo_recusa: motivo,
        recusado_por_nome: usuario.nome,
        recusado_em: new Date(),
      },
    });
    await this.transicionar(
      id,
      StatusOffboarding.RECUSADO,
      usuario,
      `Recusada: ${motivo}`,
    );
    return this.obter(id);
  }

  async cancelar(id: string, motivo: string, usuario: UsuarioCtx) {
    const s = await this.carregar(id);
    if (
      s.status === StatusOffboarding.CONCLUIDO ||
      s.status === StatusOffboarding.CANCELADO ||
      s.status === StatusOffboarding.RECUSADO
    ) {
      throw new ConflictException('Solicitação finalizada não pode ser cancelada.');
    }
    await this.transicionar(
      id,
      StatusOffboarding.CANCELADO,
      usuario,
      `Cancelada: ${motivo}`,
    );
    return this.obter(id);
  }

  // ---------------- documento + assinaturas ----------------

  /**
   * Busca o snapshot demissional no Senior, monta o termo, grava no storage,
   * envia ao Autentique e cria as assinaturas (colaborador + representante).
   * Compartilhado pelos dois caminhos (auto-solicitação e pós-aprovação DHO).
   */
  private async gerarDocumentoEEnviar(
    id: string,
    usuario: UsuarioCtx,
    deStatus: StatusOffboarding,
  ) {
    const s = await this.carregar(id);

    // 1) Snapshot demissional (Senior — simulado por ora). Contatos pessoais já
    //    informados na solicitação (prefill do espelho/Senior, editáveis) seguem
    //    para o snapshot — nada é fabricado. E-mail corporativo vem do espelho.
    const colabEspelho = await this.prisma.colaborador.findUnique({
      where: { matricula: s.colaborador_matricula },
      select: { email: true },
    });
    const dem = await this.senior.obterDadosDemissionais({
      matricula: s.colaborador_matricula,
      nome: s.colaborador_nome,
      unidade: s.unidade_atual,
      centro_custo: s.centro_custo_atual,
      cargo: s.cargo_atual,
      lider_nome: null,
      email_pessoal: s.email_pessoal,
      whatsapp_pessoal: s.whatsapp_pessoal,
      email_corporativo: colabEspelho?.email ?? null,
    });
    const snapshot = dem.snapshot;

    // 2) Termo (HTML) + storage.
    const conteudo = montarConteudoDocumento(s, snapshot);
    let storageKey: string | null = null;
    let documentoUrl: string | null = null;
    try {
      const buf = Buffer.from(conteudo, 'utf8');
      const sha256 = createHash('sha256').update(buf).digest('hex');
      storageKey = this.storage.buildKey({
        kind: 'offboarding-doc',
        sha256,
        extension: 'html',
      });
      await this.storage.putObject(storageKey, {
        body: buf,
        contentType: 'text/html; charset=utf-8',
        metadata: { solicitacao: id }, // sem PII no metadado (ver storage.types)
      });
      documentoUrl = `/api/offboarding/${id}/documento`;
    } catch (err) {
      // Storage indisponível não deve travar o fluxo de assinatura no skeleton.
      this.logger.error(
        `Falha ao gravar o termo no storage (solicitação ${id}): ${
          err instanceof Error ? err.message : err
        }`,
      );
      storageKey = null;
    }

    // 3) Autentique (simulado) + assinaturas.
    const signatarios = montarSignatarios(s, usuario);
    const envio = await this.autentique.enviarParaAssinatura({
      solicitacaoId: id,
      titulo: `Termo de desligamento — ${s.colaborador_nome}`,
      conteudo,
      signatarios,
    });

    const agora = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.assinaturaOffboarding.deleteMany({ where: { solicitacao_id: id } });
      for (let i = 0; i < signatarios.length; i++) {
        const sig = signatarios[i];
        const res = envio.signatarios.find((r) => r.papel === sig.papel);
        const ehRepresentante = sig.papel === PapelAssinanteOffboarding.REPRESENTANTE_EMPRESA;
        await tx.assinaturaOffboarding.create({
          data: {
            solicitacao_id: id,
            papel: sig.papel,
            nome: sig.nome,
            email: sig.email,
            ordem: i + 1,
            status: StatusAssinatura.ENVIADA,
            representante_origem: ehRepresentante
              ? s.forma_assinatura === FormaAssinatura.FISICA
                ? 'procurador'
                : 'dho'
              : null,
            autentique_signatario_id: res?.autentiqueSignatarioId ?? null,
            link_assinatura: res?.linkAssinatura ?? null,
          },
        });
      }
      await tx.solicitacaoOffboarding.update({
        where: { id },
        data: {
          status: StatusOffboarding.AGUARDANDO_ASSINATURAS,
          senior_snapshot: snapshot as unknown as Prisma.InputJsonValue,
          snapshot_capturado_em: agora,
          data_admissao: parseDate(snapshot.data_admissao),
          email_pessoal: s.email_pessoal ?? snapshot.email_pessoal ?? null,
          whatsapp_pessoal: s.whatsapp_pessoal ?? snapshot.whatsapp_pessoal ?? null,
          autentique_documento_id: envio.documentoId,
          documento_storage_key: storageKey,
          documento_url: documentoUrl,
          documento_gerado_em: agora,
          enviado_assinatura_em: agora,
        },
      });
      await tx.eventoOffboarding.create({
        data: {
          solicitacao_id: id,
          de_status: deStatus,
          para_status: StatusOffboarding.AGUARDANDO_ASSINATURAS,
          autor_id: usuario.id ?? null,
          autor_nome: usuario.nome,
          observacao: envio.simulado
            ? 'Snapshot do Senior capturado (SIMULADO). Termo gerado e enviado ao Autentique (SIMULADO).'
            : 'Snapshot do Senior capturado. Termo gerado e enviado ao Autentique.',
        },
      });
    });
    this.logger.log(
      `Solicitação ${id} → AGUARDANDO_ASSINATURAS${envio.simulado ? ' (simulado)' : ''}.`,
    );
  }

  /**
   * Registra a assinatura de um signatário (webhook do Autentique ou endpoint
   * manual no modo simulado). Quando TODOS assinam, vira ASSINADO.
   */
  async registrarAssinatura(
    solicitacaoId: string,
    papel: PapelAssinanteOffboarding,
    dados: {
      assinado?: boolean;
      recusado?: boolean;
      motivo?: string;
      procuradorId?: string;
    } = { assinado: true },
  ) {
    const s = await this.carregar(solicitacaoId);
    if (s.status !== StatusOffboarding.AGUARDANDO_ASSINATURAS) {
      throw new ConflictException(
        'Só é possível registrar assinatura enquanto aguarda assinaturas.',
      );
    }
    const assinatura = s.assinaturas.find((a) => a.papel === papel);
    if (!assinatura) {
      throw new NotFoundException(
        `Assinatura ${papel} não encontrada na solicitação ${solicitacaoId}.`,
      );
    }

    if (dados.recusado) {
      await this.prisma.assinaturaOffboarding.update({
        where: { id: assinatura.id },
        data: {
          status: StatusAssinatura.RECUSADA,
          recusado_em: new Date(),
          motivo_recusa: dados.motivo ?? null,
        },
      });
      await this.cancelar(
        solicitacaoId,
        `Assinatura recusada por ${papel}${dados.motivo ? `: ${dados.motivo}` : ''}`,
        { nome: `Autentique (${papel})` },
      );
      return this.obter(solicitacaoId);
    }

    // Via física: o REPRESENTANTE_EMPRESA é um procurador da lista do DHO.
    let nome = assinatura.nome;
    let email = assinatura.email;
    let procuradorId: string | null = assinatura.procurador_id;
    if (
      papel === PapelAssinanteOffboarding.REPRESENTANTE_EMPRESA &&
      s.forma_assinatura === FormaAssinatura.FISICA
    ) {
      if (!dados.procuradorId) {
        throw new BadRequestException(
          'Via física: informe o procurador que assina como representante da empresa.',
        );
      }
      const proc = await this.prisma.procurador.findUnique({
        where: { id: dados.procuradorId },
      });
      if (!proc || proc.excluido_em || !proc.ativo) {
        throw new BadRequestException('Procurador inválido ou inativo.');
      }
      nome = proc.nome;
      email = proc.email ?? email;
      procuradorId = proc.id;
    }

    await this.prisma.assinaturaOffboarding.update({
      where: { id: assinatura.id },
      data: {
        status: StatusAssinatura.ASSINADA,
        assinado_em: new Date(),
        nome,
        email,
        procurador_id: procuradorId,
      },
    });

    const restantes = await this.prisma.assinaturaOffboarding.count({
      where: {
        solicitacao_id: solicitacaoId,
        status: { not: StatusAssinatura.ASSINADA },
      },
    });
    if (restantes === 0) {
      await this.transicionar(
        solicitacaoId,
        StatusOffboarding.ASSINADO,
        { nome: 'Sistema' },
        'Todas as assinaturas concluídas. Documento armazenado.',
        { assinado_em: new Date() },
      );
    }
    return this.obter(solicitacaoId);
  }

  // ---------------- encerramento ----------------

  /** Ativa as etapas de encerramento: semeia os itens e roda as integrações. */
  async iniciarEncerramento(id: string, usuario: UsuarioCtx) {
    const s = await this.carregar(id);
    if (s.status !== StatusOffboarding.ASSINADO) {
      throw new ConflictException(
        'Só é possível iniciar o encerramento de uma solicitação ASSINADA.',
      );
    }

    await this.prisma.$transaction(async (tx) => {
      for (let i = 0; i < ITENS_ENCERRAMENTO.length; i++) {
        const item = ITENS_ENCERRAMENTO[i];
        await tx.itemEncerramentoOffboarding.upsert({
          where: {
            solicitacao_id_chave: { solicitacao_id: id, chave: item.chave },
          },
          create: {
            solicitacao_id: id,
            chave: item.chave,
            categoria: item.categoria,
            titulo: item.titulo,
            tipo_resposta: item.tipo_resposta,
            ordem: i,
          },
          update: {},
        });
      }
      await tx.solicitacaoOffboarding.update({
        where: { id },
        data: { status: StatusOffboarding.EM_ENCERRAMENTO },
      });
      await tx.eventoOffboarding.create({
        data: {
          solicitacao_id: id,
          de_status: StatusOffboarding.ASSINADO,
          para_status: StatusOffboarding.EM_ENCERRAMENTO,
          autor_id: usuario.id ?? null,
          autor_nome: usuario.nome,
          observacao: 'Encerramento iniciado — etapas de TI/benefícios/ponto e checklist criadas.',
        },
      });
    });

    // Integrações automáticas (simuladas).
    for (const item of ITENS_ENCERRAMENTO.filter((i) => i.categoria === 'INTEGRACAO')) {
      await this.executarIntegracao(id, item.chave, usuario);
    }
    return this.obter(id);
  }

  /** Roda uma integração (chave INTEGRACAO) e grava o resultado no item. */
  async executarIntegracao(id: string, chave: string, usuario: UsuarioCtx) {
    const s = await this.carregar(id);
    const item = s.itens_encerramento.find((i) => i.chave === chave);
    if (!item) throw new NotFoundException(`Item ${chave} não encontrado.`);
    if (item.categoria !== CategoriaItemEncerramento.INTEGRACAO) {
      throw new BadRequestException(`Item ${chave} não é uma integração.`);
    }
    try {
      const res = await this.conector.executar(chave, {
        solicitacaoId: id,
        matricula: s.colaborador_matricula,
        colaboradorNome: s.colaborador_nome,
      });
      await this.prisma.itemEncerramentoOffboarding.update({
        where: { id: item.id },
        data: {
          status: StatusItemEncerramento.CONCLUIDO,
          payload: res.payload as Prisma.InputJsonValue,
          respondido_por_nome: 'Sistema',
          respondido_em: new Date(),
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await this.prisma.itemEncerramentoOffboarding.update({
        where: { id: item.id },
        data: {
          status: StatusItemEncerramento.FALHA,
          payload: { erro: msg } as Prisma.InputJsonValue,
        },
      });
      this.logger.error(`Integração ${chave} falhou (solicitação ${id}): ${msg}`);
    }
    return this.obter(id);
  }

  /** Líder responde um item do checklist (booleano/texto) ou marca N/A. */
  async responderItem(
    id: string,
    chave: string,
    dados: { resposta_bool?: boolean; resposta_texto?: string; nao_aplicavel?: boolean },
    usuario: UsuarioCtx,
  ) {
    const s = await this.carregar(id);
    if (s.status !== StatusOffboarding.EM_ENCERRAMENTO) {
      throw new ConflictException('A solicitação não está em encerramento.');
    }
    const item = s.itens_encerramento.find((i) => i.chave === chave);
    if (!item) throw new NotFoundException(`Item ${chave} não encontrado.`);
    if (item.categoria === CategoriaItemEncerramento.INTEGRACAO) {
      throw new BadRequestException(
        `Item ${chave} é uma integração — use a execução da integração.`,
      );
    }
    await this.prisma.itemEncerramentoOffboarding.update({
      where: { id: item.id },
      data: {
        status: dados.nao_aplicavel
          ? StatusItemEncerramento.NAO_APLICAVEL
          : StatusItemEncerramento.CONCLUIDO,
        resposta_bool: dados.resposta_bool ?? null,
        resposta_texto: dados.resposta_texto?.trim() || null,
        respondido_por_id: usuario.id ?? null,
        respondido_por_nome: usuario.nome,
        respondido_em: new Date(),
      },
    });
    return this.obter(id);
  }

  /** Conclui o offboarding (exige todos os itens resolvidos). */
  async concluir(id: string, usuario: UsuarioCtx) {
    const s = await this.carregar(id);
    if (s.status !== StatusOffboarding.EM_ENCERRAMENTO) {
      throw new ConflictException('Só é possível concluir uma solicitação em encerramento.');
    }
    const pendentes = s.itens_encerramento.filter(
      (i) =>
        i.status !== StatusItemEncerramento.CONCLUIDO &&
        i.status !== StatusItemEncerramento.NAO_APLICAVEL,
    );
    if (pendentes.length > 0) {
      throw new ConflictException(
        `Ainda há ${pendentes.length} item(ns) de encerramento pendente(s).`,
      );
    }
    await this.transicionar(
      id,
      StatusOffboarding.CONCLUIDO,
      usuario,
      'Processo de offboarding concluído pelo líder/DHO.',
    );
    return this.obter(id);
  }

  // ---------------- documento (download) ----------------

  async obterDocumento(
    id: string,
  ): Promise<{ body: Buffer; contentType: string; filename: string }> {
    const s = await this.carregar(id);
    if (!s.documento_storage_key) {
      throw new NotFoundException('Documento ainda não gerado para esta solicitação.');
    }
    const obj = await this.storage.getObject(s.documento_storage_key);
    return {
      body: obj.body,
      contentType: obj.contentType || 'text/html; charset=utf-8',
      filename: `termo-desligamento-${s.colaborador_matricula}.html`,
    };
  }

  // ---------------- documento assinado (upload manual) + validação ----------------

  /** DHO sobe o termo assinado fisicamente (PDF/imagem) no storage. */
  async anexarDocumentoAssinado(
    id: string,
    arquivo: { buffer: Buffer; originalname?: string; mimetype?: string },
    usuario: UsuarioCtx,
  ) {
    const s = await this.carregar(id);
    if (s.status !== StatusOffboarding.AGUARDANDO_ASSINATURAS) {
      throw new ConflictException(
        'Só é possível anexar o documento assinado enquanto aguarda assinaturas.',
      );
    }
    if (!arquivo?.buffer?.length) {
      throw new BadRequestException('Arquivo vazio.');
    }
    const mime = (arquivo.mimetype ?? '').toLowerCase().split(';')[0].trim();
    const ext = MIME_EXT_ASSINADO[mime];
    if (!ext) {
      throw new BadRequestException(
        `Tipo de arquivo não suportado: "${mime}". Aceitos: PDF, JPG, PNG, WEBP.`,
      );
    }
    const sha256 = createHash('sha256').update(arquivo.buffer).digest('hex');
    const key = this.storage.buildKey({
      kind: 'offboarding-assinado',
      sha256,
      extension: ext,
    });
    await this.storage.putObject(key, {
      body: arquivo.buffer,
      contentType: mime,
      metadata: { solicitacao: id },
    });
    await this.prisma.$transaction([
      this.prisma.solicitacaoOffboarding.update({
        where: { id },
        data: {
          documento_assinado_storage_key: key,
          documento_assinado_url: `/api/offboarding/${id}/documento-assinado`,
          documento_assinado_nome: arquivo.originalname ?? `termo-assinado.${ext}`,
          documento_assinado_em: new Date(),
        },
      }),
      this.prisma.eventoOffboarding.create({
        data: {
          solicitacao_id: id,
          de_status: s.status,
          para_status: s.status,
          autor_id: usuario.id ?? null,
          autor_nome: usuario.nome,
          observacao: `Documento assinado anexado (${arquivo.originalname ?? 'arquivo'}).`,
        },
      }),
    ]);
    return this.obter(id);
  }

  async obterDocumentoAssinado(
    id: string,
  ): Promise<{ body: Buffer; contentType: string; filename: string }> {
    const s = await this.carregar(id);
    if (!s.documento_assinado_storage_key) {
      throw new NotFoundException('Nenhum documento assinado anexado.');
    }
    const obj = await this.storage.getObject(s.documento_assinado_storage_key);
    const nome = s.documento_assinado_nome ?? `termo-assinado-${s.colaborador_matricula}`;
    return { body: obj.body, contentType: obj.contentType, filename: nome };
  }

  /**
   * DHO VALIDA as assinaturas e libera o encerramento (→ ASSINADO). Na via física
   * exige o documento assinado anexado + o procurador que assinou como
   * representante. É a porta antes dos desligamentos de fato.
   */
  async validarAssinaturas(
    id: string,
    usuario: UsuarioCtx,
    opts: { procuradorId?: string } = {},
  ) {
    const s = await this.carregar(id);
    if (s.status !== StatusOffboarding.AGUARDANDO_ASSINATURAS) {
      throw new ConflictException('A solicitação não está aguardando assinaturas.');
    }

    const fisica = s.forma_assinatura === FormaAssinatura.FISICA;
    if (fisica && !s.documento_assinado_storage_key) {
      throw new BadRequestException(
        'Anexe o documento assinado antes de validar as assinaturas.',
      );
    }

    // Resolve o procurador (representante) na via física.
    let procurador: { id: string; nome: string; email: string | null } | null = null;
    if (fisica) {
      const rep = s.assinaturas.find(
        (a) => a.papel === PapelAssinanteOffboarding.REPRESENTANTE_EMPRESA,
      );
      const procuradorId = opts.procuradorId ?? rep?.procurador_id ?? undefined;
      if (!procuradorId) {
        throw new BadRequestException(
          'Informe o procurador que assinou como representante da empresa.',
        );
      }
      const p = await this.prisma.procurador.findUnique({ where: { id: procuradorId } });
      if (!p || p.excluido_em || !p.ativo) {
        throw new BadRequestException('Procurador inválido ou inativo.');
      }
      procurador = { id: p.id, nome: p.nome, email: p.email };
    }

    const agora = new Date();
    await this.prisma.$transaction(async (tx) => {
      for (const a of s.assinaturas) {
        const ehRep = a.papel === PapelAssinanteOffboarding.REPRESENTANTE_EMPRESA;
        await tx.assinaturaOffboarding.update({
          where: { id: a.id },
          data: {
            status: StatusAssinatura.ASSINADA,
            assinado_em: a.assinado_em ?? agora,
            ...(ehRep && procurador
              ? {
                  nome: procurador.nome,
                  email: procurador.email ?? a.email,
                  procurador_id: procurador.id,
                }
              : {}),
          },
        });
      }
      await tx.solicitacaoOffboarding.update({
        where: { id },
        data: {
          status: StatusOffboarding.ASSINADO,
          assinado_em: agora,
          assinaturas_validadas_por_id: usuario.id ?? null,
          assinaturas_validadas_por_nome: usuario.nome,
          assinaturas_validadas_em: agora,
        },
      });
      await tx.eventoOffboarding.create({
        data: {
          solicitacao_id: id,
          de_status: StatusOffboarding.AGUARDANDO_ASSINATURAS,
          para_status: StatusOffboarding.ASSINADO,
          autor_id: usuario.id ?? null,
          autor_nome: usuario.nome,
          observacao: fisica
            ? 'Assinaturas validadas pelo DHO (via física) — documento assinado conferido.'
            : 'Assinaturas validadas pelo DHO.',
        },
      });
    });
    return this.obter(id);
  }

  // ---------------- webhook ----------------

  async processarWebhookAutentique(payload: {
    documentoId?: string;
    signatarioId?: string;
    evento?: string;
  }) {
    if (!payload.documentoId) {
      throw new BadRequestException('Webhook sem documentoId.');
    }
    const s = await this.prisma.solicitacaoOffboarding.findFirst({
      where: { autentique_documento_id: payload.documentoId },
      include: { assinaturas: true },
    });
    if (!s) {
      this.logger.warn(
        `Webhook Autentique (offboarding) para documento desconhecido: ${payload.documentoId}.`,
      );
      return { ok: false };
    }
    const assinatura = payload.signatarioId
      ? s.assinaturas.find((a) => a.autentique_signatario_id === payload.signatarioId)
      : undefined;
    if (!assinatura) {
      this.logger.warn(`Webhook Autentique (offboarding) sem signatário casável (doc ${s.id}).`);
      return { ok: false };
    }
    const recusado = payload.evento === 'signature.rejected';
    await this.registrarAssinatura(s.id, assinatura.papel, {
      assinado: !recusado,
      recusado,
    });
    return { ok: true };
  }

  // ---------------- convites de autodesligamento (link com token) ----------------

  /** DHO gera um link de autodesligamento para um colaborador. */
  async gerarConvite(
    input: CriarConviteInputDTO,
    usuario: UsuarioCtx,
  ): Promise<ConviteOffboardingDTO> {
    if (!input.colaborador_matricula?.trim() || !input.colaborador_nome?.trim()) {
      throw new BadRequestException('Colaborador (matrícula e nome) é obrigatório.');
    }
    const dias = input.expira_em_dias && input.expira_em_dias > 0 ? input.expira_em_dias : 14;
    const expira = new Date();
    expira.setUTCDate(expira.getUTCDate() + dias);

    const convite = await this.prisma.conviteOffboarding.create({
      data: {
        token: randomBytes(24).toString('hex'),
        colaborador_id: input.colaborador_id ?? null,
        colaborador_matricula: input.colaborador_matricula.trim(),
        colaborador_nome: input.colaborador_nome.trim(),
        criado_por_id: usuario.id ?? null,
        criado_por_nome: usuario.nome,
        expira_em: expira,
      },
    });
    return conviteToDTO(convite);
  }

  async listarConvites(): Promise<ConviteOffboardingDTO[]> {
    const convites = await this.prisma.conviteOffboarding.findMany({
      orderBy: { criado_em: 'desc' },
      take: 200,
    });
    return convites.map(conviteToDTO);
  }

  async cancelarConvite(id: string): Promise<ConviteOffboardingDTO> {
    const convite = await this.prisma.conviteOffboarding.findUnique({ where: { id } });
    if (!convite) throw new NotFoundException(`Convite ${id} não encontrado.`);
    if (convite.usado_em) {
      throw new ConflictException('Convite já utilizado não pode ser cancelado.');
    }
    const atualizado = await this.prisma.conviteOffboarding.update({
      where: { id },
      data: { cancelado_em: new Date() },
    });
    return conviteToDTO(atualizado);
  }

  /** Dados que o colaborador vê ao abrir o link público (sem login). */
  async obterPrefillPorToken(token: string): Promise<AutoPrefillDTO> {
    const convite = await this.prisma.conviteOffboarding.findUnique({ where: { token } });
    if (!convite) {
      throw new NotFoundException('Link inválido.');
    }
    const status = statusConvite(convite);
    const colab = await this.prisma.colaborador.findUnique({
      where: { matricula: convite.colaborador_matricula },
      include: { unidade: { select: { nome: true } }, centro_custo: { select: { nome: true } } },
    });
    const contatos = await this.obterContatos(convite.colaborador_matricula);
    return {
      valido: status === 'PENDENTE',
      status,
      colaborador_nome: convite.colaborador_nome,
      colaborador_matricula: convite.colaborador_matricula,
      cargo: colab?.cargo_atual ?? null,
      unidade: colab?.unidade?.nome ?? null,
      centro_custo: colab?.centro_custo?.nome ?? null,
      email_pessoal: contatos.email_pessoal,
      whatsapp_pessoal: contatos.whatsapp_pessoal,
      expira_em: convite.expira_em.toISOString(),
    };
  }

  /** Colaborador confirma o próprio desligamento pelo link (sem login). */
  async confirmarAutodesligamento(
    token: string,
    body: ConfirmarAutodesligamentoInputDTO,
  ): Promise<{ ok: true; solicitacao_id: string; status: string }> {
    const convite = await this.prisma.conviteOffboarding.findUnique({ where: { token } });
    if (!convite) throw new NotFoundException('Link inválido.');
    const status = statusConvite(convite);
    if (status !== 'PENDENTE') {
      throw new ConflictException(`Este link está ${ROTULO_CONVITE[status]}.`);
    }

    const ctx: UsuarioCtx = { id: null, nome: convite.colaborador_nome };
    const sol = await this.criar(
      {
        origem: 'COLABORADOR',
        colaborador_id: convite.colaborador_id,
        colaborador_matricula: convite.colaborador_matricula,
        colaborador_nome: convite.colaborador_nome,
        tipo_desligamento: 'PEDIDO_COLABORADOR',
        cumpre_aviso_previo: !!body.cumpre_aviso_previo,
        aviso_previo_dias: body.aviso_previo_dias ?? null,
        motivo: body.motivo,
        email_pessoal: body.email_pessoal ?? null,
        whatsapp_pessoal: body.whatsapp_pessoal ?? null,
        forma_assinatura: 'DIGITAL',
      },
      ctx,
    );
    // Auto-solicitação vai direto à geração de documento/assinaturas.
    await this.submeter(sol.id, ctx);
    await this.prisma.conviteOffboarding.update({
      where: { id: convite.id },
      data: { usado_em: new Date(), solicitacao_id: sol.id },
    });
    return { ok: true, solicitacao_id: sol.id, status: 'AGUARDANDO_ASSINATURAS' };
  }

  // ---------------- helpers ----------------

  private async transicionar(
    id: string,
    para: StatusOffboarding,
    usuario: UsuarioCtx,
    observacao: string,
    extra?: Prisma.SolicitacaoOffboardingUpdateInput,
  ) {
    const s = await this.carregar(id);
    await this.prisma.$transaction([
      this.prisma.solicitacaoOffboarding.update({
        where: { id },
        data: { status: para, ...(extra ?? {}) },
      }),
      this.prisma.eventoOffboarding.create({
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

  private async carregar(id: string) {
    const s = await this.prisma.solicitacaoOffboarding.findUnique({
      where: { id },
      include: { assinaturas: true, itens_encerramento: true },
    });
    if (!s || s.excluido_em) {
      throw new NotFoundException(`Solicitação ${id} não encontrada.`);
    }
    return s;
  }
}

// ---------------- funções puras ----------------

function parseDate(s?: string | null): Date | null {
  if (!s || !/^\d{4}-\d{2}-\d{2}/.test(s)) return null;
  const d = new Date(`${s.slice(0, 10)}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

const ROTULO_CONVITE: Record<StatusConvite, string> = {
  PENDENTE: 'pendente',
  USADO: 'já utilizado',
  EXPIRADO: 'expirado',
  CANCELADO: 'cancelado',
};

/** Status derivado do convite (sem coluna — calculado a partir das datas). */
function statusConvite(c: {
  usado_em: Date | null;
  cancelado_em: Date | null;
  expira_em: Date;
}): StatusConvite {
  if (c.cancelado_em) return 'CANCELADO';
  if (c.usado_em) return 'USADO';
  if (c.expira_em.getTime() < Date.now()) return 'EXPIRADO';
  return 'PENDENTE';
}

function conviteToDTO(c: {
  id: string;
  token: string;
  colaborador_matricula: string;
  colaborador_nome: string;
  criado_por_nome: string | null;
  expira_em: Date;
  usado_em: Date | null;
  cancelado_em: Date | null;
  solicitacao_id: string | null;
  criado_em: Date;
}): ConviteOffboardingDTO {
  return {
    id: c.id,
    token: c.token,
    url: `/offboarding/auto/${c.token}`, // o web prepende a origin ao copiar
    colaborador_matricula: c.colaborador_matricula,
    colaborador_nome: c.colaborador_nome,
    criado_por_nome: c.criado_por_nome,
    status: statusConvite(c),
    expira_em: c.expira_em.toISOString(),
    usado_em: c.usado_em?.toISOString() ?? null,
    cancelado_em: c.cancelado_em?.toISOString() ?? null,
    solicitacao_id: c.solicitacao_id,
    criado_em: c.criado_em.toISOString(),
  };
}

function escaparHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Signatários do termo: colaborador + representante da empresa.
 * O REPRESENTANTE_EMPRESA nunca é o colaborador. Na via física é um procurador
 * (definido na assinatura). Na via digital é o DHO: quando o desligamento veio
 * do EMPREGADOR, é o DHO que aprovou (o `usuario`); quando veio do COLABORADOR
 * (sem aprovação prévia), fica um marcador que o DHO completa ao assinar.
 */
function montarSignatarios(
  s: {
    colaborador_nome: string;
    email_pessoal: string | null;
    forma_assinatura: FormaAssinatura;
    origem: OrigemOffboarding;
  },
  usuario: UsuarioCtx,
): SignatarioOffboardingInput[] {
  let representante: SignatarioOffboardingInput;
  if (s.forma_assinatura === FormaAssinatura.FISICA) {
    representante = {
      papel: 'REPRESENTANTE_EMPRESA',
      nome: 'A definir (procurador)',
      email: '',
    };
  } else if (s.origem === OrigemOffboarding.EMPREGADOR) {
    representante = {
      papel: 'REPRESENTANTE_EMPRESA',
      nome: usuario.nome,
      email: usuario.email ?? '',
    };
  } else {
    representante = {
      papel: 'REPRESENTANTE_EMPRESA',
      nome: 'Representante da empresa (DHO)',
      email: '',
    };
  }
  return [
    {
      papel: 'COLABORADOR',
      nome: s.colaborador_nome,
      email: s.email_pessoal ?? '',
    },
    representante,
  ];
}

/** Monta o termo (HTML) com os dados preenchidos — template de teste. */
function montarConteudoDocumento(
  s: {
    colaborador_nome: string;
    colaborador_matricula: string;
    motivo: string;
    tipo_desligamento: string;
    cumpre_aviso_previo: boolean;
    aviso_previo_dias: number | null;
    forma_assinatura: string;
  },
  snap: OffboardingSeniorSnapshot,
): string {
  const linha = (rotulo: string, valor?: string | null) =>
    `<p><b>${escaparHtml(rotulo)}:</b> ${valor ? escaparHtml(String(valor)) : '—'}</p>`;
  return [
    '<h1>Termo de Desligamento</h1>',
    linha('Colaborador', s.colaborador_nome),
    linha('Matrícula', s.colaborador_matricula),
    linha('Cargo', snap.cargo),
    linha('Filial/Unidade', snap.filial),
    linha('Centro de custo', snap.centro_custo),
    linha('Data de admissão', snap.data_admissao),
    linha('Tipo de desligamento', s.tipo_desligamento),
    linha(
      'Aviso prévio',
      s.cumpre_aviso_previo ? `Sim — ${s.aviso_previo_dias ?? '—'} dia(s)` : 'Não',
    ),
    linha('Data de término de cumprimento', snap.data_termino_cumprimento),
    linha('Prazo para homologação', snap.prazo_homologacao),
    linha('Forma de assinatura', s.forma_assinatura),
    `<p><b>Motivo:</b> ${escaparHtml(s.motivo) || '—'}</p>`,
    '<hr/>',
    '<p><i>Documento gerado automaticamente (template de teste) — pendente de assinatura.</i></p>',
    '<br/><br/>',
    '<p>__________________________________<br/>Colaborador</p>',
    '<br/>',
    '<p>__________________________________<br/>Representante da empresa</p>',
  ].join('\n');
}

function mapDetalhe(
  s: Prisma.SolicitacaoOffboardingGetPayload<{
    include: {
      assinaturas: true;
      itens_encerramento: true;
      eventos: true;
    };
  }>,
): SolicitacaoOffboardingDetalheDTO {
  return {
    id: s.id,
    status: s.status,
    origem: s.origem,
    solicitante_id: s.solicitante_id,
    solicitante_nome: s.solicitante_nome,
    colaborador_id: s.colaborador_id,
    colaborador_matricula: s.colaborador_matricula,
    colaborador_nome: s.colaborador_nome,
    tipo_desligamento: s.tipo_desligamento,
    cumpre_aviso_previo: s.cumpre_aviso_previo,
    aviso_previo_dias: s.aviso_previo_dias,
    motivo: s.motivo,
    email_pessoal: s.email_pessoal,
    whatsapp_pessoal: s.whatsapp_pessoal,
    contatos_verificados: s.contatos_verificados,
    forma_assinatura: s.forma_assinatura,
    unidade_atual: s.unidade_atual,
    centro_custo_atual: s.centro_custo_atual,
    cargo_atual: s.cargo_atual,
    data_admissao: s.data_admissao ? s.data_admissao.toISOString().slice(0, 10) : null,
    senior_snapshot: (s.senior_snapshot as OffboardingSeniorSnapshot | null) ?? null,
    snapshot_capturado_em: s.snapshot_capturado_em?.toISOString() ?? null,
    aprovado_gestor_por_nome: s.aprovado_gestor_por_nome,
    aprovado_gestor_em: s.aprovado_gestor_em?.toISOString() ?? null,
    aprovado_dho_por_nome: s.aprovado_dho_por_nome,
    aprovado_dho_em: s.aprovado_dho_em?.toISOString() ?? null,
    recusado_por_nome: s.recusado_por_nome,
    recusado_em: s.recusado_em?.toISOString() ?? null,
    motivo_recusa: s.motivo_recusa,
    autentique_documento_id: s.autentique_documento_id,
    documento_url: s.documento_url,
    documento_gerado_em: s.documento_gerado_em?.toISOString() ?? null,
    enviado_assinatura_em: s.enviado_assinatura_em?.toISOString() ?? null,
    assinado_em: s.assinado_em?.toISOString() ?? null,
    documento_assinado_url: s.documento_assinado_url,
    documento_assinado_nome: s.documento_assinado_nome,
    documento_assinado_em: s.documento_assinado_em?.toISOString() ?? null,
    assinaturas_validadas_por_nome: s.assinaturas_validadas_por_nome,
    assinaturas_validadas_em: s.assinaturas_validadas_em?.toISOString() ?? null,
    observacoes: s.observacoes,
    criado_em: s.criado_em.toISOString(),
    atualizado_em: s.atualizado_em.toISOString(),
    assinaturas: s.assinaturas.map((a) => ({
      id: a.id,
      papel: a.papel,
      nome: a.nome,
      email: a.email,
      ordem: a.ordem,
      status: a.status,
      representante_origem: a.representante_origem,
      procurador_id: a.procurador_id,
      link_assinatura: a.link_assinatura,
      assinado_em: a.assinado_em?.toISOString() ?? null,
      recusado_em: a.recusado_em?.toISOString() ?? null,
      motivo_recusa: a.motivo_recusa,
    })),
    itens_encerramento: s.itens_encerramento.map((i) => ({
      id: i.id,
      chave: i.chave,
      categoria: i.categoria,
      titulo: i.titulo,
      tipo_resposta: i.tipo_resposta,
      ordem: i.ordem,
      status: i.status,
      resposta_bool: i.resposta_bool,
      resposta_texto: i.resposta_texto,
      respondido_por_nome: i.respondido_por_nome,
      respondido_em: i.respondido_em?.toISOString() ?? null,
    })),
    eventos: s.eventos.map((e) => ({
      id: e.id,
      de_status: e.de_status,
      para_status: e.para_status,
      autor_nome: e.autor_nome,
      observacao: e.observacao,
      criado_em: e.criado_em.toISOString(),
    })),
  };
}
