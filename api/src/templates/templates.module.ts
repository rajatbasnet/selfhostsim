import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { AuthModule } from '../auth/auth.module'
import { UsersModule } from '../users/users.module'
import {
  MessageTemplate,
  MessageTemplateSchema,
} from './schemas/template.schema'
import { TemplatesController } from './templates.controller'
import { TemplatesService } from './templates.service'

@Module({
  imports: [
    MongooseModule.forFeature([
      {
        name: MessageTemplate.name,
        schema: MessageTemplateSchema,
      },
    ]),
    AuthModule,
    UsersModule,
  ],
  controllers: [TemplatesController],
  providers: [TemplatesService],
  exports: [MongooseModule, TemplatesService],
})
export class TemplatesModule {}
