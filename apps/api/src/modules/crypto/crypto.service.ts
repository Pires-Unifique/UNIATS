import {
  Injectable,
  InternalServerErrorException,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

/**
 * Envelope de criptografia em repouso para dados sensíveis (áudios, transcrições).
 *
 * Algoritmo: AES-256-GCM
 *   - 256 bits (32 bytes) de chave — vem de DATA_ENCRYPTION_KEY (base64)
 *   - IV (nonce) de 12 bytes random por mensagem — NUNCA reusar com a mesma chave
 *   - Tag de autenticação de 16 bytes — detecta tampering
 *
 * Formato do payload serializado: `iv (12) || tag (16) || ciphertext (n)`
 * Esse layout é compatível com `subtle.crypto.decrypt` e fácil de ler/separar.
 *
 * Notas operacionais:
 *  - Em produção, considere KMS (AWS KMS / Azure Key Vault) com chave envelope:
 *    o DEK (data encryption key) por arquivo seria gerado e criptografado com a CMK.
 *    Para o MVP usamos uma única DEK estática — simples e auditável.
 */

const ALG = 'aes-256-gcm';
const IV_LEN = 12;
const TAG_LEN = 16;

export interface PayloadCriptografado {
  /** Bytes serializados: `iv || tag || ciphertext`. */
  bytes: Buffer;
  /** Tamanho do ciphertext puro (sem header). */
  ciphertextLen: number;
}

@Injectable()
export class CryptoService implements OnModuleInit {
  private readonly logger = new Logger(CryptoService.name);
  private chave?: Buffer;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const raw = this.config.get<string>('DATA_ENCRYPTION_KEY');
    const env = this.config.get<string>('NODE_ENV');

    if (!raw) {
      if (env === 'production') {
        // Fail-fast em produção: nenhuma criptografia de áudio é aceitável.
        throw new Error(
          'DATA_ENCRYPTION_KEY ausente em produção — recuse subir a aplicação.',
        );
      }
      this.logger.warn(
        'DATA_ENCRYPTION_KEY ausente — CryptoService NÃO está operacional. ' +
          'Operações de áudio/transcrição falharão em runtime.',
      );
      return;
    }

    const buf = Buffer.from(raw, 'base64');
    if (buf.length !== 32) {
      throw new Error(
        `DATA_ENCRYPTION_KEY deve ter 32 bytes em base64 (recebido ${buf.length}).`,
      );
    }
    this.chave = buf;
    this.logger.log('CryptoService inicializado (AES-256-GCM).');
  }

  estaDisponivel(): boolean {
    return this.chave !== undefined;
  }

  /**
   * Criptografa um buffer. Cada chamada gera um IV fresco — NUNCA reusar.
   *
   * @param plaintext bytes em claro
   * @param aad dados adicionais autenticados (opcional, ex.: id da entrevista)
   *            Devem ser fornecidos novamente no decrypt para validar.
   */
  encrypt(plaintext: Buffer, aad?: Buffer): PayloadCriptografado {
    this.assertChave();
    if (!plaintext || plaintext.length === 0) {
      throw new InternalServerErrorException(
        'encrypt: plaintext vazio.',
      );
    }
    const iv = randomBytes(IV_LEN);
    const cipher = createCipheriv(ALG, this.chave!, iv, {
      authTagLength: TAG_LEN,
    });
    if (aad && aad.length) cipher.setAAD(aad);

    const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();

    return {
      bytes: Buffer.concat([iv, tag, ct]),
      ciphertextLen: ct.length,
    };
  }

  /**
   * Descriptografa. Lança erro de integridade (sem detalhes adicionais para
   * não vazar oráculo) se IV/tag/aad não baterem.
   */
  decrypt(payload: Buffer, aad?: Buffer): Buffer {
    this.assertChave();
    if (!payload || payload.length < IV_LEN + TAG_LEN + 1) {
      throw new InternalServerErrorException(
        'decrypt: payload muito curto ou ausente.',
      );
    }

    const iv = payload.subarray(0, IV_LEN);
    const tag = payload.subarray(IV_LEN, IV_LEN + TAG_LEN);
    const ct = payload.subarray(IV_LEN + TAG_LEN);

    const decipher = createDecipheriv(ALG, this.chave!, iv, {
      authTagLength: TAG_LEN,
    });
    decipher.setAuthTag(tag);
    if (aad && aad.length) decipher.setAAD(aad);

    try {
      return Buffer.concat([decipher.update(ct), decipher.final()]);
    } catch (err) {
      // Não logamos detalhes do erro — possíveis oráculos para o atacante.
      this.logger.warn('decrypt falhou — integridade não validada.');
      throw new InternalServerErrorException(
        'Falha de integridade ao descriptografar.',
      );
    }
  }

  /**
   * Constant-time compare de duas tags/MACs. Útil em validações de assinaturas.
   */
  compararEmTempoConstante(a: Buffer, b: Buffer): boolean {
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }

  private assertChave(): void {
    if (!this.chave) {
      throw new InternalServerErrorException(
        'CryptoService não está operacional — DATA_ENCRYPTION_KEY ausente.',
      );
    }
  }
}
