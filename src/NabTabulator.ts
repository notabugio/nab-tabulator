import createAdapter from '@chaingun/node-adapters'
import {
  Config,
  createFederationAdapter,
  GunGraphAdapter,
  GunProcessQueue,
  NotabugClient
} from '@notabug/client'
import fs from 'fs'
import yaml from 'js-yaml'
import { tabulateThing } from './functions'
import { processDiff } from './tabulator'

Config.update({
  indexer: process.env.GUN_SC_PUB,
  tabulator: process.env.NAB_TABULATOR || process.env.GUN_SC_PUB
})

const PEERS_CONFIG_FILE = './peers.yaml'

let peersConfigTxt = ''

try {
  peersConfigTxt = fs.readFileSync(PEERS_CONFIG_FILE).toString()
} catch (e) {
  // tslint:disable-next-line: no-console
  console.warn('Peers config missing', PEERS_CONFIG_FILE, e.stack)
}

const peerUrls = yaml.safeLoad(peersConfigTxt) || []

export class NabTabulator extends NotabugClient {
  public readonly internalAdapter: GunGraphAdapter
  protected readonly tabulatorQueue: GunProcessQueue<any>
  protected readonly diffTabulatorQueue: GunProcessQueue<any>

  constructor(...opts) {
    const internalAdapter = createAdapter()
    const dbAdapter = createFederationAdapter(
      internalAdapter,
      peerUrls,
      internalAdapter,
      {
        putToPeers: true
      }
    )
    super(dbAdapter, ...opts)
    this.internalAdapter = internalAdapter
    this.socket.socket.on('connect', this.authenticate.bind(this))
    this.tabulatorQueue = new GunProcessQueue()
    this.tabulatorQueue.middleware.use(id => tabulateThing(this, id))
    this.diffTabulatorQueue = new GunProcessQueue()
    this.diffTabulatorQueue.middleware.use(diff => processDiff(this, diff))

    this.socket.subscribeToChannel(
      'gun/put/diff',
      this.didReceiveDiff.bind(this)
    )
  }

  protected async didReceiveDiff(msg: any): Promise<void> {
    if (msg.put) {
      await this.internalAdapter.put(msg.put)
    }

    if (msg && msg.put) {
      this.diffTabulatorQueue.enqueue(msg.put)
      this.diffTabulatorQueue.process()
    }

    /*
    const ids = idsToTabulate(msg)
    if (ids.length) {
      this.tabulatorQueue.enqueueMany(ids)
    }
    this.tabulatorQueue.process()
    */
  }
}
