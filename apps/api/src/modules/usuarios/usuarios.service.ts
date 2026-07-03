import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { UsuarioAdminDTO } from '@uniats/shared';
import { randomUUID } from 'node:crypto';

import { PrismaService } from '../../prisma/prisma.service.js';
import { AuthService } from '../auth/auth.service.js';
import { AREAS_ATRIBUIVEIS } from '../auth/auth.types.js';
import type { Area, UsuarioAutenticado } from '../auth/auth.types.js';

/** Prefixo do azure_oid de quem foi PRÉ-CADASTRADO e ainda não logou. No 1º
 *  login o provisionamento reconcilia pela coluna email e grava o oid real. */
const OID_PRE_CADASTRO = 'pre-cadastro:';

/**
 * Gestão dos usuários e seus acessos amplos (áreas). O que é automático
 * (gestor↔vaga por e-mail, líder por escopo próprio) NÃO passa por aqui —
 * esta tela só cuida do que é decisão humana.
 */
@Injectable()
export class UsuariosService {
  private readonly logger = new Logger(UsuariosService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly auth: AuthService,
  ) {}

  async listar(busca?: string, incluirInativos = false): Promise<UsuarioAdminDTO[]> {
    const usuarios = await this.prisma.usuario.findMany({
      where: {
        ...(incluirInativos ? {} : { ativo: true }),
        ...(busca
          ? {
              OR: [
                { nome: { contains: busca, mode: 'insensitive' } },
                { email: { contains: busca, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      include: {
        _count: {
          select: { vagas_gestao: { where: { excluido_em: null } } },
        },
      },
      orderBy: { nome: 'asc' },
      take: 500,
    });
    return usuarios.map((u) => this.toDTO(u));
  }

  /**
   * PRÉ-CADASTRO: libera áreas antes do 1º login. Cria a linha só com e-mail;
   * quando a pessoa entrar com a conta Microsoft, `provisionarUsuario` acha a
   * linha pelo e-mail e grava o azure_oid real (reconciliação já existente).
   */
  async preCadastrar(
    input: { email?: string; nome?: string; areas?: string[] },
    autor: UsuarioAutenticado,
  ): Promise<UsuarioAdminDTO> {
    const email = (input.email ?? '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new BadRequestException('E-mail inválido.');
    }
    this.assertDominioPermitido(email);
    const areas = this.validarAreas(input.areas ?? []);

    const jaExiste = await this.prisma.usuario.findUnique({ where: { email } });
    if (jaExiste) {
      throw new ConflictException(
        `${email} já está cadastrado — edite as áreas dele na lista.`,
      );
    }

    const usuario = await this.prisma.usuario.create({
      data: {
        azure_oid: `${OID_PRE_CADASTRO}${randomUUID()}`,
        email,
        nome: input.nome?.trim() || email.split('@')[0],
        papel: 'VISUALIZADOR',
        areas,
      },
      include: {
        _count: { select: { vagas_gestao: { where: { excluido_em: null } } } },
      },
    });

    await this.auditar(autor, 'usuario_pre_cadastrado', usuario.id, {
      depois: { email, areas },
    });
    this.logger.log(`Pré-cadastro de ${email} (áreas: ${areas.join(', ') || '—'}) por ${autor.email}.`);
    return this.toDTO(usuario);
  }

  /** Edita áreas e/ou ativo — com travas contra auto-edição. */
  async atualizar(
    id: string,
    input: { areas?: string[]; ativo?: boolean },
    autor: UsuarioAutenticado,
  ): Promise<UsuarioAdminDTO> {
    if (id === autor.id) {
      throw new ForbiddenException(
        'Você não pode alterar os próprios acessos — peça a outro administrador.',
      );
    }
    if (input.areas === undefined && input.ativo === undefined) {
      throw new BadRequestException('Nada a atualizar (envie areas e/ou ativo).');
    }

    const atual = await this.prisma.usuario.findUnique({ where: { id } });
    if (!atual) throw new NotFoundException(`Usuário ${id} não encontrado.`);

    const areas = input.areas !== undefined ? this.validarAreas(input.areas) : undefined;

    const usuario = await this.prisma.usuario.update({
      where: { id },
      data: {
        ...(areas !== undefined ? { areas } : {}),
        ...(input.ativo !== undefined ? { ativo: input.ativo } : {}),
      },
      include: {
        _count: { select: { vagas_gestao: { where: { excluido_em: null } } } },
      },
    });

    await this.auditar(autor, 'usuario_acessos_atualizados', id, {
      antes: { areas: atual.areas, ativo: atual.ativo },
      depois: { areas: usuario.areas, ativo: usuario.ativo },
    });
    return this.toDTO(usuario);
  }

  /** Remove um PRÉ-CADASTRO que nunca logou (hard delete seguro). */
  async removerPreCadastro(
    id: string,
    autor: UsuarioAutenticado,
  ): Promise<{ ok: true }> {
    const usuario = await this.prisma.usuario.findUnique({ where: { id } });
    if (!usuario) throw new NotFoundException(`Usuário ${id} não encontrado.`);
    if (!usuario.azure_oid.startsWith(OID_PRE_CADASTRO) || usuario.ultimo_login_em) {
      throw new BadRequestException(
        'Só é possível remover pré-cadastros que nunca logaram — para os demais, use Desativar.',
      );
    }
    await this.prisma.usuario.delete({ where: { id } });
    await this.auditar(autor, 'usuario_pre_cadastro_removido', id, {
      antes: { email: usuario.email, areas: usuario.areas },
    });
    return { ok: true };
  }

  // -----------------------------------------------------------------------

  private validarAreas(entrada: string[]): Area[] {
    const unicas = [...new Set(entrada.map((a) => a.trim()))].filter(Boolean);
    const invalidas = unicas.filter(
      (a) => !AREAS_ATRIBUIVEIS.includes(a as Area),
    );
    if (invalidas.length > 0) {
      throw new BadRequestException(
        `Área(s) inválida(s): ${invalidas.join(', ')}. Válidas: ${AREAS_ATRIBUIVEIS.join(', ')}.`,
      );
    }
    return unicas as Area[];
  }

  /** Mesma allowlist de domínios do SSO (evita liberar e-mail de fora/typo). */
  private assertDominioPermitido(email: string): void {
    const raw =
      this.config.get<string>('AZURE_AD_ALLOWED_DOMAIN') ??
      'unifique.com.br,redeunifique.com.br';
    const dominios = raw
      .split(',')
      .map((d) => d.trim().toLowerCase())
      .filter(Boolean);
    const dominio = email.split('@')[1] ?? '';
    if (dominios.length > 0 && !dominios.includes(dominio)) {
      throw new BadRequestException(
        `Domínio "${dominio}" não permitido (esperado: ${dominios.join(', ')}).`,
      );
    }
  }

  private async auditar(
    autor: UsuarioAutenticado,
    acao: string,
    usuarioAlvoId: string,
    diff: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.prisma.registroAuditoria.create({
        data: {
          usuario_id: autor.chave_api ? null : autor.id,
          acao,
          entidade: 'usuario',
          entidade_id: usuarioAlvoId,
          diff: diff as object,
        },
      });
    } catch (err) {
      // Auditoria nunca derruba a operação — mas fica registrado no log.
      this.logger.error(`Falha ao auditar ${acao}: ${(err as Error).message}`);
    }
  }

  private toDTO(u: {
    id: string;
    email: string;
    nome: string;
    azure_oid: string;
    areas: string[];
    ativo: boolean;
    ultimo_login_em: Date | null;
    criado_em: Date;
    _count: { vagas_gestao: number };
  }): UsuarioAdminDTO {
    return {
      id: u.id,
      nome: u.nome,
      email: u.email,
      areas: u.areas,
      ativo: u.ativo,
      ultimo_login_em: u.ultimo_login_em?.toISOString() ?? null,
      criado_em: u.criado_em.toISOString(),
      vagas_como_gestor: u._count.vagas_gestao,
      admin_via_ambiente: this.auth.ehAdminPorAmbiente(u.email),
      aguardando_primeiro_login: u.azure_oid.startsWith(OID_PRE_CADASTRO),
    };
  }
}
