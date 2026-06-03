import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { SendGridClient } from './sendgrid.client.js';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [SendGridClient],
  exports: [SendGridClient],
})
export class SendGridModule {}
