/**
 * Seed mínimo para dev local — cria um usuário admin de teste e popula os
 * templates de mensagem padrão. Em produção este seed NÃO deve ser executado.
 *
 * Os 4 templates são inlinados aqui (e não importados de apps/api) para manter
 * o pacote `@uniats/db` autossuficiente, sem cruzar a fronteira com a API.
 * O upsert é idempotente e NÃO sobrescreve edições feitas pelo recrutador
 * (`update: {}`), então re-rodar o seed é seguro.
 */
import { PrismaClient, PapelUsuario } from '@prisma/client';

const prisma = new PrismaClient();

interface TemplateSeed {
  codigo: string;
  nome: string;
  descricao: string;
  versao: string;
  whatsapp_corpo?: string;
  email_assunto?: string;
  email_texto?: string;
}

const TEMPLATES_PADRAO: TemplateSeed[] = [
  {
    codigo: 'convite_triagem',
    nome: 'Convite de triagem',
    descricao:
      'Primeiro contato após a triagem da IA. Convida o candidato a confirmar interesse.',
    versao: 'v1',
    whatsapp_corpo:
      'Olá, {{candidato_nome}}! 👋\n\n' +
      'Aqui é o time de Recrutamento & Seleção da Unifique. ' +
      'Identificamos que o seu perfil pode ser uma boa correspondência para a vaga de *{{vaga_titulo}}*.\n\n' +
      'Você ainda tem interesse em seguir no processo seletivo?\n\n' +
      'Se sim, confirme aqui: {{link_confirmacao}}\n\n' +
      'Qualquer dúvida, estamos por aqui. Obrigado!',
    email_assunto: 'Próximo passo no processo seletivo — {{vaga_titulo}}',
    email_texto:
      'Olá, {{candidato_nome}},\n\n' +
      'Identificamos que o seu perfil é compatível com a vaga de {{vaga_titulo}} aqui na Unifique. ' +
      'Para seguir no processo seletivo, por favor confirme o seu interesse no link abaixo:\n\n' +
      '{{link_confirmacao}}\n\n' +
      'Caso prefira, é só responder a este e-mail.\n\n' +
      'Atenciosamente,\n' +
      'Unifique — Recrutamento & Seleção',
  },
  {
    codigo: 'agendamento_entrevista',
    nome: 'Agendamento de entrevista',
    descricao: 'Convite formal com link de calendário para escolher horário.',
    versao: 'v1',
    whatsapp_corpo:
      'Oi, {{candidato_nome}}!\n\n' +
      'Obrigado por confirmar interesse na vaga *{{vaga_titulo}}*. ' +
      'Vamos para a próxima etapa: uma entrevista por vídeo.\n\n' +
      'Escolha um horário que funcione melhor para você: {{link_agendamento}}\n\n' +
      '_Ao escolher um horário e participar, você concorda com a gravação da ' +
      'entrevista por vídeo, usada apenas para fins de avaliação neste processo ' +
      'seletivo._\n\n' +
      'Qualquer coisa, é só me chamar por aqui.\n\n' +
      '— {{recrutador_nome}}',
    email_assunto: 'Agendamento de entrevista — {{vaga_titulo}}',
    email_texto:
      'Olá, {{candidato_nome}},\n\n' +
      'Obrigado por confirmar interesse na vaga {{vaga_titulo}}. ' +
      'O próximo passo é uma entrevista por vídeo com o time.\n\n' +
      'Por favor, escolha um horário no link abaixo:\n{{link_agendamento}}\n\n' +
      'Ao confirmar um horário e participar, você concorda com a gravação da ' +
      'entrevista por vídeo, utilizada exclusivamente para fins de avaliação ' +
      'neste processo seletivo, conforme a nossa Política de Privacidade.\n\n' +
      'Atenciosamente,\n' +
      '{{recrutador_nome}}\n' +
      'Unifique — Recrutamento & Seleção',
  },
  {
    codigo: 'lembrete_entrevista',
    nome: 'Lembrete de entrevista',
    descricao: 'Lembrete 1 hora antes da entrevista.',
    versao: 'v1',
    whatsapp_corpo:
      'Oi, {{candidato_nome}}! ⏰\n\n' +
      'Lembrete amigável: sua entrevista para *{{vaga_titulo}}* é hoje, às *{{data_hora}}*.\n\n' +
      'Link da videochamada: {{link_meet}}\n\n' +
      'Boa entrevista! 🙌',
    email_assunto: 'Lembrete: entrevista hoje às {{data_hora}}',
    email_texto:
      'Olá, {{candidato_nome}},\n\n' +
      'Este é um lembrete da sua entrevista para a vaga {{vaga_titulo}}, marcada para hoje às {{data_hora}}.\n\n' +
      'Link da videochamada: {{link_meet}}\n\n' +
      'Boa entrevista!\n\n' +
      'Unifique — Recrutamento & Seleção',
  },
  {
    codigo: 'comunicado_decisao',
    nome: 'Comunicado de decisão',
    descricao:
      'Comunicado de aprovação ou não-aprovação. Atenção: respeito é obrigatório.',
    versao: 'v1',
    whatsapp_corpo:
      'Olá, {{candidato_nome}}!\n\n' +
      'Sobre a vaga *{{vaga_titulo}}*:\n\n' +
      '{{mensagem_personalizada}}\n\n' +
      'Agradecemos muito pelo seu tempo e atenção. ' +
      'Que possamos cruzar caminhos em outra oportunidade. 🙏\n\n' +
      '— Time Unifique',
    email_assunto: 'Sobre a vaga {{vaga_titulo}}',
    email_texto:
      'Olá, {{candidato_nome}},\n\n' +
      'Sobre a vaga {{vaga_titulo}}:\n\n' +
      '{{mensagem_personalizada}}\n\n' +
      'Agradecemos muito pelo seu tempo e por se candidatar à Unifique. ' +
      'Desejamos sucesso na sua jornada e seguimos à disposição para futuras oportunidades.\n\n' +
      'Atenciosamente,\n' +
      'Unifique — Recrutamento & Seleção',
  },
];

async function main() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Seed bloqueado em produção');
  }

  const admin = await prisma.usuario.upsert({
    where: { email: 'admin@unifique.com.br' },
    update: {},
    create: {
      azure_oid: '00000000-0000-0000-0000-000000000001',
      email: 'admin@unifique.com.br',
      nome: 'Admin de Desenvolvimento',
      papel: PapelUsuario.ADMIN,
      ativo: true,
    },
  });

  console.log('[seed] usuário admin garantido:', admin.email);

  for (const t of TEMPLATES_PADRAO) {
    await prisma.templateMensagem.upsert({
      where: { codigo: t.codigo },
      update: {}, // não sobrescreve edições do recrutador
      create: {
        codigo: t.codigo,
        nome: t.nome,
        descricao: t.descricao,
        versao: t.versao,
        ativo: true,
        whatsapp_corpo: t.whatsapp_corpo,
        email_assunto: t.email_assunto,
        email_texto: t.email_texto,
      },
    });
  }

  console.log(`[seed] ${TEMPLATES_PADRAO.length} templates de mensagem garantidos.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
