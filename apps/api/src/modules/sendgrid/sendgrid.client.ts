import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import sgMail, { MailDataRequired, ResponseError } from '@sendgrid/mail';

export interface EnviarEmailInput {
  para: string;
  assunto: string;
  textoPlano: string;
  html?: string;
  /** Para tracking — vira `customArgs.candidaturaId` no webhook. */
  candidaturaId?: string;
  /** Mensagem interna (id da nossa tabela `mensagens`). */
  mensagemId?: string;
  reply_to?: string;
}

export interface EnviarEmailResultado {
  messageId: string;
}

@Injectable()
export class SendGridClient {
  private readonly logger = new Logger(SendGridClient.name);
  private readonly from?: { email: string; name?: string };
  private readonly habilitado: boolean;

  constructor(private readonly config: ConfigService) {
    const apiKey = this.config.get<string>('SENDGRID_API_KEY');
    const fromEmail = this.config.get<string>('SENDGRID_FROM_EMAIL');
    const fromName = this.config.get<string>('SENDGRID_FROM_NAME');

    this.habilitado = Boolean(apiKey && fromEmail);
    if (this.habilitado) {
      sgMail.setApiKey(apiKey!);
      this.from = { email: fromEmail!, name: fromName };
      this.logger.log(`SendGrid habilitado — from=${fromEmail}`);
    } else {
      this.logger.warn(
        'SendGrid NÃO está habilitado (SENDGRID_API_KEY/FROM_EMAIL ausentes). ' +
          'Envios por e-mail serão recusados em tempo de execução.',
      );
    }
  }

  estaDisponivel(): boolean {
    return this.habilitado;
  }

  async enviarEmail(input: EnviarEmailInput): Promise<EnviarEmailResultado> {
    if (!this.habilitado || !this.from) {
      throw new ServiceUnavailableException(
        'SendGrid não está configurado — defina SENDGRID_API_KEY e SENDGRID_FROM_EMAIL.',
      );
    }

    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(input.para)) {
      throw new BadRequestException(`E-mail destino inválido: "${input.para}"`);
    }
    if (!input.assunto?.trim() || !input.textoPlano?.trim()) {
      throw new BadRequestException(
        'Assunto e textoPlano são obrigatórios.',
      );
    }

    const msg: MailDataRequired = {
      to: input.para,
      from: this.from,
      subject: input.assunto.trim().slice(0, 200),
      text: input.textoPlano,
      ...(input.html ? { html: input.html } : {}),
      ...(input.reply_to ? { replyTo: input.reply_to } : {}),
      // customArgs aparecem no webhook → permitem cruzar evento com nossa mensagem.
      customArgs: {
        ...(input.candidaturaId ? { candidaturaId: input.candidaturaId } : {}),
        ...(input.mensagemId ? { mensagemId: input.mensagemId } : {}),
      },
      // Reduz ruído de bots de antivírus que abrem o link
      trackingSettings: {
        clickTracking: { enable: true, enableText: false },
        openTracking: { enable: true },
      },
      mailSettings: {
        // bypass de listas em sandbox/dev se NODE_ENV=development
        sandboxMode: {
          enable: this.config.get<string>('NODE_ENV') === 'test',
        },
      },
    };

    try {
      const [resp] = await sgMail.send(msg);
      const messageId =
        (resp.headers['x-message-id'] as string | undefined) ??
        (resp.headers['x-sg-message-id'] as string | undefined) ??
        '';
      if (!messageId) {
        this.logger.warn(
          `SendGrid não devolveu X-Message-Id (status=${resp.statusCode}).`,
        );
      }
      return { messageId };
    } catch (err) {
      const e = err as ResponseError;
      const status = e?.code;
      this.logger.error(
        `SendGrid send falhou (status=${status}): ${JSON.stringify(e?.response?.body ?? e?.message).slice(0, 500)}`,
      );
      if (status === 429 || (status && status >= 500)) {
        throw new ServiceUnavailableException(
          'SendGrid indisponível — job será re-tentado.',
        );
      }
      throw new InternalServerErrorException('Falha ao enviar e-mail.');
    }
  }
}
