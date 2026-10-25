import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { ContactListType } from '../sendline/sendline.enums'

export class ListFilterDTO {
  @ApiPropertyOptional({ type: [String], example: ['vip'] })
  tagsInclude?: string[]

  @ApiPropertyOptional({ type: [String], example: ['churned'] })
  tagsExclude?: string[]

  @ApiPropertyOptional({ type: Boolean })
  hasPhone?: boolean

  @ApiPropertyOptional({ type: Boolean })
  hasEmail?: boolean

  @ApiPropertyOptional({ type: Boolean })
  smsConsent?: boolean

  @ApiPropertyOptional({ type: Boolean })
  emailConsent?: boolean

  @ApiPropertyOptional({ type: Date })
  createdAfter?: Date

  @ApiPropertyOptional({ type: Date })
  createdBefore?: Date
}

export class CreateListDTO {
  @ApiProperty({ type: String, required: true, example: 'VIP customers' })
  name: string

  @ApiPropertyOptional({
    enum: ContactListType,
    default: ContactListType.STATIC,
    description:
      'static: explicit contactIds. dynamic: filter re-evaluated on every use.',
  })
  type?: ContactListType

  @ApiPropertyOptional({
    type: [String],
    description: 'Static lists only. Contact ids owned by the caller.',
  })
  contactIds?: string[]

  @ApiPropertyOptional({
    type: ListFilterDTO,
    description: 'Dynamic lists only. Unknown keys are ignored.',
  })
  filter?: ListFilterDTO
}

export class UpdateListDTO {
  @ApiPropertyOptional({ type: String })
  name?: string

  @ApiPropertyOptional({ enum: ContactListType })
  type?: ContactListType

  @ApiPropertyOptional({
    type: [String],
    description: 'Static lists only. Replaces the whole membership.',
  })
  contactIds?: string[]

  @ApiPropertyOptional({ type: ListFilterDTO })
  filter?: ListFilterDTO
}

export class ListMembersInputDTO {
  @ApiProperty({
    type: [String],
    required: true,
    description: 'Contact ids to add or remove. Static lists only.',
  })
  contactIds: string[]
}
