import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { PapelUsuario, Usuario } from '@uniats/db';

import { PrismaService } from '../../prisma/prisma.service.js';
import type { Area, UsuarioAutenticado } from './auth.types.js';

/** Claims já normalizadas extraídas do access token do Entra. */
export interface ClaimsSSO {
  azure_oid: string;
  email: string;
  nome: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Provisiona (cria/atualiza) o usuário a partir das claims do SSO e devolve a
   * identidade autenticada. Política de acesso (por ÁREAS):
   *  - e-mail na allowlist (AUTH_ADMIN_EMAILS) → área 'admin' (a cada login);
   *  - usuário NOVO entra SEM áreas (acesso só por posse de vaga, se gestor);
   *  - demais áreas (recrutamento/admissao/offboarding) são liberadas MANUALMENTE
   *    por um admin (futuramente via grupos de AD).
   * O login NÃO mexe nas áreas de quem não é admin — atribuição é deliberada.
   * Gestor não é "papel": o vínculo com a vaga (gestor_id) dá o acesso escopado.
   */
  async provisionarUsuario(claims: ClaimsSSO): Promise<UsuarioAutenticado> {
    const ehAdmin = this.emailsAdmin().includes(claims.email);
    const usuario = await this.prisma.usuario.upsert({
      where: { azure_oid: claims.azure_oid },
      create: {
        azure_oid: claims.azure_oid,
        email: claims.email,
        nome: claims.nome,
        papel: ehAdmin ? 'ADMIN' : 'VISUALIZADOR', // legado/exibição
        areas: ehAdmin ? ['admin'] : [],
        ultimo_login_em: new Date(),
      },
      update: {
        email: claims.email,
        nome: claims.nome,
        ultimo_login_em: new Date(),
        // Só reaplica 'admin' via allowlist; NÃO sobrescreve áreas manuais.
        ...(ehAdmin ? { areas: ['admin'], papel: 'ADMIN' } : {}),
      },
    });

    // Auto-vínculo: assume como gestor as vagas cujo gestor_email casa com o dele.
    await this.vincularVagasComoGestor(usuario.id, claims.email);

    return this.toAutenticado(usuario);
  }

  /**
   * Liga ao usuário (como gestor) toda vaga com `gestor_email` igual ao seu e
   * ainda SEM gestor interno. Sentido login→vaga do auto-vínculo. Idempotente.
   */
  private async vincularVagasComoGestor(
    usuarioId: string,
    email: string,
  ): Promise<number> {
    const r = await this.prisma.vaga.updateMany({
      where: { gestor_email: email, gestor_id: null, excluido_em: null },
      data: { gestor_id: usuarioId },
    });
    if (r.count > 0) {
      this.logger.log(
        `Auto-vínculo: ${r.count} vaga(s) atribuída(s) ao gestor ${usuarioId}.`,
      );
    }
    return r.count;
  }

  /**
   * Sentido inverso (vaga→usuário): ao SINCRONIZAR uma vaga da Gupy, liga-a a um
   * gestor que JÁ tenha logado. Chamado pelo GupyService após o upsert da vaga.
   */
  async vincularGestorAoSincronizar(
    vagaId: string,
    gestorEmail: string | null,
  ): Promise<void> {
    if (!gestorEmail) return;
    const usuario = await this.prisma.usuario.findUnique({
      where: { email: gestorEmail },
    });
    if (!usuario) return;
    await this.prisma.vaga.updateMany({
      where: { id: vagaId, gestor_id: null },
      data: { gestor_id: usuario.id },
    });
  }

  /** Áreas que enxergam TODAS as vagas (recrutamento) — 'admin' cobre tudo. */
  podeVerTodasVagas(usuario: UsuarioAutenticado): boolean {
    return (
      usuario.areas.includes('admin') ||
      usuario.areas.includes('recrutamento')
    );
  }

  /**
   * Garante que o usuário pode acessar a vaga. Quem vê todas as vagas
   * (admin/recrutamento) sempre pode; os demais só se forem o gestor. Caso
   * contrário 404 (não vaza existência). Use nos endpoints que recebem vagaId.
   */
  async assertVagaPermitida(
    usuario: UsuarioAutenticado,
    vagaId: string,
  ): Promise<void> {
    if (this.podeVerTodasVagas(usuario)) return;
    const vaga = await this.prisma.vaga.findFirst({
      where: { id: vagaId, gestor_id: usuario.id },
      select: { id: true },
    });
    if (!vaga) throw new NotFoundException(`Vaga ${vagaId} não existe.`);
  }

  /** Idem, partindo de uma candidatura (resolve a vaga dela). */
  async assertCandidaturaPermitida(
    usuario: UsuarioAutenticado,
    candidaturaId: string,
  ): Promise<void> {
    if (this.podeVerTodasVagas(usuario)) return;
    const cand = await this.prisma.candidatura.findFirst({
      where: { id: candidaturaId, vaga: { gestor_id: usuario.id } },
      select: { id: true },
    });
    if (!cand) {
      throw new NotFoundException(`Candidatura ${candidaturaId} não existe.`);
    }
  }

  /** Idem, partindo de uma pergunta de entrevista (pergunta → vaga). */
  async assertPerguntaPermitida(
    usuario: UsuarioAutenticado,
    perguntaId: string,
  ): Promise<void> {
    if (this.podeVerTodasVagas(usuario)) return;
    const p = await this.prisma.perguntaEntrevista.findUnique({
      where: { id: perguntaId },
      select: { vaga_id: true },
    });
    if (!p?.vaga_id) {
      throw new NotFoundException(`Pergunta ${perguntaId} não existe.`);
    }
    await this.assertVagaPermitida(usuario, p.vaga_id);
  }

  /** Idem, partindo de uma entrevista (entrevista → candidatura → vaga). */
  async assertEntrevistaPermitida(
    usuario: UsuarioAutenticado,
    entrevistaId: string,
  ): Promise<void> {
    if (this.podeVerTodasVagas(usuario)) return;
    const e = await this.prisma.entrevista.findUnique({
      where: { id: entrevistaId },
      select: { candidatura_id: true },
    });
    if (!e) throw new NotFoundException(`Entrevista ${entrevistaId} não existe.`);
    await this.assertCandidaturaPermitida(usuario, e.candidatura_id);
  }

  /** Idem, partindo de uma mensagem (mensagem → candidatura → vaga). */
  async assertMensagemPermitida(
    usuario: UsuarioAutenticado,
    mensagemId: string,
  ): Promise<void> {
    if (this.podeVerTodasVagas(usuario)) return;
    const m = await this.prisma.mensagem.findUnique({
      where: { id: mensagemId },
      select: { candidatura_id: true },
    });
    if (!m?.candidatura_id) {
      throw new NotFoundException(`Mensagem ${mensagemId} não existe.`);
    }
    await this.assertCandidaturaPermitida(usuario, m.candidatura_id);
  }

  /** Idem, partindo de uma enquete de horários (enquete → candidatura → vaga). */
  async assertEnquetePermitida(
    usuario: UsuarioAutenticado,
    enqueteId: string,
  ): Promise<void> {
    if (this.podeVerTodasVagas(usuario)) return;
    const q = await this.prisma.enqueteHorario.findUnique({
      where: { id: enqueteId },
      select: { candidatura_id: true },
    });
    if (!q) throw new NotFoundException(`Enquete ${enqueteId} não existe.`);
    await this.assertCandidaturaPermitida(usuario, q.candidatura_id);
  }

  /**
   * gestor_id para ESCOPAR listagens (agenda, etc.): null quando o usuário vê
   * todas as vagas (admin/recrutamento); senão o próprio id (gestor).
   */
  escopoGestorId(usuario: UsuarioAutenticado): string | null {
    return this.podeVerTodasVagas(usuario) ? null : usuario.id;
  }

  /** E-mails que entram como ADMIN geral (CSV em AUTH_ADMIN_EMAILS). */
  private emailsAdmin(): string[] {
    const raw = this.config.get<string>('AUTH_ADMIN_EMAILS') ?? '';
    return raw
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);
  }

  /** Resolve um usuário pelo Object ID do Azure (usado pelo bypass de teste). */
  async resolverPorOid(azureOid: string): Promise<UsuarioAutenticado | null> {
    const u = await this.prisma.usuario.findUnique({
      where: { azure_oid: azureOid },
    });
    return u ? this.toAutenticado(u) : null;
  }

  /**
   * Usuário usado quando a autenticação está DESLIGADA (AUTH_ENABLED=false) —
   * dev/local. Garante a existência de um admin de desenvolvimento para que o
   * `req.user` nunca seja nulo nos ambientes sem SSO.
   */
  async usuarioDevPadrao(): Promise<UsuarioAutenticado> {
    const azureOid =
      this.config.get<string>('AUTH_DEV_OID') ??
      '00000000-0000-0000-0000-000000000001';
    const email =
      this.config.get<string>('AUTH_DEV_EMAIL') ?? 'admin@unifique.com.br';
    const u = await this.prisma.usuario.upsert({
      where: { azure_oid: azureOid },
      create: {
        azure_oid: azureOid,
        email,
        nome: 'Desenvolvimento (AUTH desligado)',
        papel: 'ADMIN',
        areas: ['admin'],
        ultimo_login_em: new Date(),
      },
      // Garante que o admin de dev tenha 'admin' mesmo se criado antes das áreas.
      update: { areas: ['admin'], ultimo_login_em: new Date() },
    });
    return this.toAutenticado(u);
  }

  private toAutenticado(u: Usuario): UsuarioAutenticado {
    return {
      id: u.id,
      azure_oid: u.azure_oid,
      email: u.email,
      nome: u.nome,
      papel: u.papel as PapelUsuario,
      areas: (u.areas ?? []) as Area[],
      ativo: u.ativo,
    };
  }
}
