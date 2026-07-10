-- Análise de respostas ganha duas dimensões:
--   status        → o CANDIDATO respondeu? (já existia)
--   tema_abordado → o tema apareceu na conversa por QUALQUER participante?
--   falante       → quem tratou do tema (nome no transcript)
-- Permite mostrar "tema abordado na conversa, mas não pelo candidato" (ex.:
-- entrevistador respondeu a própria pergunta) sem esconder atrás de "não abordada".
-- Aditiva: colunas novas, nullable/default.

ALTER TABLE "respostas_entrevista"
  ADD COLUMN "tema_abordado" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "falante" TEXT;

-- Linhas já analisadas: quem tinha resposta do candidato obviamente teve o tema
-- abordado (reanálises futuras preenchem o falante).
UPDATE "respostas_entrevista" SET "tema_abordado" = true WHERE "status" <> 'NAO_ABORDADA';
