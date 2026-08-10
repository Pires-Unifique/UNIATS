import type { Artigo } from '../tipos';

export const ARTIGOS_SISTEMA: Artigo[] = [
  {
    slug: 'usuarios',
    titulo: 'Usuários e acessos',
    resumo:
      'Pré-liberar alguém, conceder áreas e desativar um acesso — e o que já funciona sozinho.',
    secao: 'sistema',
    icone: '👥',
    areas: ['admin', 'gestao_acessos'],
    rotas: ['/configuracoes/usuarios'],
    blocos: [
      {
        tipo: 'nota',
        tom: 'info',
        texto:
          'Boa parte do acesso **já funciona sozinha**: quem entra com a conta Microsoft é cadastrado na hora e, se for gestor de vaga na Gupy, já enxerga as vagas dele. Esta tela é para os acessos **amplos**, que ninguém ganha automaticamente.',
      },
      { tipo: 'titulo', texto: 'Pré-liberar acesso' },
      {
        tipo: 'p',
        texto:
          'Informe o e-mail corporativo e marque as áreas. A pessoa recebe essas áreas no primeiro login — não precisa esperar ela entrar para depois configurar.',
      },
      {
        tipo: 'lista',
        itens: [
          'O nome é opcional: é atualizado com o nome real no primeiro login.',
          '**Admin** e **Gestão de Acessos** só aparecem para quem já é admin.',
          'Conceder uma área a quem já entrou vale imediatamente — basta a pessoa recarregar a página.',
        ],
      },
      { tipo: 'titulo', texto: 'Desativar' },
      {
        tipo: 'p',
        texto:
          'Desativar bloqueia o acesso: a pessoa até autentica no Microsoft, mas o Collab responde com a tela **“Acesso desativado”**. É o caminho para desligamentos e afastamentos — preserva o histórico, ao contrário de apagar.',
      },
      {
        tipo: 'nota',
        tom: 'atencao',
        texto:
          'Alguns admins são garantidos por configuração do ambiente. Tirar a área `admin` deles pela tela não adianta: volta no próximo login. Nesses casos, a mudança é na configuração do servidor.',
      },
    ],
    relacionados: ['acessos-e-papeis'],
  },

  {
    slug: 'whatsapp',
    titulo: 'Conexão do WhatsApp',
    resumo:
      'Estado da sessão, pareamento por QR e as proteções contra banimento do número.',
    secao: 'sistema',
    icone: '📱',
    areas: ['admin'],
    rotas: ['/configuracoes/whatsapp'],
    blocos: [
      {
        tipo: 'p',
        texto:
          'É por esta conexão que passam as mensagens, as enquetes de horário e os arquivos enviados aos candidatos. **Se a sessão cai, todos os envios param** — e é aqui que você resolve, sem acessar o servidor.',
      },
      { tipo: 'titulo', texto: 'Sessão' },
      {
        tipo: 'p',
        texto:
          'O card mostra o número conectado, o nome de exibição, a sessão e quando chegou o último evento. **Atualizar** relê o estado; **Reiniciar sessão** derruba e reconecta.',
      },
      {
        tipo: 'nota',
        tom: 'atencao',
        texto:
          'Se o aviso disser que o WhatsApp está **conectado mas parou de responder**, reiniciar a sessão pela tela **não resolve** — é preciso reiniciar o container do WhatsApp no servidor. O aviso aparece porque esse estado já enganou gente antes: tudo parece verde e nada é entregue.',
      },
      { tipo: 'titulo', texto: 'Parear aparelho' },
      {
        tipo: 'p',
        texto:
          'Quando não há sessão, a tela mostra o **QR Code** para ler com o WhatsApp do número operacional (Aparelhos conectados → Conectar aparelho). Não é preciso túnel nem acesso ao servidor.',
      },
      { tipo: 'titulo', texto: 'Configurações de envio (anti-banimento)' },
      {
        tipo: 'p',
        texto:
          'O número usado é uma conta comum de WhatsApp e pode ser banido se disparar rápido demais. O **pacing** existe para reduzir esse risco:',
      },
      {
        tipo: 'lista',
        itens: [
          '**Janela** — faixa de horário em que os envios acontecem. Fora dela, as mensagens ficam na fila.',
          '**Teto diário** — máximo de mensagens por dia (0 desliga o limite).',
          '**Intervalo entre envios** — espaçamento com variação, para não parecer robô.',
        ],
      },
      {
        tipo: 'nota',
        tom: 'info',
        texto:
          'Número novo ou recém-recuperado: comece com teto de ~30 a 50 por dia e suba aos poucos, semana a semana, conforme ele “esquenta”. O card de sessão mostra quantas já saíram hoje e se a janela está aberta.',
      },
    ],
    relacionados: ['contatar-candidato', 'problemas-comuns'],
  },

  {
    slug: 'chaves-api',
    titulo: 'Chaves de API',
    resumo:
      'Acesso de máquina (integrações, BI, scripts) à API do Collab, com escopo e revogação.',
    secao: 'sistema',
    icone: '🔑',
    areas: ['admin'],
    rotas: ['/configuracoes/chaves-api'],
    blocos: [
      {
        tipo: 'p',
        texto:
          'Chaves de API servem para **sistemas**, não para pessoas. Uma integração, um script ou uma ferramenta de BI usa a chave no cabeçalho `x-api-key` e recebe apenas os dados dos escopos marcados.',
      },
      {
        tipo: 'passos',
        itens: [
          'Dê um nome que diga para que serve — “Integração UNIIT — leitura de vagas” é melhor que “chave 2”.',
          'Marque só os escopos necessários. Não existe escopo `admin` para chave: acesso total é só de gente logada.',
          'Defina validade quando for um uso temporário.',
          '**Copie a chave na hora.** Ela aparece uma única vez.',
        ],
      },
      {
        tipo: 'nota',
        tom: 'atencao',
        texto:
          'A chave completa **não é guardada** — a plataforma armazena só o hash e um prefixo para você identificá-la na lista. Se perder, não há como recuperar: revogue e gere outra.',
      },
      {
        tipo: 'p',
        texto:
          'A lista mostra o último uso de cada chave — é o jeito de descobrir quais estão abandonadas. Revogar corta o acesso imediatamente e mantém o registro de que a chave existiu.',
      },
    ],
    relacionados: ['usuarios'],
  },
];
