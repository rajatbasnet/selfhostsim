import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { AuthModule } from '../auth/auth.module'
import { UsersModule } from '../users/users.module'
import { Contact, ContactSchema } from './schemas/contact.schema'
import { ContactsController } from './contacts.controller'
import { ContactsService } from './contacts.service'

@Module({
  imports: [
    MongooseModule.forFeature([
      {
        name: Contact.name,
        schema: ContactSchema,
      },
    ]),
    AuthModule,
    UsersModule,
  ],
  controllers: [ContactsController],
  providers: [ContactsService],
  exports: [MongooseModule, ContactsService],
})
export class ContactsModule {}
