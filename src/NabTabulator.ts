import LmdbGraphConnector from '@notabug/chaingun-lmdb'
import { ChainGunSear, GunGraph, GunProcessQueue } from '@notabug/chaingun-sear'
import SocketClusterGraphConnector from '@notabug/chaingun-socket-cluster-connector'
import { pubFromSoul, unpackNode } from '@notabug/gun-sear'
import { Config, Query } from '@notabug/peer'
import { idsToTabulate, tabulateThing } from './functions'

const READ_TIMEOUT = 2000

interface Opts {
  readonly socketCluster: any
  readonly lmdb?: any
}

const DEFAULT_OPTS: Opts = {
  lmdb: {
    mapSize: 1024 ** 4,
    path: process.env.LMDB_PATH || './data'
  },
  socketCluster: {
    autoReconnect: true,
    hostname: process.env.GUN_SC_HOST || '127.0.0.1',
    path: process.env.GUN_SC_PATH || '/socketcluster',
    port: process.env.GUN_SC_PORT || 4444
  }
}

Config.update({
  indexer: process.env.GUN_SC_PUB,
  tabulator: process.env.NAB_TABULATOR || process.env.GUN_SC_PUB
})

export class NabTabulator extends ChainGunSear {
  protected readonly socket: SocketClusterGraphConnector
  protected readonly lmdb: LmdbGraphConnector
  protected readonly tabulatorQueue: GunProcessQueue

  constructor(options = DEFAULT_OPTS) {
    const { socketCluster: scOpts, lmdb: lmdbOpts, ...opts } = {
      ...DEFAULT_OPTS,
      ...options
    }

    const graph = new GunGraph()
    const lmdb = new LmdbGraphConnector(lmdbOpts)
    lmdb.sendRequestsFromGraph(graph as any)
    const socket = new SocketClusterGraphConnector(options.socketCluster)
    socket.sendPutsFromGraph(graph as any)
    graph.connect(lmdb as any)

    super({ graph, ...opts })
    socket.socket.on('connect', this.authenticate.bind(this))
    this.lmdb = lmdb
    this.directRead = this.directRead.bind(this)

    this.tabulatorQueue = new GunProcessQueue()
    this.tabulatorQueue.middleware.use(id => tabulateThing(this, id))

    this.socket = socket
    this.socket.subscribeToChannel(
      'gun/put/diff',
      this.didReceiveDiff.bind(this)
    )
  }

  public newScope(): any {
    return Query.createScope(
      { gun: this },
      {
        getter: this.directRead,
        unsub: true
      }
    )
  }

  public authenticate(): void {
    if (process.env.GUN_ALIAS && process.env.GUN_PASSWORD && !this.user().is) {
      this.user()
        .auth(process.env.GUN_ALIAS, process.env.GUN_PASSWORD)
        .then(() => {
          // tslint:disable-next-line: no-console
          console.log(`Logged in as ${process.env.GUN_ALIAS}`)
        })
    }
  }

  protected directRead(soul: string): Promise<any> {
    return new Promise((ok, fail) => {
      const timeout = setTimeout(
        () => fail(new Error('Read timeout')),
        READ_TIMEOUT
      )

      function done(val: any): void {
        clearTimeout(timeout)
        ok(val)
      }

      this.lmdb.get({
        cb: (msg: any) => {
          const node = (msg && msg.put && msg.put[soul]) || undefined
          if (pubFromSoul(soul)) {
            unpackNode(node, 'mutable')
          }

          done(node)
        },
        soul
      })
    })
  }

  protected didReceiveDiff(msg: any): void {
    const ids = idsToTabulate(msg)
    if (ids.length) {
      this.tabulatorQueue.enqueueMany(ids)
    }
    this.tabulatorQueue.process()
  }
}
