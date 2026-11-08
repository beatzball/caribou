// Bluesky clients a test made, by user key. A test file's `vi.mock` of
// `@beatzball/caribou-mastodon-client` returns one of these from
// `createCaribouClient`, so `activeClient` is a real Bluesky client. This
// module imports nothing, so the mock can load it without a cycle.
//
// Until the session glue (#182) builds Bluesky clients, this is how a
// component test makes a Bluesky account active.
export const blueskyClients = new Map<string, unknown>()
