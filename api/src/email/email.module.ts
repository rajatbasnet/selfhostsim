import { Module } from '@nestjs/common'
import { EmailService } from './email.service'
import { SmtpTransport } from './smtp-transport'

@Module({
  providers: [SmtpTransport, EmailService],
  exports: [EmailService],
})
export class EmailModule {}
