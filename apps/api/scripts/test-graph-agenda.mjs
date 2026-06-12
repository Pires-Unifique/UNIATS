/**
 * Teste end-to-end do agendamento via Microsoft Graph (app-only) + WhatsApp (WAHA).
 *
 * Faz, contra o tenant REAL da Unifique:
 *   1. obtém token app-only (client_credentials);
 *   2. cria UM evento na agenda do organizador → reunião Teams + bloqueio + convite
 *      nativo do Outlook ao convidado;
 *   3. (opcional) manda um reforço por WhatsApp com o joinUrl.
 *
 * Uso (a partir da raiz do monorepo):
 *   NODE_EXTRA_CA_CERTS=infra/certs/netskope-unifique-ca.pem \
 *     node --env-file=.env apps/api/scripts/test-graph-agenda.mjs
 *
 * Variáveis lidas do ambiente: AZURE_AD_TENANT_ID, AZURE_AD_CLIENT_ID,
 * AZURE_AD_CLIENT_SECRET, GRAPH_BASE_URL?, GRAPH_SCOPE?, WAHA_BASE_URL?,
 * WAHA_API_KEY?, WAHA_SESSION?.
 */

// Alvos do teste (passados pelo Guilherme).
const ORGANIZADOR = 'guilherme.viana@unifique.com.br';
const CONVIDADO_EMAIL = 'guilherme.viana@unifique.com.br';
const CONVIDADO_NOME = 'Guilherme Viana';
const WHATSAPP_E164 = '5547988329003'; // 55 (BR) + 47 (DDD) + 988329003

// Limpa valor de env: tira espaços e comentário inline (" # ...").
const env = (k) => (process.env[k] ?? '').trim().replace(/\s+#.*$/, '');

const tenant = env('AZURE_AD_TENANT_ID');
const clientId = env('AZURE_AD_CLIENT_ID');
const clientSecret = env('AZURE_AD_CLIENT_SECRET');
const graphBase = env('GRAPH_BASE_URL') || 'https://graph.microsoft.com/v1.0';
const scope = env('GRAPH_SCOPE') || 'https://graph.microsoft.com/.default';
const wahaBase = env('WAHA_BASE_URL');
const wahaKey = env('WAHA_API_KEY');
const wahaSession = env('WAHA_SESSION') || 'default';

function exigir(nome, v) {
  if (!v) {
    console.error(`✗ Falta ${nome} no ambiente. Rode com --env-file=.env.`);
    process.exit(1);
  }
}
exigir('AZURE_AD_TENANT_ID', tenant);
exigir('AZURE_AD_CLIENT_ID', clientId);
exigir('AZURE_AD_CLIENT_SECRET', clientSecret);

const fmtUtc = (d) => d.toISOString().replace(/\.\d{3}Z$/, '');
const fmtBr = (d) =>
  new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'full',
    timeStyle: 'short',
    timeZone: 'America/Sao_Paulo',
  }).format(d);

// Início ~2h a partir de agora, arredondado para a próxima meia hora; 30 min de duração.
const agora = Date.now();
const inicio = new Date(Math.ceil((agora + 2 * 3600_000) / (30 * 60_000)) * (30 * 60_000));
const fim = new Date(inicio.getTime() + 30 * 60_000);

async function obterToken() {
  const url = `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
    scope,
  });
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error(
      `token ${resp.status}: ${data.error} — ${data.error_description?.slice(0, 300)}`,
    );
  }
  return data.access_token;
}

async function criarEvento(token) {
  const corpoHtml =
    `<p>Olá, ${CONVIDADO_NOME}!</p>` +
    '<p>Reunião de <strong>teste</strong> do agendamento automático do UniATS.</p>' +
    `<p><strong>Quando:</strong> ${fmtBr(inicio)}</p>` +
    '<p>O link do Teams está neste convite — clique em <em>Ingressar</em> no horário.</p>';
  const corpo = {
    subject: 'Entrevista — Teste UniATS (agendamento automático)',
    body: { contentType: 'HTML', content: corpoHtml },
    start: { dateTime: fmtUtc(inicio), timeZone: 'UTC' },
    end: { dateTime: fmtUtc(fim), timeZone: 'UTC' },
    attendees: [
      {
        emailAddress: { address: CONVIDADO_EMAIL, name: CONVIDADO_NOME },
        type: 'required',
      },
    ],
    isOnlineMeeting: true,
    onlineMeetingProvider: 'teamsForBusiness',
    showAs: 'busy',
    isReminderOn: true,
    reminderMinutesBeforeStart: 30,
  };
  const url = `${graphBase}/users/${encodeURIComponent(ORGANIZADOR)}/events`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Prefer: 'outlook.timezone="E. South America Standard Time"',
    },
    body: JSON.stringify(corpo),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error(
      `events ${resp.status}: ${JSON.stringify(data.error ?? data).slice(0, 600)}`,
    );
  }
  return { eventId: data.id, joinUrl: data.onlineMeeting?.joinUrl ?? null };
}

async function enviarWhatsApp(joinUrl) {
  if (!wahaBase || !wahaKey) {
    console.log('… WAHA não configurado — pulando WhatsApp.');
    return;
  }
  const phone = WHATSAPP_E164.replace(/\D+/g, '');
  const check = await fetch(
    `${wahaBase}/api/checkNumberStatus?phone=${phone}&session=${encodeURIComponent(wahaSession)}`,
    { headers: { 'X-Api-Key': wahaKey, Accept: 'application/json' } },
  );
  const checkData = await check.json().catch(() => ({}));
  if (!check.ok || !checkData.numberExists || !checkData.chatId) {
    console.log(
      `… número ${phone} não confirmado no WhatsApp (status=${check.status}, body=${JSON.stringify(checkData).slice(0, 200)}) — pulando envio.`,
    );
    return;
  }
  const texto =
    '✅ Sua entrevista (TESTE UniATS) está confirmada!\n\n' +
    `🗓️ *${fmtBr(inicio)}*\n` +
    `💻 Link do Teams: ${joinUrl}\n\n` +
    'Você também recebeu o convite no e-mail. (Mensagem de teste.)';
  const send = await fetch(`${wahaBase}/api/sendText`, {
    method: 'POST',
    headers: {
      'X-Api-Key': wahaKey,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      session: wahaSession,
      chatId: checkData.chatId,
      text: texto,
      linkPreview: false,
    }),
  });
  const sendData = await send.json().catch(() => ({}));
  if (!send.ok) {
    console.log(
      `✗ Falha ao enviar WhatsApp (status=${send.status}): ${JSON.stringify(sendData).slice(0, 200)}`,
    );
    return;
  }
  console.log(`✓ WhatsApp enviado para ${checkData.chatId}.`);
}

(async () => {
  console.log('— Teste de agendamento Graph + WhatsApp —');
  console.log(`Organizador/convidado: ${ORGANIZADOR}`);
  console.log(`Horário: ${fmtBr(inicio)} (UTC ${fmtUtc(inicio)} → ${fmtUtc(fim)})\n`);

  console.log('1/3  Obtendo token app-only…');
  const token = await obterToken();
  console.log('     ✓ token obtido.\n');

  console.log('2/3  Criando reunião Teams + bloqueio + convite…');
  const { eventId, joinUrl } = await criarEvento(token);
  console.log(`     ✓ evento criado: ${eventId}`);
  console.log(`     ✓ joinUrl: ${joinUrl ?? '(não retornado!)'}\n`);

  console.log('3/3  Enviando reforço por WhatsApp…');
  await enviarWhatsApp(joinUrl);

  console.log('\n✓ Concluído. Verifique o convite no e-mail/Outlook e o WhatsApp.');
})().catch((err) => {
  console.error(`\n✗ ERRO: ${err.message}`);
  process.exit(1);
});
