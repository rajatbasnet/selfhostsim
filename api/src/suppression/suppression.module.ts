import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { AuthModule } from '../auth/auth.module'
import { UsersModule } from '../users/users.module'
import { Suppression, SuppressionSchema } from './schemas/suppression.schema'
import { Contact, ContactSchema } from '../contacts/schemas/contact.schema'
import { SuppressionController } from './suppression.controller'
import { SuppressionService } from './suppression.service'

// Re-exported so consumers may import the service from the module entry point.
export { SuppressionService } from './suppression.service'

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Suppression.name, schema: SuppressionSchema },
      { name: Contact.name, schema: ContactSchema },
    ]),
    AuthModule,
    UsersModule,
  ],
  controllers: [SuppressionController],
  providers: [SuppressionService],
  exports: [MongooseModule, SuppressionService],
})
export class SuppressionModule {}
