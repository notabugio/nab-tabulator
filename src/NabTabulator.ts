import { ChainGunSear, GunGraph, GunProcessQueue } from "@notabug/chaingun-sear"
import SocketClusterGraphConnector from "@notabug/chaingun-socket-cluster-connector"
import { Query, Config } from "@notabug/peer"
import { idsToTabulate, tabulateThing } from "./functions"

interface Opts {
  socketCluster: any
}

const DEFAULT_OPTS: Opts = {
  socketCluster: {
    hostname: process.env.GUN_SC_HOST || "127.0.0.1",
    port: process.env.GUN_SC_PORT || 4444,
    path: process.env.GUN_SC_PATH || "/socketcluster",
    autoReconnect: true,
    autoReconnectOptions: {
      initialDelay: 1,
      randomness: 100,
      maxDelay: 500
    }
  }
}

Config.update({
  indexer: process.env.GUN_SC_PUB,
  tabulator: process.env.NAB_TABULATOR || process.env.GUN_SC_PUB
})

export class NabTabulator extends ChainGunSear {
  socket: SocketClusterGraphConnector
  tabulatorQueue: GunProcessQueue

  gun: ChainGunSear // temp compatibility thing for notabug-peer transition

  constructor(options = DEFAULT_OPTS) {
    const { socketCluster: scOpts, ...opts } = {
      ...DEFAULT_OPTS,
      ...options
    }

    const graph = new GunGraph()
    const socket = new SocketClusterGraphConnector(options.socketCluster)
    graph.connect(socket as any)

    super({ graph, ...opts })
    this.gun = this

    this.tabulatorQueue = new GunProcessQueue()
    this.tabulatorQueue.middleware.use(id => tabulateThing(this, id))

    this.socket = socket
    this.authenticateAndListen()
  }

  /**
   * Temporary compatibility measure for notabug-peer until logic is moved here
   */
  newScope(): any {
    return Query.createScope(this, { unsub: true })
  }

  /**
   * Temporary compatibility measure for notabug-peer until logic is moved here
   */
  isLoggedIn(): any {
    return this.user().is
  }

  didReceiveDiff(msg: any) {
    this.socket.ingest([msg])
    const ids = idsToTabulate(msg)
    if (ids.length) {
      this.tabulatorQueue.enqueueMany(ids)
    }
    this.tabulatorQueue.process()
  }

  authenticateAndListen() {
    if (process.env.GUN_SC_PUB && process.env.GUN_SC_PRIV) {
      this.socket
        .authenticate(process.env.GUN_SC_PUB, process.env.GUN_SC_PRIV)
        .then(() => {
          console.log(`Logged in as ${process.env.GUN_SC_PUB}`)
        })
        .catch(err => console.error("Error logging in:", err.stack || err))
    }

    if (process.env.GUN_ALIAS && process.env.GUN_PASSWORD) {
      this.user()
        .auth(process.env.GUN_ALIAS, process.env.GUN_PASSWORD)
        .then(() => {
          console.log(`Logged in as ${process.env.GUN_ALIAS}`)
          this.socket.subscribeToChannel(
            "gun/put/diff",
            this.didReceiveDiff.bind(this)
          )
        })
    }
  }
}
