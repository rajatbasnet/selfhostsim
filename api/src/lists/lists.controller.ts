import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger'
import { AuthGuard } from '../auth/guards/auth.guard'
import { CreateListDTO, ListMembersInputDTO, UpdateListDTO } from './lists.dto'
import { ListsService } from './lists.service'

@ApiTags('lists')
@ApiBearerAuth()
@Controller('lists')
export class ListsController {
  constructor(private readonly listsService: ListsService) {}

  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'Create a contact list' })
  @Post('/')
  async createList(@Body() input: CreateListDTO, @Request() req) {
    const data = await this.listsService.createList(input, req.user)
    return { data }
  }

  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'List contact lists' })
  @Get('/')
  async getLists(@Request() req) {
    const data = await this.listsService.getListsForUser(req.user)
    return { data }
  }

  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'Get a contact list with its current member count' })
  @Get('/:id')
  async getList(@Param('id') listId: string, @Request() req) {
    const list = await this.listsService.getListById(listId, req.user)
    const memberCount = await this.listsService.countListMembers(
      listId,
      req.user,
    )
    return { data: { ...list.toObject(), memberCount } }
  }

  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'Update a contact list' })
  @Patch('/:id')
  async updateList(
    @Param('id') listId: string,
    @Body() input: UpdateListDTO,
    @Request() req,
  ) {
    const data = await this.listsService.updateList(listId, input, req.user)
    return { data }
  }

  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'Delete a contact list' })
  @Delete('/:id')
  async deleteList(@Param('id') listId: string, @Request() req) {
    const data = await this.listsService.deleteList(listId, req.user)
    return { data }
  }

  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'Get the contacts currently in a list' })
  @ApiQuery({
    name: 'page',
    required: false,
    type: Number,
    description: 'Page number (default: 1)',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Number of items per page (default: 50, max: 100)',
  })
  @Get('/:id/members')
  async getListMembers(@Param('id') listId: string, @Request() req) {
    const page = req.query.page ? parseInt(req.query.page, 10) : 1
    const limit = req.query.limit ? parseInt(req.query.limit, 10) : 50

    return await this.listsService.getListMembers(listId, req.user, page, limit)
  }

  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'Add contacts to a static list' })
  @Post('/:id/members')
  async addMembers(
    @Param('id') listId: string,
    @Body() input: ListMembersInputDTO,
    @Request() req,
  ) {
    const data = await this.listsService.addContactsToList(
      listId,
      input?.contactIds,
      req.user,
    )
    return { data }
  }

  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'Remove contacts from a static list' })
  @Delete('/:id/members')
  async removeMembers(
    @Param('id') listId: string,
    @Body() input: ListMembersInputDTO,
    @Request() req,
  ) {
    const data = await this.listsService.removeContactsFromList(
      listId,
      input?.contactIds,
      req.user,
    )
    return { data }
  }
}
