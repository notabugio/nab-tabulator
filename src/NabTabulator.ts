import createAdapter from '@chaingun/node-adapters'
import { Config, GunProcessQueue, NotabugClient } from '@notabug/client'
import { tabulateThing } from './functions'
import { processDiff } from './tabulator'

Config.update({
  indexer: process.env.GUN_SC_PUB,
  tabulator: process.env.NAB_TABULATOR || process.env.GUN_SC_PUB
})

export class NabTabulator extends NotabugClient {
  protected readonly tabulatorQueue: GunProcessQueue<any>
  protected readonly diffTabulatorQueue: GunProcessQueue<any>

  constructor(...opts) {
    const dbAdapter = createAdapter()
    super(dbAdapter, ...opts)
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

  protected didReceiveDiff(msg: any): void {
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
