import { HttpException, HttpStatus, Injectable } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { FilterQuery, Model, Types } from 'mongoose'
import { ContactList, ContactListDocument } from './schemas/contact-list.schema'
import { Contact, ContactDocument } from '../contacts/schemas/contact.schema'
import { User } from '../users/schemas/user.schema'
import { ContactListType } from '../sendline/sendline.enums'
import {
  compileListFilter,
  normalizeListFilter,
} from './list-filter-compilation'
import { CreateListDTO, UpdateListDTO } from './lists.dto'

export const LIST_MEMBERS_MAX_PAGE_SIZE = 100

@Injectable()
export class ListsService {
  constructor(
    @InjectModel(ContactList.name)
    private contactListModel: Model<ContactListDocument>,
    @InjectModel(Contact.name) private contactModel: Model<ContactDocument>,
  ) {}

  async createList(input: CreateListDTO, user: User): Promise<ContactList> {
    const name = this.requireName(input?.name)
    const type = this.requireType(input?.type ?? ContactListType.STATIC)

    const doc: Partial<ContactList> = {
      user: user._id,
      name,
      type,
      contactIds: [],
      filter: null,
    }

    if (type === ContactListType.STATIC) {
      doc.contactIds = await this.ownedContactIds(input?.contactIds, user)
    } else {
      doc.filter = normalizeListFilter(input?.filter)
    }

    return await this.contactListModel.create(doc)
  }

  async getListsForUser(user: User): Promise<ContactList[]> {
    return await this.contactListModel
      .find({ user: user._id })
      .sort({ createdAt: -1 })
  }

  async getListById(listId: string, user: User): Promise<ContactListDocument> {
    const list = Types.ObjectId.isValid(listId)
      ? await this.contactListModel.findOne({ _id: listId, user: user._id })
      : null

    if (!list) {
      throw new HttpException({ error: 'List not found' }, HttpStatus.NOT_FOUND)
    }
    return list
  }

  async updateList(
    listId: string,
    input: UpdateListDTO,
    user: User,
  ): Promise<ContactList> {
    const list = await this.getListById(listId, user)
    const changes: Partial<ContactList> = {}

    if (input?.name !== undefined) {
      changes.name = this.requireName(input.name)
    }

    const type =
      input?.type !== undefined ? this.requireType(input.type) : list.type
    if (type !== list.type) {
      changes.type = type
      // Switching kind clears the other kind's data so nothing stale lingers.
      if (type === ContactListType.STATIC) changes.filter = null
      if (type === ContactListType.DYNAMIC) changes.contactIds = []
    }

    if (type === ContactListType.STATIC && input?.contactIds !== undefined) {
      changes.contactIds = await this.ownedContactIds(input.contactIds, user)
    }
    if (type === ContactListType.DYNAMIC && input?.filter !== undefined) {
      changes.filter = normalizeListFilter(input.filter)
    }

    const updated = await this.contactListModel.findOneAndUpdate(
      { _id: list._id, user: user._id },
      { $set: changes },
      { new: true },
    )
    if (!updated) {
      throw new HttpException({ error: 'List not found' }, HttpStatus.NOT_FOUND)
    }
    return updated
  }

  async deleteList(listId: string, user: User): Promise<{ deleted: boolean }> {
    const list = await this.getListById(listId, user)
    await this.contactListModel.deleteOne({ _id: list._id, user: user._id })
    return { deleted: true }
  }

  /**
   * Contact ids that belong to the list right now. Static lists return their
   * stored ids; dynamic lists re-run their filter against the user's contacts.
   *
   * This is membership only. Consent and suppression checks belong to the
   * sender, which must still run them on every id returned here.
   */
  async resolveListMemberIds(
    listId: string,
    user: User,
  ): Promise<Types.ObjectId[]> {
    const list = await this.getListById(listId, user)

    if (list.type === ContactListType.DYNAMIC) {
      const ids: Types.ObjectId[] = await this.contactModel.distinct(
        '_id',
        this.memberQuery(list, user),
      )
      return ids
    }

    return [...(list.contactIds ?? [])]
  }

  async countListMembers(listId: string, user: User): Promise<number> {
    const list = await this.getListById(listId, user)

    if (list.type === ContactListType.DYNAMIC) {
      return await this.contactModel.countDocuments(
        this.memberQuery(list, user),
      )
    }

    return (list.contactIds ?? []).length
  }

  /** Paginated member documents for the UI. */
  async getListMembers(
    listId: string,
    user: User,
    page = 1,
    limit = 50,
  ): Promise<{ data: Contact[]; meta: any }> {
    const list = await this.getListById(listId, user)
    const safePage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1
    const safeLimit =
      Number.isFinite(limit) && limit > 0
        ? Math.min(Math.floor(limit), LIST_MEMBERS_MAX_PAGE_SIZE)
        : 50
    const query = this.memberQuery(list, user)

    const total = await this.contactModel.countDocuments(query)
    const data = await this.contactModel
      .find(query)
      .sort({ createdAt: -1 })
      .skip((safePage - 1) * safeLimit)
      .limit(safeLimit)

    return {
      data,
      meta: {
        total,
        page: safePage,
        limit: safeLimit,
        totalPages: Math.ceil(total / safeLimit),
        hasNextPage: safePage * safeLimit < total,
        hasPrevPage: safePage > 1,
      },
    }
  }

  async addContactsToList(
    listId: string,
    contactIds: string[],
    user: User,
  ): Promise<ContactList> {
    const list = await this.requireStaticList(listId, user)
    const ids = await this.ownedContactIds(contactIds, user)

    if (ids.length === 0) {
      throw new HttpException(
        { error: 'No contacts found for the given ids' },
        HttpStatus.BAD_REQUEST,
      )
    }

    return await this.contactListModel.findOneAndUpdate(
      { _id: list._id, user: user._id },
      { $addToSet: { contactIds: { $each: ids } } },
      { new: true },
    )
  }

  async removeContactsFromList(
    listId: string,
    contactIds: string[],
    user: User,
  ): Promise<ContactList> {
    const list = await this.requireStaticList(listId, user)
    const ids = this.parseObjectIds(contactIds)

    return await this.contactListModel.findOneAndUpdate(
      { _id: list._id, user: user._id },
      { $pull: { contactIds: { $in: ids } } },
      { new: true },
    )
  }

  /** The Contact query for a list, always scoped to its owner. */
  private memberQuery(list: ContactList, user: User): FilterQuery<Contact> {
    if (list.type === ContactListType.DYNAMIC) {
      return { ...compileListFilter(list.filter), user: user._id }
    }
    return { _id: { $in: list.contactIds ?? [] }, user: user._id }
  }

  private async requireStaticList(
    listId: string,
    user: User,
  ): Promise<ContactListDocument> {
    const list = await this.getListById(listId, user)
    if (list.type !== ContactListType.STATIC) {
      throw new HttpException(
        { error: 'Members of a dynamic list are defined by its filter' },
        HttpStatus.BAD_REQUEST,
      )
    }
    return list
  }

  /** Valid ObjectIds only, deduplicated. Rejects a non-array outright. */
  private parseObjectIds(value: unknown): Types.ObjectId[] {
    if (!Array.isArray(value)) {
      throw new HttpException(
        { error: 'contactIds must be an array of ids' },
        HttpStatus.BAD_REQUEST,
      )
    }
    const seen = new Set<string>()
    const ids: Types.ObjectId[] = []
    for (const item of value) {
      const raw =
        typeof item === 'string'
          ? item
          : item instanceof Types.ObjectId
            ? item.toString()
            : null
      if (!raw || !Types.ObjectId.isValid(raw) || seen.has(raw)) continue
      seen.add(raw)
      ids.push(new Types.ObjectId(raw))
    }
    return ids
  }

  /**
   * Narrows the given ids to contacts the user actually owns, so a list can
   * never reference somebody else's contact.
   */
  private async ownedContactIds(
    value: unknown,
    user: User,
  ): Promise<Types.ObjectId[]> {
    if (value === undefined || value === null) return []
    const ids = this.parseObjectIds(value)
    if (ids.length === 0) return []

    const owned: Types.ObjectId[] = await this.contactModel.distinct('_id', {
      _id: { $in: ids },
      user: user._id,
    })
    return owned
  }

  private requireName(value: unknown): string {
    const name = typeof value === 'string' ? value.trim() : ''
    if (!name) {
      throw new HttpException(
        { error: 'name is required' },
        HttpStatus.BAD_REQUEST,
      )
    }
    return name
  }

  private requireType(value: unknown): ContactListType {
    if (!Object.values(ContactListType).includes(value as ContactListType)) {
      throw new HttpException(
        {
          error: `type must be one of: ${Object.values(ContactListType).join(', ')}`,
        },
        HttpStatus.BAD_REQUEST,
      )
    }
    return value as ContactListType
  }
}
