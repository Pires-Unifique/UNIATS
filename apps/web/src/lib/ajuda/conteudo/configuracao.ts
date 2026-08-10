import type { Artigo } from '../tipos';

export const ARTIGOS_CONFIGURACAO: Artigo[] = [
  {
    slug: 'cargos',
    titulo: 'Catálogo de cargos',
    resumo:
      'O cadastro de cargos que alimenta a descrição da vaga na hora de publicar.',
    secao: 'configuracao',
    icone: '🏷️',
    areas: ['recrutamento'],
    rotas: ['/cargos'],
    blocos: [
      {
        tipo: 'p',
        texto:
          'O catálogo guarda os cargos da empresa com a **descrição oficial** de cada um. É dele que a tela de publicar vaga puxa o texto, para não recomeçar do zero a cada abertura.',
      },
      {
        tipo: 'lista',
        itens: [
          'Cada cargo tem título, código interno (opcional), senioridade e descrição.',
          'A busca filtra por título; o seletor permite incluir os inativos.',
          'Desativar um cargo o tira das listas sem apagar o histórico de quem já o usou.',
        ],
      },
      {
        tipo: 'nota',
        tom: 'info',
        texto:
          'Cargo sem descrição publica do mesmo jeito, mas você vai ter que escrever a descrição na mão toda vez. Vale investir uma vez aqui.',
      },
    ],
    relacionados: ['publicar-vaga'],
  },

  {
    slug: 'publicar-vaga',
    titulo: 'Publicar uma vaga',
    resumo:
      'Do cargo do catálogo até a vaga no ar na Gupy — incluindo o que dá para salvar como rascunho.',
    secao: 'configuracao',
    icone: '➕',
    areas: ['recrutamento'],
    rotas: ['/vagas/publicar'],
    blocos: [
      {
        tipo: 'p',
        texto:
          'A publicação acontece **na Gupy** — o Collab só monta o formulário e envia. A tela tem três blocos, que aparecem conforme você avança.',
      },
      {
        tipo: 'passos',
        itens: [
          '**Cargo do catálogo** — escolha o cargo. O título, a descrição e o código são pré-preenchidos a partir dele.',
          '**Conteúdo da vaga** — ajuste o texto para esta abertura. Responsabilidades e requisitos são opcionais, um item por linha.',
          '**Estrutura e publicação na Gupy** — departamento e cargo (role) são obrigatórios; a filial é opcional. Informe também a data limite de contratação.',
        ],
      },
      {
        tipo: 'p',
        texto:
          'Os campos de departamento, role e filial buscam direto na Gupy: clique no campo, digite e escolha na lista. O role já vem com o título do cargo sugerido na busca.',
      },
      { tipo: 'titulo', texto: 'Publicar ou guardar' },
      {
        tipo: 'lista',
        itens: [
          '**Publicar agora** — a vaga entra no ar e passa a receber candidaturas.',
          '**Salvar rascunho na Gupy** — cria a vaga sem publicar, para revisar antes.',
        ],
      },
      {
        tipo: 'nota',
        tom: 'info',
        texto:
          'Preencher **e-mail do recrutador** e **e-mail do gestor** é o que faz essas pessoas enxergarem a vaga no Collab automaticamente. Vale sempre a pena.',
      },
    ],
    relacionados: ['cargos', 'vagas', 'acessos-e-papeis'],
  },

  {
    slug: 'templates',
    titulo: 'Templates de mensagem',
    resumo:
      'Criar e editar os textos de WhatsApp e e-mail — sem depender de deploy.',
    secao: 'configuracao',
    icone: '✉️',
    areas: ['recrutamento'],
    rotas: ['/configuracoes/templates'],
    blocos: [
      {
        tipo: 'p',
        texto:
          'Os templates são os textos que você dispara ao candidato. Ficam salvos na plataforma e podem ser editados a qualquer momento — não é preciso pedir nada para a TI.',
      },
      { tipo: 'titulo', texto: 'Variáveis' },
      {
        tipo: 'p',
        texto:
          'Trechos como `{{candidato_nome}}` são substituídos no envio. Você **não precisa declarar** quais variáveis o template usa: elas são deduzidas do texto. Ao escrever, clique nos botões **+ Nome do candidato**, **+ Título da vaga** etc. e a variável é inserida no ponto do cursor.',
      },
      {
        tipo: 'nota',
        tom: 'info',
        texto:
          'As variáveis destacadas são **automáticas** — vêm preenchidas na hora do envio. As demais você digita no momento de contatar o candidato.',
      },
      { tipo: 'titulo', texto: 'Modelos prontos' },
      {
        tipo: 'p',
        texto:
          'Ao criar um template novo, há modelos prontos para partir de algo escrito — o de **Proposta de horários** já vem com as opções `opcao_1`, `opcao_2` e `opcao_3`, que a agenda preenche sozinha.',
      },
      { tipo: 'titulo', texto: 'Editar e desativar' },
      {
        tipo: 'lista',
        itens: [
          'Cada edição **incrementa a versão** do template. As mensagens já enviadas guardam a versão usada, então o histórico não é reescrito.',
          'Desativar preserva o histórico e só tira o template da lista de envio.',
          'O código do template (`convite_triagem`, por exemplo) é o identificador estável — escolha com calma, ele aparece no histórico.',
        ],
      },
    ],
    relacionados: ['contatar-candidato', 'agendar-entrevista'],
  },

  {
    slug: 'perguntas-padrao',
    titulo: 'Perguntas padrão da empresa',
    resumo:
      'O banco de perguntas institucionais que a IA verifica em toda entrevista.',
    secao: 'configuracao',
    icone: '❓',
    areas: ['recrutamento', 'dho'],
    rotas: ['/configuracoes/perguntas'],
    blocos: [
      {
        tipo: 'p',
        texto:
          'São as perguntas que valem para **todo mundo** — cultura, valores, disponibilidade. Enquanto ativas, entram automaticamente na análise pós-reunião de todas as entrevistas: a IA procura na transcrição o que o candidato respondeu para cada uma.',
      },
      {
        tipo: 'lista',
        itens: [
          'Cada pergunta tem objetivo (o que você quer descobrir), competência (o eixo avaliado) e categoria (agrupamento livre).',
          'A pergunta precisa ter pelo menos 10 caracteres.',
          'A ordem define a sequência em que aparecem na análise.',
        ],
      },
      {
        tipo: 'nota',
        tom: 'info',
        texto:
          'Elas **não aparecem** no roteiro da entrevista — o roteiro é específico da vaga e do candidato. As padrão entram só na hora da análise, somadas ao roteiro.',
      },
      {
        tipo: 'nota',
        tom: 'atencao',
        texto:
          'Desativar ou editar uma pergunta **não reescreve o histórico**: as análises já feitas guardam o texto que foi usado na época. A mudança vale das próximas em diante.',
      },
    ],
    relacionados: ['entrevista-e-transcricao'],
  },

  {
    slug: 'painel-analise',
    titulo: 'Painel de Análise',
    resumo:
      'Funil, time-to-hire, no-show e volume por recrutador e por vaga.',
    secao: 'configuracao',
    icone: '📊',
    areas: ['recrutamento'],
    rotas: ['/analise'],
    blocos: [
      {
        tipo: 'p',
        texto:
          'O painel analítico de gestão do recrutamento — o item **Análise** do menu. Tudo respeita os filtros do topo: **período** (com atalhos de 30 dias, 90 dias, 12 meses e tudo), **vaga** e **recrutador**.',
      },
      { tipo: 'titulo', texto: 'Os indicadores' },
      {
        tipo: 'tabela',
        colunas: ['Indicador', 'Como é calculado'],
        linhas: [
          ['Conversão geral', 'Contratados ÷ inscritos no período.'],
          ['Time-to-hire', 'Média de dias da inscrição até a contratação.'],
          [
            'No-show',
            'Faltas ÷ (faltas + entrevistas realizadas). Fica vermelho a partir de 20%.',
          ],
          [
            'Agendadas (futuro)',
            'Entrevistas já marcadas para uma data que ainda não chegou.',
          ],
        ],
      },
      { tipo: 'titulo', texto: 'Os blocos' },
      {
        tipo: 'lista',
        itens: [
          '**Funil de recrutamento** — volume por etapa, com a taxa de conversão de uma etapa para a seguinte.',
          '**Entrevistas** — distribuição por status no período.',
          '**Tempos médios por etapa** — cada marco traz o tamanho da amostra; desconfie de média com amostra pequena.',
          '**Volume por recrutador** e **Qualidade e volume por vaga** — este último inclui o score médio da IA na vaga.',
        ],
      },
      {
        tipo: 'nota',
        tom: 'info',
        texto:
          'No rodapé, o bloco **“Sobre as métricas”** explica as limitações do recorte atual. Vale ler antes de levar um número para uma reunião.',
      },
    ],
    relacionados: ['painel-inicio', 'como-a-ia-pontua'],
  },
];
