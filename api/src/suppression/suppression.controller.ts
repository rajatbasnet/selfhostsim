import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common'
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger'
import { AuthGuard } from '../auth/guards/auth.guard'
import { Channel, SuppressionReason } from '../sendline/sendline.enums'
import {
  CreateSuppressionDTO,
  InboundMessageDTO,
  InboundMessageOutcomeDTO,
  ListSuppressionsQueryDTO,
} from './suppression.dto'
import { SuppressionService } from './suppression.service'

@ApiTags('suppression')
@ApiBearerAuth()
@Controller('suppression')
export class SuppressionController {
  constructor(private readonly suppressionService: SuppressionService) {}

  @ApiOperation({ summary: 'List do-not-contact entries' })
  @ApiQuery({ name: 'channel', required: false, enum: Channel })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @UseGuards(AuthGuard)
  @Get('/')
  async list(@Query() query: ListSuppressionsQueryDTO, @Request() req) {
    return this.suppressionService.listSuppressions(req.user, {
      channel: query.channel,
      page: query.page ? parseInt(String(query.page), 10) : undefined,
      limit: query.limit ? parseInt(String(query.limit), 10) : undefined,
    })
  }

  @ApiOperation({ summary: 'Manually add a value to the do-not-contact list' })
  @UseGuards(AuthGuard)
  @Post('/')
  async create(@Body() input: CreateSuppressionDTO, @Request() req) {
    const data = await this.suppressionService.suppress(
      input.value,
      input.channel,
      req.user,
      input.reason ?? SuppressionReason.MANUAL,
      input.evidence,
    )
    return { data }
  }

  @ApiOperation({
    summary:
      'Remove an entry. Deliberate action only; consent is NOT restored.',
  })
  @UseGuards(AuthGuard)
  @Delete('/:id')
  async remove(@Param('id') id: string, @Request() req) {
    const data = await this.suppressionService.removeSuppressionById(
      id,
      req.user,
    )
    return { data }
  }

  @ApiOperation({
    summary:
      'Gateway hook: classify an inbound SMS as STOP / START / ordinary reply',
  })
  @ApiResponse({ status: 200, type: InboundMessageOutcomeDTO })
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard)
  @Post('/inbound')
  async inbound(@Body() input: InboundMessageDTO, @Request() req) {
    const data = await this.suppressionService.handleInboundMessage(
      input,
      req.user,
    )
    return { data }
  }
}
