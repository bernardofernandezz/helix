import { defineFixture } from '../component-fixtures/component-fixture'
import Landing from './Landing'

export const empty = defineFixture({
  width: 720,
  store: { repos: [] },
  render: () => (
    <div className="relative h-[720px]">
      <Landing />
    </div>
  )
})
