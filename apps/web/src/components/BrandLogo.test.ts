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

describe('BrandLogo rakkio artwork', () => {
  it('ships the original Inter attribution and OFL license', () => {
    const license = assetContents('../../public/brand/Inter-OFL.txt')
    expect(createHash('sha256').update(license).digest('hex')).toBe(
      '5b9321a4298cfeb6b34354164a1c3afc3db114569984c502b9b35d988fd58c57',
    )
  })

  it('preserves the outlined rakkio geometry and inherits its foreground', () => {
    const wrapper = mount(BrandLogo)
    expect(wrapper.attributes('viewBox')).toBe('0 0 97 40')
    // Fingerprint of the reviewed six-letter outlined Inter wordmark.
    expect(geometry(wrapper.element)).toBe(
      '1493ec4631e0ac1173c579851cde6ea5d13f01adfaac295b32bff7340c61c198',
    )
    expect(wrapper.findAll('path')).toHaveLength(6)
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
      expect(logo.attributes('aria-label')).toBe('rakkio')
      expect(logo.attributes('focusable')).toBe('false')
      expect(logo.findAll('title, text, [id]')).toHaveLength(0)
    }
    expect(wrapper.findAll('svg')).toHaveLength(2)
    wrapper.unmount()
  })

  it('keeps the standalone export and adaptive favicon on the rakkio icon geometry', () => {
    const icon = asset('../../public/brand/icon.svg')
    const favicon = asset('../../public/favicon.svg')
    for (const svg of [icon, favicon]) {
      expect(svg.getAttribute('viewBox')).toBe('0 0 96 96')
      expect(geometry(svg)).toBe('7626162eea33d35d96fea59f75b3e4080d4b2a98eb94f0b35bad487dad9f2c67')
    }
    expect(favicon.querySelector('style')?.textContent).toContain('prefers-color-scheme: dark')
    expect(favicon.querySelector('style')?.textContent).toContain('#0f172a')
    expect(favicon.querySelector('style')?.textContent).toContain('#f8fafc')
  })
})
