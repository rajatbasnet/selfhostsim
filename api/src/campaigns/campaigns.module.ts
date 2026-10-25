import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { BullModule } from '@nestjs/bull'
import { Campaign, CampaignSchema } from './schemas/campaign.schema'
import { Send, SendSchema } from './schemas/send.schema'
import { Contact, ContactSchema } from '../contacts/schemas/contact.schema'
import {
  MessageTemplate,
  MessageTemplateSchema,
} from '../templates/schemas/template.schema'
import { CampaignsController } from './campaigns.controller'
import { CampaignsService } from './campaigns.service'
import { SendDispatchProcessor } from './send-dispatch.processor'
import { SENDLINE_SENDS_QUEUE } from './send-queue.constants'
import { AuthModule } from '../auth/auth.module'
import { UsersModule } from '../users/users.module'
import { GatewayModule } from '../gateway/gateway.module'
import { TemplatesModule } from '../templates/templates.module'
import { ListsModule } from '../lists/lists.module'
import { SuppressionModule } from '../suppression/suppression.module'
import { EmailModule } from '../email/email.module'

const models = MongooseModule.forFeature([
  { name: Campaign.name, schema: CampaignSchema },
  { name: Send.name, schema: SendSchema },
  // Read-only here: the campaign engine loads contacts and templates by id
  // directly rather than depending on the shape of the peer services.
  { name: Contact.name, schema: ContactSchema },
  { name: MessageTemplate.name, schema: MessageTemplateSchema },
])

@Module({
  imports: [
    models,
    BullModule.registerQueue({
      name: SENDLINE_SENDS_QUEUE,
      defaultJobOptions: {
        // Retries are managed by the processor, not Bull.
        attempts: 1,
        removeOnComplete: true,
        removeOnFail: false,
      },
    }),
    AuthModule,
    UsersModule,
    GatewayModule,
    TemplatesModule,
    ListsModule,
    SuppressionModule,
    EmailModule,
  ],
  controllers: [CampaignsController],
  providers: [CampaignsService, SendDispatchProcessor],
  exports: [models, CampaignsService],
})
export class CampaignsModule {}
