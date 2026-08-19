import type { Locator, Page } from 'playwright'

interface RegisteredElement {
  ref: string
  locatorIndex: number
}

export class ElementRegistry {
  private snapshotId?: string
  private readonly elements = new Map<string, Locator>()

  replace(snapshotId: string, page: Page, selector: string, elements: RegisteredElement[]) {
    this.snapshotId = snapshotId
    this.elements.clear()
    const candidates = page.locator(selector)
    for (const element of elements) this.elements.set(element.ref, candidates.nth(element.locatorIndex))
  }

  resolve(snapshotId: string, elementRef: string) {
    if (snapshotId !== this.snapshotId) throw new Error(`页面快照已失效：${snapshotId}`)
    const locator = this.elements.get(elementRef)
    if (!locator) throw new Error(`元素引用不存在：${elementRef}`)
    return locator
  }

  invalidate() {
    this.snapshotId = undefined
    this.elements.clear()
  }

  get activeSnapshotId() {
    return this.snapshotId
  }
}
