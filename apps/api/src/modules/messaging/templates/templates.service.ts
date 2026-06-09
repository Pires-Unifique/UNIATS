import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@uniats/db';

import { PrismaService } from '../../../prisma/prisma.service.js';
import { extrairVariaveis } from './renderer.js';
import type { TemplateResolvido } from './template.types.js';

export interface CriarTemplateInput {
  codigo: string;
  nome: string;
  descricao?: string;
  whatsappCorpo?: string;
  emailAssunto?: string;
  emailTexto?: string;
  emailHtml?: string;
  usuarioId?: string;
}

export type AtualizarTemplateInput = Partial<
  Omit<CriarTemplateInput, 'codigo'>
>;

/** Forma do template como a UI consome (lista de catálogo). */
export interface TemplateCatalogo {
  codigo: string;
  versao: string;
  nome: string;
  descricao: string | null;
  variaveis: string[];
  canais: Array<'WHATSAPP' | 'EMAIL'>;
  // Corpos crus — usados pela UI para preview ao vivo e pelo formulário de edição.
  whatsappCorpo: string | null;
  emailAssunto: string | null;
  emailTexto: string | null;
  emailHtml: string | null;
}

const CODIGO_RE = /^[a-z][a-z0-9_]*$/;

/**
 * Catálogo de templates persistido no banco. Substitui o antigo registry
 * "in-code". As variáveis ({{nome}}) são DERIVADAS dos corpos — o recrutador
 * nunca as declara. `versao` é incrementada a cada edição para auditoria.
 */
@Injectable()
export class TemplatesService {
  constructor(private readonly prisma: PrismaService) {}

  /** Lista templates ativos no formato consumido pela UI. */
  async listarAtivos(): Promise<TemplateCatalogo[]> {
    const rows = await this.prisma.templateMensagem.findMany({
      where: { ativo: true },
      orderBy: { codigo: 'asc' },
    });
    return rows.map((r) => this.paraCatalogo(r));
  }

  /**
   * Resolve um template ATIVO para render. Ponto único usado pelo service
   * (dry-run) e pelo worker (envio).
   */
  async obterPorCodigo(codigo: string): Promise<TemplateResolvido> {
    const r = await this.prisma.templateMensagem.findUnique({
      where: { codigo },
    });
    if (!r || !r.ativo) {
      throw new NotFoundException(
        `Template "${codigo}" não existe ou está inativo.`,
      );
    }
    return this.paraResolvido(r);
  }

  async criar(input: CriarTemplateInput): Promise<TemplateCatalogo> {
    if (!CODIGO_RE.test(input.codigo)) {
      throw new BadRequestException(
        'codigo deve começar por letra e conter apenas [a-z0-9_].',
      );
    }
    if (!input.nome?.trim()) {
      throw new BadRequestException('nome é obrigatório.');
    }
    this.exigirAoMenosUmCorpo(input);

    try {
      const r = await this.prisma.templateMensagem.create({
        data: {
          codigo: input.codigo,
          nome: input.nome.trim(),
          descricao: input.descricao,
          versao: 'v1',
          ativo: true,
          whatsapp_corpo: input.whatsappCorpo ?? null,
          email_assunto: input.emailAssunto ?? null,
          email_texto: input.emailTexto ?? null,
          email_html: input.emailHtml ?? null,
          criado_por: input.usuarioId ?? null,
          atualizado_por: input.usuarioId ?? null,
        },
      });
      return this.paraCatalogo(r);
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new BadRequestException(
          `Já existe um template com código "${input.codigo}".`,
        );
      }
      throw err;
    }
  }

  async atualizar(
    codigo: string,
    input: AtualizarTemplateInput,
  ): Promise<TemplateCatalogo> {
    const atual = await this.prisma.templateMensagem.findUnique({
      where: { codigo },
    });
    if (!atual) {
      throw new NotFoundException(`Template "${codigo}" não existe.`);
    }

    // Mescla para validar que ao menos um corpo permanece presente.
    const mesclado = {
      whatsappCorpo:
        input.whatsappCorpo !== undefined
          ? input.whatsappCorpo
          : atual.whatsapp_corpo ?? undefined,
      emailAssunto:
        input.emailAssunto !== undefined
          ? input.emailAssunto
          : atual.email_assunto ?? undefined,
      emailTexto:
        input.emailTexto !== undefined
          ? input.emailTexto
          : atual.email_texto ?? undefined,
    };
    this.exigirAoMenosUmCorpo(mesclado);

    const data: Prisma.TemplateMensagemUncheckedUpdateInput = {
      versao: this.proximaVersao(atual.versao),
      atualizado_por: input.usuarioId ?? atual.atualizado_por,
    };
    if (input.nome !== undefined) data.nome = input.nome.trim();
    if (input.descricao !== undefined) data.descricao = input.descricao;
    if (input.whatsappCorpo !== undefined)
      data.whatsapp_corpo = input.whatsappCorpo || null;
    if (input.emailAssunto !== undefined)
      data.email_assunto = input.emailAssunto || null;
    if (input.emailTexto !== undefined)
      data.email_texto = input.emailTexto || null;
    if (input.emailHtml !== undefined) data.email_html = input.emailHtml || null;

    const r = await this.prisma.templateMensagem.update({
      where: { codigo },
      data,
    });
    return this.paraCatalogo(r);
  }

  /** Soft-disable: preserva histórico de envios que referenciam o codigo. */
  async desabilitar(codigo: string): Promise<{ codigo: string; ativo: boolean }> {
    const atual = await this.prisma.templateMensagem.findUnique({
      where: { codigo },
      select: { id: true },
    });
    if (!atual) {
      throw new NotFoundException(`Template "${codigo}" não existe.`);
    }
    await this.prisma.templateMensagem.update({
      where: { codigo },
      data: { ativo: false },
    });
    return { codigo, ativo: false };
  }

  /** ----------------------------------------------------------------------
   *  Helpers internos
   *  --------------------------------------------------------------------- */

  private exigirAoMenosUmCorpo(input: {
    whatsappCorpo?: string;
    emailAssunto?: string;
    emailTexto?: string;
  }): void {
    const temWhatsapp = Boolean(input.whatsappCorpo?.trim());
    const temEmail =
      Boolean(input.emailAssunto?.trim()) && Boolean(input.emailTexto?.trim());
    if (!temWhatsapp && !temEmail) {
      throw new BadRequestException(
        'Informe ao menos o corpo de WhatsApp, ou assunto + texto de e-mail.',
      );
    }
  }

  /** "v1" → "v2"; valor não-numérico ganha sufixo de versão derivado. */
  private proximaVersao(versao: string): string {
    const m = /^v(\d+)$/.exec(versao);
    if (m) return `v${Number(m[1]) + 1}`;
    return `${versao}.1`;
  }

  private paraResolvido(
    r: Prisma.TemplateMensagemGetPayload<object>,
  ): TemplateResolvido {
    return {
      codigo: r.codigo,
      versao: r.versao,
      whatsapp: r.whatsapp_corpo ? { corpo: r.whatsapp_corpo } : undefined,
      email:
        r.email_assunto && r.email_texto
          ? {
              assunto: r.email_assunto,
              texto: r.email_texto,
              html: r.email_html ?? undefined,
            }
          : undefined,
    };
  }

  private paraCatalogo(
    r: Prisma.TemplateMensagemGetPayload<object>,
  ): TemplateCatalogo {
    const canais: Array<'WHATSAPP' | 'EMAIL'> = [];
    if (r.whatsapp_corpo) canais.push('WHATSAPP');
    if (r.email_assunto && r.email_texto) canais.push('EMAIL');
    return {
      codigo: r.codigo,
      versao: r.versao,
      nome: r.nome,
      descricao: r.descricao,
      variaveis: extrairVariaveis(
        r.whatsapp_corpo,
        r.email_assunto,
        r.email_texto,
        r.email_html,
      ),
      canais,
      whatsappCorpo: r.whatsapp_corpo,
      emailAssunto: r.email_assunto,
      emailTexto: r.email_texto,
      emailHtml: r.email_html,
    };
  }
}
