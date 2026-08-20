# Envio deployments

In Envio there is an organisation, "Anoma", and under Anoma there are multiple
projects. Each project is an indexer in its own right, configured from this Git
repository.

Currently there are the following deployments:

- **anoma-envio**

  Production deployment for Galileo (galileo.prod.heliax.app)

- **anoma-envio-dev**

  Development deployment for Galileo (galileo.dex.heliax.app)

- **anoma-envio-explorer-prod**

  Production deployment for the explorer (explorer.prod.heliax.app)

- **anoma-envio-explorer-dev**

  Development deployment for the explorer (explorer.dev.heliax.app)

- **anoma-envio-dev-v2**

  Development deployment of the V2 indexer.

Envio watches this repository and redeploys on new commits to the branch each
project is pointed at. Regenerate this table with
`envio-cloud indexer settings get <indexer> anoma`:

| Indexer                     | Branch                    | Config file        | Autodeploy | Tier        |
| --------------------------- | ------------------------- | ------------------ | ---------- | ----------- |
| `anoma-envio`               | `main`                    | `config.prod.yaml` | off        | medium      |
| `anoma-envio-dev`           | `next`                    | `config.yaml`      | **on**     | small       |
| `anoma-envio-explorer-prod` | `main`                    | `config.yaml`      | off        | development |
| `anoma-envio-explorer-dev`  | `next`                    | `config.yaml`      | off        | development |
| `anoma-envio-dev-v2`        | `heueristik/pa-v2-events` | `config.yaml`      | **on**     | development |

Two things in that table are easy to miss. Production is the only project that
does not read `config.yaml`; it reads `config.prod.yaml`, so a change to the
former does not reach production and deleting the latter breaks the next
production deploy. And `anoma-envio-explorer-prod` is on the `development` tier
despite the name, which puts it under the free-tier URL churn described below.

## Making a new deployment

### Trigger a new deployment

For the projects that have autodeploy set to on, the deployment will trigger
automatically whenever you commit to their branch. For the others, you need to
deploy them manually via the [Envio webportal](https://envio.dev/app/anoma).

Whenever you make a commit on the branch the deployment is monitoring, you will
see that commit show up in the dashboard. For example, if you look
[here](https://envio.dev/app/anoma/anoma-envio-dev) you will see that the
currently deployed commit is `1cb322f`. Any new commit will be listed under
"latest commits". You can click "Deploy" on the right side of this commit to
deploy it as an indexer. Every commit hash in this file is a snapshot from
2026-08-19; `envio-cloud indexer get <indexer> anoma` is the live answer.

Keep in mind that you can deploy as many indexers as you want under a single
project, but you only get 750 hours per month, and a single deployment running
continuously burns ~730 of them. I.e., you can run 1 deployment for a month, or
2 deployments concurrently for half a month. ***Make sure to clean up old
deployments.***

### Deployment URLs

For a paid indexer the URLs are static. This means you can do an update and the
URL does not have to change. For a free deployment you have to update the URL
each time, because it changes per deployment.

Note that the identifier in the URL is not the Git commit hash, even though it
looks like one. `anoma-envio-dev-v2` is deployed at commit `6d9cc33` and serves
from `.../3084fc4/v1/graphql`; none of the five deployments has a URL segment
matching its commit. You cannot construct the endpoint from a commit; you have
to ask for it.

There are two paid deployments:

- anoma-envio
- anoma-envio-dev

***All other deployments are on the free tier and need their URLs updated when
you change them.***

If you have deployed a new indexer on the free plan, the URL can be found on the
deployment page.

For example, the current deployment for `anoma-envio-explorer-dev` is hash
`d7aadd9`, and you can see that deployment's status
[here](https://envio.dev/app/anoma/anoma-envio-explorer-dev/d7aadd9). On the
right side of the page you will see "Deployment Endpoint". This is a public URL
that allows you to call the GraphQL endpoint.

Mind you, this is sensitive data and should not be shared publicly or used in
the front-end. It is not free to call (usage limits), and we cannot secure it
unless we pay for it. So be careful where you use this URL. ***It should never
be used in a front-end setting, only in a back-end one.***

Worth re-checking, though: Envio does expose endpoint API keys and IP allowlists
(`envio-cloud indexer security api-key enable` and `... security add-ip`). Which
tiers they are available on is not something this file can answer, so treat the
sentence above as the safe default until someone confirms otherwise.

## Doing all of this from the CLI

Everything above can be driven from the terminal instead of the dashboard, which
is what you want for scripting, CI, and agents. The tool is a separate package
from the `envio` CLI this repository depends on:

```bash
npm install -g envio-cloud     # or run it as: npx envio-cloud <command>
envio-cloud login              # first step; browser auth, 30-day session
envio-cloud config set-org anoma
```

Every command below `login` requires auth, so the login is not optional, and the
rest fail without it. Credentials land in `$HOME/.envio-cloud.yaml`, and
`envio-cloud token` reports whether the current session is still good.

For CI, log in with a GitHub token carrying `read:org`, `read:user`, and
`user:email` instead of the browser flow:

```bash
export ENVIO_GITHUB_TOKEN=...
envio-cloud login
```

The manual steps above map to these commands:

| Task                       | Command                                                            |
| -------------------------- | ------------------------------------------------------------------ |
| See what is deployed       | `envio-cloud indexer get anoma-envio-dev`                          |
| List deployable commits    | `envio-cloud indexer commits anoma-envio-dev`                      |
| Deploy a commit            | `envio-cloud deployment deploy INDEXER COMMIT`                     |
| Watch a deployment sync    | `envio-cloud deployment status INDEXER COMMIT --watch-till-synced` |
| Get the GraphQL endpoint   | `envio-cloud deployment endpoint INDEXER COMMIT`                   |
| Tail logs                  | `envio-cloud deployment logs INDEXER COMMIT --follow`              |
| Clean up an old deployment | `envio-cloud deployment delete INDEXER COMMIT`                     |
| Check or flip autodeploy   | `envio-cloud indexer settings get INDEXER ORG`                     |

Most commands take `-o json` for parsing, and the ones that mutate take `-y` /
`--yes` to skip the confirmation prompt in automation. Note that `-o` is a
per-command flag, not a global one; the only global flags are `--config`,
`--org`, `--indexer`, and `-q`.

`envio-cloud deployment delete` and `envio-cloud indexer delete` are both
irreversible. `indexer delete` takes the whole project, every deployment and
all its data with it.

Two log-fetching details that matter when you are chasing an incident: `--limit`
caps at 100 lines, and the initial fetch only looks back 30 minutes for runtime
logs (24 hours for `--build`) unless you widen it with `--since 24h`. The
ceiling is 7 days for runtime and 30 days for build, so anything older than that
is gone. `--follow` polls every 10 seconds rather than streaming.

Two things this makes easier than the dashboard: the endpoint URL churn on the
free tier becomes `envio-cloud deployment endpoint ... -o json` in a script
rather than a manual copy out of the web page, and the hours budget becomes
something you can actually enforce, since listing and deleting stale deployments
is scriptable.

## When all else fails

If the indexer is borking for some unknown reason, you can always delete the
deployment and redeploy it. Redeploying the same commit is believed to keep the
same endpoint URL, but since the URL is not derived from the commit hash (see
above), confirm with `envio-cloud deployment endpoint` afterwards rather than
assuming it.

There was an instance where the indexers stopped working due to an upstream RPC
being naughty. The simple fix is to delete the current deployment, wait until
it is removed, and then deploy that same commit again. The instructions for
deploying are written above.

There is also a first-class restart, which is less work than the delete-and-wait
dance and keeps the same commit and endpoint:

```bash
envio-cloud deployment restart INDEXER COMMIT
```

There is a 10-minute cooldown between restarts, so it is not a retry loop.
