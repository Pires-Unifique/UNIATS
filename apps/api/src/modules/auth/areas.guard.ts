import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import type { Area, UsuarioAutenticado } from './auth.types.js';
import { AREAS_KEY } from './areas.decorator.js';

/**
 * Autorização por ÁREA de acesso. Roda DEPOIS do AuthGuard (que popula req.user).
 * Sem `@Areas(...)`, libera. Quem tem 'admin' acessa qualquer área.
 */
@Injectable()
export class AreasGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requeridas = this.reflector.getAllAndOverride<Area[]>(AREAS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requeridas || requeridas.length === 0) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const usuario = req.user as UsuarioAutenticado | undefined;
    if (!usuario) {
      throw new ForbiddenException('Sem usuário autenticado.');
    }
    const liberado =
      usuario.areas.includes('admin') ||
      requeridas.some((a) => usuario.areas.includes(a));
    if (!liberado) {
      throw new ForbiddenException('Seu acesso não contempla esta área.');
    }
    return true;
  }
}
