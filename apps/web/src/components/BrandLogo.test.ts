import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import BrandLogo from './BrandLogo.vue'

function geometry(svg: Element) {
  return createHash('sha256')
    .update(
      JSON.stringify(
        [...svg.querySelectorAll('g, path')].map((element) =>
          ['d', 'transform', 'fill', 'fill-rule'].map((name) => element.getAttribute(name)),
        ),
      ),
    )
    .digest('hex')
}

function assetContents(path: string) {
  return readFileSync(new URL(path, import.meta.url), 'utf8')
}

function asset(path: string) {
  return new DOMParser().parseFromString(assetContents(path), 'image/svg+xml').documentElement
}

describe('BrandLogo approved paragraph-p artwork', () => {
  it('ships the original Inter attribution and OFL license', () => {
    const license = assetContents('../../public/brand/Inter-OFL.txt')
    expect(createHash('sha256').update(license).digest('hex')).toBe(
      '5b9321a4298cfeb6b34354164a1c3afc3db114569984c502b9b35d988fd58c57',
    )
  })

  it('preserves the approved integrated geometry and inherits its foreground', () => {
    const wrapper = mount(BrandLogo)
    expect(wrapper.attributes('viewBox')).toBe('0 0 229 80')
    // Fingerprint from design/paragraph-p-logo:logo.svg (2691782), not a regenerated wordmark.
    expect(geometry(wrapper.element)).toBe(
      '4a9261d5fc942af035e67cb8c7b004ce45b1c6dac5b2f05329ff03ce47994f31',
    )
    expect(wrapper.findAll('path')).toHaveLength(9)
    expect(
      wrapper.findAll('[fill]').every((node) => node.attributes('fill') === 'currentColor'),
    ).toBe(true)
    wrapper.unmount()
  })

  it('provides one lowercase accessible name per instance without duplicate title IDs', () => {
    const wrapper = mount({
      components: { BrandLogo },
      template: '<div><BrandLogo /><BrandLogo /></div>',
    })
    for (const logo of wrapper.findAll('svg')) {
      expect(logo.attributes('role')).toBe('img')
      expect(logo.attributes('aria-label')).toBe('prosepect')
      expect(logo.attributes('focusable')).toBe('false')
      expect(logo.findAll('title, text, [id]')).toHaveLength(0)
    }
    expect(wrapper.findAll('svg')).toHaveLength(2)
    wrapper.unmount()
  })

  it('keeps the standalone export and adaptive favicon on the approved icon geometry', () => {
    const icon = asset('../../public/brand/icon.svg')
    const favicon = asset('../../public/favicon.svg')
    for (const svg of [icon, favicon]) {
      expect(svg.getAttribute('viewBox')).toBe('0 0 96 96')
      expect(geometry(svg)).toBe('71046ea50513a6422d6c64e5b20eca22f377a61ef4f9ec1ab30a7a873e0a705b')
    }
    expect(favicon.querySelector('style')?.textContent).toContain('prefers-color-scheme: dark')
    expect(favicon.querySelector('style')?.textContent).toContain('#0f172a')
    expect(favicon.querySelector('style')?.textContent).toContain('#f8fafc')
  })
})
