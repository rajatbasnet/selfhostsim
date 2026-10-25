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
import { CampaignsService } from './campaigns.service'
import {
  CampaignPreviewDTO,
  CreateCampaignDTO,
  UpdateCampaignDTO,
} from './campaigns.dto'

@ApiTags('campaigns')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('campaigns')
export class CampaignsController {
  constructor(private readonly campaignsService: CampaignsService) {}

  @ApiOperation({ summary: 'Create a campaign (draft)' })
  @Post('/')
  async create(@Body() input: CreateCampaignDTO, @Request() req) {
    const data = await this.campaignsService.createCampaign(input, req.user)
    return { data }
  }

  @ApiOperation({ summary: 'List campaigns' })
  @Get('/')
  async list(@Request() req) {
    const data = await this.campaignsService.getCampaignsForUser(req.user)
    return { data }
  }

  @ApiOperation({ summary: 'Get a campaign' })
  @Get('/:id')
  async get(@Param('id') id: string, @Request() req) {
    const data = await this.campaignsService.getCampaignById(id, req.user)
    return { data }
  }

  @ApiOperation({ summary: 'Update a campaign' })
  @Patch('/:id')
  async update(
    @Param('id') id: string,
    @Body() input: UpdateCampaignDTO,
    @Request() req,
  ) {
    const data = await this.campaignsService.updateCampaign(id, input, req.user)
    return { data }
  }

  @ApiOperation({ summary: 'Delete a campaign and its send history' })
  @Delete('/:id')
  async remove(@Param('id') id: string, @Request() req) {
    const data = await this.campaignsService.deleteCampaign(id, req.user)
    return { data }
  }

  @ApiOperation({
    summary:
      'Preview: eligible count, skip breakdown, sample messages, segments, duration',
  })
  @ApiResponse({ status: 200, type: CampaignPreviewDTO })
  @Get('/:id/preview')
  async preview(@Param('id') id: string, @Request() req) {
    const data = await this.campaignsService.previewCampaign(id, req.user)
    return { data }
  }

  @ApiOperation({ summary: 'Start sending' })
  @HttpCode(HttpStatus.OK)
  @Post('/:id/start')
  async start(@Param('id') id: string, @Request() req) {
    const data = await this.campaignsService.startCampaign(id, req.user)
    return { data }
  }

  @ApiOperation({ summary: 'Pause a sending campaign' })
  @HttpCode(HttpStatus.OK)
  @Post('/:id/pause')
  async pause(@Param('id') id: string, @Request() req) {
    const data = await this.campaignsService.pauseCampaign(id, req.user)
    return { data }
  }

  @ApiOperation({ summary: 'Resume a paused campaign' })
  @HttpCode(HttpStatus.OK)
  @Post('/:id/resume')
  async resume(@Param('id') id: string, @Request() req) {
    const data = await this.campaignsService.resumeCampaign(id, req.user)
    return { data }
  }

  @ApiOperation({ summary: 'Cancel a campaign; queued sends are not sent' })
  @HttpCode(HttpStatus.OK)
  @Post('/:id/cancel')
  async cancel(@Param('id') id: string, @Request() req) {
    const data = await this.campaignsService.cancelCampaign(id, req.user)
    return { data }
  }

  @ApiOperation({
    summary: 'Report: counts by status, skip breakdown, failures',
  })
  @Get('/:id/report')
  async report(@Param('id') id: string, @Request() req) {
    const data = await this.campaignsService.getCampaignReport(id, req.user)
    return { data }
  }
}
