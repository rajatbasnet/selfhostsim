import { Test, TestingModule } from '@nestjs/testing'
import { getModelToken } from '@nestjs/mongoose'
import { HttpException, HttpStatus } from '@nestjs/common'
import { Types } from 'mongoose'
import { MessagingService } from './messaging.service'
import { Send } from '../campaigns/schemas/send.schema'
import { MessageTemplate } from '../templates/schemas/template.schema'
import { SuppressionService } from '../suppression/suppression.service'
import { GatewayService } from '../gateway/gateway.service'
import { EmailService } from '../email/email.service'
import {
  Channel,
  SendLane,
  SendStatus,
  SkipReason,
} from '../sendline/sendline.enums'

// Peers are mocked at the module boundary so this spec never pulls in their
// dependency graphs (firebase, mongoose models, nodemailer).
jest.mock('../suppression/suppression.service', () => ({
  SuppressionService: class SuppressionService {},
}))
jest.mock('../gateway/gateway.service', () => ({
  GatewayService: class GatewayService {},
}))
jest.mock('../email/email.service', () => ({
  EmailService: class EmailService {},
}))

describe('MessagingService', () => {
  let service: MessagingService

  const user = { _id: new Types.ObjectId(), username: 'asha' } as any
  const deviceId = new Types.ObjectId()
  const sendId = new Types.ObjectId()

  const mockSendModel = {
    create: jest.fn(),
    findByIdAndUpdate: jest.fn(),
  }
  const mockTemplateModel = {
    findOne: jest.fn(),
  }
  const mockSuppressionService = {
    isSuppressed: jest.fn(),
  }
  const mockGatewayService = {
    sendSMS: jest.fn(),
    getDeviceById: jest.fn(),
    getDevicesForUser: jest.fn(),
  }
  const mockEmailService = {
    sendEmail: jest.fn(),
  }

  const httpStatusOf = async (promise: Promise<unknown>): Promise<number> => {
    try {
      await promise
    } catch (e) {
      if (e instanceof HttpException) return e.getStatus()
      throw e
    }
    throw new Error('expected the call to reject')
  }

  const httpBodyOf = async (promise: Promise<unknown>): Promise<any> => {
    try {
      await promise
    } catch (e) {
      if (e instanceof HttpException) return e.getResponse()
      throw e
    }
    throw new Error('expected the call to reject')
  }

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MessagingService,
        { provide: getModelToken(Send.name), useValue: mockSendModel },
        {
          provide: getModelToken(MessageTemplate.name),
          useValue: mockTemplateModel,
        },
        { provide: SuppressionService, useValue: mockSuppressionService },
        { provide: GatewayService, useValue: mockGatewayService },
        { provide: EmailService, useValue: mockEmailService },
      ],
    }).compile()

    service = module.get<MessagingService>(MessagingService)

    jest.clearAllMocks()
    mockSendModel.create.mockImplementation(async (doc) => ({
      ...doc,
      _id: sendId,
    }))
    mockSendModel.findByIdAndUpdate.mockResolvedValue(null)
    mockSuppressionService.isSuppressed.mockResolvedValue(false)
    mockGatewayService.getDeviceById.mockResolvedValue({
      _id: deviceId,
      user: user._id,
      enabled: true,
    })
    mockGatewayService.getDevicesForUser.mockResolvedValue([
      { _id: deviceId, user: user._id, enabled: true },
    ])
    mockGatewayService.sendSMS.mockResolvedValue({
      success: true,
      smsBatchId: new Types.ObjectId('66f1c2a4e8b7d2a1c9f0e123'),
    })
    mockEmailService.sendEmail.mockResolvedValue({
      messageId: '<msg-1@example.com>',
    })
    mockTemplateModel.findOne.mockResolvedValue(null)
  })

  describe('happy paths', () => {
    it('sends an inline SMS immediately and writes a sent ledger row', async () => {
      const result = await service.sendMessage(
        {
          channel: Channel.SMS,
          to: '+977 981 234 5678',
          body: 'Hi {{name}}, order {{order_id}} confirmed.',
          vars: { name: 'Asha', order_id: 'A-1042' },
        },
        user,
      )

      expect(mockGatewayService.sendSMS).toHaveBeenCalledWith(
        deviceId.toString(),
        expect.objectContaining({
          message: 'Hi Asha, order A-1042 confirmed.',
          recipients: ['+9779812345678'],
        }),
      )
      expect(mockSendModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          user: user._id,
          channel: Channel.SMS,
          lane: SendLane.TRANSACTIONAL,
          recipient: '+9779812345678',
          renderedBody: 'Hi Asha, order A-1042 confirmed.',
          status: SendStatus.QUEUED,
        }),
      )
      expect(mockSendModel.findByIdAndUpdate).toHaveBeenCalledWith(sendId, {
        $set: expect.objectContaining({
          status: SendStatus.SENT,
          providerId: '66f1c2a4e8b7d2a1c9f0e123',
        }),
      })
      expect(result).toEqual({
        id: sendId.toString(),
        status: SendStatus.SENT,
        renderedPreview: 'Hi Asha, order A-1042 confirmed.',
        providerId: '66f1c2a4e8b7d2a1c9f0e123',
      })
    })

    it('sends an email from a template slug and stores the smtp message id', async () => {
      mockTemplateModel.findOne.mockResolvedValue({
        slug: 'order-confirmed',
        channel: Channel.EMAIL,
        subject: 'Order {{order_id}} confirmed',
        body: 'Thanks {{name}}!',
      })

      const result = await service.sendMessage(
        {
          channel: Channel.EMAIL,
          to: 'Asha@Example.com',
          template: 'order-confirmed',
          vars: { name: 'Asha', order_id: 'A-1042' },
        },
        user,
      )

      expect(mockTemplateModel.findOne).toHaveBeenCalledWith({
        user: user._id,
        slug: 'order-confirmed',
      })
      expect(mockEmailService.sendEmail).toHaveBeenCalledWith({
        to: 'asha@example.com',
        subject: 'Order A-1042 confirmed',
        body: 'Thanks Asha!',
      })
      expect(mockSendModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: Channel.EMAIL,
          subject: 'Order A-1042 confirmed',
          renderedBody: 'Thanks Asha!',
        }),
      )
      expect(mockSendModel.findByIdAndUpdate).toHaveBeenCalledWith(sendId, {
        $set: expect.objectContaining({
          status: SendStatus.SENT,
          providerId: '<msg-1@example.com>',
        }),
      })
      expect(result.status).toBe(SendStatus.SENT)
      expect(result.renderedPreview).toBe('Thanks Asha!')
    })

    it('lets an inline subject override the template subject', async () => {
      mockTemplateModel.findOne.mockResolvedValue({
        channel: Channel.EMAIL,
        subject: 'Template subject',
        body: 'body',
      })
      await service.sendMessage(
        {
          channel: Channel.EMAIL,
          to: 'a@example.com',
          template: 'x',
          subject: 'Inline subject',
        },
        user,
      )
      expect(mockEmailService.sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({ subject: 'Inline subject' }),
      )
    })

    it('uses the given deviceId when it belongs to the user', async () => {
      await service.sendMessage(
        {
          channel: Channel.SMS,
          to: '+9779812345678',
          body: 'hi',
          deviceId: deviceId.toString(),
        },
        user,
      )
      expect(mockGatewayService.getDeviceById).toHaveBeenCalledWith(
        deviceId.toString(),
      )
      expect(mockGatewayService.getDevicesForUser).not.toHaveBeenCalled()
      expect(mockGatewayService.sendSMS).toHaveBeenCalledWith(
        deviceId.toString(),
        expect.anything(),
      )
    })
  })

  describe('suppression on the transactional lane', () => {
    it('does NOT send to a suppressed recipient and records a skipped row', async () => {
      mockSuppressionService.isSuppressed.mockResolvedValue(true)

      const result = await service.sendMessage(
        { channel: Channel.SMS, to: '+9779812345678', body: 'Order shipped' },
        user,
      )

      expect(mockSuppressionService.isSuppressed).toHaveBeenCalledWith(
        '+9779812345678',
        Channel.SMS,
        user,
      )
      expect(mockGatewayService.sendSMS).not.toHaveBeenCalled()
      expect(mockEmailService.sendEmail).not.toHaveBeenCalled()
      expect(mockSendModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          lane: SendLane.TRANSACTIONAL,
          recipient: '+9779812345678',
          status: SendStatus.SKIPPED,
          skipReason: SkipReason.SUPPRESSED,
          renderedBody: 'Order shipped',
        }),
      )
      expect(result).toEqual({
        id: sendId.toString(),
        status: SendStatus.SKIPPED,
        skipReason: SkipReason.SUPPRESSED,
        renderedPreview: 'Order shipped',
      })
    })

    it('checks suppression against the normalised email', async () => {
      mockSuppressionService.isSuppressed.mockResolvedValue(true)
      await service.sendMessage(
        {
          channel: Channel.EMAIL,
          to: '  Asha@Example.COM ',
          subject: 's',
          body: 'b',
        },
        user,
      )
      expect(mockSuppressionService.isSuppressed).toHaveBeenCalledWith(
        'asha@example.com',
        Channel.EMAIL,
        user,
      )
      expect(mockEmailService.sendEmail).not.toHaveBeenCalled()
    })
  })

  describe('input validation', () => {
    it('rejects an unknown channel', async () => {
      await expect(
        httpStatusOf(
          service.sendMessage(
            { channel: 'fax' as any, to: '+9779812345678', body: 'x' },
            user,
          ),
        ),
      ).resolves.toBe(HttpStatus.BAD_REQUEST)
    })

    it('rejects a phone number that cannot be normalised, before any lookup', async () => {
      const promise = service.sendMessage(
        { channel: Channel.SMS, to: '9812345678', body: 'x' },
        user,
      )
      await expect(httpStatusOf(promise)).resolves.toBe(HttpStatus.BAD_REQUEST)
      expect(mockSuppressionService.isSuppressed).not.toHaveBeenCalled()
      expect(mockGatewayService.sendSMS).not.toHaveBeenCalled()
      expect(mockSendModel.create).not.toHaveBeenCalled()
    })

    it('rejects an invalid email address', async () => {
      const promise = service.sendMessage(
        { channel: Channel.EMAIL, to: 'asha@', subject: 's', body: 'x' },
        user,
      )
      await expect(httpBodyOf(promise)).resolves.toMatchObject({
        error: expect.stringContaining('not a valid email'),
      })
      expect(mockEmailService.sendEmail).not.toHaveBeenCalled()
    })

    it('rejects when neither body nor template is given', async () => {
      await expect(
        httpStatusOf(
          service.sendMessage(
            { channel: Channel.SMS, to: '+9779812345678' },
            user,
          ),
        ),
      ).resolves.toBe(HttpStatus.BAD_REQUEST)
    })

    it('rejects when both body and template are given', async () => {
      await expect(
        httpStatusOf(
          service.sendMessage(
            {
              channel: Channel.SMS,
              to: '+9779812345678',
              body: 'x',
              template: 'y',
            },
            user,
          ),
        ),
      ).resolves.toBe(HttpStatus.BAD_REQUEST)
      expect(mockTemplateModel.findOne).not.toHaveBeenCalled()
    })

    it('rejects an unknown template slug with 404 and sends nothing', async () => {
      mockTemplateModel.findOne.mockResolvedValue(null)
      const promise = service.sendMessage(
        { channel: Channel.SMS, to: '+9779812345678', template: 'nope' },
        user,
      )
      await expect(httpStatusOf(promise)).resolves.toBe(HttpStatus.NOT_FOUND)
      expect(mockGatewayService.sendSMS).not.toHaveBeenCalled()
      expect(mockSendModel.create).not.toHaveBeenCalled()
    })

    it('rejects a template whose channel does not match', async () => {
      mockTemplateModel.findOne.mockResolvedValue({
        channel: Channel.EMAIL,
        subject: 's',
        body: 'b',
      })
      await expect(
        httpStatusOf(
          service.sendMessage(
            {
              channel: Channel.SMS,
              to: '+9779812345678',
              template: 'mail-only',
            },
            user,
          ),
        ),
      ).resolves.toBe(HttpStatus.BAD_REQUEST)
    })

    it('rejects a render with missing merge tags instead of sending blanks', async () => {
      mockTemplateModel.findOne.mockResolvedValue({
        channel: Channel.SMS,
        body: 'Hi {{name}}, your code is {{code}}',
      })
      const promise = service.sendMessage(
        {
          channel: Channel.SMS,
          to: '+9779812345678',
          template: 'otp',
          vars: { name: 'Asha' },
        },
        user,
      )
      const body = await httpBodyOf(promise)
      expect(body.error).toContain('code')
      expect(body.missing).toEqual(['code'])
      expect(mockGatewayService.sendSMS).not.toHaveBeenCalled()
      expect(mockSendModel.create).not.toHaveBeenCalled()
    })

    it('counts missing tags in the email subject too', async () => {
      const promise = service.sendMessage(
        {
          channel: Channel.EMAIL,
          to: 'a@example.com',
          subject: 'Order {{order_id}}',
          body: 'Thanks',
        },
        user,
      )
      const body = await httpBodyOf(promise)
      expect(body.missing).toEqual(['order_id'])
    })

    it('rejects an email with no subject from either source', async () => {
      mockTemplateModel.findOne.mockResolvedValue({
        channel: Channel.EMAIL,
        body: 'b',
      })
      const promise = service.sendMessage(
        { channel: Channel.EMAIL, to: 'a@example.com', template: 'no-subject' },
        user,
      )
      await expect(httpBodyOf(promise)).resolves.toMatchObject({
        error: expect.stringContaining('subject'),
      })
    })

    it('refuses the marketing lane: this endpoint skips pacing', async () => {
      const promise = service.sendMessage(
        {
          channel: Channel.SMS,
          to: '+9779812345678',
          body: 'promo',
          lane: SendLane.MARKETING,
        },
        user,
      )
      await expect(httpStatusOf(promise)).resolves.toBe(HttpStatus.BAD_REQUEST)
      expect(mockGatewayService.sendSMS).not.toHaveBeenCalled()
    })
  })

  describe('devices', () => {
    it('refuses a device that belongs to someone else', async () => {
      mockGatewayService.getDeviceById.mockResolvedValue({
        _id: deviceId,
        user: new Types.ObjectId(),
        enabled: true,
      })
      const promise = service.sendMessage(
        {
          channel: Channel.SMS,
          to: '+9779812345678',
          body: 'x',
          deviceId: deviceId.toString(),
        },
        user,
      )
      await expect(httpStatusOf(promise)).resolves.toBe(HttpStatus.BAD_GATEWAY)
      expect(mockGatewayService.sendSMS).not.toHaveBeenCalled()
      expect(mockSendModel.findByIdAndUpdate).toHaveBeenCalledWith(sendId, {
        $set: expect.objectContaining({ status: SendStatus.FAILED }),
      })
    })

    it('fails clearly when the user has no enabled device', async () => {
      mockGatewayService.getDevicesForUser.mockResolvedValue([
        { _id: deviceId, enabled: false },
      ])
      const promise = service.sendMessage(
        { channel: Channel.SMS, to: '+9779812345678', body: 'x' },
        user,
      )
      const body = await httpBodyOf(promise)
      expect(body.error).toContain('No enabled device')
      expect(mockGatewayService.sendSMS).not.toHaveBeenCalled()
    })
  })

  describe('provider failures', () => {
    it('writes a failed ledger row and surfaces the gateway error', async () => {
      mockGatewayService.sendSMS.mockRejectedValue(
        new HttpException(
          { success: false, error: 'Failed to send SMS' },
          HttpStatus.BAD_REQUEST,
        ),
      )
      const promise = service.sendMessage(
        { channel: Channel.SMS, to: '+9779812345678', body: 'x' },
        user,
      )
      const body = await httpBodyOf(promise)

      expect(body).toMatchObject({
        id: sendId.toString(),
        status: SendStatus.FAILED,
        error: expect.stringContaining('Failed to send SMS'),
      })
      expect(mockSendModel.create).toHaveBeenCalledTimes(1)
      expect(mockSendModel.findByIdAndUpdate).toHaveBeenCalledWith(sendId, {
        $set: expect.objectContaining({
          status: SendStatus.FAILED,
          errorMessage: 'Failed to send SMS',
          failedAt: expect.any(Date),
        }),
      })
    })

    it('writes a failed ledger row when SMTP rejects the message', async () => {
      mockEmailService.sendEmail.mockRejectedValue(new Error('535 Auth failed'))
      const promise = service.sendMessage(
        {
          channel: Channel.EMAIL,
          to: 'a@example.com',
          subject: 's',
          body: 'b',
        },
        user,
      )
      await expect(httpStatusOf(promise)).resolves.toBe(HttpStatus.BAD_GATEWAY)
      expect(mockSendModel.findByIdAndUpdate).toHaveBeenCalledWith(sendId, {
        $set: expect.objectContaining({
          status: SendStatus.FAILED,
          errorMessage: '535 Auth failed',
        }),
      })
    })
  })
})
