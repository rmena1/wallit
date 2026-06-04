import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import postgres from 'postgres'

const DEFAULT_DATABASE_URL = 'postgresql://127.0.0.1:5432/wallit_e2e'
const databaseUrl = process.env.DATABASE_URL || DEFAULT_DATABASE_URL
const parsedDatabaseUrl = new URL(databaseUrl)

function quoteIdentifier(value) {
  return `"${value.replaceAll('"', '""')}"`
}

function commandExists(command) {
  return spawnSync('bash', ['-lc', `command -v ${command}`], { stdio: 'ignore' }).status === 0
}

function resolvePgBinary(name) {
  const candidates = [
    join(homedir(), `.cache/wallit-postgres/ubuntu-24.04/root/usr/lib/postgresql/16/bin/${name}`),
    `/usr/lib/postgresql/16/bin/${name}`,
    commandExists(name) ? name : null,
  ].filter(Boolean)

  const found = candidates.find(candidate => candidate === name || existsSync(candidate))
  if (!found) {
    throw new Error(`Could not find PostgreSQL binary: ${name}`)
  }
  return found
}

function runSync(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options })
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} exited with ${result.status}`)
  }
}

function pgIsReady(host, port) {
  const pgIsReadyBin = resolvePgBinary('pg_isready')
  const result = spawnSync(pgIsReadyBin, ['-h', host, '-p', String(port)], { stdio: 'ignore' })
  return result.status === 0
}

async function waitForPostgres(host, port) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (pgIsReady(host, port)) return
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  throw new Error(`PostgreSQL did not become ready on ${host}:${port}`)
}

async function ensureLocalPostgresRunning(url) {
  const host = url.hostname || '127.0.0.1'
  const port = Number(url.port || 5432)
  const isLocal = ['127.0.0.1', 'localhost', '::1'].includes(host)
  if (!isLocal) return
  if (pgIsReady(host, port)) return

  const cacheDir = join(homedir(), '.cache/wallit-postgres')
  const dataDir = join(cacheDir, 'data')
  const logFile = join(cacheDir, 'postgres.log')
  mkdirSync(cacheDir, { recursive: true })

  const initdb = resolvePgBinary('initdb')
  const postgresBin = resolvePgBinary('postgres')

  if (!existsSync(join(dataDir, 'PG_VERSION'))) {
    runSync(initdb, ['-D', dataDir, '--auth=trust', '--no-locale', '--encoding=UTF8'])
  }

  const out = spawnSync('bash', ['-lc', `: > ${JSON.stringify(logFile)}`])
  if (out.status !== 0) mkdirSync(dirname(logFile), { recursive: true })

  const child = spawn(postgresBin, ['-D', dataDir, '-h', host, '-p', String(port), '-k', cacheDir], {
    detached: true,
    stdio: ['ignore', 'ignore', 'ignore'],
  })
  child.unref()

  await waitForPostgres(host, port)
}

async function ensureDatabaseExists(url) {
  await ensureLocalPostgresRunning(url)

  const databaseName = decodeURIComponent(url.pathname.replace(/^\//, ''))

  if (!databaseName) {
    throw new Error('DATABASE_URL must include a database name')
  }

  const adminUrl = new URL(url)
  adminUrl.pathname = '/postgres'

  const admin = postgres(adminUrl.toString(), { max: 1 })
  try {
    const existing = await admin`SELECT 1 FROM pg_database WHERE datname = ${databaseName} LIMIT 1`
    if (existing.length === 0) {
      await admin.unsafe(`CREATE DATABASE ${quoteIdentifier(databaseName)}`)
      console.log(`Created E2E database ${databaseName}`)
    }
  } finally {
    await admin.end()
  }
}

function run(command, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      env,
      shell: process.platform === 'win32',
    })
    child.on('error', reject)
    child.on('exit', (code, signal) => {
      if (code === 0) resolve()
      else reject(new Error(`${command} ${args.join(' ')} exited with ${signal ?? code}`))
    })
  })
}

await ensureDatabaseExists(parsedDatabaseUrl)
await run('npm', ['run', 'db:migrate'], {
  ...process.env,
  DATABASE_URL: databaseUrl,
})
