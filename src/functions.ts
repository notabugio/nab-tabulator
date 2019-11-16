import { CommentCommand, Query, Schema } from '@notabug/client'
import { all, query } from '@notabug/gun-scope'
import * as R from 'ramda'
import { NabTabulator } from './NabTabulator'

const WRITE_TIMEOUT = 2000

const diffNode = (existing: any, updated: any) => {
  const changedKeys = R.without(['_'], R.keysIn(updated)).filter(k => {
    const newVal = updated[k]
    const oldVal = R.prop(k, existing)

    return !R.equals(newVal, oldVal) && `${newVal}` !== `${oldVal}`
  })

  return R.pick(changedKeys, updated)
}

export const fullTabulateThing = query(async (scope, thingId) => {
  if (!thingId) {
    return null
  }
  const [up, down, comment, replySouls] = await all([
    scope.get(Schema.ThingVotesUp.route.reverse({ thingId })).count(),
    scope.get(Schema.ThingVotesDown.route.reverse({ thingId })).count(),
    scope.get(Schema.ThingAllComments.route.reverse({ thingId })).count(),
    scope.get(Schema.ThingComments.route.reverse({ thingId })).souls()
  ])
  const thingData = await Query.thingDataFromSouls(scope, replySouls)
  const result: any = {
    up,
    down,
    comment,
    replies: replySouls.length,
    score: up - down
  }

  if (thingData) {
    const commandMap = CommentCommand.map(thingData)
    const commandKeys = Object.keys(commandMap)
    if (commandKeys.length) {
      result.commands = JSON.stringify(commandMap)
    }
  }

  return result
})

export async function tabulateThing(peer: NabTabulator, thingId: string) {
  const startedAt = new Date().getTime()
  const scope = peer.newScope()

  const countsSoul = Schema.ThingVoteCounts.route.reverse({
    thingId,
    tabulator: peer.user().is.pub
  })

  if (!countsSoul) {
    return
  }

  try {
    const existingCounts = await scope.get(countsSoul).then()
    if (existingCounts && existingCounts.commands) {
      existingCounts.commands = JSON.stringify(existingCounts.commands || {})
    }
    const updatedCounts = await fullTabulateThing(scope, thingId)
    const diff = diffNode(existingCounts, updatedCounts)
    const diffKeys = Object.keys(diff)
    if (diffKeys.length) {
      console.log('diff', diff)
      await new Promise((ok, fail) => {
        const timeout = setTimeout(
          () => fail(new Error('Write timeout')),
          WRITE_TIMEOUT
        )

        function done(): void {
          clearTimeout(timeout)
          ok()
        }

        peer.get(countsSoul).put(diff, done)
      })
    }
  } catch (e) {
    console.error('Tabulator error', thingId, e.stack || e)
  } finally {
    scope.off()
  }

  const endedAt = new Date().getTime()
  console.log('tabulated', (endedAt - startedAt) / 1000, thingId)
}

export function idsToTabulate(msg: any) {
  const ids: ReadonlyArray<any> = []
  const put = msg && msg.put
  if (!put) {
    return ids
  }

  for (const soul in put) {
    if (!soul) {
      continue
    }

    const votesUpMatch = Schema.ThingVotesUp.route.match(soul)
    const votesDownMatch = Schema.ThingVotesDown.route.match(soul)
    const allCommentsMatch = Schema.ThingAllComments.route.match(soul)
    const thingId =
      (votesUpMatch || votesDownMatch || allCommentsMatch || {}).thingId || ''

    if (thingId && ids.indexOf(thingId) === -1) {
      // @ts-ignore
      ids.push(thingId)
    }
  }

  return ids
}
