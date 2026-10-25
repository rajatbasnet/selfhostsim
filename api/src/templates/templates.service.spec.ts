import { Test, TestingModule } from '@nestjs/testing'
import { getModelToken } from '@nestjs/mongoose'
import { HttpException, HttpStatus } from '@nestjs/common'
import { Types } from 'mongoose'
import { TemplatesService } from './templates.service'
import { MessageTemplate } from './schemas/template.schema'
import { Channel } from '../sendline/sendline.enums'
import { User } from '../users/schemas/user.schema'

describe('TemplatesService', () => {
  let service: TemplatesService

  const mockTemplateModel = {
    create: jest.fn(),
    find: jest.fn(),
    findOne: jest.fn(),
    findOneAndUpdate: jest.fn(),
    deleteOne: jest.fn(),
  }

  const user = { _id: new Types.ObjectId() } as User
  const templateId = new Types.ObjectId()

  const smsTemplate = {
    _id: templateId,
    user: user._id,
    name: 'Welcome',
    slug: 'welcome',
    channel: Channel.SMS,
    body: 'Hi {{first_name}}, thanks from {{attributes.shop_name}}',
  }

  const statusOf = (promise: Promise<unknown>) =>
    promise.then(
      () => {
        throw new Error('expected rejection')
      },
      (error: HttpException) => error.getStatus(),
    )

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TemplatesService,
        {
          provide: getModelToken(MessageTemplate.name),
          useValue: mockTemplateModel,
        },
      ],
    }).compile()

    service = module.get<TemplatesService>(TemplatesService)

    jest.clearAllMocks()
  })

  describe('createTemplate', () => {
    it('creates an SMS template scoped to the user', async () => {
      mockTemplateModel.findOne.mockResolvedValue(null)
      mockTemplateModel.create.mockImplementation(async (doc) => doc)

      const created = await service.createTemplate(
        {
          name: '  Welcome ',
          slug: 'Welcome',
          channel: Channel.SMS,
          subject: 'ignored for sms',
          body: 'Hi {{first_name}}',
        },
        user,
      )

      expect(mockTemplateModel.findOne).toHaveBeenCalledWith({
        user: user._id,
        slug: 'welcome',
      })
      expect(mockTemplateModel.create).toHaveBeenCalledWith({
        user: user._id,
        name: 'Welcome',
        slug: 'welcome',
        channel: Channel.SMS,
        subject: undefined,
        body: 'Hi {{first_name}}',
      })
      expect(created.slug).toBe('welcome')
    })

    it('rejects an email template with no subject', async () => {
      await expect(
        statusOf(
          service.createTemplate(
            { name: 'x', channel: Channel.EMAIL, body: 'body' },
            user,
          ),
        ),
      ).resolves.toBe(HttpStatus.BAD_REQUEST)
      expect(mockTemplateModel.create).not.toHaveBeenCalled()
    })

    it('rejects a blank body, missing name and unknown channel', async () => {
      await expect(
        statusOf(
          service.createTemplate(
            { name: 'x', channel: Channel.SMS, body: '   ' },
            user,
          ),
        ),
      ).resolves.toBe(HttpStatus.BAD_REQUEST)
      await expect(
        statusOf(
          service.createTemplate(
            { name: '', channel: Channel.SMS, body: 'b' },
            user,
          ),
        ),
      ).resolves.toBe(HttpStatus.BAD_REQUEST)
      await expect(
        statusOf(
          service.createTemplate(
            { name: 'x', channel: 'fax' as Channel, body: 'b' },
            user,
          ),
        ),
      ).resolves.toBe(HttpStatus.BAD_REQUEST)
      expect(mockTemplateModel.create).not.toHaveBeenCalled()
    })

    it('rejects a malformed slug', async () => {
      await expect(
        statusOf(
          service.createTemplate(
            { name: 'x', slug: 'has space', channel: Channel.SMS, body: 'b' },
            user,
          ),
        ),
      ).resolves.toBe(HttpStatus.BAD_REQUEST)
    })

    it('enforces a unique slug per user', async () => {
      mockTemplateModel.findOne.mockResolvedValue({ _id: 'other' })

      await expect(
        statusOf(
          service.createTemplate(
            { name: 'x', slug: 'welcome', channel: Channel.SMS, body: 'b' },
            user,
          ),
        ),
      ).resolves.toBe(HttpStatus.CONFLICT)
      expect(mockTemplateModel.create).not.toHaveBeenCalled()
    })

    it('maps a duplicate-key race to 409', async () => {
      mockTemplateModel.findOne.mockResolvedValue(null)
      mockTemplateModel.create.mockRejectedValue({ code: 11000 })

      await expect(
        statusOf(
          service.createTemplate(
            { name: 'x', slug: 'welcome', channel: Channel.SMS, body: 'b' },
            user,
          ),
        ),
      ).resolves.toBe(HttpStatus.CONFLICT)
    })

    it('skips the slug lookup when no slug is given', async () => {
      mockTemplateModel.create.mockImplementation(async (doc) => doc)

      await service.createTemplate(
        { name: 'x', channel: Channel.EMAIL, subject: 's', body: 'b' },
        user,
      )

      expect(mockTemplateModel.findOne).not.toHaveBeenCalled()
    })
  })

  describe('getTemplateById', () => {
    it('throws 404 for an invalid id without hitting the database', async () => {
      await expect(
        statusOf(service.getTemplateById('not-an-id', user)),
      ).resolves.toBe(HttpStatus.NOT_FOUND)
      expect(mockTemplateModel.findOne).not.toHaveBeenCalled()
    })

    it('scopes the lookup to the user', async () => {
      mockTemplateModel.findOne.mockResolvedValue(null)

      await expect(
        statusOf(service.getTemplateById(templateId.toString(), user)),
      ).resolves.toBe(HttpStatus.NOT_FOUND)
      expect(mockTemplateModel.findOne).toHaveBeenCalledWith({
        _id: templateId.toString(),
        user: user._id,
      })
    })
  })

  describe('getTemplatesForUser', () => {
    it('filters by user and optional channel', async () => {
      const sort = jest.fn().mockResolvedValue([smsTemplate])
      mockTemplateModel.find.mockReturnValue({ sort })

      const result = await service.getTemplatesForUser(user, Channel.SMS)

      expect(mockTemplateModel.find).toHaveBeenCalledWith({
        user: user._id,
        channel: Channel.SMS,
      })
      expect(result).toEqual([smsTemplate])
    })
  })

  describe('updateTemplate', () => {
    it('requires a subject when switching an SMS template to email', async () => {
      mockTemplateModel.findOne.mockResolvedValue(smsTemplate)

      await expect(
        statusOf(
          service.updateTemplate(
            templateId.toString(),
            { channel: Channel.EMAIL },
            user,
          ),
        ),
      ).resolves.toBe(HttpStatus.BAD_REQUEST)
      expect(mockTemplateModel.findOneAndUpdate).not.toHaveBeenCalled()
    })

    it('checks slug uniqueness excluding the template itself', async () => {
      mockTemplateModel.findOne
        .mockResolvedValueOnce(smsTemplate)
        .mockResolvedValueOnce(null)
      mockTemplateModel.findOneAndUpdate.mockResolvedValue({
        ...smsTemplate,
        slug: 'hello',
      })

      const updated = await service.updateTemplate(
        templateId.toString(),
        { slug: 'hello' },
        user,
      )

      expect(mockTemplateModel.findOne).toHaveBeenLastCalledWith({
        user: user._id,
        slug: 'hello',
        _id: { $ne: templateId },
      })
      expect(mockTemplateModel.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: templateId, user: user._id },
        { $set: { slug: 'hello' } },
        { new: true },
      )
      expect(updated.slug).toBe('hello')
    })

    it('does not re-check uniqueness when the slug is unchanged', async () => {
      mockTemplateModel.findOne.mockResolvedValue(smsTemplate)
      mockTemplateModel.findOneAndUpdate.mockResolvedValue(smsTemplate)

      await service.updateTemplate(
        templateId.toString(),
        { slug: 'welcome', name: 'Renamed' },
        user,
      )

      expect(mockTemplateModel.findOne).toHaveBeenCalledTimes(1)
    })
  })

  describe('deleteTemplate', () => {
    it('deletes only the user-owned template', async () => {
      mockTemplateModel.findOne.mockResolvedValue(smsTemplate)
      mockTemplateModel.deleteOne.mockResolvedValue({ deletedCount: 1 })

      const result = await service.deleteTemplate(templateId.toString(), user)

      expect(mockTemplateModel.deleteOne).toHaveBeenCalledWith({
        _id: templateId,
        user: user._id,
      })
      expect(result).toEqual({ deleted: true })
    })
  })

  describe('renderPreview', () => {
    it('renders an SMS template with missing tags and a segment count', async () => {
      mockTemplateModel.findOne.mockResolvedValue(smsTemplate)

      const preview = await service.renderPreview(
        templateId.toString(),
        { attributes: { shop_name: 'Your Shop' } },
        user,
      )

      expect(preview).toEqual({
        channel: Channel.SMS,
        text: 'Hi , thanks from Your Shop',
        missing: ['first_name'],
        segments: { encoding: 'GSM-7', characters: 26, segments: 1 },
      })
    })

    it('renders the subject for email and merges its missing tags', async () => {
      mockTemplateModel.findOne.mockResolvedValue({
        ...smsTemplate,
        channel: Channel.EMAIL,
        subject: 'Order {{order_id}} for {{first_name}}',
      })

      const preview = await service.renderPreview(
        templateId.toString(),
        { attributes: { shop_name: 'Your Shop' } },
        user,
      )

      expect(preview.subject).toBe('Order  for ')
      expect(preview.text).toBe('Hi , thanks from Your Shop')
      expect(preview.missing).toEqual(['first_name', 'order_id'])
      expect(preview.segments).toBeUndefined()
    })

    it('treats null vars as empty and rejects arrays', async () => {
      mockTemplateModel.findOne.mockResolvedValue(smsTemplate)

      const preview = await service.renderPreview(
        templateId.toString(),
        null,
        user,
      )
      expect(preview.missing).toEqual(['first_name', 'attributes.shop_name'])

      await expect(
        statusOf(service.renderPreview(templateId.toString(), [] as any, user)),
      ).resolves.toBe(HttpStatus.BAD_REQUEST)
    })

    it('never leaves a literal merge tag in the output', async () => {
      mockTemplateModel.findOne.mockResolvedValue({
        ...smsTemplate,
        body: '{{a}} {{ b }} {{__proto__}} {{c.d}}',
      })

      const preview = await service.renderPreview(
        templateId.toString(),
        {},
        user,
      )

      expect(preview.text).not.toMatch(/\{\{\s*[a-zA-Z0-9_.-]+\s*\}\}/)
    })
  })
})
