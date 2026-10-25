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
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger'
import { AuthGuard } from '../auth/guards/auth.guard'
import {
  CreateTemplateDTO,
  PreviewTemplateDTO,
  TemplatePreviewDTO,
  UpdateTemplateDTO,
} from './templates.dto'
import { TemplatesService } from './templates.service'

@ApiTags('templates')
@ApiBearerAuth()
@Controller('templates')
export class TemplatesController {
  constructor(private readonly templatesService: TemplatesService) {}

  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'Create a message template' })
  @Post('/')
  async createTemplate(@Body() input: CreateTemplateDTO, @Request() req) {
    const data = await this.templatesService.createTemplate(input, req.user)
    return { data }
  }

  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'List message templates' })
  @ApiQuery({
    name: 'channel',
    required: false,
    type: String,
    description: 'Filter by channel: sms or email',
  })
  @Get('/')
  async getTemplates(@Request() req) {
    const data = await this.templatesService.getTemplatesForUser(
      req.user,
      req.query.channel || undefined,
    )
    return { data }
  }

  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'Get a message template' })
  @Get('/:id')
  async getTemplate(@Param('id') templateId: string, @Request() req) {
    const data = await this.templatesService.getTemplateById(
      templateId,
      req.user,
    )
    return { data }
  }

  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'Update a message template' })
  @Patch('/:id')
  async updateTemplate(
    @Param('id') templateId: string,
    @Body() input: UpdateTemplateDTO,
    @Request() req,
  ) {
    const data = await this.templatesService.updateTemplate(
      templateId,
      input,
      req.user,
    )
    return { data }
  }

  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'Delete a message template' })
  @Delete('/:id')
  async deleteTemplate(@Param('id') templateId: string, @Request() req) {
    const data = await this.templatesService.deleteTemplate(
      templateId,
      req.user,
    )
    return { data }
  }

  @UseGuards(AuthGuard)
  @ApiOperation({
    summary: 'Render a template with sample values',
    description:
      'Returns the rendered text, tags that had no value, and for SMS the segment count.',
  })
  @ApiResponse({ status: 200, type: TemplatePreviewDTO })
  @HttpCode(HttpStatus.OK)
  @Post('/:id/preview')
  async previewTemplate(
    @Param('id') templateId: string,
    @Body() input: PreviewTemplateDTO,
    @Request() req,
  ) {
    const data = await this.templatesService.renderPreview(
      templateId,
      input?.vars ?? {},
      req.user,
    )
    return { data }
  }
}
