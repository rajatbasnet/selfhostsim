import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { Send, SendSchema } from '../campaigns/schemas/send.schema'
import {
  MessageTemplate,
  MessageTemplateSchema,
} from '../templates/schemas/template.schema'
import { AuthModule } from '../auth/auth.module'
import { UsersModule } from '../users/users.module'
import { GatewayModule } from '../gateway/gateway.module'
import { EmailModule } from '../email/email.module'
import { SuppressionModule } from '../suppression/suppression.module'
import { MessagingController } from './messaging.controller'
import { MessagingService } from './messaging.service'

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Send.name, schema: SendSchema },
      { name: MessageTemplate.name, schema: MessageTemplateSchema },
    ]),
    AuthModule,
    UsersModule,
    GatewayModule,
    EmailModule,
    SuppressionModule,
  ],
  controllers: [MessagingController],
  providers: [MessagingService],
  exports: [MessagingService],
})
export class MessagingModule {}
