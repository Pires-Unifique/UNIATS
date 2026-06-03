/**
 * Fixtures determinísticas para testes do módulo Gupy.
 * Todos os IDs são fictícios — NÃO usar em chamadas reais à API.
 */

export const vagaFakeJson = {
  id: 987654,
  code: 'VAGA-001',
  name: 'Engenheiro(a) de Software Pleno',
  description: 'Desenvolvimento de plataforma interna em Node.js + React.',
  department: { name: 'Tecnologia da Informação' },
  branch: { name: 'Timbó - Matriz' },
  city: 'Timbó',
  state: 'SC',
  type: 'CLT',
  isRemoteWork: true,
  status: 'published',
  publishedDate: '2026-05-01T12:00:00.000-03:00',
  closingDate: null,
  customFields: [
    {
      id: 'cf-1',
      title: 'Conhecimentos obrigatórios',
      value: 'Node.js, TypeScript, PostgreSQL',
    },
    {
      id: 'cf-2',
      title: 'Anos de experiência',
      value: '3+',
    },
    {
      id: 'cf-3',
      title: 'Idioma',
      value: 'Inglês intermediário',
    },
  ],
  // Campo desconhecido — schema é .passthrough(), não pode rejeitar.
  campoDesconhecido: 'futureproof',
};

export const candidatoFakeJson = {
  id: 11223344,
  name: 'Maria Aparecida Silva',
  email: 'maria.silva@example.com',
  phone: '+5547999990000',
  linkedinUrl: 'https://linkedin.com/in/mariaaparecida',
  city: 'Blumenau',
  state: 'SC',
};

export const candidaturaFakeJson = {
  id: 5544332211,
  jobId: 987654,
  candidate: candidatoFakeJson,
  currentStep: { name: 'Triagem' },
  status: 'in_analysis',
  disqualifiedReason: null,
  appliedAt: '2026-05-10T09:30:00.000-03:00',
  movedAt: '2026-05-12T15:45:00.000-03:00',
  resumeUrl: 'https://gupy-cv-storage.example.com/cv/abc-123.pdf',
};

export const candidaturaSemCvFakeJson = {
  ...candidaturaFakeJson,
  id: 5544332299,
  resumeUrl: null,
};

// A API real da Gupy (api.gupy.io/api/v1) devolve o envelope
// { results, totalResults, page, totalPages } — o client normaliza p/ { data }.
export const respostaPaginadaVagas = (page = 1, totalPages = 1) => ({
  results: [vagaFakeJson],
  totalResults: 1,
  page,
  totalPages,
});

export const respostaPaginadaCandidaturas = (page = 1, totalPages = 1) => ({
  results: [candidaturaFakeJson],
  totalResults: 1,
  page,
  totalPages,
});

export const webhookApplicationCreatedJson = {
  event: 'application.created',
  eventId: 'evt-001-create',
  occurredAt: '2026-05-15T10:00:00.000-03:00',
  data: candidaturaFakeJson,
};

export const webhookJobUpdatedJson = {
  event: 'job.updated',
  eventId: 'evt-002-job-upd',
  occurredAt: '2026-05-15T11:00:00.000-03:00',
  data: vagaFakeJson,
};

export const envelopeInvalido = {
  event: 'nao.existe', // não está no enum
  data: {},
};
