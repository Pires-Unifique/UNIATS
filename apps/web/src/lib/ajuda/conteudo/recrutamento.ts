import type { Artigo } from '../tipos';

export const ARTIGOS_RECRUTAMENTO: Artigo[] = [
  {
    slug: 'painel-inicio',
    titulo: 'Painel de Início',
    resumo:
      'Os indicadores do topo, a agenda do dia e o que exatamente conta como pendência em “Precisa de você”.',
    secao: 'recrutamento',
    icone: '🏠',
    rotas: ['/inicio'],
    blocos: [
      {
        tipo: 'p',
        texto:
          'O Início é o seu pouso depois do login. Tudo nele é **escopado por você**: se você é recrutador de alguma vaga, vê os números das suas vagas; se não é, vê a visão geral (o subtítulo avisa qual dos dois está valendo).',
      },
      { tipo: 'titulo', texto: 'Os cinco indicadores' },
      {
        tipo: 'tabela',
        colunas: ['Indicador', 'O que conta'],
        linhas: [
          [
            'Vagas com você',
            'Vagas publicadas no seu escopo. A linha de baixo avisa quantas ainda não têm nenhuma candidatura.',
          ],
          [
            'Entrevistas hoje',
            'Tudo que está na agenda de hoje, com o horário da próxima que ainda vai acontecer.',
          ],
          [
            'Aguardando candidato',
            'Enquetes de horário enviadas e ainda sem voto. Destaca quantas passaram de 24 horas.',
          ],
          [
            'Novos candidatos · 7d',
            'Inscrições dos últimos 7 dias, comparadas com a semana anterior. O gráfico é a tendência de 14 dias.',
          ],
          [
            'Análises prontas',
            'Entrevistas cuja análise pós-reunião já ficou pronta e você ainda não abriu.',
          ],
        ],
      },
      { tipo: 'titulo', texto: 'Agenda de hoje' },
      {
        tipo: 'p',
        texto:
          'Lista as entrevistas do dia com horário, duração, candidato e vaga. O botão da direita muda conforme o momento: **Entrar na call** antes da reunião, **Ver análise** quando a análise já existe, e **Abrir** no resto dos casos. Entrevistas encerradas aparecem esmaecidas.',
      },
      { tipo: 'titulo', texto: '⚡ Precisa de você' },
      {
        tipo: 'p',
        texto:
          'Só aparece o que de fato está pendente — se estiver tudo em dia, o card fica vazio. Cada linha leva à lista **já filtrada**. As definições são exatas:',
      },
      {
        tipo: 'tabela',
        colunas: ['Pendência', 'Critério'],
        linhas: [
          [
            'Enquetes sem resposta há +24h',
            'Você propôs horários e o candidato não votou em mais de um dia.',
          ],
          [
            'Entrevistas sem parecer final',
            'Entrevistas finalizadas nos últimos 60 dias sem nenhuma anotação salva.',
          ],
          [
            'Candidaturas paradas há +7 dias',
            'Aprovadas na triagem e sem entrevista agendada há mais de uma semana.',
          ],
          ['No-shows para reagendar', 'Faltas dos últimos 7 dias.'],
          [
            'Vagas no ar sem candidatura',
            'Publicadas há mais de 14 dias e ainda sem ninguém inscrito.',
          ],
        ],
      },
      { tipo: 'titulo', texto: 'Vagas com mais movimento e funil' },
      {
        tipo: 'lista',
        itens: [
          'A tabela de vagas mostra candidaturas, **dias em aberto** (acima de 30 fica em destaque) e o maior score de IA da vaga.',
          'O funil cobre os últimos 30 dias e fecha com a conversão geral e a taxa de no-show.',
          'O link **Análise completa →** (só para a área Recrutamento) abre o painel com filtros de período, vaga e recrutador.',
        ],
      },
    ],
    relacionados: ['vagas', 'painel-analise', 'agendar-entrevista'],
  },

  {
    slug: 'vagas',
    titulo: 'Vagas',
    resumo:
      'Encontrar uma vaga, usar os filtros e entender o que o botão “Sincronizar Gupy” faz.',
    secao: 'recrutamento',
    icone: '📋',
    rotas: ['/vagas'],
    blocos: [
      {
        tipo: 'p',
        texto:
          'Esta é a lista das vagas importadas da Gupy. Por padrão ela mostra só as **publicadas** — troque no seletor de status para ver rascunhos, pausadas, encerradas ou tudo.',
      },
      { tipo: 'titulo', texto: 'Achar a vaga' },
      {
        tipo: 'lista',
        itens: [
          'A **busca** olha o título e o código interno da vaga.',
          'O botão **Filtros** abre gestor, recrutador, departamento, local e pendência. O número na bolinha diz quantos filtros estão ativos.',
          'O filtro de **pendência** usa as mesmas definições do card “Precisa de você” do Início — é para onde os links daquele card levam.',
        ],
      },
      { tipo: 'titulo', texto: 'Sincronizar Gupy' },
      {
        tipo: 'p',
        texto:
          'O botão só aparece para quem tem a área Recrutamento. Ele roda dois passos em sequência, mostrando o progresso: primeiro traz o **cadastro das vagas**, depois os **candidatos de todas as vagas**.',
      },
      {
        tipo: 'nota',
        tom: 'info',
        texto:
          'Não é preciso ficar sincronizando à mão: um sync automático roda **a cada 6 horas**. Use o botão quando publicou algo agora e quer ver na hora.',
      },
      {
        tipo: 'nota',
        tom: 'atencao',
        texto:
          'Em vagas com muitos candidatos a sincronização leva alguns minutos. Pode deixar a aba aberta e ir fazer outra coisa — ela mostra quantas vagas e quantas candidaturas já entraram.',
      },
      {
        tipo: 'p',
        texto:
          'Clicar em **Ver detalhes** abre a tela de candidatos daquela vaga, que é onde a triagem acontece.',
      },
    ],
    relacionados: ['candidatos-da-vaga', 'publicar-vaga', 'painel-inicio'],
  },

  {
    slug: 'candidatos-da-vaga',
    titulo: 'Candidatos da vaga (ranking)',
    resumo:
      'A nota da IA, o que significa “sem nota”, e como usar a classificação em lotes sem gastar à toa.',
    secao: 'recrutamento',
    icone: '🏅',
    rotas: ['/vagas/*/ranking'],
    blocos: [
      {
        tipo: 'p',
        texto:
          'É aqui que a triagem acontece. No topo ficam os dados da vaga (departamento, local, recrutador, gestor, descrição e requisitos). O botão **Ver na Gupy ↗** abre a página pública da vaga — o que o candidato enxerga.',
      },
      { tipo: 'titulo', texto: 'As três abas' },
      {
        tipo: 'p',
        texto:
          '**Candidatos** traz quem está ativo no processo. **Reprovados** e **Desistentes** ficam separados para não poluir a lista — na aba Reprovados, a última coluna mostra o **motivo da reprovação** (a decisão humana), não a justificativa da IA.',
      },
      { tipo: 'titulo', texto: 'A coluna Nota IA' },
      {
        tipo: 'tabela',
        colunas: ['O que aparece', 'Significa'],
        linhas: [
          [
            'Um número de 0 a 100',
            'A nota consolidada. Verde a partir de 70, âmbar a partir de 40, cinza abaixo disso.',
          ],
          [
            'sem nota',
            'O candidato tem currículo, mas a IA ainda não avaliou. Use “Avaliar quem está sem nota”.',
          ],
          [
            'sem currículo',
            'Não há currículo processado — a IA não tem o que ler. Sincronize a vaga com a Gupy.',
          ],
        ],
      },
      { tipo: 'titulo', texto: 'Classificar em lotes' },
      {
        tipo: 'p',
        texto:
          'O botão principal avalia **10 candidatos por vez**. Não é limitação de tela: cada avaliação é uma chamada de IA, e avaliar mil currículos de uma vez sairia caro e demorado sem necessidade.',
      },
      {
        tipo: 'passos',
        itens: [
          '**Classificação completa (top 10)** — passo 1 lê os currículos; passo 2 avalia os 10 mais parecidos com a vaga. Não inclui reprovados nem desistentes.',
          'Depois da primeira rodada o botão vira **Continuar avaliação (faltam N)** — desce na lista avaliando os próximos, sem nunca repetir quem já tem nota.',
          'Repita até achar gente suficiente. Não é preciso avaliar a lista toda.',
        ],
      },
      {
        tipo: 'p',
        texto: 'A setinha ▾ ao lado do botão tem mais duas opções:',
      },
      {
        tipo: 'lista',
        itens: [
          '**Classificar reprovados/desistentes** — a mesma avaliação, considerando também quem já foi descartado. Útil para resgatar alguém de um processo antigo.',
          '**Avaliar quem está sem nota** — vai direto na IA, sem depender da etapa de leitura dos currículos. É o caminho para destravar quando muita gente ficou “sem nota”.',
        ],
      },
      {
        tipo: 'nota',
        tom: 'atencao',
        texto:
          'Se a mensagem disser que **nenhum currículo pôde ser lido para comparação**, a etapa de leitura falhou (normalmente chave de API). Use “Avaliar quem está sem nota”, que não depende dela.',
      },
      { tipo: 'titulo', texto: 'Buscar e paginar' },
      {
        tipo: 'lista',
        itens: [
          'A busca por nome, e-mail ou cidade varre **todos** os candidatos da vaga, não só os que estão na tela.',
          'Em vagas grandes, o rodapé mostra “X de Y” e o botão **Carregar mais**.',
          '**Buscar candidatos da Gupy** traz apenas os candidatos desta vaga (mais rápido que sincronizar tudo).',
        ],
      },
    ],
    relacionados: ['ficha-do-candidato', 'como-a-ia-pontua', 'vagas'],
  },

  {
    slug: 'ficha-do-candidato',
    titulo: 'Ficha do candidato',
    resumo:
      'As três notas, a justificativa com evidências, o currículo e como mover ou reprovar na esteira da Gupy.',
    secao: 'recrutamento',
    icone: '👤',
    rotas: ['/candidaturas/*'],
    blocos: [
      {
        tipo: 'p',
        texto:
          'A ficha reúne tudo sobre uma candidatura: como a IA avaliou, o currículo, o histórico de conversa e as ações que movem o processo.',
      },
      { tipo: 'titulo', texto: 'As três notas do topo' },
      {
        tipo: 'tabela',
        colunas: ['Número', 'O que é'],
        linhas: [
          [
            'Nota final da IA',
            'A nota que ordena o ranking. Combina as outras duas (40% aderência + 60% análise).',
          ],
          [
            'Aderência à vaga',
            'Quanto o currículo se parece com a descrição e os requisitos, por comparação semântica.',
          ],
          [
            'Análise do currículo',
            'A avaliação da IA frente aos requisitos, com justificativa e trechos citados.',
          ],
        ],
      },
      {
        tipo: 'p',
        texto:
          'Cada número tem um **ⓘ** com a explicação — passe o mouse ou toque nele.',
      },
      { tipo: 'titulo', texto: 'Justificativa da IA' },
      {
        tipo: 'p',
        texto:
          'Abaixo das notas vêm o texto da avaliação, os **pontos fortes**, as **lacunas** e as **evidências citadas** — cada evidência traz o eixo avaliado e o trecho literal do currículo que sustenta a afirmação, marcado como positivo ou negativo.',
      },
      {
        tipo: 'nota',
        tom: 'info',
        texto:
          'Leia sempre as evidências antes de decidir. Elas existem justamente para você conferir se a IA entendeu certo — a nota sozinha não decide nada.',
      },
      { tipo: 'titulo', texto: 'Currículo' },
      {
        tipo: 'lista',
        itens: [
          'O bloco mostra o resumo feito pela IA, a estimativa de anos de experiência, as competências e as experiências.',
          '**Ver currículo completo** abre formação, idiomas, certificações e a descrição de cada experiência.',
          '**Abrir arquivo original ↗** aparece quando existe o arquivo enviado pelo candidato (PDF/DOCX).',
        ],
      },
      { tipo: 'titulo', texto: 'Esteira (Gupy)' },
      {
        tipo: 'p',
        texto:
          'Lista as etapas da vaga na ordem, com a atual destacada. Você move o candidato com **← Anterior** / **Próxima →**, ou clica em **Mover aqui** para pular direto para qualquer etapa. A mudança vai para a Gupy na hora.',
      },
      {
        tipo: 'nota',
        tom: 'atencao',
        texto:
          'Para **reprovar**, o motivo é obrigatório. Ele fica registrado na candidatura, aparece na aba Reprovados e é enviado à Gupy.',
      },
      { tipo: 'titulo', texto: 'Revisão humana — sem botão' },
      {
        tipo: 'nota',
        tom: 'lgpd',
        texto:
          'O selo do topo alterna entre **“Análise aguardando ação humana”** e **“✓ Análise revisada”**. Não existe botão de aprovar: a revisão é registrada sozinha quando você **age** sobre o candidato — mover de etapa, agendar entrevista ou reprovar. É o que a LGPD (Art. 20) exige de um processo com apoio de IA.',
      },
      { tipo: 'titulo', texto: 'Ações' },
      {
        tipo: 'lista',
        itens: [
          '**💬 Contatar** — abre o envio de mensagem por WhatsApp ou e-mail.',
          '**Propor horários** — manda a enquete de horários no WhatsApp.',
          '**Agendar entrevista** — marca direto num horário já combinado.',
          '**Recalcular score** — refaz a avaliação deste candidato (útil se o currículo chegou depois).',
        ],
      },
    ],
    relacionados: [
      'contatar-candidato',
      'agendar-entrevista',
      'como-a-ia-pontua',
      'candidatos-da-vaga',
    ],
  },

  {
    slug: 'contatar-candidato',
    titulo: 'Falar com o candidato',
    resumo:
      'Enviar WhatsApp ou e-mail a partir de um template, com pré-visualização antes de disparar.',
    secao: 'recrutamento',
    icone: '💬',
    blocos: [
      {
        tipo: 'p',
        texto:
          'O botão **💬 Contatar** da [ficha do candidato](/ajuda/ficha-do-candidato) abre a janela de envio. Você nunca escreve do zero: escolhe um template, preenche as variáveis e confere o resultado antes de mandar.',
      },
      {
        tipo: 'passos',
        itens: [
          'Escolha o **template** e o **canal** (WhatsApp ou e-mail). Cada template só oferece os canais que tem escritos.',
          'Confira as **variáveis**. As marcadas como *automático* (nome do candidato, título da vaga, seu nome) já vêm preenchidas.',
          'Leia a **pré-visualização** — é exatamente o texto que o candidato vai receber.',
          'Clique em **Enviar WhatsApp** ou **Enviar e-mail**.',
        ],
      },
      {
        tipo: 'nota',
        tom: 'info',
        texto:
          'Quando o template tem opções de horário (`opcao_1`, `opcao_2`…), aparece o atalho **📅 Escolher horários da minha agenda**: ele preenche as opções com horários livres seus, sem digitar nada.',
      },
      { tipo: 'titulo', texto: 'Quando o botão de enviar fica travado' },
      {
        tipo: 'lista',
        itens: [
          '**Alguma variável está vazia** — todas precisam estar preenchidas.',
          '**Candidato sem telefone** (para WhatsApp) ou **sem e-mail** — troque de canal.',
          '**Candidato pediu exclusão dos dados (LGPD)** — o envio é bloqueado e não há como contornar pela tela.',
        ],
      },
      {
        tipo: 'p',
        texto:
          'O envio entra numa fila; o resultado aparece no **Histórico de mensagens** da ficha, com o status evoluindo de enviado para entregue e lido. Se o WhatsApp falhar de forma definitiva e o candidato tiver e-mail, a plataforma tenta o e-mail sozinha.',
      },
      {
        tipo: 'nota',
        tom: 'atencao',
        texto:
          'Se as mensagens pararem de sair, olhe a tela [WhatsApp](/configuracoes/whatsapp) da seção Sistema — normalmente é a sessão que caiu ou o teto diário de envios que fechou.',
      },
    ],
    relacionados: ['templates', 'agendar-entrevista', 'whatsapp'],
  },

  {
    slug: 'agendar-entrevista',
    titulo: 'Agendar a entrevista',
    resumo:
      'Os dois caminhos — enquete de horários no WhatsApp ou agendamento direto — e o que cada um faz na sua agenda.',
    secao: 'recrutamento',
    icone: '🗓️',
    rotas: ['/entrevistas'],
    blocos: [
      {
        tipo: 'p',
        texto:
          'Existem dois jeitos de marcar, os dois a partir da ficha do candidato. A diferença é quem escolhe o horário.',
      },
      { tipo: 'titulo', texto: 'Caminho 1 — Propor horários (recomendado)' },
      {
        tipo: 'passos',
        itens: [
          'Clique em **Propor horários** e selecione de **2 a 5** horários livres na agenda embutida.',
          'Convide quem mais precisa participar — o gestor da vaga já vem sugerido. A disponibilidade dos convidados entra no cálculo.',
          'Envie. O candidato recebe uma **enquete no WhatsApp** e vota no horário que preferir.',
          'O voto **confirma a reunião sozinho**: a sala do Teams é criada, os outros horários são liberados e você é avisado pelo sino.',
        ],
      },
      {
        tipo: 'nota',
        tom: 'info',
        texto:
          'Enquanto o candidato não vota, os horários propostos ficam **pré-reservados** na sua agenda e na dos convidados — assim ninguém marca outra coisa por cima. Ao confirmar, sobra só o horário escolhido.',
      },
      {
        tipo: 'p',
        texto:
          'O **link da call** é enviado ao candidato até 2 horas antes da reunião, não no momento do voto.',
      },
      { tipo: 'titulo', texto: 'Caminho 2 — Agendar direto' },
      {
        tipo: 'p',
        texto:
          'Use quando o horário já foi combinado por outro meio. Escolha o horário na agenda e defina a sala:',
      },
      {
        tipo: 'lista',
        itens: [
          '**Gerar automaticamente no Teams** (padrão) — cria a reunião, bloqueia a agenda e envia o convite ao candidato pelo Outlook.',
          '**Informar um link manualmente** — cole um link HTTPS de Meet ou Teams que você já tem.',
        ],
      },
      {
        tipo: 'nota',
        tom: 'lgpd',
        texto:
          'A caixa de **consentimento de gravação** vem marcada: ela declara que o candidato foi informado no convite e concorda com a gravação. Desmarque se ainda não houve esse aviso.',
      },
      { tipo: 'titulo', texto: 'A tela Agenda' },
      {
        tipo: 'p',
        texto:
          'Lista as entrevistas das suas vagas, filtradas por status. O filtro **Finalizadas sem parecer** é o mesmo da pendência “Entrevistas sem parecer final” do Início.',
      },
    ],
    relacionados: ['entrevista-e-transcricao', 'contatar-candidato', 'painel-inicio'],
  },

  {
    slug: 'entrevista-e-transcricao',
    titulo: 'Durante e depois da entrevista',
    resumo:
      'Roteiro de perguntas, análise das respostas com citação, anotações e como ler a transcrição.',
    secao: 'recrutamento',
    icone: '🎙️',
    rotas: ['/entrevistas/*'],
    blocos: [
      {
        tipo: 'p',
        texto:
          'A tela da entrevista serve antes (montar o roteiro), durante (anotar) e depois (ler a transcrição e a análise). Dá para recolher qualquer seção — e a preferência fica salva no seu navegador.',
      },
      { tipo: 'titulo', texto: 'Roteiro de perguntas' },
      {
        tipo: 'lista',
        itens: [
          '**Gerar com IA** monta perguntas a partir do currículo do candidato e dos requisitos da vaga. Cada uma vem com objetivo, competência, dificuldade e “Sinais a buscar”.',
          '**+ Adicionar** cria uma pergunta sua, marcada como **manual** (borda verde).',
          'Gerar novamente **substitui só as perguntas de IA** — as manuais permanecem.',
        ],
      },
      {
        tipo: 'nota',
        tom: 'info',
        texto:
          'As [perguntas padrão da empresa](/configuracoes/perguntas) não aparecem no roteiro, mas entram automaticamente na análise pós-reunião de toda entrevista.',
      },
      { tipo: 'titulo', texto: 'Respostas do candidato (✨ IA)' },
      {
        tipo: 'p',
        texto:
          'Com a transcrição pronta, **Analisar respostas** confronta o roteiro com as falas da reunião e diz o que o candidato respondeu em cada pergunta:',
      },
      {
        tipo: 'tabela',
        colunas: ['Marcação', 'Significa'],
        linhas: [
          ['✓ respondida', 'O candidato respondeu a pergunta.'],
          ['◐ parcial', 'Respondeu por alto ou só em parte.'],
          [
            'tema abordado — sem resposta do candidato',
            'O assunto apareceu na conversa, mas quem falou foi outra pessoa.',
          ],
        ],
      },
      {
        tipo: 'p',
        texto:
          'As perguntas que ninguém tocou ficam recolhidas no rodapé do card. Use **Reanalisar** depois de acrescentar perguntas novas.',
      },
      {
        tipo: 'nota',
        tom: 'atencao',
        texto:
          'Toda resposta traz **“Ver trecho da conversa”** com a citação literal. Confira por ela antes de usar a síntese numa decisão — é uma sugestão de IA, não um fato apurado.',
      },
      { tipo: 'titulo', texto: 'Anotações' },
      {
        tipo: 'p',
        texto:
          'O bloco de anotações salva sozinho quando você clica fora do campo. É ele que a pendência “Entrevistas sem parecer final” procura.',
      },
      { tipo: 'titulo', texto: 'Transcrição' },
      {
        tipo: 'lista',
        itens: [
          'As falas vêm separadas por participante, com cor e marca de tempo.',
          'O **Resumo da entrevista** (a ATA) fica em destaque, com os tópicos tratados.',
          'O selo **✨ versão revisada** significa que dois motores de transcrição foram reconciliados por IA — é o que corrige o português virando inglês fonético.',
          'No fim há o texto cru, recolhido, para conferência.',
        ],
      },
      {
        tipo: 'nota',
        tom: 'lgpd',
        texto:
          'Uma pílula 🔒 **[OCULTADO: …]** marca onde havia um dado sensível. Ele é removido **antes** de a transcrição ser salva — não está guardado em lugar nenhum da plataforma, e não há como revelá-lo.',
      },
    ],
    relacionados: ['agendar-entrevista', 'perguntas-padrao', 'lgpd-na-pratica'],
  },
];
