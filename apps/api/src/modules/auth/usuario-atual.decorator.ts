import {
  createParamDecorator,
  ExecutionContext,
  InternalServerErrorException,
} from '@nestjs/common';
import type { Request } from 'express';

import type { UsuarioAutenticado } from './auth.types.js';

/**
 * Injeta o usuário autenticado (`req.user`) no handler. Use SEMPRE em conjunto
 * com `@UseGuards(AuthGuard)` — sem o guard, `req.user` é indefinido e isto
 * lança 500 (falha de programação, não de autenticação).
 */
export const UsuarioAtual = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): UsuarioAutenticado => {
    const req = ctx.switchToHttp().getRequest<Request>();
    const usuario = req.user as UsuarioAutenticado | undefined;
    if (!usuario) {
      throw new InternalServerErrorException(
        '@UsuarioAtual usado sem AuthGuard (req.user vazio).',
      );
    }
    return usuario;
  },
);
