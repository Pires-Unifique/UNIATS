import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';

import { AreasGuard } from './areas.guard.js';
import { AuthController } from './auth.controller.js';
import { AuthGuard } from './auth.guard.js';
import { AuthService } from './auth.service.js';
import { AzureStrategy } from './azure.strategy.js';

/**
 * Autenticação dos usuários internos via SSO Azure AD (Entra).
 * PrismaService é global, então não precisamos importá-lo aqui.
 * Exporta AuthService/AuthGuard para os módulos de domínio (vagas, etc.)
 * aplicarem o escopo por papel (Fase 3).
 */
@Module({
  imports: [PassportModule],
  controllers: [AuthController],
  providers: [AuthService, AzureStrategy, AuthGuard, AreasGuard],
  exports: [AuthService, AuthGuard, AreasGuard],
})
export class AuthModule {}
