import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { UsuariosController } from './usuarios.controller.js';
import { UsuariosService } from './usuarios.service.js';

/** Gestão de usuários e acessos (tela Usuários da seção Sistema). */
@Module({
  imports: [AuthModule],
  controllers: [UsuariosController],
  providers: [UsuariosService],
})
export class UsuariosModule {}
