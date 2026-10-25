import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common'
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger'
import { AuthGuard } from '../auth/guards/auth.guard'
import { ContactsService } from './contacts.service'
import {
  CreateContactInputDTO,
  ImportContactsInputDTO,
  ImportContactsSummaryDTO,
  ListContactsQueryDTO,
  ListContactsResponseDTO,
  UpdateContactInputDTO,
} from './contacts.dto'

@ApiTags('contacts')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('contacts')
export class ContactsController {
  constructor(private readonly contactsService: ContactsService) {}

  @ApiOperation({ summary: 'Create a contact' })
  @Post()
  async createContact(@Body() input: CreateContactInputDTO, @Request() req) {
    const data = await this.contactsService.createContact(input, req.user)
    return { data }
  }

  @ApiOperation({ summary: 'List contacts (paginated)' })
  @ApiResponse({ status: 200, type: ListContactsResponseDTO })
  @Get()
  async listContacts(@Query() query: ListContactsQueryDTO, @Request() req) {
    return await this.contactsService.listContacts(req.user, {
      search: query.search,
      tag: query.tag,
      consent: query.consent,
      page: query.page !== undefined ? Number(query.page) : undefined,
      limit: query.limit !== undefined ? Number(query.limit) : undefined,
    })
  }

  @ApiOperation({ summary: 'Import contacts from CSV text' })
  @ApiResponse({ status: 200, type: ImportContactsSummaryDTO })
  @HttpCode(HttpStatus.OK)
  @Post('/import')
  async importContacts(@Body() input: ImportContactsInputDTO, @Request() req) {
    const data = await this.contactsService.importContactsFromCsv(
      input.csv,
      req.user,
      {
        defaultCountryCode: input.defaultCountryCode,
        consentSource: input.consentSource,
        tags: input.tags,
      },
    )
    return { data }
  }

  @ApiOperation({ summary: 'Get a contact' })
  @Get('/:id')
  async getContact(@Param('id') id: string, @Request() req) {
    const data = await this.contactsService.getContactById(id, req.user)
    return { data }
  }

  @ApiOperation({ summary: 'Update a contact' })
  @Patch('/:id')
  async updateContact(
    @Param('id') id: string,
    @Body() input: UpdateContactInputDTO,
    @Request() req,
  ) {
    const data = await this.contactsService.updateContact(id, input, req.user)
    return { data }
  }

  @ApiOperation({ summary: 'Delete a contact' })
  @Delete('/:id')
  async deleteContact(@Param('id') id: string, @Request() req) {
    const data = await this.contactsService.deleteContact(id, req.user)
    return { data }
  }
}
