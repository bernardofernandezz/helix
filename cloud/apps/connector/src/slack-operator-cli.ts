import { text } from 'node:stream/consumers'
import { openConnectorDatabase } from './connector-database.js'
import { decodeSlackTokenKey } from './slack-config.js'
import { runSlackOperator } from './slack-operator.js'

// pnpm --filter @helix-cloud/connector slack-operator <command>, with the service's database env.
const env = process.env
const database = await openConnectorDatabase({
  ...(env.HELIX_CONNECTOR_DATABASE_URL ? { databaseUrl: env.HELIX_CONNECTOR_DATABASE_URL } : {}),
  dataDir: env.HELIX_CONNECTOR_DATA_DIR || './data/connector',
  poolMax: 1,
  applicationName: 'helix-connector-slack-operator'
})
try {
  const output = await runSlackOperator(process.argv.slice(2), {
    database,
    ...(env.HELIX_CONNECTOR_SLACK_TOKEN_KEY
      ? { tokenKey: decodeSlackTokenKey(env.HELIX_CONNECTOR_SLACK_TOKEN_KEY) }
      : {}),
    readSecret: () => text(process.stdin),
    now: Date.now
  })
  console.log(output)
} catch (error) {
  console.error(error instanceof Error ? error.message : 'failed')
  process.exitCode = 1
} finally {
  await database.close()
}
