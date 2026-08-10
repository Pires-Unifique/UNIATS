import type { Artigo } from '../tipos';

export const ARTIGOS_COMECANDO: Artigo[] = [
  {
    slug: 'primeiros-passos',
    titulo: 'Primeiros passos no Collab',
    resumo:
      'O que a plataforma faz, como entrar e qual é o caminho de um candidato do começo ao fim.',
    secao: 'comecando',
    icone: '🚀',
    blocos: [
      {
        tipo: 'p',
        texto:
          'O **Collab** é a plataforma de Recrutamento & Seleção da Unifique. Ele puxa os candidatos da Gupy, ordena por aderência à vaga com apoio de IA, conduz a conversa com o candidato (WhatsApp e e-mail), agenda a entrevista no Teams e, depois da reunião, transcreve e analisa o que foi dito.',
      },
      {
        tipo: 'nota',
        tom: 'info',
        texto:
          'A Gupy continua sendo o sistema oficial da vaga e do funil. O Collab lê e escreve nela — mover um candidato de etapa aqui move na Gupy também.',
      },
      { tipo: 'titulo', texto: 'Entrar' },
      {
        tipo: 'passos',
        itens: [
          'Abra o Collab e clique em **Entrar com Microsoft**.',
          'Use a mesma conta do seu e-mail corporativo. Não existe cadastro nem senha própria da plataforma.',
          'No primeiro acesso seu usuário é criado automaticamente. Se você é gestor de alguma vaga na Gupy, as suas vagas já aparecem — ninguém precisa liberar nada.',
        ],
      },
      {
        tipo: 'p',
        texto:
          'Depois do login você cai na tela [Início](/inicio), que é o seu painel do dia.',
      },
      { tipo: 'titulo', texto: 'O caminho de um candidato' },
      {
        tipo: 'passos',
        itens: [
          '**Vagas** — as vagas vêm da Gupy sozinhas, de 6 em 6 horas. Você também pode sincronizar na hora.',
          '**Candidatos da vaga** — a IA lê os currículos e dá uma nota de 0 a 100 para ordenar quem olhar primeiro.',
          '**Ficha do candidato** — currículo estruturado, justificativa da nota com trechos citados, e as ações: contatar, mover de etapa, reprovar.',
          '**Agendamento** — proponha horários por WhatsApp (o voto do candidato confirma sozinho) ou agende direto num horário já combinado.',
          '**Depois da reunião** — a transcrição chega sozinha, e a IA responde pergunta a pergunta o que o candidato disse. Você confere pelo trecho citado.',
        ],
      },
      { tipo: 'titulo', texto: 'Coisas que ficam sempre à mão' },
      {
        tipo: 'lista',
        itens: [
          '🔔 **Sino** no topo — avisa quando um candidato escolhe horário e quando a análise de uma entrevista fica pronta.',
          '🌙 **Tema claro/escuro** — o botão de lua/sol no topo.',
          '❓ **Ajuda** — o “?” ao lado do título de cada tela abre o artigo daquela tela.',
        ],
      },
      {
        tipo: 'nota',
        tom: 'atencao',
        texto:
          'Se aparecer a tela **“Acesso desativado”**, sua conta existe mas foi desligada no Collab. Procure o DHO ou um administrador — não adianta tentar entrar de novo.',
      },
    ],
    relacionados: ['acessos-e-papeis', 'painel-inicio', 'problemas-comuns'],
  },

  {
    slug: 'acessos-e-papeis',
    titulo: 'Quem enxerga o quê',
    resumo:
      'Áreas de acesso, por que o gestor já vê a vaga dele sem pedir nada, e como solicitar mais acesso.',
    secao: 'comecando',
    icone: '🔑',
    blocos: [
      {
        tipo: 'p',
        texto:
          'O acesso no Collab é por **área**, não por cargo na empresa. Uma pessoa pode ter mais de uma área. Quem tem `admin` enxerga tudo.',
      },
      {
        tipo: 'tabela',
        colunas: ['Área', 'O que abre'],
        linhas: [
          [
            'Recrutamento',
            'Todas as vagas, publicar vaga, sincronizar a Gupy, catálogo de cargos, templates de mensagem e o painel de Análise.',
          ],
          [
            'Administração de Pessoas',
            'Perguntas padrão da empresa. (Os módulos de alteração contratual e offboarding existem, mas estão fora da navegação nesta fase.)',
          ],
          ['Admissão', 'Fila de admissões — também fora da navegação nesta fase.'],
          [
            'Gestão de Acessos',
            'Só a tela Usuários: libera e revoga acesso sem enxergar os processos. Quem só tem essa área cai direto em Usuários ao entrar.',
          ],
          ['Admin', 'Tudo, incluindo a seção Sistema (WhatsApp e Chaves de API).'],
        ],
      },
      { tipo: 'titulo', texto: 'Gestor de vaga não é uma área' },
      {
        tipo: 'p',
        texto:
          'Se você é o gestor (ou o recrutador) de uma vaga **na Gupy**, o Collab liga a vaga a você automaticamente pelo e-mail que vem de lá. Você passa a ver aquela vaga, os candidatos dela e a agenda das entrevistas dela — sem ninguém conceder acesso.',
      },
      {
        tipo: 'nota',
        tom: 'info',
        texto:
          'É por isso que o gestor vê um menu mais curto: ele enxerga **as vagas dele**, não a operação inteira. As telas de sincronizar, publicar e Análise exigem a área Recrutamento.',
      },
      { tipo: 'titulo', texto: 'Preciso de mais acesso — e agora?' },
      {
        tipo: 'lista',
        itens: [
          'Peça ao DHO ou a um administrador para incluir sua área na tela [Usuários](/configuracoes/usuarios).',
          'As áreas **Admin** e **Gestão de Acessos** só podem ser concedidas por quem já é admin.',
          'A mudança vale na hora — basta recarregar a página.',
        ],
      },
    ],
    relacionados: ['usuarios', 'primeiros-passos'],
  },
];
