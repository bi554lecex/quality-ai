import { randomUUID } from 'node:crypto'
import type { Page } from 'playwright'
import { pageSnapshotSchema, type PageSnapshot, type SemanticElement } from '../shared/contracts'
import { ElementRegistry } from './element-registry'
import { observePageInBrowser } from './page-observer-browser.js'

export const interactiveElementSelector = [
  'a[href]',
  'button',
  'input:not([type="hidden"])',
  'textarea',
  'select',
  '[contenteditable="true"]',
  '[role="button"]',
  '[role="link"]',
  '[role="textbox"]',
  '[role="combobox"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="switch"]',
  '[role="tab"]',
  '[role="menuitem"]',
  '[role="option"]',
  '[role="treeitem"]',
].join(',')

interface ObserverOptions {
  maxElements?: number
  maxTextLength?: number
  maxTableRows?: number
}

interface ObservedElement extends SemanticElement {
  locatorIndex: number
}

interface RawObservation {
  loading: boolean
  discoveredElements: number
  elements: ObservedElement[]
  dialogs: PageSnapshot['dialogs']
  tables: PageSnapshot['tables']
  messages: PageSnapshot['messages']
}

export class PageObserver {
  readonly registry = new ElementRegistry()

  constructor(private readonly options: ObserverOptions = {}) {}

  async observe(page: Page): Promise<PageSnapshot> {
    const snapshotId = randomUUID()
    const maxElements = this.options.maxElements ?? 300
    const maxTextLength = this.options.maxTextLength ?? 160
    const maxTableRows = this.options.maxTableRows ?? 3
    const raw = await page.evaluate<RawObservation, {
      selector: string
      maxElements: number
      maxTextLength: number
      maxTableRows: number
    }>(observePageInBrowser as (options: {
      selector: string
      maxElements: number
      maxTextLength: number
      maxTableRows: number
    }) => RawObservation, {
      selector: interactiveElementSelector,
      maxElements,
      maxTextLength,
      maxTableRows,
    })

    this.registry.replace(snapshotId, page, interactiveElementSelector, raw.elements)
    return pageSnapshotSchema.parse({
      snapshotId,
      observedAt: new Date().toISOString(),
      url: page.url(),
      title: await page.title(),
      loading: raw.loading,
      elements: raw.elements.map(element => Object.fromEntries(
        Object.entries(element).filter(([key]) => key !== 'locatorIndex'),
      )),
      dialogs: raw.dialogs,
      tables: raw.tables,
      messages: raw.messages,
      stats: {
        discoveredElements: raw.discoveredElements,
        returnedElements: raw.elements.length,
        truncated: raw.discoveredElements > raw.elements.length,
      },
    })
  }
}
