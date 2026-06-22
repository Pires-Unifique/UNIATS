import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, StatusSolicitacaoAcesso, TipoDocumentoAdmissional } from '@uniats/db';

import { PrismaService } from '../../prisma/prisma.service.js';
import { RgExtraidoSchema } from '../claude/rg.schema.js';
import { AceleratoProvider } from './acelerato.provider.js';
import { AbrirSolicitacaoInput } from './acesso-provider.interface.js';

/**
 * Orquestra o gatilho de criação de acesso (usuário de AD) a partir de uma
 * admissão. Disparado automaticamente após o OCR do RG. Idempotente por
 * admissão (1:1 em SolicitacaoAcesso) — não duplica chamado.
 *
 * O alvo é plugável via ACESSO_PROVIDER:
 *  - "acelerato"    → abre chamado no Acelerato (AceleratoProvider)
 *  - "desabilitado" → registra a intenção (PENDENTE) e não dispara nada
 *                     (gating para testes, no espírito do AUTH_ENABLED).
 */
@Injectable()
export class ProvisaoAcessoService {
  private readonly logger = new Logger(ProvisaoAcessoService.name);
  private readonly provider: string;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly acelerato: AceleratoProvider,
  ) {
    this.provider = this.config.get<string>('ACESSO_PROVIDER') ?? 'desabilitado';
  }

  async processar(admissaoId: string) {
    const existente = await this.prisma.solicitacaoAcesso.findUnique({
      where: { admissao_id: admissaoId },
      select: { id: true, status: true },
    });
    if (existente?.status === StatusSolicitacaoAcesso.ENVIADA) {
      this.logger.debug(
        `Solicitação de acesso já enviada para admissão ${admissaoId} — ignorando.`,
      );
      return existente;
    }

    const admissao = await this.prisma.admissao.findUnique({
      where: { id: admissaoId },
      select: {
        id: true,
        cargo: true,
        candidato: { select: { nome_completo: true } },
        vaga: { select: { titulo: true } },
        documentos: {
          where: { tipo: TipoDocumentoAdmissional.RG },
          select: { id: true, dados_extraidos_json: true },
          take: 1,
        },
      },
    });
    if (!admissao) {
      throw new NotFoundException(`Admissão ${admissaoId} não existe.`);
    }

    const docRg = admissao.documentos[0];
    const rg = docRg?.dados_extraidos_json
      ? RgExtraidoSchema.safeParse(docRg.dados_extraidos_json)
      : null;
    const rgDados = rg?.success ? rg.data : undefined;

    const nomeCompleto = rgDados?.nome_completo ?? admissao.candidato.nome_completo;
    const fonteNome: AbrirSolicitacaoInput['fonteNome'] = rgDados?.nome_completo
      ? 'rg-ocr'
      : 'cadastro';

    if (!nomeCompleto?.trim()) {
      // Sem nome em lugar nenhum — registra falha (não re-tenta indefinidamente).
      await this.upsert(admissaoId, docRg?.id, StatusSolicitacaoAcesso.FALHADA, {
        erro: 'Sem nome completo (nem OCR do RG nem cadastro) para solicitar acesso.',
      });
      this.logger.error(
        `Admissão ${admissaoId} sem nome para provisão de acesso.`,
      );
      return;
    }

    // Provider desabilitado: registra a intenção e para por aqui.
    if (this.provider === 'desabilitado') {
      const rec = await this.upsert(
        admissaoId,
        docRg?.id,
        StatusSolicitacaoAcesso.PENDENTE,
        { provider: 'desabilitado', nome_enviado: nomeCompleto },
      );
      this.logger.warn(
        `ACESSO_PROVIDER=desabilitado — solicitação de acesso registrada (PENDENTE) ` +
          `para admissão ${admissaoId}, sem disparo externo.`,
      );
      return rec;
    }

    const frontend = this.config.get<string>('FRONTEND_ORIGIN');
    const linkPainel = frontend ? `${frontend}/admissao/${admissaoId}` : null;

    const input: AbrirSolicitacaoInput = {
      admissaoId,
      nomeCompleto,
      fonteNome,
      cpf: rgDados?.cpf,
      vagaTitulo: admissao.vaga?.titulo ?? null,
      cargo: admissao.cargo,
      rgNumero: rgDados?.rg_numero,
      orgaoEmissor: rgDados?.orgao_emissor,
      confiancaOcr: rgDados?.confianca,
      linkPainel,
    };

    try {
      const res = await this.acelerato.abrirSolicitacao(input);
      const rec = await this.upsert(
        admissaoId,
        docRg?.id,
        StatusSolicitacaoAcesso.ENVIADA,
        {
          provider: this.acelerato.nome,
          nome_enviado: nomeCompleto,
          ref_externa: res.refExterna || null,
          url_externa: res.url,
          payload_enviado: res.payloadEnviado as Prisma.InputJsonValue,
          resposta: (res.resposta ?? Prisma.JsonNull) as Prisma.InputJsonValue,
          erro: null,
        },
      );
      this.logger.log(
        `Chamado de acesso aberto (admissão ${admissaoId}, ref=${res.refExterna}).`,
      );
      return rec;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await this.upsert(admissaoId, docRg?.id, StatusSolicitacaoAcesso.FALHADA, {
        provider: this.acelerato.nome,
        nome_enviado: nomeCompleto,
        erro: msg,
      });
      // Re-lança para o BullMQ re-tentar com backoff.
      throw err;
    }
  }

  private async upsert(
    admissaoId: string,
    documentoId: string | undefined,
    status: StatusSolicitacaoAcesso,
    extra: Partial<{
      provider: string;
      nome_enviado: string | null;
      ref_externa: string | null;
      url_externa: string | null;
      payload_enviado: Prisma.InputJsonValue;
      resposta: Prisma.InputJsonValue;
      erro: string | null;
    }> = {},
  ) {
    const provider = extra.provider ?? this.provider;
    return this.prisma.solicitacaoAcesso.upsert({
      where: { admissao_id: admissaoId },
      create: {
        admissao_id: admissaoId,
        documento_id: documentoId ?? null,
        provider,
        status,
        nome_enviado: extra.nome_enviado ?? null,
        ref_externa: extra.ref_externa ?? null,
        url_externa: extra.url_externa ?? null,
        payload_enviado: extra.payload_enviado,
        resposta: extra.resposta,
        erro: extra.erro ?? null,
      },
      update: {
        documento_id: documentoId ?? undefined,
        provider,
        status,
        nome_enviado: extra.nome_enviado ?? undefined,
        ref_externa: extra.ref_externa ?? undefined,
        url_externa: extra.url_externa ?? undefined,
        payload_enviado: extra.payload_enviado,
        resposta: extra.resposta,
        erro: extra.erro ?? undefined,
      },
    });
  }
}
