import { expect, test } from 'claude-code/testing'

import { rangeChoices } from '../hooks/orbitview'
import { SETTINGS } from '../hooks/prefs'
import type { Setting } from '../hooks/prefs'

const numeric = (range: [number, number]): Setting => ({
  ...SETTINGS.find(s => s.key === 'logRows')!,
  range,
})

test('a short range offers every integer, including negative values, in numeric order', () => {
  expect(rangeChoices(numeric([-2, 2]), '0', '1')).toEqual(['-2', '-1', '0', '1', '2'])
})

test('a range of exactly twelve values still offers every integer', () => {
  expect(rangeChoices(numeric([3, 14]), '7', '10')).toEqual([
    '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14',
  ])
})

test('a range of thirteen values switches to six evenly spaced rounded choices', () => {
  expect(rangeChoices(numeric([0, 12]), '0', '12')).toEqual(['0', '2', '5', '7', '10', '12'])
})

test('a wider range offers six choices including both ends', () => {
  expect(rangeChoices(numeric([0, 100]), '0', '100')).toEqual(['0', '20', '40', '60', '80', '100'])
})

test('the current value and default are kept even when neither is a sampled choice', () => {
  expect(rangeChoices(numeric([0, 100]), '25', '75')).toEqual(['0', '20', '25', '40', '60', '75', '80', '100'])
})

test('overlapping current, default and sampled choices occur only once', () => {
  expect(rangeChoices(numeric([0, 100]), '40', '40')).toEqual(['0', '20', '40', '60', '80', '100'])
})

test('absent current and default values do not add an empty choice', () => {
  expect(rangeChoices(numeric([0, 100]), '', '')).toEqual(['0', '20', '40', '60', '80', '100'])
})

test('pane widths include the common sizes without duplicates and put max last', () => {
  const pane = SETTINGS.find(s => s.key === 'paneColumns')!
  expect(rangeChoices(pane, '80', 'max')).toEqual([
    '40', '60', '80', '100', '120', '232', '424', '615', '807', '999', 'max',
  ])
})
