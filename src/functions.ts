import { query, all } from "@notabug/gun-scope"
import { Schema, CommentCommand, Query, GunNode } from "@notabug/peer"
import NabTabulator from "."

export const fullTabulateThing = query(async (scope, thingId) => {
  if (!thingId) return null
  const [up, down, comment, replySouls] = await all([
    scope.get(Schema.ThingVotesUp.route.reverse({ thingId })).count(),
    scope.get(Schema.ThingVotesDown.route.reverse({ thingId })).count(),
    scope.get(Schema.ThingAllComments.route.reverse({ thingId })).count(),
    scope.get(Schema.ThingComments.route.reverse({ thingId })).souls()
  ])
  const thingData = await Query.thingDataFromSouls(scope, replySouls)
  const result = {
    up,
    down,
    comment,
    replies: replySouls.length,
    score: up - down,
    commands: "{}"
  }

  if (thingData) {
    const commandMap = CommentCommand.map(thingData)
    const commandKeys = Object.keys(commandMap)
    if (commandKeys.length) result.commands = JSON.stringify(commandMap)
  }

  return result
})

export async function tabulateThing(peer: NabTabulator, thingId: string) {
  const countsSoul = Schema.ThingVoteCounts.route.reverse({
    thingId,
    tabulator: peer.user().is.pub
  })

  if (!countsSoul) return

  try {
    const scope = peer.newScope()
    const existingCounts = await scope.get(countsSoul).then()
    const updatedCounts = await fullTabulateThing(scope, thingId)
    const diff = GunNode.diff(existingCounts, updatedCounts)
    const diffKeys = Object.keys(diff)
    if (diffKeys.length) {
      await new Promise(ok => peer.get(countsSoul).put(diff, ok))
    }
    scope.off()
  } catch (e) {
    console.error("Tabulator error", thingId, e.stack || e)
  }
}

export function idsToTabulate(msg: any) {
  const ids = []
  const put = msg && msg.put
  if (!put) return ids

  for (let soul in put) {
    const thingDataMatch = Schema.ThingDataSigned.route.match(soul)
    const votesUpMatch = Schema.ThingVotesUp.route.match(soul)
    const votesDownMatch = Schema.ThingVotesDown.route.match(soul)
    const allCommentsMatch = Schema.ThingAllComments.route.match(soul)
    const thingId =
      (
        thingDataMatch ||
        votesUpMatch ||
        votesDownMatch ||
        allCommentsMatch ||
        {}
      ).thingId || ""

    if (thingId && ids.indexOf(thingId) === -1) {
      ids.push(thingId)
    }
  }

  return ids
}
