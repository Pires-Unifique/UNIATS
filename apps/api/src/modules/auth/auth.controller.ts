import { Controller, Get, UseGuards } from '@nestjs/common';

import { AuthGuard } from './auth.guard.js';
import type { UsuarioAutenticado } from './auth.types.js';
import { UsuarioAtual } from './usuario-atual.decorator.js';

@Controller('api/auth')
@UseGuards(AuthGuard)
export class AuthController {
  /**
   * Identidade do usuário logado — fonte de verdade do `papel` para o frontend
   * decidir o que exibir. O front deve chamar isto após o login (não confiar no
   * papel embutido no token).
   */
  @Get('me')
  me(@UsuarioAtual() usuario: UsuarioAutenticado): UsuarioAutenticado {
    return usuario;
  }
}
