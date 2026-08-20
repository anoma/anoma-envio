# Release checklist

The path is `next` for development, `main` for staging, and a tag for production.
`anoma-envio-stag` follows `main` on its own, so staging is already running the candidate
before you tag anything. Production (`anoma-envio`) has autodeploy off and is promoted by
hand, which is the only manual gate in the sequence.

Everything here is doable from the terminal. Set the org once so the commands below can
omit it:

```bash
envio-cloud login
envio-cloud config set-org anoma
```

## 1. Before tagging

Nothing reaches a tag without going through `next` first. `next` autodeploys to
`anoma-envio-dev`, so every change has already run as a live indexer before it is a release
candidate, and that run is the evidence to check.

- [ ] Every change in the release landed on `next` first, with CI green there.
- [ ] The `next` deployment ran the change without errors. Check the runtime logs for the
      commit itself, not just the exit status of CI:

```bash
envio-cloud indexer get anoma-envio-dev                          # commit live on next
envio-cloud deployment logs anoma-envio-dev COMMIT --since 1h
envio-cloud deployment logs anoma-envio-dev COMMIT --since 24h | grep -iE "error|panic|fatal"
```

A healthy indexer logs `TRACE` lines for block processing and nothing above them. Any
`ERROR` is a reason not to tag, even when CI passed, because CI never runs the handlers
against live chain data for more than the integration window.

- [ ] The apps that read the `next` indexer are still healthy. galileo reports per-chain
      progress, so it shows consumer-side lag directly:

```bash
curl -s https://galileo.dev.heliax.app/health | jq '{status, version, indexed_contracts}'
curl -s https://explorer.dev.heliax.app/health | jq
curl -s "https://explorer.dev.heliax.app/health/debug?key=$ADMIN_SECRET_KEY" | jq '.checks.indexer'
```

`status` should be `ok`, and the `last_block` per chain should track the chain rather than
sitting still. The explorer's debug endpoint also names the indexer URL it is actually
using, which is the fastest way to catch an app pointed at a stale deployment.

`ADMIN_SECRET_KEY` is the explorer's own admin secret, set on the explorer deployment and
read in its `config/runtime.exs`; `/health/debug` returns nothing without it. Export it in
your shell for these checks, do not paste it into a command you might share. Plain
`/health` needs no key and is enough for a liveness check.

- [ ] Everything intended for the release is merged into `main` and CI is green on it.
- [ ] After the merge, the staging consumers are still healthy. Note what this does and does
      not move: `anoma-envio-stag` redeploys itself from `main`, but galileo staging reads
      `anoma-envio-dev`, which follows `next`, so a merge to `main` does not change what
      galileo staging serves. The explorer indexers track `main` with autodeploy off, so
      they keep serving their previous commit until someone deploys them by hand. Check
      rather than assume:

```bash
envio-cloud indexer list -o json | jq -r '.data[] | "\(.indexer_id) \(.deployments[0].commit_hash)"'
curl -s https://galileo.dev.heliax.app/health | jq '.status'
```

- [ ] Contract addresses in `config.yaml` match the pa-evm release being indexed.
- [ ] `config.prod.yaml` is still in step with `config.yaml` for the chains production
      indexes. Production reads the former only; a change to the latter does not reach it.
- [ ] Staging has caught up on the candidate commit:

```bash
envio-cloud indexer get anoma-envio-stag              # which commit is live
envio-cloud deployment status anoma-envio-stag COMMIT --watch-till-synced
envio-cloud deployment metrics anoma-envio-stag COMMIT
```

- [ ] Staging answers real queries, not just a health check:

```bash
curl -s -X POST "$(envio-cloud deployment endpoint anoma-envio-stag COMMIT)" \
  -H "Content-Type: application/json" \
  -d '{"query":"{ Stats { transactions actions tags } ChainStats { chainId transactions } }"}'
```

Compare the per-chain counts against production before deciding the candidate is sound.

## 2. Tag it

- [ ] Bump `version` in `package.json`.
- [ ] Commit the bump, tag it, push both:

```bash
git tag vX.Y.Z
git push origin main --tags
```

- [ ] CI publishes the image under the tag name. Watch the Docker workflow rather than
      assuming it.

## 3. Deploy production

Production does not deploy itself. The commit must appear as `inactive` before it can be
deployed:

```bash
envio-cloud indexer commits anoma-envio            # find the release commit
envio-cloud deployment deploy anoma-envio COMMIT
envio-cloud deployment status anoma-envio COMMIT --watch-till-synced
```

- [ ] All chains report caught up. A fresh deployment rebuilds from scratch, which has
      taken under ten minutes on every deployment so far, so this is a wait, not a hang.

Do not promote the moment it syncs. Reaching head proves it backfilled; it does not prove it
keeps up, and a handler that throws on a particular event shape only shows once such an event
arrives. Let it run and watch it:

```bash
envio-cloud deployment logs anoma-envio COMMIT --follow          # polls every 10s
envio-cloud deployment metrics anoma-envio COMMIT --watch        # refreshes every 10s
```

- [ ] Logs stay at `TRACE` block processing with nothing above for the soak window. Give it
      long enough to cover normal traffic on the busiest chain rather than a fixed number of
      minutes.
- [ ] `latest_processed_block` keeps advancing with `block_height` instead of falling behind.
- [ ] A final error scan comes back empty:

```bash
envio-cloud deployment logs anoma-envio COMMIT --since 1h | grep -iE "error|panic|fatal"
```

If any of that is unhappy, stop here. The old deployment is still the promoted one, so
nothing is serving the new commit yet and there is nothing to roll back.

- [ ] Only once the soak is clean, promote it, which makes it the active deployment:

```bash
envio-cloud deployment promote anoma-envio COMMIT
```

- [ ] Query the production endpoint and confirm the counts match what staging showed.
- [ ] The production consumers are healthy against the newly promoted deployment:

```bash
curl -s https://galileo.prod.heliax.app/health | jq '{status, version, indexed_contracts}'
curl -s https://explorer.anoma.net/health | jq
curl -s "https://explorer.anoma.net/health/debug?key=$ADMIN_SECRET_KEY" | jq '.checks.indexer'
```

Give the `last_block` values a minute and re-read them; they should move. A consumer that
returns `ok` while its blocks are frozen is the failure this step exists to catch.

- [ ] The explorer production indexer is on the release commit too. It tracks `main` with
      autodeploy off, so it does not follow a merge; deploy it the same way as production
      above if it is behind.

## 4. Clean up

- [ ] Delete the superseded deployment. There is a hard cap of 3 per indexer, and a
      forgotten deployment keeps burning indexing hours:

```bash
envio-cloud indexer get anoma-envio                 # list what is still live
envio-cloud deployment delete anoma-envio OLD_COMMIT
```

- [ ] Check the other indexers picked up nothing unexpected:

```bash
envio-cloud indexer list -o json
```

## If it goes wrong

Restart first; it keeps the same commit and endpoint and is far less work than a redeploy.
There is a ten-minute cooldown, so it is not a retry loop.

```bash
envio-cloud deployment restart anoma-envio COMMIT
envio-cloud deployment logs anoma-envio COMMIT --since 1h
envio-cloud deployment logs anoma-envio COMMIT --build     # if it never started
```

If a restart does not fix it, roll back by deploying and promoting the previous release
commit, then investigate on staging rather than on production.

See [DEPLOYMENTS.md](DEPLOYMENTS.md) for what each indexer watches, the tier limits, and the
rest of the `envio-cloud` surface.
