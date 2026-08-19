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

- **anoma-envio-7**

  Poorly chosen name for the development deployment of the V2 indexer.

Envio watches this repository for new commits on a specific branch:

- **anoma-envio** @ `main`

  autodeploy: off

- **anoma-envio-dev** @ `next`

  autodeploy: on

- **anoma-envio-explorer-prod** @ `main`

  autodeploy: off

- **anoma-envio-explorer-dev** @ `next`

  autodeploy: off

- **anoma-envio-7** @ `heueristik/pa-v2-events`

  autodeploy: on

## Making a new deployment

### Trigger a new deployment

For the projects that have autodeploy set to on, the deployment will trigger
automatically whenever you commit to their branch. For the others, you need to
deploy them manually via the [Envio webportal](https://envio.dev/app/anoma).

Whenever you make a commit on the branch the deployment is monitoring, you will
see that commit show up in the dashboard. For example, if you look
[here](https://envio.dev/app/anoma/anoma-envio-dev) you will see that the
currently deployed commit is `d7aadd9`. Any new commit will be listed under
"latest commits". You can click "Deploy" on the right side of this commit to
deploy it as an indexer.

Keep in mind that you can deploy as many indexers as you want under a single
project, but you only get 750 hours per month, and a single deployment running
continuously burns ~730 of them. I.e., you can run 1 deployment for a month, or
2 deployments concurrently for half a month. ***Make sure to clean up old
deployments.***

### Deployment URLs

For a paid indexer the URLs are static. This means you can do an update and the
URL does not have to change. For a free deployment you have to update the URL
each time, because it is based on the commit hash of the deployment.

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
envio-cloud login              # browser auth, 30-day session
envio-cloud config set-org anoma
```

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

Add `-o json` to anything you want to parse, and `--yes` to skip the
confirmation prompts in automation. `envio-cloud deployment delete` and
`envio-cloud indexer delete` are both irreversible — `indexer delete` takes the
whole project, every deployment and all its data with it.

Two things this makes easier than the dashboard: the endpoint URL churn on the
free tier becomes `envio-cloud deployment endpoint ... -o json` in a script
rather than a manual copy out of the web page, and the hours budget becomes
something you can actually enforce, since listing and deleting stale deployments
is scriptable.

## When all else fails

If the indexer is borking for some unknown reason, you can always delete the
deployment and redeploy it. If you redeploy the same commit you do not have to
update the endpoint URLs, since they use the Git commit hash under the hood and
will not change if you deploy the same commit again.

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
