import { Channel, SMS_OPT_OUT_NOTICE } from '../sendline/sendline.enums'
import {
  ensureSmsOptOutNotice,
  hasOptOutInstruction,
  mergeVarsForContact,
  renderCampaignMessage,
} from './campaign-message'

describe('hasOptOutInstruction', () => {
  it('matches STOP in any case, anywhere', () => {
    expect(hasOptOutInstruction('Reply STOP to opt out')).toBe(true)
    expect(hasOptOutInstruction('text stop to leave')).toBe(true)
    expect(hasOptOutInstruction('Unsubscribe here')).toBe(false)
    expect(hasOptOutInstruction('')).toBe(false)
    expect(hasOptOutInstruction(undefined as any)).toBe(false)
  })
})

describe('ensureSmsOptOutNotice', () => {
  it('appends the notice once, separated by a space, trimming trailing whitespace', () => {
    expect(ensureSmsOptOutNotice('Sale today!  \n')).toBe(
      `Sale today! ${SMS_OPT_OUT_NOTICE}`,
    )
  })

  it('leaves a body that already says stop alone', () => {
    const body = 'Sale today! Text STOP to quit'
    expect(ensureSmsOptOutNotice(body)).toBe(body)
  })

  it('returns just the notice for an empty body', () => {
    expect(ensureSmsOptOutNotice('')).toBe(SMS_OPT_OUT_NOTICE)
  })
})

describe('mergeVarsForContact', () => {
  it('exposes name, phone, email, flat attributes and attributes.*', () => {
    const vars = mergeVarsForContact({
      name: 'Asha',
      phone: '+9779800000001',
      email: 'a@x.io',
      attributes: { shop_name: 'Asha Store' },
    })
    expect(vars).toMatchObject({
      name: 'Asha',
      phone: '+9779800000001',
      email: 'a@x.io',
      shop_name: 'Asha Store',
      attributes: { shop_name: 'Asha Store' },
    })
  })

  it('does not let an attribute shadow the contact name', () => {
    const vars = mergeVarsForContact({
      name: 'Asha',
      attributes: { name: 'Evil' },
    })
    expect(vars.name).toBe('Asha')
  })
})

describe('renderCampaignMessage', () => {
  const contact = {
    name: 'Asha',
    phone: '+9779800000001',
    email: 'asha@example.com',
    attributes: { shop_name: 'Asha Store' },
  }

  it('renders body tags and appends the SMS notice', () => {
    const result = renderCampaignMessage({
      template: { body: 'Hi {{name}}, {{shop_name}} has a sale' },
      contact,
      channel: Channel.SMS,
    })
    expect(result.body).toBe(
      `Hi Asha, Asha Store has a sale ${SMS_OPT_OUT_NOTICE}`,
    )
    expect(result.subject).toBeUndefined()
    expect(result.missing).toEqual([])
  })

  it('does not append the notice when the body already contains stop', () => {
    const result = renderCampaignMessage({
      template: { body: 'Hi {{name}}. Reply stop to leave.' },
      contact,
      channel: Channel.SMS,
    })
    expect(result.body).toBe('Hi Asha. Reply stop to leave.')
  })

  it('does not append the notice for transactional SMS', () => {
    const result = renderCampaignMessage({
      template: { body: 'Your code is 1234' },
      contact,
      channel: Channel.SMS,
      marketing: false,
    })
    expect(result.body).toBe('Your code is 1234')
  })

  it('renders the subject for email and never appends the SMS notice', () => {
    const result = renderCampaignMessage({
      template: { subject: 'For {{name}}', body: 'Hello {{name}}' },
      contact,
      channel: Channel.EMAIL,
    })
    expect(result.subject).toBe('For Asha')
    expect(result.body).toBe('Hello Asha')
  })

  it('collects missing tags from subject and body without duplicates', () => {
    const result = renderCampaignMessage({
      template: { subject: '{{coupon}}', body: '{{coupon}} {{nope}}' },
      contact,
      channel: Channel.EMAIL,
    })
    expect(result.missing.sort()).toEqual(['coupon', 'nope'])
  })
})
