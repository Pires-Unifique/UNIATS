import type { Artigo } from '../tipos';

export const ARTIGOS_ENTENDA: Artigo[] = [
  {
    slug: 'como-a-ia-pontua',
    titulo: 'Como a IA monta a nota',
    resumo:
      'De onde vêm os 0 a 100, o que a nota não significa e por que ela nunca decide sozinha.',
    secao: 'entenda',
    icone: '✨',
    blocos: [
      {
        tipo: 'p',
        texto:
          'A **nota final** de um candidato é a média ponderada de duas medidas diferentes, calculadas de formas independentes:',
      },
      {
        tipo: 'tabela',
        colunas: ['Parte', 'Peso', 'Como sai'],
        linhas: [
          [
            'Aderência à vaga',
            '40%',
            'Comparação semântica entre o texto do currículo e o texto da vaga. Mede parecença geral, não requisito específico.',
          ],
          [
            'Análise do currículo',
            '60%',
            'A IA lê os requisitos e o currículo, dá uma nota, escreve a justificativa e cita os trechos que a sustentam.',
          ],
        ],
      },
      {
        tipo: 'p',
        texto:
          'A análise pesa mais porque a comparação semântica sozinha ignora requisito obrigatório: um currículo pode “parecer” muito com a vaga e não ter a CNH exigida. Quando a etapa de comparação não roda, a nota final passa a ser só a da análise — por isso o mesmo candidato pode ter nota sem ter aderência.',
      },
      { tipo: 'titulo', texto: 'O que a nota NÃO é' },
      {
        tipo: 'lista',
        itens: [
          '**Não é uma decisão.** Nada acontece com o candidato por causa da nota — ninguém é reprovado automaticamente.',
          '**Não é uma medida de qualidade da pessoa.** É a distância entre o que está escrito no currículo e o que está escrito na vaga.',
          '**Não é comparável entre vagas.** 82 numa vaga e 82 em outra não querem dizer a mesma coisa; a nota serve para ordenar dentro da mesma vaga.',
        ],
      },
      {
        tipo: 'nota',
        tom: 'atencao',
        texto:
          'Requisito mal descrito na vaga produz nota ruim em candidato bom. Se o ranking parecer estranho, o primeiro lugar para olhar é o texto dos requisitos — não o candidato.',
      },
      { tipo: 'titulo', texto: 'A revisão humana' },
      {
        tipo: 'p',
        texto:
          'A LGPD (Art. 20) dá ao candidato o direito de revisão por uma pessoa quando há decisão apoiada em tratamento automatizado. No Collab isso é registrado sozinho: quando você **move o candidato de etapa, agenda uma entrevista ou reprova**, fica gravado que um humano avaliou aquele caso. Por isso não existe botão de “aprovar análise”.',
      },
      {
        tipo: 'p',
        texto:
          'A IA também é usada em outros dois lugares, sempre como sugestão: para **gerar o roteiro de perguntas** e para **dizer o que o candidato respondeu** na entrevista — este último sempre com o trecho literal da conversa junto, para você conferir.',
      },
    ],
    relacionados: ['ficha-do-candidato', 'candidatos-da-vaga', 'lgpd-na-pratica'],
  },

  {
    slug: 'lgpd-na-pratica',
    titulo: 'LGPD no dia a dia',
    resumo:
      'O que a plataforma apaga sozinha, o que ela nunca guarda e o que depende de você.',
    secao: 'entenda',
    icone: '🔒',
    blocos: [
      {
        tipo: 'p',
        texto:
          'Recrutamento lida com dado pessoal o tempo todo. Boa parte das obrigações o Collab cumpre sozinho — vale saber quais, para não desfazer sem querer.',
      },
      { tipo: 'titulo', texto: 'O que a plataforma faz por você' },
      {
        tipo: 'lista',
        itens: [
          '**Censura antes de salvar** — a transcrição passa por duas camadas de remoção de dado sensível (documentos, contatos, saúde, religião, opinião política e afins) **antes** de ir para o banco. O que você vê como 🔒 [OCULTADO: …] nunca foi guardado.',
          '**Minimização na entrada** — a plataforma só importa da Gupy os campos que usa. CPF, data de nascimento, gênero, raça e deficiência não entram.',
          '**Retenção** — as transcrições têm prazo de validade e são truncadas automaticamente quando ele vence.',
          '**Registro de auditoria** — cada apagamento e cada acesso a dado sensível fica registrado.',
        ],
      },
      { tipo: 'titulo', texto: 'O que depende de você' },
      {
        tipo: 'lista',
        itens: [
          'Avisar o candidato **antes** de gravar a reunião, e só então marcar o consentimento de gravação no agendamento.',
          'Escrever o **motivo real** ao reprovar — ele é o registro da decisão humana.',
          'Não copiar trechos de transcrição para fora da plataforma sem necessidade: fora daqui, a censura e a retenção não valem.',
        ],
      },
      {
        tipo: 'nota',
        tom: 'lgpd',
        texto:
          'O selo **“Geral: pendente”** no bloco de consentimentos da ficha não significa que falta base legal. O aceite é colhido na Gupy, no momento da inscrição, e não chega ao Collab. O tratamento da candidatura se apoia no Art. 7º V (procedimentos preliminares de contrato), não em consentimento.',
      },
      {
        tipo: 'nota',
        tom: 'atencao',
        texto:
          'Se um candidato pedir a exclusão dos dados dele, fale com o DHO. O envio de mensagens é bloqueado para quem está marcado como excluído, mas o pedido em si não é processado pela tela.',
      },
    ],
    relacionados: ['como-a-ia-pontua', 'entrevista-e-transcricao'],
  },

  {
    slug: 'problemas-comuns',
    titulo: 'Quando algo não funciona',
    resumo:
      'As dúvidas que mais aparecem — vaga que não aparece, candidato sem nota, mensagem que não sai.',
    secao: 'entenda',
    icone: '🛠️',
    blocos: [
      { tipo: 'titulo', texto: 'Não aparece nenhuma vaga para mim' },
      {
        tipo: 'p',
        texto:
          'Se você é gestor, enxerga só as vagas em que **está registrado como gestor na Gupy** — o vínculo é feito pelo e-mail que vem de lá. Se o e-mail cadastrado na Gupy for diferente do corporativo, o vínculo não acontece. Peça ao recrutador para corrigir na vaga, ou solicite a área Recrutamento se o seu caso é outro.',
      },
      { tipo: 'titulo', texto: 'O candidato aparece como “sem nota”' },
      {
        tipo: 'p',
        texto:
          'Significa que há currículo, mas a IA ainda não avaliou aquele candidato — normal, já que a avaliação roda em lotes de 10. Use **Continuar avaliação** para descer na lista, ou a opção **Avaliar quem está sem nota** do menu ▾ para pegar só os pendentes.',
      },
      { tipo: 'titulo', texto: 'O candidato aparece como “sem currículo”' },
      {
        tipo: 'p',
        texto:
          'A candidatura chegou sem o currículo processado, e sem ele não há o que avaliar. Rode **Buscar candidatos da Gupy** na tela da vaga. Se continuar assim depois da sincronização, avise o time técnico.',
      },
      { tipo: 'titulo', texto: 'A mensagem não chegou no WhatsApp' },
      {
        tipo: 'lista',
        itens: [
          'Veja o **Histórico de mensagens** na ficha: se o status parou em pendente, ela está na fila.',
          'Abra [WhatsApp](/configuracoes/whatsapp) (seção Sistema): a sessão pode ter caído, a janela de envio pode estar fechada ou o teto diário atingido.',
          'Se a sessão aparece conectada mas nada é entregue, é o caso de reiniciar o serviço no servidor — a tela avisa quando detecta isso.',
        ],
      },
      { tipo: 'titulo', texto: 'A transcrição da entrevista não apareceu' },
      {
        tipo: 'lista',
        itens: [
          'A transcrição é puxada **depois** que a reunião termina, e leva alguns minutos.',
          'Ela só existe para reuniões criadas pelo Collab no Teams. Se você agendou colando um **link manual**, não há transcrição automática.',
          'Reuniões muito curtas ou sem fala gravada podem não gerar transcrição nenhuma.',
        ],
      },
      { tipo: 'titulo', texto: 'O candidato votou na enquete e nada aconteceu' },
      {
        tipo: 'p',
        texto:
          'O voto costuma confirmar a reunião sozinho. Se a ficha mostrar **“Candidato escolheu”** com o botão **✓ Confirmar no Teams** disponível, é só clicar — a reunião é criada e o convite sai na hora.',
      },
      { tipo: 'titulo', texto: 'Fui jogado para a tela de login no meio do uso' },
      {
        tipo: 'p',
        texto:
          'A sessão do Microsoft expirou. Entre de novo — nada do que você fez se perde, e as anotações da entrevista são salvas ao sair do campo.',
      },
      {
        tipo: 'nota',
        tom: 'info',
        texto:
          'Não achou aqui? Fale com o time de Recrutamento ou com o DHO. Para falhas da plataforma, descreva a tela, o horário e o que apareceu na mensagem de erro — isso encurta muito o diagnóstico.',
      },
    ],
    relacionados: ['candidatos-da-vaga', 'whatsapp', 'entrevista-e-transcricao'],
  },
];
