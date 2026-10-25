import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common'
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger'
import { AuthGuard } from '../auth/guards/auth.guard'
import { SendMessageInputDTO, SendMessageResponseDTO } from './messaging.dto'
import { MessagingService } from './messaging.service'

/**
 * Public transactional API: POST /api/v1/messages.
 *
 * main.ts enables URI versioning with defaultVersion '1' and the global
 * prefix 'api', so declaring the version here (rather than hard-coding
 * 'v1/' in the path) yields /api/v1/messages, not /api/v1/v1/messages.
 *
 * Authenticated by the shared AuthGuard, which accepts either a JWT bearer
 * token or an API key in the `x-api-key` header.
 */
@ApiTags('messages')
@ApiBearerAuth()
@ApiSecurity('api_key')
@Controller({ path: 'messages', version: '1' })
export class MessagingController {
  constructor(private readonly messagingService: MessagingService) {}

  @UseGuards(AuthGuard)
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Send a transactional SMS or email immediately',
    description:
      'Dispatches one message right away, ahead of any campaign traffic. No pacing or quiet hours apply, but recipients on your do-not-contact list are skipped (status "skipped"). Every call writes a ledger row you can look up by the returned id.',
  })
  @ApiResponse({
    status: HttpStatus.ACCEPTED,
    type: SendMessageResponseDTO,
    description:
      'The message was handed to the provider, or skipped for a suppressed recipient.',
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description:
      'Unusable recipient, missing body/template, unfilled merge tags, or no device to send from.',
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Missing or invalid credentials.',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Unknown template slug or device id.',
  })
  @ApiResponse({
    status: HttpStatus.BAD_GATEWAY,
    description:
      'The device or SMTP server rejected the message. The response carries the ledger id and status "failed".',
  })
  @Post()
  async sendMessage(
    @Body() input: SendMessageInputDTO,
    @Request() req,
  ): Promise<SendMessageResponseDTO> {
    const data = await this.messagingService.sendMessage(input, req.user)
    return { data }
  }
}
