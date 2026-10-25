import { Test, TestingModule } from '@nestjs/testing'
import { getModelToken } from '@nestjs/mongoose'
import { HttpException, HttpStatus } from '@nestjs/common'
import { Types } from 'mongoose'
import { ListsService } from './lists.service'
import { ContactList } from './schemas/contact-list.schema'
import { Contact } from '../contacts/schemas/contact.schema'
import { ContactListType } from '../sendline/sendline.enums'
import { User } from '../users/schemas/user.schema'

describe('ListsService', () => {
  let service: ListsService

  const mockListModel = {
    create: jest.fn(),
    find: jest.fn(),
    findOne: jest.fn(),
    findOneAndUpdate: jest.fn(),
    deleteOne: jest.fn(),
  }

  const mockContactModel = {
    distinct: jest.fn(),
    countDocuments: jest.fn(),
    find: jest.fn(),
  }

  const user = { _id: new Types.ObjectId() } as User
  const listId = new Types.ObjectId()
  const contactA = new Types.ObjectId()
  const contactB = new Types.ObjectId()

  const staticList = {
    _id: listId,
    user: user._id,
    name: 'Static',
    type: ContactListType.STATIC,
    contactIds: [contactA, contactB],
    filter: null,
  }

  const dynamicList = {
    _id: listId,
    user: user._id,
    name: 'Dynamic',
    type: ContactListType.DYNAMIC,
    contactIds: [],
    filter: { tagsInclude: ['vip'], smsConsent: true, bogus: 'ignored' },
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
        ListsService,
        { provide: getModelToken(ContactList.name), useValue: mockListModel },
        { provide: getModelToken(Contact.name), useValue: mockContactModel },
      ],
    }).compile()

    service = module.get<ListsService>(ListsService)

    jest.clearAllMocks()
  })

  describe('createList', () => {
    it('creates a static list keeping only contacts the user owns', async () => {
      mockContactModel.distinct.mockResolvedValue([contactA])
      mockListModel.create.mockImplementation(async (doc) => doc)

      const created = await service.createList(
        {
          name: 'Static',
          contactIds: [contactA.toString(), 'junk', contactB.toString()],
        },
        user,
      )

      expect(mockContactModel.distinct).toHaveBeenCalledWith('_id', {
        _id: { $in: [contactA, contactB] },
        user: user._id,
      })
      expect(created.type).toBe(ContactListType.STATIC)
      expect(created.contactIds).toEqual([contactA])
      expect(created.filter).toBeNull()
    })

    it('creates a dynamic list with a normalized filter', async () => {
      mockListModel.create.mockImplementation(async (doc) => doc)

      const created = await service.createList(
        {
          name: 'Dynamic',
          type: ContactListType.DYNAMIC,
          filter: { tagsInclude: ['vip'], $where: 'x' } as any,
        },
        user,
      )

      expect(created.filter).toEqual({ tagsInclude: ['vip'] })
      expect(created.contactIds).toEqual([])
      expect(mockContactModel.distinct).not.toHaveBeenCalled()
    })

    it('rejects a blank name and an unknown type', async () => {
      await expect(
        statusOf(service.createList({ name: ' ' }, user)),
      ).resolves.toBe(HttpStatus.BAD_REQUEST)
      await expect(
        statusOf(service.createList({ name: 'x', type: 'smart' as any }, user)),
      ).resolves.toBe(HttpStatus.BAD_REQUEST)
    })
  })

  describe('resolveListMemberIds', () => {
    it('returns the stored ids for a static list', async () => {
      mockListModel.findOne.mockResolvedValue(staticList)

      const ids = await service.resolveListMemberIds(listId.toString(), user)

      expect(ids).toEqual([contactA, contactB])
      expect(mockContactModel.distinct).not.toHaveBeenCalled()
    })

    it('runs the compiled, user-scoped filter for a dynamic list', async () => {
      mockListModel.findOne.mockResolvedValue(dynamicList)
      mockContactModel.distinct.mockResolvedValue([contactB])

      const ids = await service.resolveListMemberIds(listId.toString(), user)

      expect(mockContactModel.distinct).toHaveBeenCalledWith('_id', {
        tags: { $in: ['vip'] },
        smsConsent: true,
        user: user._id,
      })
      expect(ids).toEqual([contactB])
    })

    it('throws 404 for a list the user does not own', async () => {
      mockListModel.findOne.mockResolvedValue(null)

      await expect(
        statusOf(service.resolveListMemberIds(listId.toString(), user)),
      ).resolves.toBe(HttpStatus.NOT_FOUND)
      expect(mockListModel.findOne).toHaveBeenCalledWith({
        _id: listId.toString(),
        user: user._id,
      })
    })
  })

  describe('countListMembers', () => {
    it('counts static lists locally and dynamic lists in the database', async () => {
      mockListModel.findOne.mockResolvedValue(staticList)
      expect(await service.countListMembers(listId.toString(), user)).toBe(2)

      mockListModel.findOne.mockResolvedValue(dynamicList)
      mockContactModel.countDocuments.mockResolvedValue(7)
      expect(await service.countListMembers(listId.toString(), user)).toBe(7)
      expect(mockContactModel.countDocuments).toHaveBeenCalledWith({
        tags: { $in: ['vip'] },
        smsConsent: true,
        user: user._id,
      })
    })
  })

  describe('addContactsToList', () => {
    it('adds owned contacts with $addToSet', async () => {
      mockListModel.findOne.mockResolvedValue(staticList)
      mockContactModel.distinct.mockResolvedValue([contactA])
      mockListModel.findOneAndUpdate.mockResolvedValue(staticList)

      await service.addContactsToList(
        listId.toString(),
        [contactA.toString()],
        user,
      )

      expect(mockListModel.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: listId, user: user._id },
        { $addToSet: { contactIds: { $each: [contactA] } } },
        { new: true },
      )
    })

    it('rejects when none of the ids belong to the user', async () => {
      mockListModel.findOne.mockResolvedValue(staticList)
      mockContactModel.distinct.mockResolvedValue([])

      await expect(
        statusOf(
          service.addContactsToList(
            listId.toString(),
            [new Types.ObjectId().toString()],
            user,
          ),
        ),
      ).resolves.toBe(HttpStatus.BAD_REQUEST)
      expect(mockListModel.findOneAndUpdate).not.toHaveBeenCalled()
    })

    it('refuses to edit the members of a dynamic list', async () => {
      mockListModel.findOne.mockResolvedValue(dynamicList)

      await expect(
        statusOf(
          service.addContactsToList(
            listId.toString(),
            [contactA.toString()],
            user,
          ),
        ),
      ).resolves.toBe(HttpStatus.BAD_REQUEST)
    })
  })

  describe('removeContactsFromList', () => {
    it('pulls the given ids', async () => {
      mockListModel.findOne.mockResolvedValue(staticList)
      mockListModel.findOneAndUpdate.mockResolvedValue(staticList)

      await service.removeContactsFromList(
        listId.toString(),
        [contactA.toString(), 'junk'],
        user,
      )

      expect(mockListModel.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: listId, user: user._id },
        { $pull: { contactIds: { $in: [contactA] } } },
        { new: true },
      )
    })

    it('rejects a non-array body', async () => {
      mockListModel.findOne.mockResolvedValue(staticList)

      await expect(
        statusOf(
          service.removeContactsFromList(listId.toString(), 'abc' as any, user),
        ),
      ).resolves.toBe(HttpStatus.BAD_REQUEST)
    })
  })

  describe('updateList', () => {
    it('clears contactIds when switching a static list to dynamic', async () => {
      mockListModel.findOne.mockResolvedValue(staticList)
      mockListModel.findOneAndUpdate.mockResolvedValue(dynamicList)

      await service.updateList(
        listId.toString(),
        { type: ContactListType.DYNAMIC, filter: { hasPhone: true } },
        user,
      )

      expect(mockListModel.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: listId, user: user._id },
        {
          $set: {
            type: ContactListType.DYNAMIC,
            contactIds: [],
            filter: { hasPhone: true },
          },
        },
        { new: true },
      )
    })
  })
})
