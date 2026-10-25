import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { AuthModule } from '../auth/auth.module'
import { UsersModule } from '../users/users.module'
import { ContactList, ContactListSchema } from './schemas/contact-list.schema'
import { Contact, ContactSchema } from '../contacts/schemas/contact.schema'
import { ListsController } from './lists.controller'
import { ListsService } from './lists.service'

@Module({
  imports: [
    MongooseModule.forFeature([
      {
        name: ContactList.name,
        schema: ContactListSchema,
      },
      // Dynamic lists query contacts directly; registering the model here
      // keeps this module usable without a dependency on ContactsModule.
      {
        name: Contact.name,
        schema: ContactSchema,
      },
    ]),
    AuthModule,
    UsersModule,
  ],
  controllers: [ListsController],
  providers: [ListsService],
  exports: [MongooseModule, ListsService],
})
export class ListsModule {}
