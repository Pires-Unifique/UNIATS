/**
 * Acesso DELEGADO ao Microsoft Graph para ler a disponibilidade (free/busy) da
 * agenda do recrutador. Fluxo "sob demanda": um popup MSAL pede consentimento
 * (Calendars.Read) só quando o recrutador clica em "Conectar minha agenda" —
 * independente do login geral do app.
 *
 * PRÉ-REQUISITO: um app registration no Entra ID (NEXT_PUBLIC_AZURE_AD_CLIENT_ID).
 * Sem ele, `graphEnabled()` é false e a UI mostra a instrução para a infra.
 * Ver docs/agendamento-teams.md.
 */
import { getMsal, graphCalendarRequest } from './msal';

const GRAPH = 'https://graph.microsoft.com/v1.0';
// Fuso de Brasília no formato Windows (esperado pelo Graph).
const TZ_WINDOWS = 'E. South America Standard Time';

export interface SlotLivre {
  /** Início em ISO local (sem timezone), ex.: "2026-06-03T14:00:00". */
  inicio: string;
  fim: string;
  /** Rótulo amigável pt-BR, ex.: "ter, 03/06 · 14:00–14:30". */
  rotulo: string;
}

export interface OpcoesDisponibilidade {
  /** Duração de cada janela em minutos (30 ou 60). */
  duracaoMin: number;
  /** Quantos dias úteis olhar a partir de amanhã. */
  diasUteis: number;
  /** Início do expediente (hora local, 0-23). */
  horaInicio: number;
  /** Fim do expediente (hora local, 0-23). */
  horaFim: number;
}

export function graphEnabled(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_AZURE_AD_CLIENT_ID);
}

/**
 * E-mail FIXO para teste: quando definido, a consulta de disponibilidade usa
 * este e-mail no getSchedule (pula o /me). Útil com a conta local (sem SSO) —
 * o popup Microsoft ainda é necessário para obter o token, mas a agenda
 * consultada é a deste e-mail.
 */
export function emailAgendaFixo(): string {
  return (process.env.NEXT_PUBLIC_AGENDA_EMAIL_TESTE ?? '').trim();
}

/** Adquire um token delegado do Graph via popup (consentimento sob demanda). */
async function obterTokenGraph(): Promise<string> {
  const msal = getMsal();
  await msal.initialize();
  let conta = msal.getAllAccounts()[0] ?? null;
  if (!conta) {
    const login = await msal.loginPopup(graphCalendarRequest);
    conta = login.account;
  }
  try {
    const r = await msal.acquireTokenSilent({
      ...graphCalendarRequest,
      account: conta!,
    });
    return r.accessToken;
  } catch {
    const r = await msal.acquireTokenPopup(graphCalendarRequest);
    return r.accessToken;
  }
}

/** E-mail/UPN do usuário logado (necessário para o getSchedule). */
async function obterMeuEmail(token: string): Promise<string> {
  const resp = await fetch(`${GRAPH}/me?$select=mail,userPrincipalName`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok) throw new Error(`Graph /me falhou (${resp.status}).`);
  const j = (await resp.json()) as { mail?: string; userPrincipalName?: string };
  const email = j.mail ?? j.userPrincipalName;
  if (!email) throw new Error('Não foi possível identificar seu e-mail no Graph.');
  return email;
}

/** Formata "YYYY-MM-DDTHH:mm:ss" local (sem offset) para o Graph. */
function isoLocal(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:00`;
}

/**
 * Gera os slots livres a partir do `availabilityView` do getSchedule.
 * Função PURA (testável): cada caractere representa um intervalo de `intervalo`
 * minutos a partir de `janelaInicio`; '0' = livre. Um slot de `duracaoMin` exige
 * `duracaoMin/intervalo` caracteres '0' consecutivos, dentro do expediente e em
 * dia útil.
 */
export function gerarSlotsLivres(
  availabilityView: string,
  janelaInicio: Date,
  intervalo: number,
  opts: OpcoesDisponibilidade,
): SlotLivre[] {
  const slots: SlotLivre[] = [];
  const charsPorSlot = Math.max(1, Math.round(opts.duracaoMin / intervalo));
  const fmtData = new Intl.DateTimeFormat('pt-BR', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
  });
  const fmtHora = new Intl.DateTimeFormat('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  });

  // Itera dia a dia (a partir de amanhã), pulando fim de semana.
  const base = new Date(janelaInicio);
  for (let dia = 0; dia < opts.diasUteis + 7; dia++) {
    const d = new Date(base);
    d.setDate(base.getDate() + dia);
    const dow = d.getDay();
    if (dow === 0 || dow === 6) continue; // pula sáb/dom (não conta no limite)
    if (diasUteisContados(base, d) > opts.diasUteis) break;

    for (
      let h = opts.horaInicio * 60;
      h + opts.duracaoMin <= opts.horaFim * 60;
      h += opts.duracaoMin
    ) {
      const inicio = new Date(d);
      inicio.setHours(0, 0, 0, 0);
      inicio.setMinutes(h);
      const idx = Math.round(
        (inicio.getTime() - janelaInicio.getTime()) / (intervalo * 60_000),
      );
      if (idx < 0 || idx + charsPorSlot > availabilityView.length) continue;
      const trecho = availabilityView.slice(idx, idx + charsPorSlot);
      if (!/^0+$/.test(trecho)) continue; // algum intervalo ocupado

      const fim = new Date(inicio);
      fim.setMinutes(inicio.getMinutes() + opts.duracaoMin);
      slots.push({
        inicio: isoLocal(inicio),
        fim: isoLocal(fim),
        rotulo: `${fmtData.format(inicio)} · ${fmtHora.format(inicio)}–${fmtHora.format(fim)}`,
      });
    }
  }
  return slots;
}

function diasUteisContados(de: Date, ate: Date): number {
  let count = 0;
  const d = new Date(de);
  d.setHours(0, 0, 0, 0);
  const alvo = new Date(ate);
  alvo.setHours(0, 0, 0, 0);
  while (d <= alvo) {
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) count++;
    d.setDate(d.getDate() + 1);
  }
  return count;
}

/**
 * Combina os `availabilityView` de vários participantes em UMA visão conjunta:
 * um intervalo só é considerado LIVRE ('0') se TODOS estiverem livres nele;
 * basta um ocupado para marcar '1'. Função PURA (testável). Usa o menor
 * comprimento entre as views (devem ser iguais, mas protege contra desalinho).
 */
export function combinarViews(views: string[]): string {
  const validas = views.filter((v) => v.length > 0);
  if (validas.length === 0) return '';
  const len = Math.min(...validas.map((v) => v.length));
  let out = '';
  for (let i = 0; i < len; i++) {
    out += validas.every((v) => v[i] === '0') ? '0' : '1';
  }
  return out;
}

/**
 * Lê a disponibilidade conjunta da agenda do recrutador + participantes
 * (líderes técnicos) e devolve os slots em que TODOS estão livres.
 * Faz o popup de consentimento na primeira chamada.
 *
 * @param participantes E-mails extras a checar junto com o recrutador (ex.: o
 *   gestor/líder técnico da vaga). Slots ocupados em qualquer agenda são descartados.
 */
export async function obterDisponibilidade(
  opts: OpcoesDisponibilidade,
  participantes: string[] = [],
): Promise<SlotLivre[]> {
  if (!graphEnabled()) {
    throw new Error(
      'Agenda não configurada: peça à infra um app registration (Calendars.Read).',
    );
  }
  const token = await obterTokenGraph();
  // E-mail fixo de teste tem precedência; senão resolve via /me.
  const meuEmail = emailAgendaFixo() || (await obterMeuEmail(token));

  // Agendas a consultar: a minha + participantes (sem duplicar, case-insensitive).
  const schedules: string[] = [meuEmail];
  for (const p of participantes) {
    const e = p.trim();
    if (e && !schedules.some((s) => s.toLowerCase() === e.toLowerCase())) {
      schedules.push(e);
    }
  }

  // Janela: de amanhã 00:00 até diasUteis+7 dias depois, no expediente.
  const inicio = new Date();
  inicio.setDate(inicio.getDate() + 1);
  inicio.setHours(opts.horaInicio, 0, 0, 0);
  const fim = new Date(inicio);
  fim.setDate(inicio.getDate() + opts.diasUteis + 7);
  fim.setHours(opts.horaFim, 0, 0, 0);

  const intervalo = 30;
  const resp = await fetch(`${GRAPH}/me/calendar/getSchedule`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Prefer: `outlook.timezone="${TZ_WINDOWS}"`,
    },
    body: JSON.stringify({
      schedules,
      startTime: { dateTime: isoLocal(inicio), timeZone: TZ_WINDOWS },
      endTime: { dateTime: isoLocal(fim), timeZone: TZ_WINDOWS },
      availabilityViewInterval: intervalo,
    }),
  });
  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    throw new Error(`Graph getSchedule falhou (${resp.status}). ${txt.slice(0, 200)}`);
  }
  const j = (await resp.json()) as {
    value?: Array<{ availabilityView?: string; scheduleId?: string }>;
  };
  const views = (j.value ?? []).map((v) => v.availabilityView ?? '');
  // Slot só é livre se TODOS (recrutador + participantes) estiverem livres nele.
  const viewConjunta = combinarViews(views);
  return gerarSlotsLivres(viewConjunta, inicio, intervalo, opts);
}
